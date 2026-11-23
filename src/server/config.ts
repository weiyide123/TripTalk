import { z } from "zod";

const agentConfigSchema = z.object({
  OPENAI_API_KEY: z.string().trim().min(1),
  OPENAI_MODEL: z.string().trim().min(1),
  AI_MODE: z.literal("openai").default("openai"),
});

export class ConfigurationError extends Error {
  constructor(readonly fields: string[]) {
    super(
      `请在项目 .env 或进程环境中配置：${fields.join("、")}。不要把 API key 发到聊天中。`,
    );
    this.name = "ConfigurationError";
  }
}

// Read at execution time: importing/building the app never requires credentials.
export function getAgentConfig() {
  const parsed = agentConfigSchema.safeParse({
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    AI_MODE: process.env.AI_MODE,
  });
  if (!parsed.success) {
    // Never log Zod's input object: it may contain a credential.
    throw new ConfigurationError([
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0]))),
    ]);
  }
  return {
    apiKey: parsed.data.OPENAI_API_KEY,
    model: parsed.data.OPENAI_MODEL,
  };
}

export function getConfigurationStatus() {
  return {
    apiKeyPresent: Boolean(process.env.OPENAI_API_KEY?.trim()),
    modelPresent: Boolean(process.env.OPENAI_MODEL?.trim()),
    modeSupported: (process.env.AI_MODE ?? "openai") === "openai",
  };
}

/** 转写独立于教学模型配置，构建/文字对话不要求启用转写。 */
export function getTranscriptionConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new ConfigurationError(["OPENAI_API_KEY"]);
  return {
    apiKey,
    model: process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "gpt-transcribe",
  };
}
