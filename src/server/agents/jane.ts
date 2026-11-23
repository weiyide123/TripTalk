import { Agent } from "@openai/agents";
import { generatedPlanSchema } from "@/contracts/dialogue-plan";
import { generatedEvaluationSchema } from "@/contracts/jane-turn";
import { planInstructions, turnInstructions } from "./prompts/jane";

export const teachingSettings = (model: string, maxTokens: number) => ({
  store: false,
  maxTokens,
  ...(model === "gpt-6-luna" ? { reasoning: { effort: "none" as const } } : {}),
});
export function createJanePlanningAgent(model: string) {
  return new Agent({
    name: "Jane",
    model,
    instructions: planInstructions,
    outputType: generatedPlanSchema,
    modelSettings: teachingSettings(model, 6500),
  });
}
export function createJaneTeachingAgent(model: string) {
  return new Agent({
    name: "Jane",
    model,
    instructions: turnInstructions,
    outputType: generatedEvaluationSchema,
    modelSettings: teachingSettings(model, 2500),
  });
}

export function createJaneAgent(model: string) {
  return new Agent({
    name: "Jane",
    model,
    instructions:
      "你是温和、清新的旅行英语助教 Jane。当前只是连接验证，不是正式课程。用一句简短英文自我介绍并欢迎用户学习酒店入住。不声称已保存学习记录或已完成课程。",
    modelSettings: {
      store: false,
      // P0's selected model supports no reasoning; keep a greeting inexpensive.
      ...(model === "gpt-6-luna"
        ? {
            reasoning: { effort: "none" as const },
            maxTokens: 128,
          }
        : {}),
    },
  });
}
