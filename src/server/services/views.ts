import type { TrainingSession } from "@/contracts/training-session";
import type { LearningEvent } from "@/contracts/learning-event";
import type { HomeView, SessionView, SessionSummary } from "@/contracts/views";
import type { Question, VisibleQuestion } from "@/contracts/dialogue-plan";
import type { SessionProgress } from "../repositories/learning-progress";
import { getStore } from "../storage/store";
import { currentQuestion, resolvedQuestionIds } from "./session-selectors";

/** 从规划问题提取页面允许看到的字段，排除尚未主动请求的内部参考答案。 */
export function visibleQuestion(question: Question): VisibleQuestion {
  return {
    id: question.id,
    english: question.english,
    chineseTranslation: question.chineseTranslation,
    chineseTask: question.chineseTask,
    goal: question.goal,
  };
}

/** 将练习快照和同一快照的回执编号转换为页面数据，派生进度/结束语，不暴露内部计划。 */
export function sessionView(
  session: TrainingSession,
  processedRequestIds: string[],
): SessionView {
  const completed = session.turns.find((turn) => turn.action === "completed");
  return {
    id: session.id,
    sceneId: session.sceneId,
    sceneTitle: session.configSnapshot.lesson.title,
    topicTitle: session.configSnapshot.topic.title,
    difficulty: session.configSnapshot.lesson.difficulty,
    scenario: session.planSnapshot.scenario,
    revision: session.revision,
    status: session.status,
    currentQuestion: currentQuestion(session),
    turns: session.turns.map(turnView),
    completedCount: resolvedQuestionIds(session).size,
    totalCount: session.planSnapshot.questions.length,
    currentNumber: session.turns.filter((turn) => turn.action === "question")
      .length,
    nextIsClosing: Boolean(session.pendingContinuation?.closingMessage),
    closingMessage:
      completed?.action === "completed"
        ? completed.payload.closingMessage
        : null,
    processedRequestIds,
  };
}

/** 一致性读取练习和回执，再组装对话页视图；读取不会创建练习或推进状态。 */
export function getSessionView(sessionId: string) {
  const snapshot = getStore().sessions.readWithReceipts(sessionId);
  return sessionView(snapshot.session, snapshot.processedRequestIds);
}

/** 组合偏好、场景目录、主题和练习摘要，计算首页当前场景、续学入口及下一主题。 */
export function homeView(sceneId?: string | null): HomeView {
  const store = getStore();
  const profile = store.profile.read();
  const scene = store.catalog.resolveHomeScene(sceneId, profile.lastSceneId);
  const plan = store.catalog.readPlan(scene.id);
  const sessions = store.sessions.progress(scene.id);
  const active = sessions.find(
    (session) => session.status !== "topic_completed",
  );
  const completed = sessions.filter(
    (session) => session.status === "topic_completed",
  );
  const completedTopicIds = [
    ...new Set(completed.map((session) => session.topicId)),
  ];
  const nextTopic = plan?.topics.find(
    (topic) => !completedTopicIds.includes(topic.id),
  );
  return {
    onboardingCompleted: Boolean(profile.onboardingCompletedAt),
    scene,
    scenes: store.catalog.list(),
    difficulty: profile.difficulty,
    initialized: Boolean(plan),
    sceneCompleted: Boolean(plan && !nextTopic && !active),
    topics:
      plan?.topics.map((topic) => ({
        id: topic.id,
        title: topic.title,
        description: topicDescription(topic.scope),
        sessionId:
          sessions.find((session) => session.topicId === topic.id)?.id ?? null,
      })) ?? [],
    nextTopic: nextTopic ? { id: nextTopic.id, title: nextTopic.title } : null,
    activeSession: active ? sessionSummary(active) : null,
    latestCompletedSession: completed[0] ? sessionSummary(completed[0]) : null,
    completedTopicIds,
  };
}

/** 将仓库进度摘要缩减为首页续学卡片需要的字段。 */
function sessionSummary(session: SessionProgress): SessionSummary {
  return {
    id: session.id,
    topicId: session.topicId,
    topicTitle: session.topicTitle,
    difficulty: session.difficulty,
    currentGoal: session.currentGoal,
    completedCount: session.completedCount,
    totalCount: session.totalCount,
  };
}

/** 取主题范围的首句作为简短说明，最多 60 个 Unicode 字符，超出追加省略号。 */
function topicDescription(scope: string) {
  const firstSentence = scope
    .trim()
    .split(/[。！？\n]/u)[0]
    .trim();
  const characters = Array.from(firstSentence);
  if (characters.length <= 60) return firstSentence;
  return characters.slice(0, 60).join("") + "…";
}

/** 按事件种类映射提问、反馈或完成内容，去除页面不需要的模型用量和状态变更依据。 */
function turnView(turn: LearningEvent): SessionView["turns"][number] {
  if (turn.action === "question") {
    return {
      id: turn.id,
      action: turn.action,
      question: { id: turn.questionId, ...turn.payload },
    };
  }
  if (turn.action === "completed") {
    return {
      id: turn.id,
      action: turn.action,
      closingMessage: turn.payload.closingMessage,
    };
  }
  return {
    id: turn.id,
    questionId: turn.questionId,
    action: turn.action,
    text: turn.payload.text,
    evaluation: turn.payload.feedback,
  };
}
