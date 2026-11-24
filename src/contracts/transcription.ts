import { z } from "zod";

// 短回答上限由前后端共用；服务端另限制请求体和调用耗时。
export const RECORDING_LIMITS = {
  maxSeconds: 60,
  minMilliseconds: 600,
  maxBytes: 5 * 1024 * 1024,
  maxTextLength: 2000,
  requestTimeoutMs: 45_000,
} as const;

export const AUDIO_FORMATS = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
} as const;

export const transcriptionResultSchema = z.object({
  text: z.string().trim().min(1).max(RECORDING_LIMITS.maxTextLength),
});

/** 去除浏览器附加的 codecs 参数，只接受录音支持的音频容器。 */
export function audioFormat(mimeType: string) {
  const type = mimeType.split(";")[0].trim().toLowerCase();
  if (!Object.hasOwn(AUDIO_FORMATS, type)) return null;
  return {
    type,
    extension: AUDIO_FORMATS[type as keyof typeof AUDIO_FORMATS],
  };
}

/** 追加到最新草稿，不覆盖新编辑；超长时让用户手动取用完整转写。 */
export function appendTranscript(draft: string, text: string): string | null {
  const separator = draft && !/\s$/.test(draft) ? "\n" : "";
  const combined = draft + separator + text;
  return combined.length <= RECORDING_LIMITS.maxTextLength ? combined : null;
}
