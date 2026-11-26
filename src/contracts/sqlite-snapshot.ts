import { z } from "zod";
import { profileSchema } from "./profile";
import { sceneSchema, scenePlanSchema } from "./scene";
import { trainingSessionSchema } from "./training-session";
import { operationReceiptSchema } from "./operation-receipt";
import { favoriteSchema } from "./favorite";
import { savedTranslationSchema } from "./sentence-translation";

// 显式安装/离线核对使用完整快照；页面仓库不得为一次查询加载此聚合。
export const sqliteSnapshotSchema = z
  .object({
    profile: profileSchema.nullable(),
    scenes: z
      .array(
        sceneSchema
          .extend({
            origin: z.enum(["builtin", "custom"]),
            position: z.number().int().nonnegative(),
            plan: scenePlanSchema.nullable(),
          })
          .strict(),
      )
      .min(1),
    sessions: z.array(trainingSessionSchema),
    receipts: z.array(operationReceiptSchema),
    favorites: z.array(favoriteSchema).default([]),
    translations: z.array(savedTranslationSchema).default([]),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const report = (message: string) =>
      context.addIssue({ code: "custom", message });
    const scenes = new Map(snapshot.scenes.map((scene) => [scene.id, scene]));
    const sessions = new Map(
      snapshot.sessions.map((session) => [session.id, session]),
    );
    if (
      scenes.size !== snapshot.scenes.length ||
      new Set(snapshot.scenes.map((scene) => scene.position)).size !==
        scenes.size
    )
      report("Duplicate scene identity/order");
    if (sessions.size !== snapshot.sessions.length)
      report("Duplicate session identity");
    if (
      snapshot.profile?.lastSceneId &&
      !scenes.has(snapshot.profile.lastSceneId)
    )
      report("Unknown last scene");
    for (const scene of snapshot.scenes) {
      if (scene.plan && scene.plan.sceneId !== scene.id)
        report("Course belongs to another scene");
    }
    const activeScenes = new Set<string>();
    const eventIds = new Set<string>();
    for (const session of snapshot.sessions) {
      if (
        !scenes
          .get(session.sceneId)
          ?.plan?.topics.some((topic) => topic.id === session.topicId)
      )
        report("Unknown session topic");
      if (session.status !== "topic_completed") {
        if (activeScenes.has(session.sceneId))
          report("Multiple active sessions in scene");
        activeScenes.add(session.sceneId);
      }
      for (const event of session.turns) {
        if (eventIds.has(event.id)) report("Duplicate global event identity");
        eventIds.add(event.id);
      }
    }
    const receiptIds = new Set<string>();
    const translationSources = new Set<string>();
    for (const translation of snapshot.translations) {
      if (!eventIds.has(translation.sourceTurnId))
        report("Unknown translation source");
      const key = JSON.stringify([
        translation.sourceTurnId,
        translation.sourcePart,
      ]);
      if (translationSources.has(key)) report("Duplicate translation source");
      translationSources.add(key);
    }
    const favoriteIds = new Set<string>();
    const favoriteSources = new Set<string>();
    for (const favorite of snapshot.favorites) {
      if (favoriteIds.has(favorite.id)) report("Duplicate favorite identity");
      favoriteIds.add(favorite.id);
      if (favorite.sceneId && !scenes.has(favorite.sceneId))
        report("Unknown favorite scene");
      if (favorite.sourceTurnId) {
        if (!eventIds.has(favorite.sourceTurnId))
          report("Unknown favorite source");
        const key = JSON.stringify([
          favorite.sourceTurnId,
          favorite.sourcePart,
        ]);
        if (favoriteSources.has(key)) report("Duplicate favorite source");
        favoriteSources.add(key);
      }
    }
    for (const receipt of snapshot.receipts) {
      const key = JSON.stringify([
        receipt.operation,
        receipt.scopeId,
        receipt.requestId,
      ]);
      if (receiptIds.has(key)) report("Duplicate operation receipt");
      receiptIds.add(key);
      switch (receipt.operation) {
        case "initialize-scene":
          if (
            receipt.scopeId !== receipt.result.sceneId ||
            !scenes.get(receipt.scopeId)?.plan
          )
            report("Invalid initialization receipt");
          break;
        case "create-scene":
          if (scenes.get(receipt.result.sceneId)?.origin !== "custom")
            report("Invalid custom scene receipt");
          break;
        case "create-session":
          if (
            sessions.get(receipt.result.sessionId)?.sceneId !== receipt.scopeId
          )
            report("Invalid creation receipt");
          break;
        case "session-turn": {
          const session = sessions.get(receipt.scopeId);
          const event = session?.turns.find(
            (item) => item.id === receipt.result.turnId,
          );
          if (
            !session ||
            receipt.result.sessionId !== session.id ||
            !event ||
            event.sequence === 1 ||
            receipt.result.revision > session.revision
          )
            report("Invalid session receipt");
          break;
        }
      }
    }
  });

export type SqliteSnapshot = z.infer<typeof sqliteSnapshotSchema>;
