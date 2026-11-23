import type { DatabaseSync } from "node:sqlite";
import type { z } from "zod";
import { emptyProfile, profileSchema, type Profile } from "@/contracts/profile";
import { preferencesSchema } from "@/contracts/requests";
import { transaction } from "../storage/database";
import { AppError } from "../errors";

export class ProfileRepository {
  constructor(private readonly database: DatabaseSync) {}

  /** 读取唯一的本地用户资料；尚无记录时返回默认值，但不会因此写入数据库。 */
  read(): Profile {
    const row = this.database
      .prepare("SELECT * FROM profile WHERE id = 1")
      .get();
    if (!row) return emptyProfile();
    return profileSchema.parse({
      schemaVersion: 1,
      onboardingCompletedAt: row.onboarding_completed_at,
      difficulty: row.difficulty,
      lastSceneId: row.last_scene_id,
    });
  }

  /** 在事务内校验白名单和场景存在性后合并偏好；undefined 不修改，null 明确清空。 */
  updatePreferences(input: z.infer<typeof preferencesSchema>) {
    const patch = preferencesSchema.parse(input);
    return transaction(this.database, () => {
      // 使用同一事务中的真实目录，不依赖种子文件或调用方的旧快照。
      if (
        patch.lastSceneId != null &&
        !this.database
          .prepare("SELECT 1 FROM scenes WHERE id = ?")
          .get(patch.lastSceneId)
      ) {
        throw new AppError("SCENE_NOT_FOUND", "没有这个学习场景。", 404);
      }
      const definedPatch = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      );
      return this.save({
        ...this.read(),
        ...definedPatch,
      });
    });
  }

  /** 首次完成欢迎引导时保存时间；再次调用不覆盖首次时间。 */
  completeOnboarding() {
    transaction(this.database, () => {
      const profile = this.read();
      if (profile.onboardingCompletedAt) return;
      this.save({
        ...profile,
        onboardingCompletedAt: new Date().toISOString(),
      });
    });
    return { onboardingCompleted: true };
  }

  /** 校验并新增/更新 id=1 的用户资料，返回保存值；由公开方法提供事务边界。 */
  private save(input: Profile) {
    const profile = profileSchema.parse(input);
    this.database
      .prepare(
        `INSERT INTO profile
      (id, onboarding_completed_at, difficulty, last_scene_id) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        onboarding_completed_at = excluded.onboarding_completed_at,
        difficulty = excluded.difficulty, last_scene_id = excluded.last_scene_id`,
      )
      .run(
        profile.onboardingCompletedAt,
        profile.difficulty,
        profile.lastSceneId,
      );
    return profile;
  }
}
