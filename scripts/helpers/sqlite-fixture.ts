import { randomUUID } from "node:crypto";
import catalog from "../../content/scenes.json";
import {
  sqliteSnapshotSchema,
  type SqliteSnapshot,
} from "../../src/contracts/sqlite-snapshot";
import type { TrainingSession } from "../../src/contracts/training-session";
import type { ModelCall } from "../../src/contracts/teaching";
import { inputHash } from "../../src/server/request-hash";
import { createCatalogSnapshot } from "../../src/server/storage/snapshots/write-snapshot";

const modelCall: ModelCall = {
  model: "offline-fixture",
  elapsedMs: 1,
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  promptVersion: "sqlite-fixture",
};
const createdAt = "2026-11-19T00:00:00.000Z";

/** 直接构造当前 SQLite 快照；保留历史空翻译、空回执时间和待继续状态的读取覆盖。 */
export function sqliteFixture(
  status: TrainingSession["status"] = "active",
): SqliteSnapshot {
  const snapshot = createCatalogSnapshot(catalog);
  snapshot.profile = {
    schemaVersion: 1,
    onboardingCompletedAt: null,
    difficulty: "medium",
    lastSceneId: "hotel",
  };
  const scene = snapshot.scenes.find((item) => item.id === "hotel")!;
  scene.plan = {
    sceneId: scene.id,
    source: "generated",
    createdAt,
    planningCall: modelCall,
    topics: ["办理入住", "餐饮咨询", "办理退房"].map((title, index) => ({
      id: "topic-" + (index + 1),
      title,
      scope: "本主题只练习" + title + "相关沟通",
      boundaries: "不包含其他主题，只处理" + title,
    })),
  };
  const session = initialSession();
  snapshot.sessions.push(session);
  snapshot.receipts.push({
    operation: "create-session",
    scopeId: session.sceneId,
    requestId: randomUUID(),
    inputHash: "a".repeat(64),
    createdAt: null,
    result: { sessionId: session.id },
  });
  appendTeaching(snapshot, session, "hint");
  const rounds = status === "topic_completed" ? 8 : 1;
  for (let index = 0; index < rounds; index++) {
    appendTeaching(snapshot, session, "answer");
    const next = session.planSnapshot.questions[index + 1];
    if (status === "awaiting_continue") {
      session.status = status;
      session.pendingContinuation = {
        nextQuestionId: next.id,
        english: "Actual " + next.id + "?",
        chineseTranslation: "实际问题的翻译",
        chineseTask: "回应实际问题",
        closingMessage: null,
      };
      break;
    }
    // 模拟既有记录：旧推进有独立版本/回执，但事件只保存实际问题或结束语。
    if (next) {
      session.turns.push({
        ...eventFields(session),
        action: "question",
        questionId: next.id,
        payload: {
          english: "Actual " + next.id + "?",
          chineseTranslation: "实际问题的翻译",
          chineseTask: "回应实际问题",
          goal: next.goal,
        },
      });
      session.currentQuestionId = next.id;
    } else {
      session.turns.push({
        ...eventFields(session),
        action: "completed",
        questionId: null,
        payload: { closingMessage: "练习完成，出发吧！" },
      });
      session.status = "topic_completed";
      session.currentQuestionId = null;
      session.topicCompletedAt = createdAt;
    }
    appendReceipt(snapshot, session, "continue", "");
  }
  return sqliteSnapshotSchema.parse(snapshot);
}

/** 实际首问不同于计划且无翻译，避免回归时用计划内容伪造历史。 */
function initialSession(): TrainingSession {
  const sessionId = randomUUID();
  return {
    id: sessionId,
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
      scenario: "只用于离线存储检查",
      facts: [{ key: "nights", value: "2" }],
      questions: Array.from({ length: 8 }, (_, index) => ({
        id: "q" + (index + 1),
        english: "Planned question " + (index + 1) + "?",
        chineseTranslation: "计划问题 " + (index + 1) + "？",
        chineseTask: "说明离线任务 " + (index + 1),
        referenceAnswer: "Answer " + (index + 1),
        goal: "目标 " + (index + 1),
      })),
    },
    planningCall: modelCall,
    revision: 0,
    status: "active",
    currentQuestionId: "q1",
    pendingContinuation: null,
    createdAt,
    updatedAt: createdAt,
    topicCompletedAt: null,
    turns: [
      {
        id: randomUUID(),
        sessionId,
        sequence: 1,
        createdAt,
        action: "question",
        questionId: "q1",
        payload: {
          english: "Actual first question?",
          chineseTask: "说明实际任务",
          goal: "目标 1",
        },
      },
    ],
  };
}

/** 直接构造教学事件，不复用生产推进算法，以独立验证存储契约。 */
function appendTeaching(
  snapshot: SqliteSnapshot,
  session: TrainingSession,
  action: "hint" | "answer",
) {
  const isAnswer = action === "answer";
  const text = "I would like to check in.";
  session.turns.push({
    ...eventFields(session),
    action,
    questionId: session.currentQuestionId!,
    payload: {
      text,
      feedback: {
        learnerIntent: action,
        verdict: isAnswer ? "correct" : "not_applicable",
        canContinue: isAnswer,
        correctedAnswer: null,
        explanation: null,
        errorTypes: [],
        roleplayLine: "Thank you.",
        tutorFeedback: "表达清楚了。",
        hint: isAnswer ? null : { level: "keywords", text: "先说入住人数" },
      },
      effects: { coveredEarly: [], factChanges: [] },
      modelCall,
    },
  });
  appendReceipt(snapshot, session, action, text);
}

/** 按事件末尾分配身份和序号，不将序号当作操作版本。 */
function eventFields(session: TrainingSession) {
  return {
    id: randomUUID(),
    sessionId: session.id,
    sequence: session.turns.length + 1,
    createdAt,
  };
}

/** 为刚追加的事件保存独立回执，覆盖旧请求重试与版本保真。 */
function appendReceipt(
  snapshot: SqliteSnapshot,
  session: TrainingSession,
  action: "hint" | "answer" | "continue",
  text: string,
) {
  const requestId = randomUUID();
  const hash = inputHash({
    requestId,
    expectedRevision: session.revision,
    action,
    text,
  });
  session.revision++;
  snapshot.receipts.push({
    operation: "session-turn",
    scopeId: session.id,
    requestId,
    inputHash: hash,
    createdAt,
    result: {
      sessionId: session.id,
      turnId: session.turns.at(-1)!.id,
      revision: session.revision,
    },
  });
}
