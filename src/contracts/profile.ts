import { z } from "zod";
import { difficultySchema } from "./difficulty";
import { sceneIdSchema } from "./scene-id";

export const profileSchema = z
  .object({
    schemaVersion: z.literal(1),
    onboardingCompletedAt: z.string().nullable(),
    difficulty: difficultySchema,
    lastSceneId: sceneIdSchema.nullable(),
  })
  .strict();
export type Profile = z.infer<typeof profileSchema>;

export const emptyProfile = (): Profile => ({
  schemaVersion: 1,
  onboardingCompletedAt: null,
  difficulty: "medium",
  lastSceneId: null,
});
