import { z } from "zod";
import { sceneIdSchema } from "../scene-id";
import { scenePlanSchema } from "../scene";
import { sessionSchema } from "./session";
import { validateSessionLinks } from "./session-integrity";

export const sceneDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    sceneId: sceneIdSchema,
    plan: scenePlanSchema.nullable(),
    creationRequests: z.record(
      z.string().uuid(),
      z
        .object({
          inputHash: z.string().regex(/^[a-f0-9]{64}$/),
          sessionId: z.string(),
        })
        .strict(),
    ),
    sessions: z.record(z.string(), sessionSchema),
  })
  .strict()
  .superRefine((data, ctx) => {
    const report = (message: string) =>
      ctx.addIssue({
        code: "custom",
        message,
      });
    if (data.plan && data.plan.sceneId !== data.sceneId) {
      report("Scene plan does not match its file");
    }
    for (const [id, session] of Object.entries(data.sessions)) {
      if (id !== session.id) report("Session key does not match its ID");
      if (session.sceneId !== data.sceneId)
        report("Session belongs to another scene");
      if (!data.plan?.topics.some((topic) => topic.id === session.topicId)) {
        report("Session topic missing from scene plan");
      }
      validateSessionLinks(session, report);
    }
    for (const operation of Object.values(data.creationRequests)) {
      if (!Object.hasOwn(data.sessions, operation.sessionId)) {
        report("Missing created session");
      }
    }
  });
export type SceneData = z.infer<typeof sceneDataSchema>;
