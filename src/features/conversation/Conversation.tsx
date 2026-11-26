"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SessionView, TeachingTurnView } from "@/contracts/views";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { CopyButton } from "@/components/CopyButton";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useConversationSubmission } from "./useConversationSubmission";
import { PendingMessage, SubmissionNotice } from "./SubmissionStatus";
import { TranslatableText } from "@/components/TranslatableText";
import { VoiceInput } from "./VoiceInput";
import { ReplyGuidance, collectQuestionHints } from "./ReplyGuidance";
import { RecommendationButton } from "./RecommendationButton";
import {
  ConversationFavorites,
  FavoriteButton,
  FavoriteStatus,
} from "../favorites/ConversationFavorites";
import {
  canFavoriteLearnerAnswer,
  type FavoriteSource,
} from "@/contracts/favorite";
import { requestSentenceTranslation } from "../favorites/useSentenceTranslation";
import { useSourceLocation, type SourceLocation } from "./useSourceLocation";
import {
  SentencePlaybackContext,
  SentencePlayButton,
  useSentencePlayback,
} from "./SentencePlayback";

const ACTION_LABELS = {
  answer: "",
  explain: " · 词句解释",
};

export function Conversation({
  sessionId,
  source,
}: {
  sessionId: string;
  source?: SourceLocation;
}) {
  const router = useRouter();
  const {
    session,
    draft,
    error,
    busy,
    submission,
    explainMode,
    storageWarning,
    lock,
    sendLabel,
    refresh,
    send,
    submitDraft,
    retry,
    unresolved,
    setDraft,
    setExplainMode,
    insertTranscript,
  } = useConversationSubmission(sessionId);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [hiddenExampleId, setHiddenExampleId] = useState<string | null>(null);
  const playback = useSentencePlayback(
    `${sessionId}:${session?.revision}`,
    voiceBusy,
  );
  const voiceLock = useRef(false);
  const operationBusy = busy || voiceBusy;
  // 同步锁先于 React 渲染更新，避免录音启动与 Enter 发送发生竞争。
  function changeVoiceBusy(value: boolean) {
    if (value) playback.stop();
    voiceLock.current = value;
    setVoiceBusy(value);
  }
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveTarget = useRef<string | null>(null);
  const history = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const location = useSourceLocation(history, !!session, source);
  useEffect(() => {
    if (location.shouldLocate) return;
    history.current?.scrollTo({
      top: history.current.scrollHeight,
      behavior: "instant",
    });
  }, [session?.revision, busy, submission?.operation.requestId]);
  // After the answer and next question arrive together, keep typing friction low.
  useEffect(() => {
    if (source) return;
    if (!busy && session?.status === "active" && session.revision > 0)
      input.current?.focus({ preventScroll: true });
  }, [busy, session?.currentQuestion?.id, session?.status]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (lock.current || voiceLock.current || draft.trim() || submission) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft, submission, lock]);
  function leave(target: string | null = null) {
    if (lock.current) return;
    leaveTarget.current = target;
    if (voiceLock.current || draft.trim() || submission) {
      setLeaveOpen(true);
      return;
    }
    returnHome();
  }
  function returnHome() {
    if (lock.current) return;
    setLeaveOpen(false);
    playback.stop();
    router.push(
      leaveTarget.current ??
        (session ? "/?scene=" + encodeURIComponent(session.sceneId) : "/"),
    );
  }
  function fill(text: string) {
    if (
      draft.trim() &&
      draft !== text &&
      !window.confirm("用这条参考表达替换当前草稿吗？")
    )
      return;
    setDraft(text);
    setExplainMode(false);
    setHiddenExampleId(hints.example?.turnId ?? null);
    input.current?.focus();
  }
  const current = session?.currentQuestion;
  const awaiting = session?.status === "awaiting_continue";
  const done = session?.status === "topic_completed";
  const currentTurns =
    session?.turns.filter(
      (t): t is TeachingTurnView =>
        (t.action === "answer" ||
          t.action === "hint" ||
          t.action === "explain") &&
        t.questionId === current?.id,
    ) ?? [];
  const hints = collectQuestionHints(currentTurns);
  const exampleOpen =
    !!hints.example && hints.example.turnId !== hiddenExampleId;
  let hintLabel = "给点提示";
  if (hints.keywords) hintLabel = "再给点提示";
  if (hints.pattern) hintLabel = "看参考表达";
  if (hints.example) hintLabel = exampleOpen ? "收起参考表达" : "看参考表达";
  /** 已生成的参考只切换展示；未生成的下一级仍沿用原求助请求与互斥保护。 */
  function requestHint() {
    if (operationBusy || unresolved) return;
    if (hints.example) {
      setHiddenExampleId(exampleOpen ? hints.example.turnId : null);
      return;
    }
    void send("hint");
  }
  const messageSubmission =
    submission &&
    (submission.operation.action === "answer" ||
      submission.operation.action === "explain")
      ? submission
      : null;
  const auxiliarySubmission =
    submission && !messageSubmission ? submission : null;
  const title = done
    ? "You did it! 又前进了一小步。"
    : (current?.english ?? "稍等，我来找找我们的进度…");
  let leaveDescription =
    "已提交的对话已保存。草稿暂存在当前标签页，不计入学习进度。";
  if (unresolved)
    leaveDescription =
      "这次提交尚未确认。返回后会核对记录；草稿暂存在当前标签页。";
  if (storageWarning)
    leaveDescription =
      "浏览器暂存不可用，离开会丢失当前草稿和重试备忘；已保存的对话不受影响。";
  if (voiceBusy)
    leaveDescription =
      "返回将取消当前录音或识别，已输入的文字仍暂存在当前标签页。已上传的音频可能已产生识别费用。";
  return (
    <ConversationFavorites
      key={sessionId}
      sessionId={sessionId}
    >
      <SentencePlaybackContext.Provider value={playback}>
        <AppShell
          compact
          onHome={() => leave()}
          onFavorites={() => leave("/favorites")}
          busy={busy}
          title={
            <TranslatableText
              key={current?.id ?? "status"}
              text={title}
              translation={done ? undefined : current?.chineseTranslation}
            />
          }
          subtitle={
            done
              ? `${session?.topicTitle}练习完成。让这份自信，陪你走向下一站。`
              : undefined
          }
          label={done ? "JANE · 为你的小进步庆祝" : "JANE · 旅行英语陪练"}
        >
          <main className="conversation-content">
            <FavoriteStatus />
            <div className="lesson-toolbar">
              <div>
                <h2>
                  {session?.sceneTitle ?? "旅行英语"}{" "}
                  <span>/ {session?.topicTitle ?? "读取中"}</span>
                </h2>
              </div>
              <div className="lesson-progress">
                <span>
                  {session
                    ? `已完成 ${session.completedCount} / ${session.totalCount} 个目标`
                    : "读取中…"}
                </span>
                <div className="progress-track">
                  <div
                    style={{
                      width: session
                        ? (session.completedCount / session.totalCount) * 100 +
                          "%"
                        : 0,
                    }}
                  />
                </div>
              </div>
              <button
                className="text-button lesson-return"
                aria-label="返回首页"
                disabled={busy}
                onClick={() => leave()}
              >
                <Icon
                  name="back"
                  size={13}
                />
                <span className="return-label">返回首页</span>
              </button>
            </div>
            {!session && !error && (
              <div className="loading-card">
                <span className="spinner" />
                正在读取记录，不会重新生成问题…
              </div>
            )}
            {location.notice && (
              <p
                className="favorite-location-notice"
                role="status"
              >
                {location.notice}
              </p>
            )}
            {session && (
              <>
                <div
                  className="chat-history"
                  ref={history}
                  aria-label="对话记录"
                  aria-live="polite"
                  aria-relevant="additions"
                >
                  {session.turns.map((turn) => (
                    <ConversationTurn
                      key={turn.id}
                      turn={turn}
                    />
                  ))}
                  {messageSubmission && (
                    <PendingMessage
                      submission={messageSubmission}
                      busy={operationBusy}
                      onRetry={() => void retry()}
                    />
                  )}
                  {done && (
                    <div
                      className="completion-card"
                      data-source-turn={
                        session.turns.find(
                          (turn) => turn.action === "completed",
                        )?.id
                      }
                      data-source-part="closing"
                    >
                      <span className="completion-mark">
                        <Icon
                          name="check"
                          size={28}
                        />
                      </span>
                      <h3>{session.topicTitle} · 主题完成</h3>
                      <p>{session.closingMessage}</p>
                      {session.turns
                        .filter((turn) => turn.action === "completed")
                        .map((turn) => (
                          <div
                            className="completion-favorite-actions"
                            key={turn.id}
                          >
                            <SentencePlayButton
                              text={session.closingMessage ?? ""}
                            />
                            <CopyButton
                              text={session.closingMessage ?? ""}
                              label="复制结束语"
                            />
                            <FavoriteButton
                              source={{
                                sourceTurnId: turn.id,
                                sourcePart: "closing",
                              }}
                            />
                          </div>
                        ))}
                      <div className="completion-actions">
                        <button
                          className="button primary"
                          onClick={() => leave()}
                        >
                          选择下一步
                          <Icon
                            name="arrow"
                            size={17}
                          />
                        </button>
                        <button
                          className="button secondary"
                          disabled
                        >
                          和 Jane 自由聊聊 · 后续开放
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {!done && (
                  <section
                    className="answer-panel"
                    aria-label="作答区"
                  >
                    <ReplyGuidance
                      task={current?.chineseTask}
                      hints={hints}
                      exampleOpen={exampleOpen}
                      disabled={operationBusy || awaiting || unresolved}
                      onFill={fill}
                    />
                    {awaiting && (
                      <div className="continue-panel">
                        <div>
                          <span className="pass-label">
                            <Icon
                              name="check"
                              size={16}
                            />
                            上次反馈已保存
                          </span>
                          <p>恢复已保存的下一步后，回答通过会自动接着聊。</p>
                        </div>
                        <button
                          className="button primary"
                          disabled={busy}
                          onClick={() => {
                            if (
                              auxiliarySubmission?.operation.action ===
                                "continue" &&
                              auxiliarySubmission.status !== "conflict"
                            )
                              void retry();
                            else void send("continue");
                          }}
                        >
                          {session.nextIsClosing ? "查看完成结果" : "恢复对话"}
                          <Icon
                            name="arrow"
                            size={18}
                          />
                        </button>
                      </div>
                    )}
                    {!awaiting && (
                      <>
                        <label
                          className="sr-only"
                          htmlFor="learner-answer"
                        >
                          {explainMode
                            ? "想请 Jane 解释的词句"
                            : "你的英文回答"}
                        </label>
                        <div
                          className={
                            "input-wrap integrated-composer" +
                            (explainMode ? " explain-mode" : "")
                          }
                        >
                          {explainMode && (
                            <span className="explain-label">
                              词句解释模式 · 不计答题
                            </span>
                          )}
                          <textarea
                            id="learner-answer"
                            ref={input}
                            value={draft}
                            maxLength={2000}
                            readOnly={busy}
                            aria-busy={busy}
                            placeholder={
                              explainMode
                                ? "哪个词或句子没看懂？可以用中文问 Jane…"
                                : "用英语表达你的想法，不用担心说得不完美…"
                            }
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (
                                e.key !== "Enter" ||
                                e.shiftKey ||
                                e.nativeEvent.isComposing ||
                                e.nativeEvent.keyCode === 229
                              )
                                return;

                              // Enter 发送；选词与 Shift + Enter 保留输入法/换行行为。
                              e.preventDefault();
                              if (
                                e.repeat ||
                                (!draft.trim() && !unresolved) ||
                                busy ||
                                voiceLock.current
                              )
                                return;
                              void submitDraft();
                            }}
                          />
                          <span className="char-count">
                            {draft.length} / 2000
                          </span>
                          <VoiceInput
                            contextKey={`${sessionId}:${current?.id}:${session.revision}`}
                            disabled={busy || unresolved}
                            onBusyChange={changeVoiceBusy}
                            onTranscript={insertTranscript}
                            helpActions={
                              <div className="help-actions">
                                <button
                                  className="button soft"
                                  disabled={operationBusy || unresolved}
                                  onClick={requestHint}
                                  aria-expanded={
                                    hints.example ? exampleOpen : undefined
                                  }
                                  aria-controls={
                                    hints.example
                                      ? "reply-reference"
                                      : undefined
                                  }
                                >
                                  <Icon
                                    name="bulb"
                                    size={17}
                                  />
                                  {hintLabel}
                                </button>
                                {explainMode && (
                                  <button
                                    className="text-button"
                                    disabled={operationBusy}
                                    onClick={() => {
                                      setExplainMode(false);
                                      input.current?.focus();
                                    }}
                                  >
                                    返回作答
                                  </button>
                                )}
                              </div>
                            }
                            sendAction={
                              <button
                                className="button primary composer-send"
                                aria-label={sendLabel}
                                title={sendLabel}
                                disabled={
                                  (!draft.trim() && !unresolved) ||
                                  operationBusy
                                }
                                onClick={() => void submitDraft()}
                              >
                                {busy ? (
                                  <span className="spinner" />
                                ) : (
                                  <>
                                    <Icon
                                      name={unresolved ? "refresh" : "arrowUp"}
                                      size={17}
                                    />
                                  </>
                                )}
                              </button>
                            }
                          />
                        </div>
                      </>
                    )}
                  </section>
                )}
              </>
            )}
            {auxiliarySubmission && (
              <SubmissionNotice
                submission={auxiliarySubmission}
                busy={operationBusy}
                onRetry={() => void retry()}
              />
            )}
            {error && (
              <div
                className="conversation-load-error"
                role="alert"
              >
                {error}{" "}
                <button
                  className="text-button"
                  disabled={operationBusy}
                  onClick={() => void refresh()}
                >
                  重新加载
                </button>
              </div>
            )}
            {storageWarning && (
              <p
                className="draft-storage-warning"
                role="status"
              >
                浏览器暂存不可用，请勿刷新；当前输入仍保留在本页。
              </p>
            )}
          </main>
          <ConfirmDialog
            open={leaveOpen}
            title={leaveTarget.current ? "去看看收藏？" : "先休息一下？"}
            description={leaveDescription}
            confirmLabel={leaveTarget.current ? "查看收藏" : "返回首页"}
            cancelLabel="继续练习"
            onConfirm={returnHome}
            onCancel={() => setLeaveOpen(false)}
          />
        </AppShell>
      </SentencePlaybackContext.Provider>
    </ConversationFavorites>
  );
}

