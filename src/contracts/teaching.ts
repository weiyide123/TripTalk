import { z } from "zod";
import { evaluationSchema } from "./jane-turn";

export type Feedback = z.infer<typeof feedbackSchema>;
export type ModelCall = z.infer<typeof modelCallSchema>;

// 教学反馈与模型调用信息共用此契约，不依赖数据库物理列结构。
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
