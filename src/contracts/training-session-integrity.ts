import type { TrainingSession } from "./training-session";
import type { LearningEvent } from "./learning-event";

type Report = (message: string) => void;

// 基于实际事件校验关联；不读取旧 presentedQuestions，不按事件数推导 revision。
export function validateTrainingHistory(
  session: TrainingSession,
  report: Report,
) {
  const planIds = new Set(session.planSnapshot.questions.map((q) => q.id));
  const factKeys = new Set(session.planSnapshot.facts.map((fact) => fact.key));
  const resolved = new Set<string>();
  const visited = new Set<string>();
  const ids = new Set<string>();
  let current: string | null = null;
  let awaiting = false;
  let completed = false;
  if (
    planIds.size !== session.planSnapshot.questions.length ||
    factKeys.size !== session.planSnapshot.facts.length
  ) {
    report("Duplicate plan identifiers");
  }
  if (
    session.sceneId !== session.configSnapshot.lesson.id ||
    session.topicId !== session.configSnapshot.topic.id ||
    session.topicId !== session.planSnapshot.topicId
  ) {
    report("Course identity mismatch");
  }
  for (const [index, event] of session.turns.entries()) {
    if (
      event.sequence !== index + 1 ||
      event.sessionId !== session.id ||
      ids.has(event.id)
    )
      report("Invalid event identity or sequence");
    ids.add(event.id);
    if (completed) report("Event after completion");
    if (event.action === "question") {
      if (index === 0) {
        if (event.questionId !== session.planSnapshot.questions[0].id)
          report("Missing first question");
      } else if (!awaiting) report("Question without accepted answer");
      if (
        !planIds.has(event.questionId) ||
        visited.has(event.questionId) ||
        resolved.has(event.questionId)
      )
        report("Invalid next question");
      visited.add(event.questionId);
      current = event.questionId;
      awaiting = false;
      continue;
    }
    if (event.action === "completed") {
      if (!awaiting || resolved.size !== planIds.size)
        report("Premature completion");
      completed = true;
      current = null;
      awaiting = false;
      continue;
    }
    if (
      index === 0 ||
      awaiting ||
      current === null ||
      event.questionId !== current
    )
      report("Teaching references wrong question/state");
    validateTeaching(event, resolved, planIds, factKeys, report);
    if (event.payload.feedback.canContinue) awaiting = true;
  }
  if (session.currentQuestionId !== current)
    report("Current question differs from history");
  if (completed) {
    if (
      session.status !== "topic_completed" ||
      !session.topicCompletedAt ||
      session.pendingContinuation !== null
    )
      report("Invalid completed state");
  } else {
    if (
      session.status === "topic_completed" ||
      session.topicCompletedAt !== null ||
      current === null
    )
      report("Invalid unfinished state");
    if ((session.status === "awaiting_continue") !== awaiting)
      report("Status differs from history");
    if (
      !awaiting &&
      (session.pendingContinuation !== null || resolved.has(current ?? ""))
    )
      report("Invalid active state");
  }
  if (awaiting) validatePending(session, planIds, resolved, report);
}

function validateTeaching(
  event: Extract<LearningEvent, { action: "answer" | "hint" | "explain" }>,
  resolved: Set<string>,
  planIds: Set<string>,
  factKeys: Set<string>,
  report: Report,
) {
  const { text, feedback, effects } = event.payload;
  if (
    event.action === "hint" &&
    (feedback.learnerIntent !== "hint" || !feedback.hint)
  )
    report("Invalid hint");
  if (event.action === "explain" && feedback.learnerIntent !== "explain")
    report("Invalid explanation");
  if (
    feedback.verdict === "needs_correction" &&
    (!feedback.errorTypes.length ||
      !feedback.correctedAnswer?.trim() ||
      !feedback.explanation?.trim())
  )
    report("Incomplete correction");
  if (feedback.verdict !== "needs_correction" && feedback.errorTypes.length)
    report("Unexpected error types");
  if (feedback.verdict === "correct" && !feedback.canContinue)
    report("Correct answer cannot be blocked");
  if (feedback.canContinue) {
    if (
      event.action !== "answer" ||
      feedback.learnerIntent !== "answer" ||
      !/[a-z0-9]/i.test(text) ||
      feedback.errorTypes.includes("meaning") ||
      !["correct", "needs_correction"].includes(feedback.verdict) ||
      resolved.has(event.questionId)
    )
      report("Invalid accepted answer");
    resolved.add(event.questionId);
  } else if (effects.coveredEarly.length || effects.factChanges.length)
    report("Unaccepted answer changes progress/facts");
  for (const covered of effects.coveredEarly) {
    if (
      !planIds.has(covered.questionId) ||
      resolved.has(covered.questionId) ||
      !text.includes(covered.evidence)
    )
      report("Invalid early coverage evidence");
    resolved.add(covered.questionId);
  }
  const changed = new Set<string>();
  for (const fact of effects.factChanges) {
    if (
      !factKeys.has(fact.key) ||
      changed.has(fact.key) ||
      !text.includes(fact.evidence)
    )
      report("Invalid fact evidence");
    changed.add(fact.key);
  }
}

function validatePending(
  session: TrainingSession,
  planIds: Set<string>,
  resolved: Set<string>,
  report: Report,
) {
  const next = session.pendingContinuation;
  if (!next) return report("Missing pending continuation");
  if (resolved.size < planIds.size) {
    if (
      !next.nextQuestionId ||
      !planIds.has(next.nextQuestionId) ||
      resolved.has(next.nextQuestionId) ||
      !next.english?.trim() ||
      !next.chineseTask?.trim() ||
      (next.chineseTranslation !== undefined &&
        !next.chineseTranslation?.trim()) ||
      next.closingMessage !== null
    )
      report("Invalid pending question");
  } else if (
    next.nextQuestionId !== null ||
    next.english !== null ||
    next.chineseTranslation != null ||
    next.chineseTask !== null ||
    !next.closingMessage?.trim()
  )
    report("Invalid pending closing");
}
