import { randomUUID } from "node:crypto";
import type { TrainingSession } from "../../src/contracts/training-session";
import type { LearningEvent } from "../../src/contracts/learning-event";
import type { TurnRequest } from "../../src/contracts/requests";
import type { Scene, SceneTopic } from "../../src/contracts/scene";
import { sqliteFixture } from "./sqlite-fixture";

// 纯离线候选，不连接模型。测试仓库是否接收/拒绝指定业务结果。
export function initialTrainingSession(
  scene: Scene,
  topic: SceneTopic,
): TrainingSession {
  const source = sqliteFixture().sessions[0];
  const now = new Date().toISOString();
  const sessionId = randomUUID();
  const first = source.planSnapshot.questions[0];
  const { referenceAnswer: _, id: questionId, ...payload } = first;
  return {
    ...source,
    id: sessionId,
    sceneId: scene.id,
    topicId: topic.id,
    configSnapshot: {
      lesson: {
        id: scene.id,
        version: scene.version,
        title: scene.title,
        description: scene.description,
        difficulty: "medium",
      },
      topic: {
        id: topic.id,
        title: topic.title,
        available: true,
        minQuestions: 8,
        maxQuestions: 15,
        scope: topic.scope + "\n主题边界：" + topic.boundaries,
      },
    },
    planSnapshot: {
      ...source.planSnapshot,
      id: randomUUID(),
      topicId: topic.id,
    },
    revision: 0,
    status: "active",
    currentQuestionId: questionId,
    pendingContinuation: null,
    createdAt: now,
    updatedAt: now,
    topicCompletedAt: null,
    turns: [
      {
        id: randomUUID(),
        sessionId,
        sequence: 1,
        createdAt: now,
        action: "question",
        questionId,
        payload,
      },
    ],
  };
}

export function simulatedSubmission(
  original: TrainingSession,
  action: "answer" | "hint" | "explain" = "answer",
  pass = true,
) {
  const input: TurnRequest = {
    requestId: randomUUID(),
    expectedRevision: original.revision,
    action,
    text: action === "answer" ? "There are two of us." : "",
  };
  const candidate = structuredClone(original);
  const now = new Date().toISOString();
  candidate.revision += 1;
  candidate.updatedAt = now;
  const canContinue = action === "answer" && pass;
  const feedback = {
    learnerIntent: action,
    verdict: "not_applicable" as "not_applicable" | "correct" | "uncertain",
    canContinue,
    correctedAnswer: null,
    explanation: null,
    errorTypes: [],
    roleplayLine: "Thank you.",
    tutorFeedback: "离线教学结果。",
    hint:
      action === "hint"
        ? { level: "keywords" as const, text: "two of us" }
        : null,
  };
  if (action === "answer")
    feedback.verdict = canContinue ? "correct" : "uncertain";
  append(candidate, {
    action,
    questionId: original.currentQuestionId!,
    payload: {
      text: input.text,
      feedback,
      effects: { coveredEarly: [], factChanges: [] },
      modelCall: original.planningCall,
    },
  });
  if (canContinue) {
    const currentIndex = candidate.planSnapshot.questions.findIndex(
      (question) => question.id === original.currentQuestionId,
    );
    const next = candidate.planSnapshot.questions[currentIndex + 1];
    if (next) {
      const { referenceAnswer: _, id: questionId, ...payload } = next;
      append(candidate, { action: "question", questionId, payload });
      candidate.currentQuestionId = questionId;
    } else {
      append(candidate, {
        action: "completed",
        questionId: null,
        payload: { closingMessage: "这次练习完成啦！" },
      });
      candidate.currentQuestionId = null;
      candidate.status = "topic_completed";
      candidate.topicCompletedAt = now;
    }
  }
  return { input, candidate };
}

type EventContent = LearningEvent extends infer Event
  ? Event extends LearningEvent
    ? Omit<Event, "id" | "sessionId" | "sequence" | "createdAt">
    : never
  : never;

export function append(session: TrainingSession, content: EventContent) {
  session.turns.push({
    ...content,
    id: randomUUID(),
    sessionId: session.id,
    sequence: session.turns.length + 1,
    createdAt: session.updatedAt,
  });
}
