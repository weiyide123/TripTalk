import { z } from "zod";
import { lessonSnapshotSchema, topicSchema } from "../lesson";
import { planSchema, visibleQuestionSchema } from "../dialogue-plan";
import { continuationSchema } from "../jane-turn";
import { feedbackSchema, effectsSchema, modelCallSchema } from "../teaching";
export { feedbackSchema, effectsSchema, modelCallSchema } from "../teaching";

// 仅供旧 JSON 离线导入校验；网页运行时使用 training-session / learning-event。
const operationFields = {
  id: z.string(),
  requestId: z.string().uuid(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.number().int().positive(),
  questionId: z.string(),
  createdAt: z.string(),
};
const teachingTurnSchema = z
  .object({
    ...operationFields,
    action: z.enum(["answer", "hint", "explain"]),
    text: z.string(),
    feedback: feedbackSchema,
    effects: effectsSchema,
    modelCall: modelCallSchema,
  })
  .strict();
const continueTurnSchema = z
  .object({
    ...operationFields,
    action: z.literal("continue"),
    nextQuestionId: z.string().nullable(),
  })
  .strict();
export const turnSchema = z.discriminatedUnion("action", [
  teachingTurnSchema,
  continueTurnSchema,
]);

export const sessionSchema = z
  .object({
    id: z.string(),
    mode: z.literal("practice"),
    sceneId: z.string(),
    topicId: z.string(),
    configSnapshot: z
      .object({
        lesson: lessonSnapshotSchema,
        topic: topicSchema,
      })
      .strict(),
    planSnapshot: planSchema,
    planningCall: modelCallSchema,
    // One immutable snapshot per presented question; turns reference only its ID.
    presentedQuestions: z.record(z.string(), visibleQuestionSchema.strict()),
    revision: z.number().int().nonnegative(),
    status: z.enum(["active", "awaiting_continue", "topic_completed"]),
    currentQuestionId: z.string().nullable(),
    pendingContinuation: continuationSchema.nullable(),
    turns: z.array(turnSchema),
    closingMessage: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    topicCompletedAt: z.string().nullable(),
  })
  .strict();

export type Session = z.infer<typeof sessionSchema>;
export type Turn = z.infer<typeof turnSchema>;
export type TeachingTurn = Extract<
  Turn,
  { action: "answer" | "hint" | "explain" }
>;
export type Feedback = z.infer<typeof feedbackSchema>;
export type ModelCall = z.infer<typeof modelCallSchema>;
