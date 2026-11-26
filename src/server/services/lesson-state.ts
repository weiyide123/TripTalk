import type { Evaluation } from "@/contracts/jane-turn";
import { randomUUID } from "node:crypto";
import type { TrainingSession } from "@/contracts/training-session";
import type { LearningEvent } from "@/contracts/learning-event";
import type { ModelCall, Feedback } from "@/contracts/teaching";
import type { TurnRequest } from "@/contracts/requests";
import {
  currentQuestion,
  resolvedQuestionIds,
  confirmedFacts,
  assistanceFor,
  questionFor,
} from "./session-selectors";
import { AppError } from "../errors";
/** 拒绝结构有效但业务含义矛盾的模型结果，保留细分原因并明确本次尚未提交。 */
const invalid = (reason: string) => {
  throw new AppError(
    "AGENT_OUTPUT_INVALID",
    "Jane 这次的回复没有整理好，未保存本次回答。请稍后重新发送。",
    502,
    true,
    { reason, stage: "evaluation_validation", submission: "not_committed" },
  );
};

/**
 * 校验反馈并追加教学事件；可继续时同时追加下一问或完成事件，整次操作只加一个版本。
 * 直接修改传入的候选副本，不写数据库；调用方必须整体提交，不能保存半步状态。
 */
export function recordEvaluation(
  session: TrainingSession,
  input: TurnRequest,
  evaluation: Evaluation,
  modelCall: ModelCall,
): LearningEvent {
  const answer = applyEvaluation(session, input, evaluation, modelCall);
  session.turns.push(answer);
  if (evaluation.canContinue) {
    advanceQuestion(session, answer.createdAt);
  }
  // 一次提交可能追加两条事件，但只更新一次会话版本。
  session.revision += 1;
  session.updatedAt = answer.createdAt;
  return answer;
}

/** 将历史待继续候选推进到已保存的下一问/结束状态；不调用模型、不新增 continue 事件。 */
export function applyContinue(session: TrainingSession, input: TurnRequest) {
  const question = currentQuestion(session);
  if (
    session.status !== "awaiting_continue" ||
    !session.pendingContinuation ||
    !question ||
    input.action !== "continue"
  ) {
    throw new AppError(
      "INVALID_STATE",
      "当前没有待确认的下一步，请同步页面。",
      409,
    );
  }
  const createdAt = new Date().toISOString();
  advanceQuestion(session, createdAt);
  session.revision += 1;
  session.updatedAt = createdAt;
}

/** 校验评分、提示级别和推进依据，构造教学事件，并暂存候选下一步；尚未追加该事件。 */
function applyEvaluation(
  session: TrainingSession,
  input: TurnRequest,
  evaluation: Evaluation,
  modelCall: ModelCall,
): LearningEvent {
  const question = currentQuestion(session);
  if (!question || session.status !== "active" || input.action === "continue")
    return invalid("INVALID_EVALUATION_STATE");
  validateFeedback(input, evaluation);
  validateProgressEffects(session, input, evaluation);
  const counts = assistanceFor(session, question.id);
  if (
    input.action === "hint" &&
    evaluation.hint?.level !==
      ["keywords", "pattern", "example"][Math.min(counts.hints, 2)]
  )
    return invalid("HINT_LEVEL_MISMATCH");

  const {
    continuation: _,
    coveredEarly,
    factChanges,
    ...feedback
  } = evaluation;
  return {
    ...eventFields(session, new Date().toISOString()),
    questionId: question.id,
    action: input.action,
    payload: {
      text: input.text,
      feedback: learnerFeedback(feedback, input, question.chineseTask),
      effects: {
        coveredEarly,
        factChanges,
      },
      modelCall,
    },
  };
}

/** 将未通过的模糊/偏题输入整理为友好引导，保留可理解英文的真实纠错；不改变进度。 */
function learnerFeedback(
  feedback: Feedback,
  input: TurnRequest,
  chineseTask: string,
) {
  // 只整理已通过结构/业务校验且不推进的教学反馈，不用兜底掩盖模型故障。
  if (input.action !== "answer" || feedback.canContinue) return feedback;
  const needsGuidance =
    feedback.verdict === "uncertain" ||
    feedback.learnerIntent === "off_topic" ||
    (feedback.learnerIntent === "answer" && !/[a-z]/i.test(input.text));
  if (!needsGuidance) return feedback;
  return {
    ...feedback,
    verdict: "uncertain" as const,
    errorTypes: [],
    correctedAnswer: null,
    correctedTranslation: null,
    explanation: null,
    roleplayLine: "Could you try that again?",
    roleplayTranslation: "你能再试一次吗？",
    tutorFeedback: `我还没理解你的意思。试着用英语表达：${chineseTask}`,
  };
}

