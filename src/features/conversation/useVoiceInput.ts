"use client";

import { useEffect, useRef, useState } from "react";
import {
  RECORDING_LIMITS,
  transcriptionResultSchema,
  audioFormat,
} from "@/contracts/transcription";
import {
  recordingError,
  startRecording,
  type Recording,
  type RecordingHandle,
} from "./audio-recording";

type Phase = "idle" | "permission" | "recording" | "transcribing";
type Options = {
  contextKey: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onTranscript: (text: string) => boolean;
};

/** 协调录音和转写；操作令牌隔离取消/重录后的迟到权限与网络结果。 */
export function useVoiceInput(options: Options) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState("");
  const [uninserted, setUninserted] = useState("");
  const active = useRef<AbortController | null>(null);
  const recording = useRef<RecordingHandle | null>(null);
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    // 草稿开始提交后，不再保留“请核对后发送”的旧成功提示。
    if (options.disabled && !active.current) setMessage("");
  }, [options.disabled]);

  /** 先失效旧操作，再停止设备/请求；取消不回填文本、不发送回答。 */
  function cancel(notice = "已取消，原有文字已保留。") {
    const controller = active.current;
    active.current = null;
    recording.current = null;
    controller?.abort();
    latest.current.onBusyChange(false);
    setPhase("idle");
    setMessage(notice);
  }

  useEffect(() => {
    setPhase("idle");
    setMessage("");
    setUninserted("");
    // 移动端切到后台会暂停录音计时；直接取消，避免隐蔽的超长采集。
    const hide = () => {
      if (document.hidden && active.current)
        cancel("已暂停录音操作，原有文字已保留。");
    };
    const leave = () => {
      if (active.current) cancel();
    };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hide);
    return () => {
      const controller = active.current;
      active.current = null;
      controller?.abort();
      latest.current.onBusyChange(false);
      recording.current = null;
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hide);
    };
    // 回调从 latest 读取，输入草稿的更新不应重新申请设备。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.contextKey]);

  /** 只有用户确认后启动；成功结果仅交给草稿入口，绝不调用 turns。 */
  async function start() {
    if (active.current || latest.current.disabled || uninserted) return;
    const controller = new AbortController();
    active.current = controller;
    latest.current.onBusyChange(true);
    setPhase("permission");
    setSeconds(0);
    setMessage("");
    const current = () => active.current === controller;
    let stage = "permission";
    const permissionTimer = window.setTimeout(() => {
      if (current()) cancel("等待麦克风权限超时，请允许后再点录音。");
    }, 20_000);
    try {
      const handle = await startRecording(controller.signal, (elapsed) => {
        if (current()) setSeconds(elapsed);
      });
      window.clearTimeout(permissionTimer);
      if (!current()) return;
      recording.current = handle;
      stage = "recording";
      setPhase("recording");
      const captured = await handle.result;
      if (!current()) return;
      recording.current = null;
      stage = "transcription";
      setPhase("transcribing");
      const text = await requestTranscript(captured, controller.signal);
      if (!current()) return;
      if (latest.current.onTranscript(text)) {
        setMessage("已填入输入框，请核对后发送。");
      } else {
        setUninserted(text);
        setMessage(
          "加上原有文字会超过 2,000 字，未覆盖草稿。请精简后填入，或选中下方文字复制。",
        );
      }
    } catch (error) {
      if (current()) {
        setMessage(recordingError(error));
        console.warn(
          JSON.stringify({
            event: "voice_input_failed",
            stage,
            errorType: error instanceof Error ? error.name : "UnknownError",
          }),
        );
      }
    } finally {
      window.clearTimeout(permissionTimer);
      if (current()) {
        active.current = null;
        recording.current = null;
        controller.abort();
        latest.current.onBusyChange(false);
        setPhase("idle");
      }
    }
  }

  /** 超长合并保留完整转写，用户缩短草稿后可明确再次填入。 */
  function insert() {
    if (latest.current.disabled || !uninserted) return;
    if (latest.current.onTranscript(uninserted)) {
      setUninserted("");
      setMessage("已填入输入框，请核对后发送。");
    }
  }

  return {
    phase,
    seconds,
    message,
    uninserted,
    start,
    cancel,
    insert,
    stop: () => recording.current?.stop(),
    dismiss: () => {
      setUninserted("");
      setMessage("");
    },
  };
}

/** 一次上传完整音频，设置独立超时；不自动重试、不手动设置 multipart boundary。 */
async function requestTranscript(recording: Recording, signal: AbortSignal) {
  const form = new FormData();
  const format = audioFormat(recording.audio.type);
  if (!format) throw new Error("录音格式不支持，请使用文字输入。");
  form.append("audio", recording.audio, "recording." + format.extension);
  form.append("durationMs", String(recording.durationMs));
  const timeout = AbortSignal.timeout(RECORDING_LIMITS.requestTimeoutMs);
  let response: Response;
  try {
    response = await fetch("/api/transcriptions", {
      method: "POST",
      body: form,
      signal: AbortSignal.any([signal, timeout]),
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) {
      console.warn(
        JSON.stringify({
          event: "transcription_request_failed",
          code: result.error?.code,
          requestId: result.error?.requestId,
          status: response.status,
        }),
      );
      throw new TranscriptionError(
        result.error?.message ?? "语音识别失败，请重新录制。",
      );
    }
    const parsed = transcriptionResultSchema.safeParse(result);
    if (!parsed.success)
      throw new TranscriptionError("识别结果为空或过长，请缩短回答后重录。");
    return parsed.data.text;
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof TranscriptionError) throw error;
    if (timeout.aborted)
      throw new Error("语音识别超时，请重新录制或继续打字。");
    throw new Error("语音识别连接中断，请检查网络后重录；原有文字已保留。");
  }
}

class TranscriptionError extends Error {}
