import { z } from "zod";

// IDs are storage-safe identifiers, not a closed list of built-in scenes.
// Existence is checked by the server's scene catalog before accepting requests.
export const sceneIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  .max(80);
export type SceneId = z.infer<typeof sceneIdSchema>;
