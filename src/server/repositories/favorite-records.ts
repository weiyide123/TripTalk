import type { SQLOutputValue } from "node:sqlite";
import {
  canFavoriteLearnerAnswer,
  favoriteSchema,
  type FavoritePart,
} from "@/contracts/favorite";
import type { LearningEvent } from "@/contracts/learning-event";
import { AppError } from "../errors";

/** 将物理列转换为统一收藏快照；列表与离线快照共用，避免字段漏读。 */
export function readFavoriteRow(row: Record<string, SQLOutputValue>) {
  return favoriteSchema.parse({
    id: row.id,
    sourceTurnId: row.source_turn_id,
    sourcePart: row.source_part,
    sceneId: row.scene_id,
    topicId: row.topic_id,
    sceneTitle: row.scene_title,
    topicTitle: row.topic_title,
    english: row.english,
    chineseTranslation: row.chinese_translation,
    explanation: row.explanation,
    createdAt: row.created_at,
  });
}

/** 收藏可用表达：原回答必须正确且无修正版；不接受隐藏内容或客户端自带正文。 */
export function favoriteContent(event: LearningEvent, part: FavoritePart) {
  if (
    part === "learner_answer" &&
    (event.action !== "answer" ||
      !canFavoriteLearnerAnswer(event.payload.feedback))
  ) {
    throw new AppError(
      "FAVORITE_SOURCE_INVALID",
      "请收藏反馈中的推荐表达。",
      400,
    );
  }
  return sentenceContent(event, part);
}

/** 翻译针对原句而非正确答案；已保存的原回答可查看释义，但不一定可收藏。 */
export function sentenceContent(event: LearningEvent, part: FavoritePart) {
  if (
    part === "learner_answer" &&
    event.action === "answer" &&
    event.payload.text.trim()
  ) {
    return {
      english: event.payload.text,
      chineseTranslation: event.payload.feedback.learnerTranslation ?? null,
      explanation: null,
    };
  }
  if (part === "question" && event.action === "question") {
    return {
      english: event.payload.english,
      chineseTranslation: event.payload.chineseTranslation ?? null,
      explanation: null,
    };
  }
  if (part === "closing" && event.action === "completed") {
    return {
      english: event.payload.closingMessage,
      chineseTranslation: null,
      explanation: null,
    };
  }
  if (event.action === "answer" || event.action === "explain") {
    const feedback = event.payload.feedback;
    if (part === "roleplay" && feedback.roleplayLine.trim()) {
      return {
        english: feedback.roleplayLine,
        chineseTranslation: feedback.roleplayTranslation ?? null,
        explanation: null,
      };
    }
    if (part === "corrected_answer" && feedback.correctedAnswer?.trim()) {
      return {
        english: feedback.correctedAnswer,
        chineseTranslation: feedback.correctedTranslation ?? null,
        explanation: feedback.explanation,
      };
    }
  }
  throw new AppError(
    "FAVORITE_SOURCE_INVALID",
    "这部分内容暂不支持收藏。",
    400,
  );
}