function ConversationTurn({ turn }: { turn: SessionView["turns"][number] }) {
  const [highlightRecommendation, setHighlightRecommendation] = useState(false);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setHighlightRecommendation(false);
    return () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    };
  }, [turn.id]);

  /** 仅标记当前回答的修正版；重复点击重新计时，不滚动、不发收藏请求。 */
  function markRecommendation() {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    setHighlightRecommendation(true);
    highlightTimer.current = setTimeout(() => {
      setHighlightRecommendation(false);
      highlightTimer.current = null;
    }, 2000);
  }

  // 按钮求助只更新输入框上方的提示卡；记录仍保留用于恢复与提示分级。
  if (turn.action === "hint") return null;
  // 提问按事件顺序展示；完成内容由底部完成卡展示，避免重复。
  if (turn.action === "completed") return null;
  if (turn.action === "question") {
    return (
      <DialogueMessage
        author="Jane"
        text={turn.question.english}
        translation={turn.question.chineseTranslation}
        source={{ sourceTurnId: turn.id, sourcePart: "question" }}
      />
    );
  }
  const fallbackText = "请解释一下当前问题";
  return (
    <div className="turn-group">
      <DialogueMessage
        learner
        author={"你" + ACTION_LABELS[turn.action]}
        text={turn.text || fallbackText}
        translation={turn.evaluation.learnerTranslation ?? undefined}
        source={
          turn.action === "answer"
            ? { sourceTurnId: turn.id, sourcePart: "learner_answer" }
            : undefined
        }
        allowFavorite={
          turn.action === "answer" && canFavoriteLearnerAnswer(turn.evaluation)
        }
        onRecommend={
          turn.action === "answer" && turn.evaluation.correctedAnswer?.trim()
            ? markRecommendation
            : undefined
        }
        recommendationActive={highlightRecommendation}
      />
      {turn.evaluation?.roleplayLine && (
        <DialogueMessage
          author="Jane"
          text={turn.evaluation.roleplayLine}
          translation={turn.evaluation.roleplayTranslation}
          source={{ sourceTurnId: turn.id, sourcePart: "roleplay" }}
        />
      )}
      {turn.evaluation && (
        <TutorFeedback
          turnId={turn.id}
          evaluation={turn.evaluation}
          highlighted={highlightRecommendation}
        />
      )}
    </div>
  );
}

