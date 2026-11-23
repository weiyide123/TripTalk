"use client";

import { useEffect, useRef, useState } from "react";
import type { MutationResult, SessionView } from "@/contracts/views";
import type { TurnRequest } from "@/contracts/requests";
import { api, ApiError } from "@/lib/api";
import { appendTranscript } from "@/contracts/transcription";
import {
  EMPTY_COMPOSER,
  failureFrom,
  readComposer,
  saveComposer,
  type Composer,
  type Submission,
} from "./submission-state";

type State = Composer & {
  session: SessionView | null;
  busy: boolean;
  ready: boolean;
  error: string;
  storageWarning: boolean;
};

export function useConversationSubmission(sessionId: string) {
  const [state, setState] = useState<State>({
    ...EMPTY_COMPOSER,
    session: null,
    busy: false,
    ready: false,
    error: "",
    storageWarning: false,
  });
  const latest = useRef(state);
  const lock = useRef(false);
  const mounted = useRef(false);

  function update(patch: Partial<State>) {
    if (!mounted.current) return;
    const next = {
      ...latest.current,
      ...patch,
    };
    if (next.ready) {
      next.storageWarning = !saveComposer(sessionId, {
        draft: next.draft,
        explainMode: next.explainMode,
        submission: next.submission,
      });
    }
    latest.current = next;
    setState(next);
  }

  /** 用服务端回执确认消息；确认旧请求时不触碰用户的新草稿。 */
  function accept(fresh: SessionView) {
    const current = latest.current;
    if (current.session && fresh.revision < current.session.revision) {
      fresh = current.session;
    }
    const submission = current.submission;
    if (!submission) {
      update({
        session: fresh,
        error: "",
      });
      return "idle";
    }
    const operation = submission.operation;
    if (fresh.processedRequestIds.includes(operation.requestId)) {
      // 历史和临时消息原子切换；草稿已在首次发送时消费。
      update({
        session: fresh,
        submission: null,
        error: "",
      });
      return "committed";
    }
    if (fresh.revision !== operation.expectedRevision) {
      update({
        session: fresh,
        submission: {
          ...submission,
          status: "conflict",
        },
        error: "",
      });
      return "conflict";
    }
    update({
      session: fresh,
      error: "",
    });
    return "unconfirmed";
  }

  async function synchronize() {
    return accept(await api<SessionView>("/sessions/" + sessionId));
  }

  useEffect(() => {
    mounted.current = true;
    let alive = true;
    update({
      ...readComposer(sessionId),
      ready: true,
      busy: true,
    });
    lock.current = true;
    void api<SessionView>("/sessions/" + sessionId)
      .then((fresh) => {
        if (alive) accept(fresh);
      })
      .catch((error) => {
        if (alive) update({ error: failureFrom(error).message });
      })
      .finally(() => {
        if (alive) {
          lock.current = false;
          update({ busy: false });
        }
      });
    return () => {
      alive = false;
      mounted.current = false;
    };
    // 页面由 sessionId 作为 key；不要因输入变化重新读取服务端。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function refresh() {
    if (lock.current) return;
    lock.current = true;
    update({
      busy: true,
      error: "",
    });
    try {
      await synchronize();
    } catch (error) {
      update({ error: failureFrom(error).message });
    } finally {
      lock.current = false;
      update({ busy: false });
    }
  }

  async function reconcile(submission: Submission) {
    update({
      submission: {
        ...submission,
        status: "checking",
      },
    });
    try {
      const result = await synchronize();
      if (result === "unconfirmed") {
        update({
          submission: {
            ...submission,
            status: submission.status === "failed" ? "failed" : "unknown",
          },
        });
      }
      return result;
    } catch {
      // GET 未查到/失败都不能证明原 POST 已停止，不允许改内容绕过去。
      update({
        submission: {
          ...submission,
          status: submission.status === "failed" ? "failed" : "unknown",
        },
      });
      return "unavailable";
    }
  }

  async function post(submission: Submission) {
    update({
      submission: {
        ...submission,
        status: "sending",
        failure: null,
      },
    });
    const operation = submission.operation;
    const route = operation.action === "continue" ? "/continue" : "/turns";
    try {
      const result = await api<MutationResult>(
        "/sessions/" + sessionId + route,
        operation,
      );
      accept(result.session);
      // 成功响应必须能核对到该操作，否则保留备忘，不假定提交成功。
      if (latest.current.submission?.status === "sending") {
        update({
          submission: {
            ...submission,
            status: "unknown",
          },
        });
      }
    } catch (error) {
      const failed: Submission = {
        ...submission,
        status:
          error instanceof ApiError && error.submission === "not_committed"
            ? "failed"
            : "unknown",
        failure: failureFrom(error),
      };
      update({ submission: failed });
      if (failed.status === "unknown") await reconcile(failed);
    }
  }

  /** 新消息接管输入框内容；重试只复用原请求，不消费当前草稿。 */
  async function send(action: TurnRequest["action"], retry = false) {
    const current = latest.current;
    if (lock.current || !current.session) return;
    const previous = current.submission;
    if (retry && (!previous || previous.status === "conflict")) return;
    if (!retry && previous?.status === "unknown") return;
    const text =
      action === "answer" || action === "explain" ? current.draft.trim() : "";
    if (!retry && (action === "answer" || action === "explain") && !text)
      return;
    lock.current = true;
    update({
      busy: true,
      error: "",
    });
    try {
      if (retry && previous) {
        if ((await reconcile(previous)) !== "unconfirmed") return;
        await post(previous); // 原内容、ID、版本保持不变，编辑后的草稿不参与。
      } else {
        const submission: Submission = {
          operation: {
            requestId: crypto.randomUUID(),
            expectedRevision: current.session.revision,
            action,
            text,
          },
          status: "sending",
          failure: null,
        };
        // 同一次暂存中保存完整消息并清空输入，失败后仍可从气泡重试。
        // 求助和恢复操作没有输入正文，不能清掉尚未发送的草稿。
        const consumesDraft = action === "answer" || action === "explain";
        update({
          submission,
          draft: consumesDraft ? "" : current.draft,
          explainMode: consumesDraft ? false : current.explainMode,
        });
        await post(submission);
      }
    } finally {
      lock.current = false;
      update({ busy: false });
    }
  }

  const action = state.explainMode ? "explain" : "answer";
  const unknown = state.submission?.status === "unknown";
  let sendLabel = state.explainMode ? "请 Jane 解释" : "发送";
  if (unknown) sendLabel = "核对状态";

  /** 输入区发送新草稿；未知结果必须先核对，原消息重试由气泡负责。 */
  async function submitDraft() {
    if (unknown) {
      await refresh();
      return;
    }
    await send(action);
  }

  /** 转写只能追加到最新草稿；不截断、不改解释模式，也不触发回答提交。 */
  function insertTranscript(text: string) {
    if (lock.current || !mounted.current) return false;
    const draft = appendTranscript(latest.current.draft, text);
    if (draft === null) return false;
    update({ draft });
    return true;
  }

  return {
    ...state,
    lock,
    sendLabel,
    refresh,
    send,
    submitDraft,
    insertTranscript,
    setDraft: (draft: string) => update({ draft }),
    setExplainMode: (explainMode: boolean) => update({ explainMode }),
    retry: () =>
      state.submission && send(state.submission.operation.action, true),
    unresolved: unknown || state.submission?.status === "checking",
  };
}
