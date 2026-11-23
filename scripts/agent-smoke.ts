import { ConfigurationError, getAgentConfig } from "../src/server/config";
import { createJaneAgent } from "../src/server/agents/jane";
import { createJaneRunner } from "../src/server/agents/runner";

const startedAt = performance.now();

try {
  const config = getAgentConfig();
  const runner = createJaneRunner(config.apiKey);
  console.log(
    JSON.stringify({
      event: "agent_smoke_started",
      model: config.model,
      tracing: false,
    }),
  );
  const result = await runner.run(
    createJaneAgent(config.model),
    "请向第一次来访的用户打招呼。",
    {
      maxTurns: 1,
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (typeof result.finalOutput !== "string" || !result.finalOutput.trim()) {
    throw new Error("EMPTY_OUTPUT");
  }
  console.log(`Jane: ${result.finalOutput}`);
  console.log(
    JSON.stringify({
      event: "agent_smoke_succeeded",
      model: config.model,
      elapsedMs: Math.round(performance.now() - startedAt),
      inputTokens: result.state.usage.inputTokens,
      outputTokens: result.state.usage.outputTokens,
    }),
  );
} catch (error: unknown) {
  // Raw SDK errors can include request bodies/headers; print only allowlisted metadata.
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : undefined;
  const networkCodes = new Set([
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "SELF_SIGNED_CERT_IN_CHAIN",
  ]);
  let cause: unknown = error;
  let networkCode: string | undefined;
  for (
    let depth = 0;
    depth < 4 && typeof cause === "object" && cause !== null;
    depth++
  ) {
    if (
      "code" in cause &&
      typeof cause.code === "string" &&
      networkCodes.has(cause.code)
    )
      networkCode = cause.code;
    cause = "cause" in cause ? cause.cause : undefined;
  }
  const code = classifyFailure(error, status, networkCode);
  console.error(
    JSON.stringify({
      event: "agent_smoke_failed",
      code,
      status,
      networkCode,
      elapsedMs: Math.round(performance.now() - startedAt),
    }),
  );
  console.error(
    error instanceof ConfigurationError
      ? error.message
      : "真实调用未通过；请核对模型权限、API 额度与网络。不自动重试或回退模拟回复。",
  );
  process.exitCode = 1;
}

function classifyFailure(
  error: unknown,
  status?: number,
  networkCode?: string,
) {
  if (error instanceof ConfigurationError)
    return "CONFIGURATION_MISSING_OR_INVALID";
  if (status === 401) return "AUTHENTICATION_FAILED";
  if (status === 403 || status === 404) return "MODEL_OR_ACCESS_ERROR";
  if (status === 429) return "RATE_LIMIT_OR_QUOTA";

  const errorName = error instanceof Error ? error.name : "";
  if (
    [
      "AbortError",
      "TimeoutError",
      "APIUserAbortError",
      "APIConnectionTimeoutError",
    ].includes(errorName)
  )
    return "TIMEOUT";
  if (errorName === "APIConnectionError" || networkCode)
    return "NETWORK_CONNECTION_FAILED";
  if (error instanceof Error && error.message === "EMPTY_OUTPUT")
    return "EMPTY_OUTPUT";
  return "MODEL_REQUEST_FAILED";
}