/** 仅按已有教学结果区分鼓励、表达建议和重答，不改变任务推进。 */
function TutorFeedback({
  evaluation,
  turnId,
  highlighted = false,
}: {
  evaluation: NonNullable<TeachingTurnView["evaluation"]>;
  turnId: string;
  highlighted?: boolean;
}) {
  // 允许继续也可能需要纠正；只有正确且无需改写时才使用点赞。
  const isPositive =
    evaluation.verdict === "correct" &&
    evaluation.canContinue &&
    !evaluation.correctedAnswer;
  const needsRetry =
    evaluation.learnerIntent === "answer" &&
    !evaluation.canContinue &&
    (evaluation.verdict === "needs_correction" ||
      evaluation.verdict === "uncertain");
  let title = "学习提示";
  if (evaluation.canContinue) title = "表达小建议";
  if (needsRetry) title = "再试一次";
  let className = "tutor-note tutor-note-card";
  if (isPositive) className = "tutor-note tutor-note-positive";
  else if (needsRetry) className += " tutor-note-retry";
  return (
    <div className={className}>
      {isPositive ? (
        <span className="tutor-note-badge">
          <Icon
            name="thumbsUp"
            size={15}
          />
        </span>
      ) : (
        <div className="tutor-note-heading">
          <span className="tutor-note-badge">
            <Icon
              name={needsRetry ? "pencil" : "sparkles"}
              size={16}
            />
          </span>
          <span>{title}</span>
        </div>
      )}
      <div className="tutor-note-content">
        <span className="sr-only">
          {isPositive ? "Jane 的鼓励：" : "Jane 的学习提示："}
        </span>
        <p>{evaluation.tutorFeedback}</p>
        {evaluation.correctedAnswer && (
          <div
            className={
              "corrected-expression" +
              (highlighted ? " recommended-expression-highlight" : "")
            }
            data-source-turn={turnId}
            data-source-part="corrected_answer"
          >
            <p className="corrected-answer">
              <TranslatableText
                text={evaluation.correctedAnswer}
                translation={evaluation.correctedTranslation ?? undefined}
                loadTranslation={() =>
                  requestSentenceTranslation({
                    sourceTurnId: turnId,
                    sourcePart: "corrected_answer",
                  })
                }
              />
            </p>
            <span className="expression-actions">
              <FavoriteButton
                source={{
                  sourceTurnId: turnId,
                  sourcePart: "corrected_answer",
                }}
              />
            </span>
          </div>
        )}
        {evaluation.explanation && (
          <p className="explanation">{evaluation.explanation}</p>
        )}
      </div>
    </div>
  );
}

function DialogueMessage({
  author,
  text,
  translation,
  learner = false,
  source,
  allowFavorite = true,
  onRecommend,
  recommendationActive = false,
}: {
  author: string;
  text: string;
  translation?: string;
  learner?: boolean;
  source?: FavoriteSource;
  allowFavorite?: boolean;
  onRecommend?: () => void;
  recommendationActive?: boolean;
}) {
  return (
    <div
      data-source-turn={source?.sourceTurnId}
      data-source-part={source?.sourcePart}
      className={
        "chat-message " + (learner ? "learner-message" : "jane-message")
      }
    >
      <span className="sr-only">{author}：</span>
      <div className="message-bubble">
        <p>
          <TranslatableText
            text={text}
            translation={translation}
            loadTranslation={
              source ? () => requestSentenceTranslation(source) : undefined
            }
          />
        </p>
      </div>
      <div className="message-actions">
        <SentencePlayButton text={text} />
        <CopyButton
          text={text}
          label={`复制${author}内容`}
        />
        {source && allowFavorite && <FavoriteButton source={source} />}
        {!allowFavorite && onRecommend && (
          <RecommendationButton
            active={recommendationActive}
            onClick={onRecommend}
          />
        )}
      </div>
    </div>
  );
}
