import { randomUUID } from "node:crypto";
import { generatedPlanSchema } from "@/contracts/dialogue-plan";
import type { TrainingSession } from "@/contracts/training-session";
import type { ModelCall } from "@/contracts/teaching";
import type { Difficulty } from "@/contracts/difficulty";
import type { Scene, ScenePlan } from "@/contracts/scene";
import type { CreateRequest } from "@/contracts/requests";
import { DIFFICULTIES } from "@/contracts/difficulty";
import { PROMPT_VERSION } from "../agents/prompts/jane";
import { getAgentConfig } from "../config";
import { createJanePlanningAgent } from "../agents/jane";
import { createJaneRunner } from "../agents/runner";
import { AppError } from "../errors";
import { visibleQuestion, getSessionView } from "./views";

import { getStore } from "../storage/store";

/** 创建或复用主题练习并返回页面视图；先查回执，只有没有可复用练习时才调用规划模型。 */
export async function createSession(input: CreateRequest) {
  const store = getStore();
  const scene = store.catalog.get(input.sceneId);
  return store.withSceneOperation(scene.id, async () => {
    // 幂等重试先返回已保存结果，不重复调用模型。
    const previous = store.sessions.findCreation(input);
    if (previous) {
      return {
        session: getSessionView(previous.result.sessionId),
        receipt: null,
      };
    }
    const { topic, active } = store.sessions.creationContext(input);
    const difficulty = input.difficulty ?? store.profile.read().difficulty;
    const candidate = active
      ? undefined
      : await generateSession(scene, topic, difficulty);
    const saved = store.sessions.create(input, candidate);
    return {
      session: getSessionView(saved.id),
      receipt: null,
    };
  });
}

/** 按场景、主题和难度生成尚未提交的练习候选；写入及提交校验由仓库负责。 */
async function generateSession(
  scene: Scene,
  selected: ScenePlan["topics"][number],
  difficulty: Difficulty,
): Promise<TrainingSession> {
  const configSnapshot = {
    lesson: {
      id: scene.id,
      version: scene.version,
      title: scene.title,
      description: scene.description,
      difficulty,
    },
    topic: {
      id: selected.id,
      title: selected.title,
      available: true,
      minQuestions: 8,
      maxQuestions: 15,
      scope: selected.scope + "\n主题边界：" + selected.boundaries,
    },
  };
  const { plan, planningCall } = await requestPlan(configSnapshot, difficulty);
  return initialSession(configSnapshot, plan, planningCall);
}

/** 调用规划模型，校验主题归属、事实键和问题不重复，返回计划及调用用量；不写库。 */
async function requestPlan(
  configSnapshot: TrainingSession["configSnapshot"],
  difficulty: Difficulty,
) {
  const config = getAgentConfig();
  const started = Date.now();
  const result = await createJaneRunner(config.apiKey, 60_000).run(
    createJanePlanningAgent(config.model),
    JSON.stringify({
      ...configSnapshot,
      difficulty: {
        id: difficulty,
        ...DIFFICULTIES[difficulty],
      },
    }),
    { maxTurns: 1 },
  );
  const parsed = generatedPlanSchema.safeParse(result.finalOutput);
  if (!parsed.success) {
    throw new AppError(
      "PLAN_INVALID",
      "Jane 的计划格式不完整，请重新尝试；没有创建半成品记录。",
      502,
      true,
    );
  }
  const plan = parsed.data;
  if (
    plan.topicId !== configSnapshot.topic.id ||
    new Set(plan.facts.map((fact) => fact.key)).size !== plan.facts.length ||
    new Set(
      plan.questions.map((question) => question.english.trim().toLowerCase()),
    ).size !== plan.questions.length
  ) {
    throw new AppError(
      "PLAN_INVALID",
      "计划包含重复事实或问题，请重新尝试。",
      502,
      true,
    );
  }
  const usage = result.state.usage;
  return {
    plan,
    planningCall: {
      promptVersion: PROMPT_VERSION,
      model: config.model,
      elapsedMs: Date.now() - started,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
    },
  };
}

/** 将有效计划组装为 revision=0 的内存练习，分配 ID 并加入首问事件；不写库。 */
function initialSession(
  configSnapshot: TrainingSession["configSnapshot"],
  plan: ReturnType<typeof generatedPlanSchema.parse>,
  planningCall: ModelCall,
): TrainingSession {
  const now = new Date().toISOString();
  const planSnapshot = {
    ...plan,
    id: randomUUID(),
    questions: plan.questions.map((question, index) => ({
      ...question,
      id: "q" + (index + 1),
    })),
  };
  const firstQuestion = visibleQuestion(planSnapshot.questions[0]);
  const sessionId = randomUUID();
  const { id: questionId, ...payload } = firstQuestion;
  return {
    id: sessionId,
    mode: "practice",
    sceneId: configSnapshot.lesson.id,
    topicId: configSnapshot.topic.id,
    configSnapshot,
    planSnapshot,
    planningCall,
    revision: 0,
    status: "active",
    currentQuestionId: firstQuestion.id,
    pendingContinuation: null,
    turns: [
      {
        id: randomUUID(),
        sessionId,
        sequence: 1,
        createdAt: now,
        action: "question",
        questionId,
        payload,
      },
    ],
    createdAt: now,
    updatedAt: now,
    topicCompletedAt: null,
  };
}
