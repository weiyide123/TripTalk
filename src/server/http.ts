import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, publicError } from "./errors";
import { logRequestFailure } from "./logging";
export function guardLocal(request: Request) {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (
    !host ||
    !["127.0.0.1:3000", "localhost:3000"].includes(host) ||
    (origin !== null && origin !== "http://" + host) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    throw new AppError("LOCAL_REQUEST_REQUIRED", "仅允许本机同源访问。", 403);
  }
}
export async function body<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new AppError("JSON_REQUIRED", "请求必须为 JSON。", 415);
  if (Number(request.headers.get("content-length") ?? 0) > 16_384)
    throw new AppError("INPUT_TOO_LARGE", "请求内容过长。", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_INPUT", "请求为空。");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) {
        await reader.cancel();
        throw new AppError("INPUT_TOO_LARGE", "请求内容过长。", 413);
      }
      chunks.push(value);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new AppError("INVALID_JSON", "JSON 格式无效。");
    }
    const result = schema.safeParse(parsed);
    if (!result.success)
      throw new AppError(
        "INVALID_INPUT",
        "提交内容格式不正确，请检查输入长度（最多 2,000 字符）后再试。",
        400,
        false,
        {
          reason: "REQUEST_SCHEMA_INVALID",
          stage: "request_validation",
          submission: "not_committed",
        },
      );
    return result.data;
  } finally {
    reader.releaseLock();
  }
}
export async function handle(
  request: Request,
  work: () => unknown | Promise<unknown>,
) {
  const requestId = randomUUID();
  const started = Date.now();
  try {
    guardLocal(request);
    return Response.json(await work(), {
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  } catch (error) {
    const safe = publicError(error);
    logRequestFailure(error, safe, {
      requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      elapsedMs: Date.now() - started,
    });
    return Response.json(
      {
        error: {
          code: safe.code,
          message: safe.message,
          retryable: safe.retryable,
          requestId,
          submission: safe.details.submission ?? "unknown",
        },
      },
      {
        status: safe.status,
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
      },
    );
  }
}
