import { z } from "zod";
import type { Feedback } from "./teaching";

export const favoritePartSchema = z.enum([
  "question",
  "roleplay",
  "corrected_answer",
  "closing",
  "learner_answer",
]);
export const favoriteSourceSchema = z
  .object({
    sourceTurnId: z.string().trim().min(1).max(200),
    sourcePart: favoritePartSchema,
  })
  .strict();
export const favoriteSchema = z
  .object({
    id: z.string().uuid(),
    sourceTurnId: z.string().min(1).nullable(),
    sourcePart: favoritePartSchema,
    sceneId: z.string().min(1).nullable(),
    topicId: z.string().min(1),
    sceneTitle: z.string().min(1),
    topicTitle: z.string().min(1),
    english: z.string().trim().min(1).max(2000),
    chineseTranslation: z.string().nullable(),
    explanation: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
export const favoriteQuerySchema = z
  .object({
    sceneId: z.string().min(1).max(200).optional(),
    topicId: z.string().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict()
  .refine((value) => !value.topicId || !!value.sceneId, {
    message: "主题筛选需要场景",
  });

export type Favorite = z.infer<typeof favoriteSchema>;
export type FavoriteSource = z.infer<typeof favoriteSourceSchema>;
export type FavoritePart = z.infer<typeof favoritePartSchema>;
export type FavoriteQuery = z.infer<typeof favoriteQuerySchema>;
export type FavoriteView = Favorite & { sourceSessionId: string | null };
export type FavoriteList = {
  items: FavoriteView[];
  total: number;
  filters: {
    sceneId: string;
    sceneTitle: string;
    topicId: string;
    topicTitle: string;
  }[];
};
export type FavoriteMark = FavoriteSource & { id: string };

/** 只收藏可直接使用且没有替代版本的原回答；前后端共用，不以 canContinue 单独判断。 */
export function canFavoriteLearnerAnswer(feedback: Feedback) {
  return (
    feedback.learnerIntent === "answer" &&
    feedback.verdict === "correct" &&
    feedback.canContinue &&
    feedback.errorTypes.length === 0 &&
    !feedback.correctedAnswer?.trim()
  );
}

/** 同一事件中的角色回应与推荐表达分别收藏，不以文字内容猜测身份。 */
export function favoriteSourceKey(source: FavoriteSource) {
  return `${source.sourceTurnId}:${source.sourcePart}`;
}

/** 来源不存在时不生成可点击链接；参数仅定位，不推进或重建练习。 */
export function favoriteSourceHref(item: FavoriteView) {
  if (!item.sourceSessionId || !item.sourceTurnId) return null;
  const query = new URLSearchParams({
    turn: item.sourceTurnId,
    part: item.sourcePart,
  });
  return `/lessons/${encodeURIComponent(item.sourceSessionId)}?${query}`;
}
