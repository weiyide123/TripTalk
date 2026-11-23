import { z } from "zod";
import { turnRequestSchema } from "@/contracts/requests";
import { ApiError } from "@/lib/api";

const failureSchema = z.object({
  message: z.string(),
  code: z.string(),
  requestId: z.string().nullable(),
});
const submissionSchema = z.object({
  operation: turnRequestSchema,
  status: z.enum(["sending", "checking", "failed", "unknown", "conflict"]),
  failure: failureSchema.nullable(),
});
const composerSchema = z.object({
  draft: z.string().max(2000),
  explainMode: z.boolean(),
  submission: submissionSchema.nullable(),
});

export type Submission = z.infer<typeof submissionSchema>;
export type Composer = z.infer<typeof composerSchema>;
export const EMPTY_COMPOSER: Composer = {
  draft: "",
  explainMode: false,
  submission: null,
};

export function readComposer(sessionId: string): Composer {
  try {
    const saved = sessionStorage.getItem("triptalk:composer:" + sessionId);
    if (saved) {
      const parsed = composerSchema.safeParse(JSON.parse(saved));
      if (parsed.success) {
        const value = parsed.data;
        if (value.submission && isInFlight(value.submission)) {
          value.submission.status = "unknown";
        }
        return value;
      }
    }
    // 保留升级前尚未确认的请求，不将未知提交当作已失败。
    const previous = sessionStorage.getItem("triptalk:pending:" + sessionId);
    const operation = turnRequestSchema.safeParse(
      JSON.parse(previous ?? "null"),
    );
    if (operation.success) {
      return {
        draft: operation.data.text,
        explainMode: operation.data.action === "explain",
        submission: {
          operation: operation.data,
          status: "unknown",
          failure: null,
        },
      };
    }
  } catch {
    // 存储不可用时仍允许本页输入，写入时向用户提示刷新风险。
  }
  return { ...EMPTY_COMPOSER };
}

export function saveComposer(sessionId: string, value: Composer): boolean {
  try {
    // 草稿和原请求一次保存，避免刷新后把新编辑替换成旧请求正文。
    sessionStorage.setItem(
      "triptalk:composer:" + sessionId,
      JSON.stringify(value),
    );
    sessionStorage.removeItem("triptalk:pending:" + sessionId);
    return true;
  } catch {
    return false;
  }
}

export function isInFlight(submission: Submission) {
  return submission.status === "sending" || submission.status === "checking";
}

export function failureFrom(
  error: unknown,
): NonNullable<Submission["failure"]> {
  if (error instanceof ApiError) {
    return {
      message: error.message,
      code: error.code,
      requestId: error.requestId,
    };
  }
  return {
    message: "暂时无法确认结果，请重试。",
    code: "CLIENT_ERROR",
    requestId: null,
  };
}

export function submissionMessage(submission: Submission) {
  if (submission.status === "sending") return "等待 Jane 回复…";
  if (submission.status === "checking") return "正在确认提交状态…";
  if (submission.status === "unknown") return "结果尚未确认，可重试这条消息。";
  if (submission.status === "conflict")
    return "学习记录已更新，请核对当前问题后重新发送。";
  switch (submission.failure?.code) {
    case "NETWORK_TIMEOUT":
    case "NETWORK_CONNECTION_FAILED":
    case "CONNECTION_FAILED":
      return "连接中断，请重试。";
    case "API_QUOTA_EXHAUSTED":
      return "服务额度不足，请检查 API 配置。";
    case "API_AUTH_FAILED":
    case "MODEL_UNAVAILABLE":
      return "服务配置不可用，请检查 API 配置。";
    case "API_RATE_LIMITED":
      return "请求有点频繁，请稍后重试。";
    case "STORAGE_WRITE_FAILED":
      return "记录未能保存，请检查本地存储后重试。";
    default:
      return "Jane 暂时没能完成回复，请重试。";
  }
}
