import { z } from "zod";
import { visibleQuestionSchema } from "./dialogue-plan";
import { feedbackSchema, effectsSchema, modelCallSchema } from "./teaching";

const eventFields = {
  id: z.string().min(1),
  sessionId: z.string().min(1),
  sequence: z.number().int().positive(),
  createdAt: z.string().min(1),
};
const teachingPayloadSchema = z
  .object({
    text: z.string(),
    feedback: feedbackSchema,
    effects: effectsSchema,
    modelCall: modelCallSchema,
  })
  .strict();

export const learningEventSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...eventFields,
      action: z.literal("question"),
      questionId: z.string().min(1),
      payload: visibleQuestionSchema.omit({ id: true }).strict(),
    })
    .strict(),
  z
    .object({
      ...eventFields,
      action: z.enum(["answer", "hint", "explain"]),
      questionId: z.string().min(1),
      payload: teachingPayloadSchema,
    })
    .strict(),
  z
    .object({
      ...eventFields,
      action: z.literal("completed"),
      questionId: z.null(),
      payload: z
        .object({ closingMessage: z.string().trim().min(1).max(600) })
        .strict(),
    })
    .strict(),
]);

export type LearningEvent = z.infer<typeof learningEventSchema>;
