import { z } from "zod";
import { sceneIdSchema } from "./scene";
import { difficultySchema } from "./difficulty";

export const requestIdSchema = z.string().uuid();
export const actionSchema = z.enum(["answer", "hint", "explain", "continue"]);
export const createRequestSchema = z
  .object({
    requestId: requestIdSchema,
    sceneId: sceneIdSchema,
    topicId: z.string().regex(/^[a-z0-9-]{1,80}$/),
    difficulty: difficultySchema.optional(),
    repeat: z.boolean().optional(),
  })
  .strict();
// 初始化与创建练习一样，重试时复用同一请求编号。
export const courseInitializationSchema = z
  .object({
    requestId: requestIdSchema,
    sceneId: sceneIdSchema,
  })
  .strict();
export type CourseInitialization = z.infer<typeof courseInitializationSchema>;
export const preferencesSchema = z
  .object({
    difficulty: difficultySchema.optional(),
    lastSceneId: sceneIdSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "至少提供一项偏好");
export const turnRequestSchema = z
  .object({
    requestId: requestIdSchema,
    expectedRevision: z.number().int().nonnegative(),
    action: actionSchema,
    text: z.string().max(2000).default(""),
  })
  .strict()
  .refine((x) => x.action !== "answer" || x.text.trim().length > 0, {
    message: "请输入英文回答",
  });
export type CreateRequest = z.infer<typeof createRequestSchema>;
export type TurnRequest = z.infer<typeof turnRequestSchema>;
