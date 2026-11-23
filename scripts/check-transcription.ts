// 离线音频边界回归：替换 fetch，绝不读取 .env、学习库或调用收费服务。
import assert from "node:assert/strict";
import { readAudioUpload } from "../src/server/audio-upload";
import { transcribeAudio } from "../src/server/services/transcribe-audio";
import { POST } from "../src/app/api/transcriptions/route";
import { AppError } from "../src/server/errors";
import {
  appendTranscript,
  audioFormat,
  RECORDING_LIMITS,
} from "../src/contracts/transcription";

const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENAI_API_KEY;
const originalModel = process.env.OPENAI_TRANSCRIPTION_MODEL;
const audio = new File(
  [new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0])],
  "private-name.webm",
  { type: "audio/webm;codecs=opus" },
);
let calls = 0;
let upstream: (request: Request) => Promise<Response> = async () =>
  Response.json({ text: "Three people, please." });

/** 构造本机 multipart 请求；测试文件仅有容器签名，不冒充真实音频验收。 */
function request(
  file: File = audio,
  duration = "2000",
  extra?: (form: FormData) => void,
) {
  const form = new FormData();
  form.append("audio", file);
  form.append("durationMs", duration);
  extra?.(form);
  return new Request("http://127.0.0.1:3000/api/transcriptions", {
    method: "POST",
    headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
    body: form,
  });
}

async function rejects(work: () => Promise<unknown>, code: string) {
  await assert.rejects(
    work,
    (error: unknown) => error instanceof AppError && error.code === code,
  );
}

