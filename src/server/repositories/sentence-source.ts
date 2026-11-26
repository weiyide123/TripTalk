import type { DatabaseSync } from "node:sqlite";
import { learningEventSchema } from "@/contracts/learning-event";
import { AppError } from "../errors";

/** 按已保存事件读取来源与场景快照；收藏和补译共用，不信任客户端传入正文。 */
export function readSentenceSource(
  database: DatabaseSync,
  sourceTurnId: string,
) {
  const row = database
    .prepare(
      `SELECT t.*, s.scene_id, s.topic_id, s.config_snapshot_json
    FROM turns t JOIN sessions s ON s.id = t.session_id WHERE t.id = ?`,
    )
    .get(sourceTurnId);
  if (!row)
    throw new AppError(
      "FAVORITE_SOURCE_NOT_FOUND",
      "原对话不存在，暂时无法处理。",
      404,
    );
  const event = learningEventSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    sequence: row.sequence,
    action: row.action,
    questionId: row.question_id,
    payload: JSON.parse(String(row.payload_json)),
    createdAt: row.created_at,
  });
  const config = JSON.parse(String(row.config_snapshot_json));
  return {
    event,
    sceneId: String(row.scene_id),
    topicId: String(row.topic_id),
    sceneTitle: String(config.lesson.title),
    topicTitle: String(config.topic.title),
  };
}
