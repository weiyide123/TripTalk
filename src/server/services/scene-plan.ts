import {
  generatedSceneSchema,
  scenePlanSchema,
  type ScenePlan,
} from "@/contracts/scene";
import type { ModelCall } from "@/contracts/teaching";
import type { CourseInitialization } from "@/contracts/requests";
import { getStore } from "../storage/store";
import { getAgentConfig } from "../config";
import { createScenePlanningAgent } from "../agents/scene";
import { createJaneRunner } from "../agents/runner";
import { SCENE_PROMPT_VERSION } from "../agents/prompts/scene";
import { AppError } from "../errors";

/** 校验模型返回的主题目录，按顺序分配 topic ID 并补齐场景和生成信息；不写库。 */
export function buildScenePlan(
  sceneId: string,
  output: unknown,
  call: ModelCall,
): ScenePlan {
  const parsed = generatedSceneSchema.safeParse(output);
  if (!parsed.success)
    throw new AppError(
      "SCENE_PLAN_INVALID",
      "主题目录格式不完整，没有保存。请重试。",
      502,
      true,
    );
  const result = scenePlanSchema.safeParse({
    sceneId,
    source: "generated",
    createdAt: new Date().toISOString(),
    planningCall: call,
    topics: parsed.data.topics.map((topic, i) => ({
      ...topic,
      id: `topic-${i + 1}`,
    })),
  });
  if (!result.success)
    throw new AppError(
      "SCENE_PLAN_INVALID",
      "主题目录重复或无效，没有保存。请重试。",
      502,
      true,
    );
  return result.data;
}

/** 为场景生成并保存课程目录；已有目录复用，仅首次生成调用模型，成功后由仓库原子提交。 */
export async function initializeScene(input: CourseInitialization) {
  const store = getStore();
  const scene = store.catalog.get(input.sceneId);
  return store.withSceneOperation(scene.id, async () => {
    store.catalog.findInitialization(input);
    if (store.catalog.readPlan(scene.id)) {
      return store.catalog.initializeCourse(input);
    }
    const config = getAgentConfig();
    const started = Date.now();
    const result = await createJaneRunner(config.apiKey, 60_000).run(
      createScenePlanningAgent(config.model),
      JSON.stringify({
        scene: {
          id: scene.id,
          title: scene.title,
          scope: scene.scope,
        },
      }),
      { maxTurns: 1 },
    );
    const u = result.state.usage;
    const plan = buildScenePlan(scene.id, result.finalOutput, {
      model: config.model,
      elapsedMs: Date.now() - started,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      totalTokens: u.totalTokens,
      promptVersion: SCENE_PROMPT_VERSION,
    });
    return store.catalog.initializeCourse(input, plan);
  });
}