try {
  process.env.OPENAI_API_KEY = "offline-fixture-key";
  process.env.OPENAI_TRANSCRIPTION_MODEL = "gpt-transcribe";
  globalThis.fetch = async (input, init) => {
    calls++;
    const req = new Request(input, init);
    assert.equal(req.url, "https://api.openai.com/v1/audio/transcriptions");
    return upstream(req);
  };
  assert.equal(appendTranscript("Existing", "New"), "Existing\nNew");
  assert.equal(appendTranscript("Existing\n", "New"), "Existing\nNew");
  assert.equal(appendTranscript("x".repeat(2000), "New"), null);
  assert.equal(audioFormat("audio/webm;codecs=opus")?.extension, "webm");
  assert.equal(audioFormat("text/html"), null);

  const accepted = await readAudioUpload(request());
  assert.equal(accepted.name, "recording.webm");
  assert.equal(accepted.type, "audio/webm");
  for (const [type, bytes] of [
    ["audio/ogg", "OggS000000"],
    ["audio/mp4", "0000ftyp0000"],
    ["audio/wav", "RIFF0000WAVE"],
  ]) {
    assert.equal(
      (await readAudioUpload(request(new File([bytes], "file", { type }))))
        .type,
      type,
    );
  }
  for (const duration of ["0", "599", "60001", "NaN", "Infinity", ""]) {
    await rejects(
      () => readAudioUpload(request(audio, duration)),
      "AUDIO_INVALID",
    );
  }
  await rejects(
    () =>
      readAudioUpload(
        request(audio, "2000", (form) => form.append("audio", audio)),
      ),
    "AUDIO_INVALID",
  );
  await rejects(
    () =>
      readAudioUpload(
        request(audio, "2000", (form) => form.append("other", "ignored?")),
      ),
    "AUDIO_INVALID",
  );
  await rejects(
    () =>
      readAudioUpload(request(new File([], "empty", { type: "audio/webm" }))),
    "AUDIO_EMPTY",
  );
  await rejects(
    () =>
      readAudioUpload(
        request(new File(["bad"], "fake.webm", { type: "audio/webm" })),
      ),
    "AUDIO_FORMAT_UNSUPPORTED",
  );
  await rejects(
    () =>
      readAudioUpload(
        request(new File(["bad"], "fake.webm", { type: "text/html" })),
      ),
    "AUDIO_FORMAT_UNSUPPORTED",
  );
  await rejects(
    () =>
      readAudioUpload(
        request(
          new File([new Uint8Array(RECORDING_LIMITS.maxBytes + 1)], "large", {
            type: "audio/webm",
          }),
        ),
      ),
    "AUDIO_TOO_LARGE",
  );
  const oversized = request();
  oversized.headers.set("content-length", "999999999");
  await rejects(() => readAudioUpload(oversized), "AUDIO_TOO_LARGE");
  // 无 Content-Length 的流仍受总字节上限保护。
  await rejects(
    () =>
      readAudioUpload(
        new Request("http://localhost", {
          method: "POST",
          headers: { "content-type": "multipart/form-data; boundary=x" },
          body: new Uint8Array(RECORDING_LIMITS.maxBytes + 20_000),
        }),
      ),
    "AUDIO_TOO_LARGE",
  );
  const cancelled = new AbortController();
  cancelled.abort();
  await rejects(
    () => readAudioUpload(new Request(request(), { signal: cancelled.signal })),
    "AUDIO_UPLOAD_INTERRUPTED",
  );

  upstream = async (req) => {
    const form = await req.formData();
    assert.equal(form.get("model"), "gpt-transcribe");
    assert.equal(form.get("response_format"), "json");
    assert.equal((form.get("file") as File).name, "recording.webm");
    assert.match(String(form.get("prompt")), /Do not translate/);
    return Response.json({
      text: " Three people, please. ",
      languages: ["en"],
    });
  };
  const successful = await POST(request());
  assert.equal(successful.status, 200);
  assert.deepEqual(await successful.json(), { text: "Three people, please." });
  assert.equal(successful.headers.get("cache-control"), "no-store");
  assert.ok(successful.headers.get("x-request-id"));
  const crossSite = request();
  crossSite.headers.set("origin", "https://example.com");
  const beforeBlocked = calls;
  assert.equal((await POST(crossSite)).status, 403);
  assert.equal(calls, beforeBlocked);

  upstream = async () => Response.json({ text: " " });
  await rejects(
    () => transcribeAudio(accepted, new AbortController().signal),
    "AUDIO_NO_SPEECH",
  );
  upstream = async () => Response.json({ text: "x".repeat(2001) });
  await rejects(
    () => transcribeAudio(accepted, new AbortController().signal),
    "TRANSCRIPTION_OUTPUT_INVALID",
  );
  for (const [status, expected] of [
    [401, "API_AUTH_FAILED"],
    [429, "API_RATE_LIMITED"],
    [503, "AI_SERVICE_UNAVAILABLE"],
    [400, "AUDIO_INVALID"],
    [404, "MODEL_UNAVAILABLE"],
  ] as const) {
    upstream = async () =>
      Response.json(
        { error: { message: "private upstream content" } },
        { status },
      );
    const before = calls;
    await rejects(
      () => transcribeAudio(accepted, new AbortController().signal),
      expected,
    );
    assert.equal(calls, before + 1, "付费请求不得自动重试");
  }
  upstream = async () => {
    throw new TypeError("offline");
  };
  await rejects(
    () => transcribeAudio(accepted, new AbortController().signal),
    "NETWORK_CONNECTION_FAILED",
  );

  let finish!: (response: Response) => void;
  upstream = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const first = transcribeAudio(accepted, new AbortController().signal);
  await rejects(
    () => transcribeAudio(accepted, new AbortController().signal),
    "TRANSCRIPTION_BUSY",
  );
  while (!finish) await new Promise((resolve) => setTimeout(resolve, 0));
  finish(Response.json({ text: "Recovered" }));
  assert.deepEqual(await first, { text: "Recovered" });
  await rejects(
    () => transcribeAudio(accepted, cancelled.signal),
    "NETWORK_TIMEOUT",
  );
  delete process.env.OPENAI_API_KEY;
  await rejects(
    () => transcribeAudio(accepted, new AbortController().signal),
    "CONFIGURATION_MISSING",
  );
  console.log(
    "音频上传、SDK 请求/错误、并发、来源保护和草稿合并检查通过；真实模型调用 0。",
  );
} finally {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
  if (originalModel === undefined)
    delete process.env.OPENAI_TRANSCRIPTION_MODEL;
  else process.env.OPENAI_TRANSCRIPTION_MODEL = originalModel;
}
