import type { DatabaseSync } from "node:sqlite";
import {
  trainingSessionSchema,
  type TrainingSession,
} from "@/contracts/training-session";
import type { LearningEvent } from "@/contracts/learning-event";
import { AppError } from "../errors";

/** 读取一条练习及按 sequence 排序的事件，解析 JSON 列并校验；一致性由仓库读事务保证。 */
export function readSession(
  database: DatabaseSync,
  sessionId: string,
): TrainingSession {
  const row = database
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(sessionId);
  if (!row)
    throw new AppError("SESSION_NOT_FOUND", "没有找到这段学习记录。", 404);
  const events = database
    .prepare("SELECT * FROM turns WHERE session_id = ? ORDER BY sequence")
    .all(sessionId);
  return trainingSessionSchema.parse({
    id: row.id,
    sceneId: row.scene_id,
    topicId: row.topic_id,
    mode: row.mode,
    status: row.status,
    revision: row.revision,
    currentQuestionId: row.current_question_id,
    configSnapshot: JSON.parse(String(row.config_snapshot_json)),
    planSnapshot: JSON.parse(String(row.plan_snapshot_json)),
    planningCall: JSON.parse(String(row.planning_call_json)),
    pendingContinuation:
      row.pending_continuation_json === null
        ? null
        : JSON.parse(String(row.pending_continuation_json)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    topicCompletedAt: row.topic_completed_at,
    turns: events.map((event) => ({
      id: event.id,
      sessionId: event.session_id,
      sequence: event.sequence,
      action: event.action,
      questionId: event.question_id,
      payload: JSON.parse(String(event.payload_json)),
      createdAt: event.created_at,
    })),
  });
}

/** 插入新练习及首问事件；由仓库先校验初始状态并提供事务，不负责幂等判断。 */
export function insertSession(
  database: DatabaseSync,
  session: TrainingSession,
) {
  database
    .prepare(
      `INSERT INTO sessions
    (id, scene_id, topic_id, mode, status, revision, current_question_id,
     config_snapshot_json, plan_snapshot_json, planning_call_json,
     pending_continuation_json, created_at, updated_at, topic_completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
    )
    .run(
      session.id,
      session.sceneId,
      session.topicId,
      session.mode,
      session.status,
      session.revision,
      session.currentQuestionId,
      JSON.stringify(session.configSnapshot),
      JSON.stringify(session.planSnapshot),
      JSON.stringify(session.planningCall),
      session.createdAt,
      session.updatedAt,
    );
  appendEvents(database, session.turns);
}

/** 仅更新允许变化的状态列；用 expectedRevision 防止覆盖较新提交，不修改身份/计划。 */
export function updateSessionState(
  database: DatabaseSync,
  session: TrainingSession,
  expectedRevision: number,
) {
  // 不允许 UPDATE 身份、生成计划、初始配置与任何历史事件。
  const result = database
    .prepare(
      `UPDATE sessions SET status = ?, revision = ?,
    current_question_id = ?, pending_continuation_json = ?, updated_at = ?, topic_completed_at = ?
    WHERE id = ? AND revision = ?`,
    )
    .run(
      session.status,
      session.revision,
      session.currentQuestionId,
      session.pendingContinuation
        ? JSON.stringify(session.pendingContinuation)
        : null,
      session.updatedAt,
      session.topicCompletedAt,
      session.id,
      expectedRevision,
    );
  if (result.changes !== 1) {
    throw new AppError("STALE_REVISION", "记录已更新，请同步后再操作。", 409);
  }
}

/** 追加事件，不更新或删除历史；调用方负责校验连续性并将其纳入同一提交事务。 */
export function appendEvents(database: DatabaseSync, events: LearningEvent[]) {
  const statement = database.prepare(`INSERT INTO turns
    (id, session_id, sequence, action, question_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const event of events) {
    statement.run(
      event.id,
      event.sessionId,
      event.sequence,
      event.action,
      event.questionId,
      JSON.stringify(event.payload),
      event.createdAt,
    );
  }
}
