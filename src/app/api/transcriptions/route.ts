import { handle } from "@/server/http";
import { readAudioUpload } from "@/server/audio-upload";
import { transcribeAudio } from "@/server/services/transcribe-audio";

export const runtime = "nodejs";

/** 独立转写入口：同源保护 → 有界音频读取 → 云端识别，不写学习记录。 */
export function POST(request: Request) {
  return handle(request, async () => {
    const audio = await readAudioUpload(request);
    return transcribeAudio(audio, request.signal);
  });
}
