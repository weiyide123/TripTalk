import type { DatabaseSync } from "node:sqlite";
import {
  favoriteSourceSchema,
  type FavoriteSource,
} from "@/contracts/favorite";
import {
  savedTranslationSchema,
  translationResultSchema,
} from "@/contracts/sentence-translation";
import { transaction } from "../storage/database";
import { sentenceContent } from "./favorite-records";
import { readSentenceSource } from "./sentence-source";

/** 补译是原事件的附属缓存，不修改事件、回执或学习进度。 */
export class TranslationRepository {
  constructor(private readonly database: DatabaseSync) {}

  /** 优先使用教学时已有的释义，再读历史补译缓存；读取不调用模型。 */
  read(input: FavoriteSource) {
    const source = favoriteSourceSchema.parse(input);
    const { event } = readSentenceSource(this.database, source.sourceTurnId);
    const content = sentenceContent(event, source.sourcePart);
    const cached = this.database
      .prepare(
        `SELECT chinese_translation FROM turn_translations
      WHERE source_turn_id = ? AND source_part = ?`,
      )
      .get(source.sourceTurnId, source.sourcePart);
    return {
      english: content.english,
      chineseTranslation:
        content.chineseTranslation ??
        (cached ? String(cached.chinese_translation) : null),
    };
  }

  /** 模型返回后重新检查来源，幂等保存并同步已有收藏；不会复活已取消的收藏。 */
  save(input: FavoriteSource, chineseTranslation: string) {
    const source = favoriteSourceSchema.parse(input);
    const result = translationResultSchema.parse({ chineseTranslation });
    return transaction(this.database, () => {
      const existing = this.read(source);
      const translation =
        existing.chineseTranslation ?? result.chineseTranslation;
      const saved = savedTranslationSchema.parse({
        ...source,
        chineseTranslation: translation,
        createdAt: new Date().toISOString(),
      });
      this.database
        .prepare(
          `INSERT INTO turn_translations
        (source_turn_id, source_part, chinese_translation, created_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(source_turn_id, source_part) DO NOTHING`,
        )
        .run(
          saved.sourceTurnId,
          saved.sourcePart,
          saved.chineseTranslation,
          saved.createdAt,
        );
      this.database
        .prepare(
          `UPDATE favorites SET chinese_translation = ?
        WHERE source_turn_id = ? AND source_part = ? AND chinese_translation IS NULL`,
        )
        .run(translation, source.sourceTurnId, source.sourcePart);
      return { chineseTranslation: translation };
    });
  }
}
