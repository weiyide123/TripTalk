import type { AppError } from "./errors";

type RequestLog = {
  requestId: string;
  method: string;
  path: string;
  elapsedMs: number;
};

export function logRequestFailure(
  error: unknown,
  safe: AppError,
  context: RequestLog,
) {
  // 只输出受控元数据，不打印异常对象、模型原文、用户文本或密钥。
  const original =
    error instanceof Error && error.cause instanceof Error
      ? error.cause
      : error;
  const errorName = original instanceof Error ? original.name : "UnknownError";
  const log = {
    event: "request_failed",
    category: errorCategory(safe.code),
    ...context,
    code: safe.code,
    status: safe.status,
    reason: safe.details.reason ?? safe.code,
    stage: safe.details.stage ?? "request",
    submission: safe.details.submission ?? "unknown",
    systemCode: safe.details.systemCode,
    errorType: [
      "AppError",
      "Error",
      "TypeError",
      "ReferenceError",
      "SyntaxError",
      "RangeError",
      "APIConnectionError",
      "APIConnectionTimeoutError",
      "ModelBehaviorError",
      "ModelRefusalError",
    ].includes(errorName)
      ? errorName
      : "UnknownError",
    locations:
      original instanceof Error
        ? original.stack?.match(/src\/[\w./[\]-]+:\d+:\d+/g)?.slice(0, 3)
        : undefined,
  };
  if (safe.status >= 500) console.error(JSON.stringify(log));
  else console.warn(JSON.stringify(log));
}

export function logLearnerGuidance(requestId: string, sessionId: string) {
  console.info(
    JSON.stringify({
      event: "learner_input_guidance",
      category: "input",
      requestId,
      sessionId,
      reason: "ANSWER_NEEDS_CLARIFICATION",
      committed: true,
      progressAdvanced: false,
    }),
  );
}

function errorCategory(code: string) {
  if (code.startsWith("AUDIO_")) return "audio_input";
  if (code.startsWith("TRANSCRIPTION_")) return "transcription";
  if (code === "API_RATE_LIMITED") return "rate_limit";
  if (code.startsWith("NETWORK_")) return "network";
  if (code.startsWith("STORAGE_") || code.startsWith("DATABASE_"))
    return "storage";
  if (code.startsWith("AGENT_") || code.startsWith("AI_")) return "model";
  if (
    code.startsWith("API_") ||
    code.startsWith("CONFIGURATION_") ||
    code === "MODEL_UNAVAILABLE"
  )
    return "configuration";
  if (["STALE_REVISION", "REQUEST_BUSY", "REQUEST_ID_CONFLICT"].includes(code))
    return "conflict";
  if (
    [
      "INVALID_INPUT",
      "INVALID_JSON",
      "INPUT_TOO_LARGE",
      "JSON_REQUIRED",
    ].includes(code)
  )
    return "input";
  return "internal";
}
