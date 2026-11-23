import OpenAI from "openai";
import { transcriptionResultSchema } from "@/contracts/transcription";
import { getTranscriptionConfig } from "../config";
import { AppError, publicError } from "../errors";

// 单机应用只允许一个转写在途；热更新也不能绕过此费用保护。
const shared = globalThis as typeof globalThis & {
  triptalkTranscriptionBusy?: boolean;
};

/** 音频只在内存中转发，返回草稿文本；不使用学习仓库、不自动重试。 */
export async function transcribeAudio(audio: File, signal: AbortSignal) {
  if (shared.triptalkTranscriptionBusy) {
    throw new AppError(
      "TRANSCRIPTION_BUSY",
      "正在识别另一段录音，请稍后再试。",
      409,
      false,
      {
        stage: "audio_transcription",
        submission: "not_committed",
      },
    );
  }
  shared.triptalkTranscriptionBusy = true;
  try {
    signal.throwIfAborted();
    const config = getTranscriptionConfig();
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: "https://api.openai.com/v1",
      timeout: 30_000,
      maxRetries: 0,
    });
    const result = await client.audio.transcriptions.create(
      {
        file: audio,
        model: config.model,
        response_format: "json",
        // 不传参考答案或课程历史，避免识别器补出用户没说过的词。
        prompt:
          "Transcribe speech in its original language. Preserve spoken words, grammatical mistakes and repetitions. Do not translate, polish or complete sentences.",
      },
      { signal },
    );
    const parsed = transcriptionResultSchema.safeParse(result);
    if (!parsed.success) {
      if (typeof result?.text === "string" && !result.text.trim()) {
        throw new AppError(
          "AUDIO_NO_SPEECH",
          "没有听清语音，请靠近麦克风重新录制。",
          422,
        );
      }
      throw new AppError(
        "TRANSCRIPTION_OUTPUT_INVALID",
        "识别内容过长或不完整，请录制更短的回答。",
        502,
      );
    }
    return parsed.data;
  } catch (error) {
    throw transcriptionError(error);
  } finally {
    shared.triptalkTranscriptionBusy = false;
  }
}

/** 复用网络/额度分类，但替换教学专用文案；不暴露上游音频或异常正文。 */
function transcriptionError(error: unknown) {
  let safe = publicError(error);
  if (error instanceof OpenAI.APIError && error.status === 400) {
    safe = new AppError(
      "AUDIO_INVALID",
      "无法识别这段录音，请重新录制；若持续失败，请检查转写模型配置。",
      422,
    );
  }
  const messages: Record<string, string> = {
    NETWORK_TIMEOUT: "语音识别超时，请检查网络后重录，也可以继续打字。",
    NETWORK_CONNECTION_FAILED: "暂时连不上语音识别服务，请检查网络后重录。",
    API_RATE_LIMITED: "语音识别请求较多，请稍后再试。",
    MODEL_UNAVAILABLE:
      "转写模型或权限不可用，请检查 OPENAI_TRANSCRIPTION_MODEL。",
    INTERNAL_ERROR:
      "语音识别暂时遇到问题，请根据诊断编号检查日志；文字输入不受影响。",
  };
  return new AppError(
    safe.code,
    messages[safe.code] ?? safe.message,
    safe.status,
    safe.retryable,
    {
      ...safe.details,
      stage: "audio_transcription",
      submission: "not_committed",
    },
    error,
  );
}
