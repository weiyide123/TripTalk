import { z } from "zod";
import { modelCallSchema } from "./teaching";

import { sceneIdSchema } from "./scene-id";
export { sceneIdSchema, type SceneId } from "./scene-id";
export const sceneSchema = z
  .object({
    id: sceneIdSchema,
    version: z.number().int().positive(),
    title: z.string(),
    description: z.string(),
    scope: z.string(),
    englishTitle: z.string(),
    art: z
      .enum(["hotel", "airport", "food", "bus", "generic"])
      .default("generic"),
  })
  .strict();
export type Scene = z.infer<typeof sceneSchema>;
export const catalogSceneSchema = sceneSchema.extend({
  origin: z.enum(["builtin", "custom"]),
});
export type CatalogScene = z.infer<typeof catalogSceneSchema>;

/** 用描述首句生成短标题；完整练习范围始终保存在 scope，不调用模型起名。 */
export function customSceneTitle(description: string) {
  const first = description
    .trim()
    .split(/[。！？\n]/u)[0]
    .trim();
  const characters = Array.from(first || description.trim());
  return characters.length > 24
    ? characters.slice(0, 24).join("") + "…"
    : characters.join("");
}
export const topicContentSchema = z
  .object({
    title: z.string().trim().min(2).max(50),
    scope: z.string().trim().min(5).max(600),
    boundaries: z.string().trim().min(5).max(400),
  })
  .strict();
export const generatedSceneSchema = z
  .object({ topics: z.array(topicContentSchema).min(3).max(8) })
  .strict();
export const sceneTopicSchema = topicContentSchema.extend({
  id: z.string().regex(/^[a-z0-9-]{1,80}$/),
});
export const scenePlanSchema = z
  .object({
    sceneId: sceneIdSchema,
    source: z.literal("generated"),
    createdAt: z.string(),
    topics: z.array(sceneTopicSchema).min(3).max(8),
    planningCall: modelCallSchema,
  })
  .strict()
  .superRefine((plan, ctx) => {
    const normalize = (s: string) =>
      s
        .normalize("NFKC")
        .replace(/[\s\p{P}]/gu, "")
        .toLowerCase();
    for (const field of ["id", "title", "scope"] as const) {
      if (
        new Set(plan.topics.map((t) => normalize(t[field]))).size !==
        plan.topics.length
      )
        ctx.addIssue({
          code: "custom",
          message: `Duplicate topic ${field}`,
        });
    }
  });
export type ScenePlan = z.infer<typeof scenePlanSchema>;
export type SceneTopic = z.infer<typeof sceneTopicSchema>;
