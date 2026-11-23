import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import {
  sceneSchema,
  scenePlanSchema,
  type ScenePlan,
} from "@/contracts/scene";
import { sceneIdSchema } from "@/contracts/scene-id";
import {
  courseInitializationSchema,
  type CourseInitialization,
} from "@/contracts/requests";
import { AppError } from "../errors";
import { inputHash } from "../request-hash";
import { transaction } from "../storage/database";
import {
  findOperationReceipt,
  insertOperationReceipt,
} from "./operation-receipts";

export class CatalogRepository {
  constructor(private readonly database: DatabaseSync) {}

  /** 按目录顺序读取可选场景；数据来自 SQLite，不再同时读取种子 JSON。 */
  list() {
    return this.database
      .prepare("SELECT * FROM scenes ORDER BY position")
      .all()
      .map(sceneFromRow);
  }

  /** 读取指定场景的公开配置，不存在时抛错；不包含生成课程和学习记录。 */
  get(sceneId: string) {
    return sceneFromRow(this.sceneRow(sceneId));
  }

  /** 仅确认场景 ID 合法且存在，供不需要场景内容的业务校验使用。 */
  assertExists(sceneId: string): void {
    this.sceneRow(sceneId);
  }

  /** 优先使用指定场景，其次上次场景、目录首项；显式指定的无效 ID 不静默回退。 */
  resolveHomeScene(sceneId?: string | null, lastSceneId?: string | null) {
    if (sceneId != null) return this.get(sceneId);
    const scenes = this.list();
    const selected =
      scenes.find((scene) => scene.id === lastSceneId) ?? scenes[0];
    if (!selected) {
      throw new AppError(
        "SCENE_CATALOG_EMPTY",
        "场景目录为空，请先完成数据库初始化。",
        503,
      );
    }
    return selected;
  }

  /** 在同一快照读取生成元信息和有序主题；尚未生成返回 null，记录不完整则报错。 */
  readPlan(sceneId: string): ScenePlan | null {
    return transaction(this.database, () => this.planFromRows(sceneId), "read");
  }

  /** 核对初始化请求是否已成功及输入是否一致；模型调用前可查，提交时仍须事务内复查。 */
  findInitialization(input: CourseInitialization) {
    const request = courseInitializationSchema.parse(input);
    return findOperationReceipt(
      this.database,
      "initialize-scene",
      request.sceneId,
      request,
    );
  }

  /** 原子保存课程元信息、主题目录和回执；已有课程直接复用，不覆盖或重新生成。 */
  initializeCourse(input: CourseInitialization, candidate?: ScenePlan) {
    const request = courseInitializationSchema.parse(input);
    return transaction(this.database, () => {
      const previous = this.findInitialization(request);
      const existing = this.readPlan(request.sceneId);
      if (previous) {
        if (!existing)
          throw new AppError("COURSE_DATA_INVALID", "课程回执缺少目录。", 500);
        return existing;
      }
      const plan = existing ?? this.insertPlan(request.sceneId, candidate);
      insertOperationReceipt(this.database, {
        operation: "initialize-scene",
        scopeId: request.sceneId,
        requestId: request.requestId,
        inputHash: inputHash(request),
        createdAt: new Date().toISOString(),
        result: { sceneId: request.sceneId },
      });
      return plan;
    });
  }

  /** 将场景生成信息和主题行还原为课程对象，检查主题顺序连续性及课程契约。 */
  private planFromRows(sceneId: string): ScenePlan | null {
    const scene = this.sceneRow(sceneId);
    const topics = this.database
      .prepare(
        "SELECT * FROM scene_topics WHERE scene_id = ? ORDER BY position",
      )
      .all(sceneId);
    if (scene.course_generated_at === null && !topics.length) return null;
    if (
      scene.course_generated_at === null ||
      topics.some((topic, index) => topic.position !== index)
    ) {
      throw new AppError(
        "COURSE_DATA_INVALID",
        "课程目录不完整，请检查数据库。",
        500,
      );
    }
    return scenePlanSchema.parse({
      sceneId,
      source: scene.course_source,
      createdAt: scene.course_generated_at,
      planningCall: JSON.parse(String(scene.course_planning_call_json)),
      topics: topics.map((topic) => ({
        id: topic.topic_id,
        title: topic.title,
        scope: topic.scope,
        boundaries: topic.boundaries,
      })),
    });
  }

  /** 校验课程归属并写入元信息及主题；仅由 initializeCourse 在写事务内调用。 */
  private insertPlan(sceneId: string, candidate?: ScenePlan) {
    if (!candidate)
      throw new AppError("COURSE_REQUIRED", "请先生成课程目录。", 409);
    const plan = scenePlanSchema.parse(candidate);
    if (plan.sceneId !== sceneId)
      throw new AppError(
        "COURSE_IDENTITY_INVALID",
        "课程不属于当前场景。",
        409,
      );
    this.database
      .prepare(
        `UPDATE scenes SET course_source = ?, course_generated_at = ?,
      course_planning_call_json = ? WHERE id = ?`,
      )
      .run(
        plan.source,
        plan.createdAt,
        JSON.stringify(plan.planningCall),
        sceneId,
      );
    const insert = this.database.prepare(`INSERT INTO scene_topics
      (scene_id, topic_id, position, title, scope, boundaries) VALUES (?, ?, ?, ?, ?, ?)`);
    plan.topics.forEach((topic, position) => {
      insert.run(
        sceneId,
        topic.id,
        position,
        topic.title,
        topic.scope,
        topic.boundaries,
      );
    });
    return plan;
  }

  /** 校验 ID 格式并读取原始场景行；格式错误与记录缺失统一报场景不存在。 */
  private sceneRow(sceneId: string) {
    const parsed = sceneIdSchema.safeParse(sceneId);
    const row = parsed.success
      ? this.database.prepare("SELECT * FROM scenes WHERE id = ?").get(sceneId)
      : undefined;
    if (!row) throw new AppError("SCENE_NOT_FOUND", "没有这个学习场景。", 404);
    return row;
  }
}

/** 将数据库列名映射为业务字段并校验，仅返回场景公开配置。 */
function sceneFromRow(row: Record<string, SQLOutputValue>) {
  return sceneSchema.parse({
    id: row.id,
    version: row.version,
    title: row.title,
    description: row.description,
    scope: row.scope,
    englishTitle: row.english_title,
    art: row.art,
  });
}
