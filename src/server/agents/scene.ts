import { Agent } from "@openai/agents";
import { generatedSceneSchema } from "@/contracts/scene";
import { teachingSettings } from "./jane";
import { sceneInstructions } from "./prompts/scene";

export function createScenePlanningAgent(model: string) {
  return new Agent({
    name: "Scene curriculum planner",
    model,
    instructions: sceneInstructions,
    outputType: generatedSceneSchema,
    modelSettings: teachingSettings(model, 4000),
  });
}
