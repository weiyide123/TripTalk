import { z } from "zod";
import { evaluationSchema } from "./jane-turn";

export type Feedback = z.infer<typeof feedbackSchema>;
export type ModelCall = z.infer<typeof modelCallSchema>;

// 教学内容契约与存储形式无关；JSON 和 SQLite 交付切片共用同一份定义。
export const feedbackSchema = evaluationSchema
  .omit({
    continuation: true,
    coveredEarly: true,
    factChanges: true,
  })
  .strict();
export const effectsSchema = evaluationSchema
  .pick({
    coveredEarly: true,
    factChanges: true,
  })
  .strict();
export const modelCallSchema = z
  .object({
    model: z.string(),
    elapsedMs: z.number().nonnegative(),
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
    totalTokens: z.number().nonnegative(),
    promptVersion: z.string(),
  })
  .strict();
