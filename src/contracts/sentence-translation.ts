import { z } from "zod";
import { favoriteSourceSchema } from "./favorite";

export const translationResultSchema = z
  .object({
    chineseTranslation: z.string().trim().min(1).max(3000),
  })
  .strict();

export const savedTranslationSchema = favoriteSourceSchema
  .extend({
    chineseTranslation: translationResultSchema.shape.chineseTranslation,
    createdAt: z.string().datetime(),
  })
  .strict();

export type SavedTranslation = z.infer<typeof savedTranslationSchema>;
