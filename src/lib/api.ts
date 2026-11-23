export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly submission: "not_committed" | "unknown" = "unknown",
    readonly requestId: string | null = null,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  input?: unknown,
  method = "POST",
): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api" + path, {
      method: input === undefined ? "GET" : method,
      cache: "no-store",
      ...(input === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          }),
    });
  } catch {
    throw loggedError(
      path,
      new ApiError(
        "连接中断，提交结果可能尚未返回。请先同步记录，再决定重试。",
        "CONNECTION_FAILED",
        0,
        true,
      ),
    );
  }
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw loggedError(
      path,
      new ApiError(
        result?.error?.message ?? "服务暂不可用，请稍后重试。",
        result?.error?.code ?? "HTTP_ERROR",
        response.status,
        Boolean(result?.error?.retryable),
        result?.error?.submission === "not_committed"
          ? "not_committed"
          : "unknown",
        result?.error?.requestId ?? response.headers.get("X-Request-Id"),
      ),
    );
  if (!result)
    throw loggedError(
      path,
      new ApiError(
        "没有收到有效响应，请同步记录。",
        "INVALID_RESPONSE",
        response.status,
        true,
        "unknown",
        response.headers.get("X-Request-Id"),
      ),
    );
  return result as T;
}

function loggedError(path: string, error: ApiError) {
  console.warn(
    JSON.stringify({
      event: "api_request_failed",
      path: path.split("?")[0],
      code: error.code,
      status: error.status,
      requestId: error.requestId,
      submission: error.submission,
    }),
  );
  return error;
}
