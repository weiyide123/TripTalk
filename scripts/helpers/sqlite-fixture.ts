import { randomUUID } from "node:crypto";
import catalog from "../../content/scenes.json";
import type { SceneData } from "../../src/contracts/legacy/scene-data";
import type {
  Session,
  ModelCall,
  Turn,
} from "../../src/contracts/legacy/session";
import type { Evaluation } from "../../src/contracts/jane-turn";
import type { TurnRequest } from "../../src/contracts/requests";
import { inputHash } from "../../src/server/request-hash";

const modelCall: ModelCall = {
  model: "offline-fixture",
  elapsedMs: 1,
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  promptVersion: "sqlite-fixture",
};

export function sqliteFixture(status: Session["status"] = "active") {
  const questions = Array.from({ length: 8 }, (_, index) => ({
    id: `q${index + 1}`,
    english: `Planned question ${index + 1}?`,
    chineseTranslation: `计划问题 ${index + 1}？`,
    chineseTask: `说明离线任务 ${index + 1}`,
    referenceAnswer: `Answer ${index + 1}`,
    goal: `目标 ${index + 1}`,
  }));
  const session: Session = {
    id: randomUUID(),
    mode: "practice",
    sceneId: "hotel",
    topicId: "topic-1",
    configSnapshot: {
      lesson: {
        id: "hotel",
        version: 1,
        title: "酒店英语",
        description: "离线示例",
        difficulty: "medium",
      },
      topic: {
        id: "topic-1",
        title: "办理入住",
        available: true,
        minQuestions: 8,
        maxQuestions: 15,
        scope: "入住沟通",
      },
    },
    planSnapshot: {
      id: randomUUID(),
      topicId: "topic-1",
      scenario: "只用于离线迁移检查",
      facts: [{ key: "nights", value: "2" }],
      questions,
    },
    planningCall: modelCall,
    presentedQuestions: {
      q1: {
        id: "q1",
        english: "Actual first question?",
        chineseTask: "说明实际任务",
        goal: "目标 1",
      },
    },
    revision: 0,
    status: "active",
    currentQuestionId: "q1",
    pendingContinuation: null,
    turns: [],
    closingMessage: null,
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
    topicCompletedAt: null,
  };
  const hint = evaluation(null);
  Object.assign(hint, {
    learnerIntent: "hint",
    verdict: "not_applicable",
    canContinue: false,
    continuation: null,
    hint: { level: "keywords", text: "先说入住人数" },
  });
  recordEvaluation(session, request(session, "hint"), hint, modelCall);
  const rounds = status === "topic_completed" ? 8 : 1;
  for (let index = 0; index < rounds; index++) {
    const next = index < 7 ? questions[index + 1] : null;
    const feedback = evaluation(next);
    const input = request(session, "answer");
    if (status === "awaiting_continue") {
      const turn = applyEvaluation(session, input, feedback, modelCall);
      session.turns.push(turn);
      session.revision = turn.revision;
      session.updatedAt = turn.createdAt;
    } else {
      recordEvaluation(session, input, feedback, modelCall);
    }
  }
  const data: SceneData = {
    schemaVersion: 1,
    sceneId: "hotel",
    plan: {
      sceneId: "hotel",
      source: "generated",
      createdAt: session.createdAt,
      planningCall: modelCall,
      topics: ["办理入住", "餐饮咨询", "办理退房"].map((title, index) => ({
        id: `topic-${index + 1}`,
        title,
        scope: `本主题只练习${title}相关沟通`,
        boundaries: `不包含其他主题，只处理${title}`,
      })),
    },
    sessions: { [session.id]: session },
    creationRequests: {
      [randomUUID()]: { inputHash: "a".repeat(64), sessionId: session.id },
    },
  };
  return {
    catalog,
    profile: {
      schemaVersion: 1,
      onboardingCompletedAt: null,
      difficulty: "medium",
      lastSceneId: "hotel",
    },
    sceneData: [data],
  };
}

function request(session: Session, action: Turn["action"]) {
  return {
    requestId: randomUUID(),
    expectedRevision: session.revision,
    action,
    text: "I would like to check in.",
  };
}

function evaluation(next: { id: string } | null): Evaluation {
  return {
    learnerIntent: "answer",
    verdict: "correct",
    canContinue: true,
    correctedAnswer: null,
    explanation: null,
    errorTypes: [],
    roleplayLine: "Thank you.",
    tutorFeedback: "表达清楚了。",
    hint: null,
    continuation: {
      nextQuestionId: next?.id ?? null,
      english: next ? `Actual ${next.id}?` : null,
      chineseTranslation: next ? "实际问题的翻译" : null,
      chineseTask: next ? "回应实际问题" : null,
      closingMessage: next ? null : "练习完成，出发吧！",
    },
    coveredEarly: [],
    factChanges: [],
  };
}

// 迁移夹具刻意保持旧格式，与当前教学状态机隔离，避免新逻辑改写迁移输入。
function applyEvaluation(
  session: Session,
  input: TurnRequest,
  value: Evaluation,
  call: ModelCall,
): Turn {
  const { continuation, coveredEarly, factChanges, ...feedback } = value;
  if (value.canContinue) {
    session.pendingContinuation = continuation;
    session.status = "awaiting_continue";
  }
  return {
    id: randomUUID(),
    requestId: input.requestId,
    inputHash: inputHash(input),
    revision: session.revision + 1,
    createdAt: new Date().toISOString(),
    questionId: session.currentQuestionId!,
    action: input.action as "answer" | "hint" | "explain",
    text: input.text,
    feedback,
    effects: { coveredEarly, factChanges },
    modelCall: call,
  };
}

function recordEvaluation(
  session: Session,
  input: TurnRequest,
  value: Evaluation,
  call: ModelCall,
) {
  const turn = applyEvaluation(session, input, value, call);
  session.turns.push(turn);
  session.revision = turn.revision;
  session.updatedAt = turn.createdAt;
  const next = session.pendingContinuation;
  if (!next) return;
  const requestId = randomUUID();
  const continuation: Turn = {
    id: randomUUID(),
    requestId,
    inputHash: inputHash({
      requestId,
      expectedRevision: session.revision,
      action: "continue",
      text: "",
    }),
    revision: session.revision + 1,
    createdAt: new Date().toISOString(),
    questionId: session.currentQuestionId!,
    action: "continue",
    nextQuestionId: next.nextQuestionId,
  };
  if (next.nextQuestionId) {
    const planned = session.planSnapshot.questions.find(
      (q) => q.id === next.nextQuestionId,
    )!;
    session.presentedQuestions[planned.id] = {
      id: planned.id,
      goal: planned.goal,
      english: next.english!,
      chineseTranslation: next.chineseTranslation!,
      chineseTask: next.chineseTask!,
    };
    session.status = "active";
  } else {
    session.status = "topic_completed";
    session.closingMessage = next.closingMessage;
    session.topicCompletedAt = continuation.createdAt;
  }
  session.currentQuestionId = next.nextQuestionId;
  session.pendingContinuation = null;
  session.turns.push(continuation);
  session.revision = continuation.revision;
  session.updatedAt = continuation.createdAt;
}
