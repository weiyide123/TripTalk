import { OpenAIProvider, Runner } from "@openai/agents";
import OpenAI from "openai";

export function createJaneRunner(apiKey: string, timeout = 30_000) {
  return new Runner({
    tracingDisabled: true,
    modelProvider: new OpenAIProvider({
      // Configure the SDK's underlying HTTP client, not a replacement for Agents SDK.
      // Disable HTTP retries too: Runner's retry setting alone is not sufficient.
      openAIClient: new OpenAI({
        apiKey,
        baseURL: "https://api.openai.com/v1",
        maxRetries: 0,
        timeout,
      }),
      useResponses: true,
    }),
    modelSettings: {
      store: false,
      retry: {
        maxRetries: 0,
        policy: () => false,
      },
    },
  });
}