/** 消费候选中的 pendingContinuation，追加提问或完成事件、更新状态并清空待推进信息。 */
function advanceQuestion(session: TrainingSession, createdAt: string) {
  const resolved = resolvedQuestionIds(session);
  const next = session.pendingContinuation!;
  if (next.nextQuestionId) {
    const planned = session.planSnapshot.questions.find(
      (q) => q.id === next.nextQuestionId,
    );
    if (
      !planned ||
      resolved.has(planned.id) ||
      questionFor(session, planned.id) ||
      !next.english ||
      !next.chineseTask
    )
      return invalid("CONTINUE_TARGET_INVALID");
    session.turns.push({
      ...eventFields(session, createdAt),
      action: "question",
      questionId: planned.id,
      payload: {
        english: next.english,
        // 实际提问可能改变措辞，不沿用计划翻译。
        chineseTranslation: next.chineseTranslation ?? undefined,
        chineseTask: next.chineseTask,
        goal: planned.goal,
      },
    });
    session.currentQuestionId = planned.id;
    session.status = "active";
  } else {
    if (
      session.planSnapshot.questions.some((q) => !resolved.has(q.id)) ||
      !next.closingMessage
    )
      return invalid("PREMATURE_COMPLETION");
    session.status = "topic_completed";
    session.topicCompletedAt = createdAt;
    session.currentQuestionId = null;
    session.turns.push({
      ...eventFields(session, createdAt),
      action: "completed",
      questionId: null,
      payload: { closingMessage: next.closingMessage },
    });
  }
  session.pendingContinuation = null;
}

/** 为待追加事件分配 ID、所属练习和下一序号；不修改事件列表或会话版本。 */
function eventFields(session: TrainingSession, createdAt: string) {
  return {
    id: randomUUID(),
    sessionId: session.id,
    sequence: session.turns.length + 1,
    createdAt,
  };
}

/** 检查输入意图、评分、纠错和可继续标记是否一致，拒绝求助被评分或错误推进等矛盾。 */
function validateFeedback(input: TurnRequest, evaluation: Evaluation) {
  const isAnswer =
    input.action === "answer" && evaluation.learnerIntent === "answer";
  if (
    !isAnswer &&
    (evaluation.canContinue ||
      evaluation.errorTypes.length ||
      !["not_applicable", "uncertain"].includes(evaluation.verdict))
  )
    return invalid("NON_ANSWER_HAS_GRADING");
  if (evaluation.canContinue && !/[a-z0-9]/i.test(input.text))
    return invalid("NON_ENGLISH_ANSWER_ACCEPTED");
  if (
    evaluation.verdict === "correct" &&
    (!evaluation.canContinue || evaluation.errorTypes.length)
  )
    return invalid("CORRECT_VERDICT_CONFLICT");
  if (
    evaluation.verdict === "needs_correction" &&
    (!evaluation.errorTypes.length ||
      !evaluation.correctedAnswer?.trim() ||
      !evaluation.explanation?.trim())
  )
    return invalid("CORRECTION_DETAILS_MISSING");
  if (evaluation.verdict !== "needs_correction" && evaluation.errorTypes.length)
    return invalid("UNEXPECTED_ERROR_TYPES");
  if (
    evaluation.canContinue &&
    !["correct", "needs_correction"].includes(evaluation.verdict)
  )
    return invalid("NON_PASSING_VERDICT_CONTINUES");
  if (evaluation.canContinue && evaluation.errorTypes.includes("meaning"))
    return invalid("MEANING_ERROR_CONTINUES");
  if (
    !evaluation.canContinue &&
    (evaluation.continuation ||
      evaluation.coveredEarly.length ||
      evaluation.factChanges.length)
  )
    return invalid("BLOCKED_ANSWER_HAS_EFFECTS");
  if (
    input.action === "hint" &&
    (evaluation.learnerIntent !== "hint" || !evaluation.hint)
  )
    return invalid("HINT_INTENT_MISMATCH");
  if (input.action === "explain" && evaluation.learnerIntent !== "explain")
    return invalid("EXPLANATION_INTENT_MISMATCH");
}

/** 校验提前覆盖/事实变更的原文依据及下一问/完成边界，通过后暂存候选的待推进状态。 */
function validateProgressEffects(
  session: TrainingSession,
  input: TurnRequest,
  evaluation: Evaluation,
) {
  const resolved = resolvedQuestionIds(session);
  if (!evaluation.canContinue) return;
  const remaining = session.planSnapshot.questions.filter(
    (q) => q.id !== session.currentQuestionId && !resolved.has(q.id),
  );
  const covered = new Set<string>();
  for (const c of evaluation.coveredEarly) {
    if (
      covered.has(c.questionId) ||
      !remaining.some((q) => q.id === c.questionId) ||
      !input.text.includes(c.evidence)
    )
      return invalid("EARLY_COVERAGE_INVALID");
    covered.add(c.questionId);
  }
  const factKeys = new Set<string>();
  for (const f of evaluation.factChanges) {
    if (
      factKeys.has(f.key) ||
      !confirmedFacts(session).some((x) => x.key === f.key) ||
      !input.text.includes(f.evidence)
    )
      return invalid("FACT_CHANGE_INVALID");
    factKeys.add(f.key);
  }
  const pending = remaining.filter((q) => !covered.has(q.id));
  const c = evaluation.continuation;
  if (!c) return invalid("CONTINUATION_MISSING");
  if (pending.length) {
    if (
      !pending.some((q) => q.id === c.nextQuestionId) ||
      !c.english?.trim() ||
      !c.chineseTranslation?.trim() ||
      !c.chineseTask?.trim() ||
      c.closingMessage !== null
    )
      return invalid("NEXT_QUESTION_INVALID");
  } else if (
    c.nextQuestionId !== null ||
    c.english !== null ||
    c.chineseTranslation != null ||
    c.chineseTask !== null ||
    !c.closingMessage?.trim()
  )
    return invalid("CLOSING_INVALID");
  session.pendingContinuation = c;
  session.status = "awaiting_continue";
}
