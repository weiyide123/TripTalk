import type { Session } from "./session";

// 旧 JSON 关系校验，只由离线迁移入口使用。
export function validateSessionLinks(
  s: Session,
  report: (message: string) => void,
) {
  const planIds = new Set(s.planSnapshot.questions.map((q) => q.id));
  const factKeys = new Set(s.planSnapshot.facts.map((f) => f.key));
  const firstId = s.planSnapshot.questions[0].id;
  if (
    planIds.size !== s.planSnapshot.questions.length ||
    factKeys.size !== s.planSnapshot.facts.length
  )
    report("Duplicate plan identifiers");
  if (
    s.sceneId !== s.configSnapshot.lesson.id ||
    s.topicId !== s.configSnapshot.topic.id ||
    s.topicId !== s.planSnapshot.topicId
  )
    report("Course identity mismatch");
  for (const [id, q] of Object.entries(s.presentedQuestions))
    if (id !== q.id || !planIds.has(id)) report("Invalid presented question");
  if (!Object.hasOwn(s.presentedQuestions, firstId))
    report("Missing first question");
  const resolved = new Set<string>();
  const visited = new Set([firstId]);
  const requestIds = new Set<string>();
  const turnIds = new Set<string>();
  let current: string | null = firstId;
  let awaiting = false;
  let revision = 0;
  for (const t of s.turns) {
    if (
      t.questionId !== current ||
      !Object.hasOwn(s.presentedQuestions, t.questionId)
    )
      report("Turn references the wrong question");
    if (
      requestIds.has(t.requestId) ||
      turnIds.has(t.id) ||
      t.revision <= revision ||
      t.revision > s.revision
    )
      report("Invalid operation identity or revision");
    requestIds.add(t.requestId);
    turnIds.add(t.id);
    revision = t.revision;
    if (t.action === "continue") {
      if (!awaiting) report("Continue without accepted feedback");
      if (t.nextQuestionId !== null) {
        if (
          !planIds.has(t.nextQuestionId) ||
          resolved.has(t.nextQuestionId) ||
          visited.has(t.nextQuestionId) ||
          !Object.hasOwn(s.presentedQuestions, t.nextQuestionId)
        )
          report("Invalid next question");
        visited.add(t.nextQuestionId);
      } else if (resolved.size !== planIds.size) report("Premature completion");
      current = t.nextQuestionId;
      awaiting = false;
    } else {
      if (awaiting || current === null)
        report("Teaching after completion or before confirmation");
      const f = t.feedback;
      if (t.action === "hint" && (f.learnerIntent !== "hint" || !f.hint))
        report("Invalid hint");
      if (t.action === "explain" && f.learnerIntent !== "explain")
        report("Invalid explanation");
      if (
        f.verdict === "needs_correction" &&
        (!f.errorTypes.length ||
          !f.correctedAnswer?.trim() ||
          !f.explanation?.trim())
      )
        report("Incomplete correction");
      if (f.verdict !== "needs_correction" && f.errorTypes.length)
        report("Unexpected error types");
      if (f.verdict === "correct" && !f.canContinue)
        report("Correct answer cannot be blocked");
      if (f.canContinue) {
        if (
          t.action !== "answer" ||
          f.learnerIntent !== "answer" ||
          !/[a-z0-9]/i.test(t.text) ||
          f.errorTypes.includes("meaning") ||
          !["correct", "needs_correction"].includes(f.verdict) ||
          resolved.has(t.questionId)
        )
          report("Invalid accepted answer");
        resolved.add(t.questionId);
        awaiting = true;
      } else if (t.effects.coveredEarly.length || t.effects.factChanges.length)
        report("Unaccepted feedback cannot change progress or facts");
      for (const c of t.effects.coveredEarly) {
        if (
          !planIds.has(c.questionId) ||
          resolved.has(c.questionId) ||
          !t.text.includes(c.evidence)
        )
          report("Invalid early coverage evidence");
        resolved.add(c.questionId);
      }
      const changed = new Set<string>();
      for (const f of t.effects.factChanges) {
        if (
          !factKeys.has(f.key) ||
          changed.has(f.key) ||
          !t.text.includes(f.evidence)
        )
          report("Invalid fact evidence");
        changed.add(f.key);
      }
    }
  }
  if (Object.keys(s.presentedQuestions).some((id) => !visited.has(id)))
    report("Unreferenced question snapshot");
  if (s.currentQuestionId !== current)
    report("Current question differs from history");
  if (s.status === "topic_completed") {
    if (
      current !== null ||
      awaiting ||
      s.pendingContinuation !== null ||
      !s.topicCompletedAt ||
      !s.closingMessage?.trim()
    )
      report("Invalid completed state");
  } else {
    if (
      current === null ||
      s.topicCompletedAt !== null ||
      s.closingMessage !== null
    )
      report("Invalid unfinished state");
    if ((s.status === "awaiting_continue") !== awaiting)
      report("Status differs from history");
    if (
      s.status === "active" &&
      (s.pendingContinuation !== null ||
        (current !== null && resolved.has(current)))
    )
      report("Invalid active state");
  }
  if (awaiting) {
    const next = s.pendingContinuation;
    if (!next) report("Missing pending continuation");
    else if (resolved.size < planIds.size) {
      if (
        !next.nextQuestionId ||
        !planIds.has(next.nextQuestionId) ||
        resolved.has(next.nextQuestionId) ||
        !next.english?.trim() ||
        (next.chineseTranslation !== undefined &&
          !next.chineseTranslation?.trim()) ||
        !next.chineseTask?.trim() ||
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
}
