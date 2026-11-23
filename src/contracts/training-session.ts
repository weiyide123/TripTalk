import { z } from "zod";
import { lessonSnapshotSchema, topicSchema } from "./lesson";
import { planSchema } from "./dialogue-plan";
import { continuationSchema } from "./jane-turn";
import { modelCallSchema } from "./teaching";
import { sceneIdSchema } from "./scene-id";
import { learningEventSchema } from "./learning-event";
import { validateTrainingHistory } from "./training-session-integrity";

const trainingSessionRecordSchema = z
  .object({
    id: z.string().min(1),
    mode: z.literal("practice"),
    sceneId: sceneIdSchema,
    topicId: z.string().min(1),
    configSnapshot: z
      .object({
        lesson: lessonSnapshotSchema,
        topic: topicSchema,
      })
      .strict(),
    planSnapshot: planSchema,
    planningCall: modelCallSchema,
    revision: z.number().int().nonnegative(),
    status: z.enum(["active", "awaiting_continue", "topic_completed"]),
    currentQuestionId: z.string().nullable(),
    pendingContinuation: continuationSchema.nullable(),
    turns: z.array(learningEventSchema).min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    topicCompletedAt: z.string().nullable(),
  })
  .strict();

export type TrainingSession = z.infer<typeof trainingSessionRecordSchema>;
export const trainingSessionSchema = trainingSessionRecordSchema.superRefine(
  (session, context) =>
    validateTrainingHistory(session, (message) => {
      context.addIssue({ code: "custom", message });
    }),
);
