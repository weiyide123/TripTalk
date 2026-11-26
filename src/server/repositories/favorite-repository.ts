import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  favoriteQuerySchema,
  favoriteSchema,
  favoriteSourceSchema,
  type FavoriteList,
  type FavoriteMark,
  type FavoriteQuery,
  type FavoriteSource,
  type FavoriteView,
} from "@/contracts/favorite";
import { transaction } from "../storage/database";
import { favoriteContent, readFavoriteRow } from "./favorite-records";
import { readSentenceSource } from "./sentence-source";

export class FavoriteRepository {
  constructor(private readonly database: DatabaseSync) {}

  /** 短事务内验证来源并保存文本快照；重复来源返回原收藏，不更新时间或进度。 */
  save(input: FavoriteSource): FavoriteView {
    const source = favoriteSourceSchema.parse(input);
    return transaction(this.database, () => {
      const existing = this.database
        .prepare(
          `SELECT f.*, t.session_id
        FROM favorites f LEFT JOIN turns t ON t.id = f.source_turn_id
        WHERE f.source_turn_id = ? AND f.source_part = ?`,
        )
        .get(source.sourceTurnId, source.sourcePart);
      if (existing)
        return {
          ...readFavoriteRow(existing),
          sourceSessionId: String(existing.session_id),
        };
      const { event, ...location } = readSentenceSource(
        this.database,
        source.sourceTurnId,
      );
      const content = favoriteContent(event, source.sourcePart);
      const cached = this.database
        .prepare(
          `SELECT chinese_translation FROM turn_translations
        WHERE source_turn_id = ? AND source_part = ?`,
        )
        .get(source.sourceTurnId, source.sourcePart);
      const favorite = favoriteSchema.parse({
        id: randomUUID(),
        ...source,
        ...location,
        ...content,
        chineseTranslation:
          content.chineseTranslation ?? cached?.chinese_translation ?? null,
        createdAt: new Date().toISOString(),
      });
      this.database
        .prepare(
          `INSERT INTO favorites
        (id, source_turn_id, source_part, scene_id, topic_id, scene_title,
         topic_title, english, chinese_translation, explanation, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          favorite.id,
          favorite.sourceTurnId,
          favorite.sourcePart,
          favorite.sceneId,
          favorite.topicId,
          favorite.sceneTitle,
          favorite.topicTitle,
          favorite.english,
          favorite.chineseTranslation,
          favorite.explanation,
          favorite.createdAt,
        );
      return {
        ...favorite,
        sourceSessionId: event.sessionId,
      };
    });
  }

  /** 删除指定收藏 UUID；重复删除成功，旧请求不会删掉同来源后来重建的新收藏。 */
  remove(id: string) {
    return transaction(this.database, () => {
      this.database.prepare("DELETE FROM favorites WHERE id = ?").run(id);
      return { deleted: true };
    });
  }

  /** 一次主键关联取得跳转信息；列表、计数与全部筛选目录使用同一读快照。 */
  list(input: FavoriteQuery): FavoriteList {
    const query = favoriteQuerySchema.parse(input);
    return transaction(
      this.database,
      () => {
        const where =
          "(? IS NULL OR f.scene_id = ?) AND (? IS NULL OR f.topic_id = ?)";
        const params = [
          query.sceneId ?? null,
          query.sceneId ?? null,
          query.topicId ?? null,
          query.topicId ?? null,
        ];
        const rows = this.database
          .prepare(
            `SELECT f.*, t.session_id
        FROM favorites f LEFT JOIN turns t ON t.id = f.source_turn_id
        WHERE ${where} ORDER BY f.created_at DESC, f.id DESC LIMIT 50 OFFSET ?`,
          )
          .all(...params, query.offset);
        const total = this.database
          .prepare(`SELECT count(*) AS n FROM favorites f WHERE ${where}`)
          .get(...params)!;
        const filters = this.database
          .prepare(
            `SELECT scene_id, topic_id, scene_title, topic_title
        FROM (SELECT *, row_number() OVER (
          PARTITION BY scene_id, topic_id ORDER BY created_at DESC, id DESC
        ) AS position FROM favorites WHERE scene_id IS NOT NULL)
        WHERE position = 1 ORDER BY scene_title, topic_title`,
          )
          .all();
        return {
          items: rows.map((row) => ({
            ...readFavoriteRow(row),
            sourceSessionId:
              row.session_id === null ? null : String(row.session_id),
          })),
          total: Number(total.n),
          filters: filters.map((row) => ({
            sceneId: String(row.scene_id),
            sceneTitle: String(row.scene_title),
            topicId: String(row.topic_id),
            topicTitle: String(row.topic_title),
          })),
        };
      },
      "read",
    );
  }

  /** 按练习批量读取已收藏身份；不逐气泡查询，也不加载收藏文本。 */
  forSession(sessionId: string): FavoriteMark[] {
    return this.database
      .prepare(
        `SELECT f.id, f.source_turn_id, f.source_part
      FROM turns t JOIN favorites f ON f.source_turn_id = t.id
      WHERE t.session_id = ?`,
      )
      .all(sessionId)
      .map((row) => ({
        id: String(row.id),
        ...favoriteSourceSchema.parse({
          sourceTurnId: row.source_turn_id,
          sourcePart: row.source_part,
        }),
      }));
  }
}
