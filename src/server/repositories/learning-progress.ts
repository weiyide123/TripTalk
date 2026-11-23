import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { difficultySchema } from "@/contracts/difficulty";

const progressSchema = z
  .object({
    id: z.string(),
    topicId: z.string(),
    topicTitle: z.string(),
    difficulty: difficultySchema,
    status: z.enum(["active", "awaiting_continue", "topic_completed"]),
    updatedAt: z.string(),
    currentGoal: z.string().nullable(),
    completedCount: z.number().int().nonnegative(),
    totalCount: z.number().int().min(8).max(15),
  })
  .strict();
export type SessionProgress = z.infer<typeof progressSchema>;

/**
 * 在 SQL 中汇总场景各次练习的进度，按最近更新排序，不加载完整对话到 Node。
 * 已通过与提前覆盖的目标合并去重；返回首页需要的当前目标、完成数和总数。
 */
export function readLearningProgress(
  database: DatabaseSync,
  sceneId: string,
): SessionProgress[] {
  const rows = database
    .prepare(
      `WITH resolved AS (
    SELECT t.session_id, t.question_id FROM turns t
    JOIN sessions s ON s.id = t.session_id
    WHERE s.scene_id = ? AND t.action = 'answer'
      AND json_extract(t.payload_json, '$.feedback.canContinue') = 1
    UNION
    SELECT t.session_id, json_extract(e.value, '$.questionId') FROM turns t
    JOIN sessions s ON s.id = t.session_id
    JOIN json_each(t.payload_json, '$.effects.coveredEarly') e
    WHERE s.scene_id = ? AND t.action = 'answer'
      AND json_extract(t.payload_json, '$.feedback.canContinue') = 1
  ), counts AS (
    SELECT session_id, count(*) AS completed FROM resolved GROUP BY session_id
  )
  SELECT s.id, s.topic_id, s.status, s.updated_at,
    json_extract(s.config_snapshot_json, '$.topic.title') AS topic_title,
    json_extract(s.config_snapshot_json, '$.lesson.difficulty') AS difficulty,
    json_array_length(s.plan_snapshot_json, '$.questions') AS total,
    json_extract(q.payload_json, '$.goal') AS current_goal,
    coalesce(c.completed, 0) AS completed
  FROM sessions s LEFT JOIN counts c ON c.session_id = s.id
  LEFT JOIN turns q ON q.session_id = s.id AND q.action = 'question'
    AND q.question_id = s.current_question_id
  WHERE s.scene_id = ? ORDER BY s.updated_at DESC, s.id`,
    )
    .all(sceneId, sceneId, sceneId);
  return rows.map((row) =>
    progressSchema.parse({
      id: row.id,
      topicId: row.topic_id,
      topicTitle: row.topic_title,
      difficulty: row.difficulty,
      status: row.status,
      updatedAt: row.updated_at,
      currentGoal: row.current_goal,
      completedCount: row.completed,
      totalCount: row.total,
    }),
  );
}
