import { z } from "zod";
import { sceneIdSchema } from "./scene-id";

const receiptFields = {
  requestId: z.string().uuid(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().min(1),
};

export const operationReceiptSchema = z.discriminatedUnion("operation", [
  z
    .object({
      ...receiptFields,
      operation: z.literal("initialize-scene"),
      scopeId: sceneIdSchema,
      result: z.object({ sceneId: sceneIdSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...receiptFields,
      operation: z.literal("create-scene"),
      scopeId: z.literal("local"),
      result: z.object({ sceneId: sceneIdSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...receiptFields,
      operation: z.literal("create-session"),
      scopeId: sceneIdSchema,
      // 仅旧创建映射没有提交时间；新业务写入必须提供实际提交时间。
      createdAt: receiptFields.createdAt.nullable(),
      result: z.object({ sessionId: z.string().min(1) }).strict(),
    })
    .strict(),
  z
    .object({
      ...receiptFields,
      operation: z.literal("session-turn"),
      scopeId: z.string().min(1),
      result: z
        .object({
          sessionId: z.string().min(1),
          turnId: z.string().min(1),
          revision: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
]);

export type OperationReceipt = z.infer<typeof operationReceiptSchema>;
