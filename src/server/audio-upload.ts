import { z } from "zod";
import { audioFormat, RECORDING_LIMITS } from "@/contracts/transcription";
import { AppError } from "./errors";

const MAX_BODY_BYTES = RECORDING_LIMITS.maxBytes + 16_384;
const durationSchema = z.coerce
  .number()
  .finite()
  .min(RECORDING_LIMITS.minMilliseconds)
  .max(RECORDING_LIMITS.maxSeconds * 1000);

/** 有界读取 multipart 音频；不信任扩展名，不创建磁盘文件。 */
export async function readAudioUpload(request: Request): Promise<File> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw audioError("AUDIO_FORM_REQUIRED", "请通过录音按钮上传音频。", 415);
  }
  const bytes = await readBoundedBody(request);
  let form: FormData;
  try {
    form = await new Response(bytes, {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch {
    throw audioError("AUDIO_INVALID", "录音文件无法读取，请重新录制。");
  }
  if (
    [...form.keys()].some((key) => !["audio", "durationMs"].includes(key)) ||
    form.getAll("audio").length !== 1 ||
    form.getAll("durationMs").length !== 1 ||
    !durationSchema.safeParse(form.get("durationMs")).success
  ) {
    throw audioError("AUDIO_INVALID", "请录制 1 至 60 秒的短回答。");
  }
  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    throw audioError("AUDIO_EMPTY", "没有收到录音，请重新录制。");
  }
  if (audio.size > RECORDING_LIMITS.maxBytes) throw tooLarge();
  const format = audioFormat(audio.type);
  const header = new Uint8Array(await audio.slice(0, 16).arrayBuffer());
  if (!format || !matchesContainer(header, format.extension)) {
    throw audioError(
      "AUDIO_FORMAT_UNSUPPORTED",
      "录音格式不支持，请更换浏览器或使用文字输入。",
      415,
    );
  }
  return new File([audio], "recording." + format.extension, {
    type: format.type,
  });
}

/** 流式计数，防止缺失或伪造 Content-Length 绕过内存上限。 */
async function readBoundedBody(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    throw tooLarge();
  }
  const reader = request.body?.getReader();
  if (!reader) throw audioError("AUDIO_EMPTY", "没有收到录音，请重新录制。");
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted)
        throw audioError(
          "AUDIO_UPLOAD_INTERRUPTED",
          "上传已取消或超时，请重新录制。",
          408,
        );
      const { done, value } = await reader.read();
      if (signal.aborted)
        throw audioError(
          "AUDIO_UPLOAD_INTERRUPTED",
          "上传已取消或超时，请重新录制。",
          408,
        );
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw audioError(
      "AUDIO_UPLOAD_INTERRUPTED",
      "录音上传中断，请检查网络后重录。",
      408,
    );
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

/** 只做容器签名检查；可解码性由转写服务校验，时长元数据不是可信鉴权。 */
function matchesContainer(bytes: Uint8Array, format: string) {
  const text = new TextDecoder().decode(bytes);
  if (format === "webm")
    return [0x1a, 0x45, 0xdf, 0xa3].every((b, i) => bytes[i] === b);
  if (format === "ogg") return text.startsWith("OggS");
  if (format === "mp4") return text.slice(4, 8) === "ftyp";
  return text.startsWith("RIFF") && text.slice(8, 12) === "WAVE";
}

function tooLarge() {
  return audioError("AUDIO_TOO_LARGE", "录音超过 5 MB，请缩短后重录。", 413);
}

function audioError(code: string, message: string, status = 400) {
  return new AppError(code, message, status, false, {
    stage: "audio_upload",
    submission: "not_committed",
  });
}
