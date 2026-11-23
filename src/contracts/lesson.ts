import { z } from "zod";
import { difficultySchema } from "./difficulty";
export const topicSchema = z.object({
  id: z.string(),
  title: z.string(),
  available: z.boolean(),
  minQuestions: z.number().int().min(8),
  maxQuestions: z.number().int().max(15),
  scope: z.string(),
});
export const lessonSnapshotSchema = z
  .object({
    id: z.string(),
    version: z.number().int(),
    title: z.string(),
    description: z.string(),
    difficulty: difficultySchema,
  })
  .strict();
