import type { TrainingSession } from "@/contracts/training-session";
import type { LearningEvent } from "@/contracts/learning-event";

type TeachingTurn = Extract<
  LearningEvent,
  { action: "answer" | "hint" | "explain" }
>;

/** 识别带教学反馈的回答/提示/解释事件，同时缩窄类型，排除纯提问和完成事件。 */
export function isTeachingTurn(turn: LearningEvent): turn is TeachingTurn {
  return ["answer", "hint", "explain"].includes(turn.action);
}
/** 按当前题 ID 读取已实际展示的问题；已完成或没有对应事件时返回 null。 */
export function currentQuestion(session: TrainingSession) {
  return questionFor(session, session.currentQuestionId);
}
/** 从实际提问事件取出指定问题，不使用可能已被改写的规划原文。 */
export function questionFor(
  session: TrainingSession,
  questionId: string | null,
) {
  const event = session.turns.find(
    (turn) => turn.action === "question" && turn.questionId === questionId,
  );
  if (event?.action !== "question") return null;
  return { id: event.questionId, ...event.payload };
}
/** 从反馈汇总已通过和提前覆盖的目标 ID 并去重，不另存一份进度。 */
export function resolvedQuestionIds(session: TrainingSession): Set<string> {
  const ids = new Set<string>();
  for (const turn of session.turns.filter(isTeachingTurn)) {
    if (turn.payload.feedback.canContinue) ids.add(turn.questionId);
    for (const covered of turn.payload.effects.coveredEarly)
      ids.add(covered.questionId);
  }
  return ids;
}
/** 按识别出的学习者意图统计指定题的提示/解释次数，供提示分级和上下文使用。 */
export function assistanceFor(
  session: TrainingSession,
  questionId: string | null,
) {
  const history = session.turns
    .filter(isTeachingTurn)
    .filter((t) => t.questionId === questionId);
  return {
    hints: history.filter((t) => t.payload.feedback.learnerIntent === "hint")
      .length,
    explanations: history.filter(
      (t) => t.payload.feedback.learnerIntent === "explain",
    ).length,
  };
}
/** 按事件顺序提取已记录的情境事实变更，附来源事件 ID 以便追溯。 */
export function factChanges(session: TrainingSession) {
  return session.turns.filter(isTeachingTurn).flatMap((t) =>
    t.payload.effects.factChanges.map((f) => ({
      ...f,
      turnId: t.id,
    })),
  );
}
/** 将历史变更依次应用到初始事实副本，得到当前情境；不改写计划快照。 */
export function confirmedFacts(session: TrainingSession) {
  const facts = session.planSnapshot.facts.map((f) => ({ ...f }));
  for (const change of factChanges(session)) {
    const fact = facts.find((f) => f.key === change.key);
    if (fact) fact.value = change.value;
  }
  return facts;
}
