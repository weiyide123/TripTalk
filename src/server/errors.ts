import { ConfigurationError } from "./config";

type ErrorDetails = {
  reason?: string;
  stage?: string;
  systemCode?: string;
  submission?: "not_committed" | "unknown";
};

const SQLITE_FAILURES = [
  {
    codes: [5, 6],
    code: "DATABASE_BUSY",
    message: "学习记录暂时正在使用中，请稍后重试。",
    status: 503,
    retryable: true,
  },
  {
    codes: [8, 14],
    code: "DATABASE_ACCESS_FAILED",
    message: "无法访问学习数据库，请检查文件权限和存储位置。",
    status: 500,
    retryable: false,
  },
  {
    codes: [13],
    code: "DATABASE_FULL",
    message: "磁盘空间不足，请释放空间后重试。",
    status: 507,
    retryable: false,
  },
  {
    codes: [11, 26],
    code: "DATABASE_CORRUPT",
    message: "学习数据库无法正常读取，请先备份并检查；不会自动清空记录。",
    status: 500,
    retryable: false,
  },
  {
    codes: [19],
    code: "DATABASE_CONSTRAINT_FAILED",
    message: "学习记录关联检查未通过，请同步记录后再试。",
    status: 500,
    retryable: false,
  },
];

export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly retryable = false,
    readonly details: ErrorDetails = {},
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}
export function publicError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const databaseFailure = sqliteError(error);
  if (databaseFailure) return databaseFailure;
  if (error instanceof ConfigurationError)
    return new AppError("CONFIGURATION_MISSING", error.message, 503);
  const e = error as {
    status?: number;
    code?: string;
    name?: string;
    cause?: { code?: string };
  };
  const systemCode = [
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    "UND_ERR_SOCKET",
  ].find((code) => code === (e?.cause?.code ?? e?.code));
  if (e?.status === 401)
    return new AppError(
      "API_AUTH_FAILED",
      "API 凭据不可用，请检查本机配置。",
      502,
    );
  if (
    e?.status === 429 &&
    ["insufficient_quota", "credit_balance_exhausted"].includes(e.code ?? "")
  )
    return new AppError(
      "API_QUOTA_EXHAUSTED",
      "AI 服务额度不足，请检查 API 账户余额后再试。",
      503,
    );
  if (e?.status === 429)
    return new AppError(
      "API_RATE_LIMITED",
      "Jane 暂时有点忙，请稍等片刻再试。",
      503,
      true,
    );
  if (e?.status === 403 || e?.status === 404)
    return new AppError(
      "MODEL_UNAVAILABLE",
      "模型或项目权限不可用，请检查 OPENAI_MODEL。",
      502,
    );
  if (
    /Timeout|Abort/.test(e?.name ?? "") ||
    /TIMEOUT|TIMEDOUT/.test(e?.cause?.code ?? e?.code ?? "") ||
    (error instanceof Error && error.message === "Request timed out.")
  ) {
    return new AppError(
      "NETWORK_TIMEOUT",
      "等待 Jane 回复超时，请检查网络或 Clash 代理后重试。",
      504,
      true,
      { systemCode },
    );
  }
  if (
    /Connection/.test(e?.name ?? "") ||
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "ENOTFOUND",
      "EAI_AGAIN",
      "UND_ERR_SOCKET",
    ].includes(e?.cause?.code ?? e?.code ?? "") ||
    (error instanceof Error && error.message === "Connection error.")
  )
    return new AppError(
      "NETWORK_CONNECTION_FAILED",
      "暂时连不上 Jane，请检查网络和 Clash 代理后再试。",
      503,
      true,
      { systemCode },
    );
  if (e?.status && e.status >= 500)
    return new AppError(
      "AI_SERVICE_UNAVAILABLE",
      "AI 服务暂时不可用，请稍后再试。",
      503,
      true,
    );
  return new AppError(
    "INTERNAL_ERROR",
    "程序暂时遇到了问题。请先同步记录；若仍失败，请根据控制台日志排查。",
    500,
    true,
  );
}

// 使用 SQLite 数字错误码，不将 SQL、磁盘路径或原始异常文案发给浏览器。
export function sqliteError(
  error: unknown,
  submission: ErrorDetails["submission"] = "unknown",
): AppError | null {
  const original = error as { code?: string; errcode?: number } | null;
  if (
    original?.code !== "ERR_SQLITE_ERROR" ||
    typeof original.errcode !== "number"
  )
    return null;
  const primaryCode = original.errcode & 0xff;
  const failure = SQLITE_FAILURES.find((item) =>
    item.codes.includes(primaryCode),
  );
  return new AppError(
    failure?.code ?? "DATABASE_OPERATION_FAILED",
    failure?.message ?? "学习记录暂时无法读写，请根据诊断日志检查。",
    failure?.status ?? 500,
    failure?.retryable ?? false,
    {
      systemCode: "SQLITE_" + original.errcode,
      stage: "sqlite_storage",
      submission,
    },
    error,
  );
}
