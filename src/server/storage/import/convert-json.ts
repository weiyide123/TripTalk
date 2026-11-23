import { sceneDataSchema, type SceneData } from "@/contracts/legacy/scene-data";
import { profileSchema } from "@/contracts/profile";
import { sceneSchema } from "@/contracts/scene";
import {
  sqliteSnapshotSchema,
  type SqliteSnapshot,
} from "@/contracts/sqlite-snapshot";
import { trainingSessionSchema } from "@/contracts/training-session";
import type { Session } from "@/contracts/legacy/session";
import type { LearningEvent } from "@/contracts/learning-event";
import type { OperationReceipt } from "@/contracts/operation-receipt";

// 旧契约只在离线转换入口使用；新事件中不保留 continue 或请求字段。
export function convertJsonSnapshot(input: {
  catalog: unknown[];
  profile: unknown | null;
  sceneData: unknown[];
}): SqliteSnapshot {
  const catalog = input.catalog.map((item) => sceneSchema.parse(item));
  const sceneData = input.sceneData.map((item) => sceneDataSchema.parse(item));
  const dataByScene = new Map(sceneData.map((data) => [data.sceneId, data]));
  if (
    dataByScene.size !== sceneData.length ||
    sceneData.some(
      (data) => !catalog.some((scene) => scene.id === data.sceneId),
    )
  ) {
    throw new Error("Duplicate or unknown source scene");
  }
  const sessions = sceneData.flatMap((data) => Object.values(data.sessions));
  return sqliteSnapshotSchema.parse({
    profile: input.profile === null ? null : profileSchema.parse(input.profile),
    scenes: catalog.map((scene, position) => ({
      ...scene,
      position,
      origin: "builtin",
      plan: dataByScene.get(scene.id)?.plan ?? null,
    })),
    sessions: sessions.map(convertSession),
    receipts: sceneData.flatMap(convertReceipts),
  });
}

function convertSession(session: Session) {
  const {
    presentedQuestions,
    closingMessage,
    turns: oldTurns,
    ...record
  } = session;
  const firstId = session.planSnapshot.questions[0].id;
  const questionPayload = (questionId: string) => {
    const { id, ...payload } = presentedQuestions[questionId];
    if (id !== questionId) throw new Error("Invalid source question identity");
    return payload;
  };
  const turns: LearningEvent[] = [
    {
      id: session.id + ":initial-question",
      sessionId: session.id,
      sequence: 1,
      action: "question",
      questionId: firstId,
      payload: questionPayload(firstId),
      createdAt: session.createdAt,
    },
  ];
  for (const turn of oldTurns) {
    const fields = {
      id: turn.id,
      sessionId: session.id,
      sequence: turns.length + 1,
      createdAt: turn.createdAt,
    };
    if (turn.action !== "continue") {
      turns.push({
        ...fields,
        action: turn.action,
        questionId: turn.questionId,
        payload: {
          text: turn.text,
          feedback: turn.feedback,
          effects: turn.effects,
          modelCall: turn.modelCall,
        },
      });
    } else if (turn.nextQuestionId !== null) {
      turns.push({
        ...fields,
        action: "question",
        questionId: turn.nextQuestionId,
        payload: questionPayload(turn.nextQuestionId),
      });
    } else {
      if (!closingMessage) throw new Error("Missing source closing message");
      turns.push({
        ...fields,
        action: "completed",
        questionId: null,
        payload: { closingMessage },
      });
    }
  }
  return trainingSessionSchema.parse({ ...record, turns });
}

function convertReceipts(data: SceneData): OperationReceipt[] {
  const receipts: OperationReceipt[] = Object.entries(
    data.creationRequests,
  ).map(([requestId, entry]) => ({
    operation: "create-session",
    scopeId: data.sceneId,
    requestId,
    inputHash: entry.inputHash,
    result: { sessionId: entry.sessionId },
    createdAt: null,
  }));
  for (const session of Object.values(data.sessions)) {
    for (const turn of session.turns) {
      receipts.push({
        operation: "session-turn",
        scopeId: session.id,
        requestId: turn.requestId,
        inputHash: turn.inputHash,
        result: {
          sessionId: session.id,
          turnId: turn.id,
          revision: turn.revision,
        },
        createdAt: turn.createdAt,
      });
    }
  }
  return receipts;
}
