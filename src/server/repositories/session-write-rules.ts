import { isDeepStrictEqual } from "node:util";
import type { TrainingSession } from "@/contracts/training-session";
import type { TurnRequest, CreateRequest } from "@/contracts/requests";
import type { Scene, SceneTopic } from "@/contracts/scene";
import { AppError } from "../errors";

/** 校验新练习属于请求场景/主题，配置与目录一致，且只包含合法的首问初始状态。 */
export function assertNewSession(
  session: TrainingSession,
  input: CreateRequest,
  scene: Scene,
  topic: SceneTopic,
) {
  const first = session.turns[0];
  const lesson = session.configSnapshot.lesson;
  const snapshotTopic = session.configSnapshot.topic;
  if (
    session.sceneId !== input.sceneId ||
    session.topicId !== input.topicId ||
    session.status !== "active" ||
    session.revision !== 0 ||
    session.turns.length !== 1 ||
    first.action !== "question" ||
    first.sequence !== 1 ||
    session.pendingContinuation !== null ||
    session.topicCompletedAt !== null ||
    session.createdAt !== session.updatedAt ||
    first.createdAt !== session.createdAt ||
    lesson.version !== scene.version ||
    lesson.title !== scene.title ||
    lesson.description !== scene.description ||
    snapshotTopic.title !== topic.title ||
    snapshotTopic.scope !== topic.scope + "\n主题边界：" + topic.boundaries ||
    !snapshotTopic.available ||
    snapshotTopic.minQuestions !== 8 ||
    snapshotTopic.maxQuestions !== 15 ||
    (input.difficulty !== undefined && lesson.difficulty !== input.difficulty)
  )
    invalid("NEW_SESSION_INVALID");
  if (first.action === "question") {
    const planned = session.planSnapshot.questions[0];
    const { referenceAnswer: _, id: questionId, ...visible } = planned;
    if (
      first.questionId !== questionId ||
      !first.payload.chineseTranslation ||
      !isDeepStrictEqual(first.payload, visible)
    )
      invalid("FIRST_QUESTION_INVALID");
  }
}

/** 校验本次提交只推进一次版本、只追加合法事件且不改身份/历史；返回用于回执的新事件。 */
export function assertTurnCommit(
  original: TrainingSession,
  candidate: TrainingSession,
  input: TurnRequest,
) {
  if (original.revision !== input.expectedRevision) {
    throw new AppError("STALE_REVISION", "记录已更新，请同步后再操作。", 409);
  }
  if (original.status === "topic_completed") {
    throw new AppError("INVALID_STATE", "这次练习已经完成。", 409);
  }
  for (const key of [
    "id",
    "sceneId",
    "topicId",
    "mode",
    "createdAt",
    "configSnapshot",
    "planSnapshot",
    "planningCall",
  ] as const) {
    if (!isDeepStrictEqual(original[key], candidate[key]))
      invalid("IMMUTABLE_SESSION_CHANGED");
  }
  if (
    !isDeepStrictEqual(
      original.turns,
      candidate.turns.slice(0, original.turns.length),
    )
  ) {
    invalid("HISTORY_CHANGED");
  }
  const added = candidate.turns.slice(original.turns.length);
  if (
    !added.length ||
    candidate.revision !== original.revision + 1 ||
    candidate.status === "awaiting_continue" ||
    candidate.pendingContinuation !== null ||
    added.some((event) => event.createdAt !== candidate.updatedAt) ||
    (candidate.status === "topic_completed" &&
      candidate.topicCompletedAt !== candidate.updatedAt)
  )
    invalid("OPERATION_BOUNDARY_INVALID");
  if (input.action === "continue") {
    if (input.text) invalid("RECOVERY_INPUT_INVALID");
    assertRecovery(original, added);
    return added[0];
  }
  return assertTeachingSubmission(original, input, added);
}

/** 校验新增教学事件与原请求吻合，并按是否通过限制后续提问/完成事件的数量和内容。 */
function assertTeachingSubmission(
  original: TrainingSession,
  input: TurnRequest,
  added: TrainingSession["turns"],
) {
  const first = added[0];
  if (
    original.status !== "active" ||
    first.action === "question" ||
    first.action === "completed"
  ) {
    return invalid("TEACHING_STATE_INVALID");
  }
  if (
    first.action !== input.action ||
    first.payload.text !== input.text ||
    first.questionId !== original.currentQuestionId
  )
    invalid("SUBMISSION_MISMATCH");
  const feedback = first.payload.feedback;
  if (first.action === "hint") {
    assertHintLevel(original, feedback.hint?.level);
  }
  if (
    (first.action !== "answer" || feedback.learnerIntent !== "answer") &&
    (feedback.canContinue ||
      feedback.errorTypes.length ||
      !["uncertain", "not_applicable"].includes(feedback.verdict))
  )
    invalid("NON_ANSWER_HAS_GRADING");
  const expectedLength = first.payload.feedback.canContinue ? 2 : 1;
  if (
    added.length !== expectedLength ||
    (added.length === 2 && !["question", "completed"].includes(added[1].action))
  )
    invalid("TEACHING_EVENTS_INVALID");
  if (added[1]?.action === "question") {
    const planned = original.planSnapshot.questions.find(
      (question) => question.id === added[1].questionId,
    );
    if (
      !added[1].payload.chineseTranslation ||
      added[1].payload.goal !== planned?.goal
    ) {
      invalid("NEXT_QUESTION_INVALID");
    }
  }
  return first;
}

/** 根据当前题已有求助次数校验提示级别，防止跳过关键词、句型直接暴露答案。 */
function assertHintLevel(original: TrainingSession, level?: string) {
  const hints = original.turns.filter(
    (event) =>
      event.questionId === original.currentQuestionId &&
      "feedback" in event.payload &&
      event.payload.feedback.learnerIntent === "hint",
  ).length;
  if (level !== ["keywords", "pattern", "example"][Math.min(hints, 2)]) {
    invalid("HINT_LEVEL_MISMATCH");
  }
}

/** 恢复历史待继续状态时，只允许追加已保存的下一问或结束语，不改内容、不重新生成。 */
function assertRecovery(
  original: TrainingSession,
  added: TrainingSession["turns"],
) {
  const pending = original.pendingContinuation;
  if (
    original.status !== "awaiting_continue" ||
    !pending ||
    added.length !== 1
  ) {
    return invalid("RECOVERY_STATE_INVALID");
  }
  const event = added[0];
  if (pending.nextQuestionId !== null) {
    const planned = original.planSnapshot.questions.find(
      (question) => question.id === pending.nextQuestionId,
    );
    if (
      event.action !== "question" ||
      event.questionId !== pending.nextQuestionId ||
      event.payload.english !== pending.english ||
      event.payload.chineseTask !== pending.chineseTask ||
      event.payload.chineseTranslation !==
        (pending.chineseTranslation ?? undefined) ||
      event.payload.goal !== planned?.goal
    ) {
      invalid("RECOVERY_QUESTION_CHANGED");
    }
  } else if (
    event.action !== "completed" ||
    event.payload.closingMessage !== pending.closingMessage
  ) {
    invalid("RECOVERY_CLOSING_CHANGED");
  }
}

/** 拒绝不符合提交约束的候选，保留细分原因供日志定位并标记本次未保存。 */
function invalid(reason: string): never {
  throw new AppError(
    "STORAGE_VALIDATION_FAILED",
    "记录校验失败，本次内容未保存。",
    500,
    false,
    {
      reason,
      stage: "storage_validation",
      submission: "not_committed",
    },
  );
}
