import { audioFormat, RECORDING_LIMITS } from "@/contracts/transcription";

export type Recording = {
  audio: Blob;
  durationMs: number;
};
export type RecordingHandle = {
  stop: () => void;
  result: Promise<Recording>;
};

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/webm",
];

/** 请求麦克风并启动有界录制；取消后迟到的权限授权也立即释放设备。 */
export async function startRecording(
  signal: AbortSignal,
  onElapsed: (seconds: number) => void,
): Promise<RecordingHandle> {
  if (
    !window.isSecureContext ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === "undefined"
  ) {
    throw new Error(
      "当前浏览器不支持录音，请使用 Chrome / Safari 的 localhost 页面或 HTTPS，仍可继续打字。",
    );
  }
  const mimeType = MIME_CANDIDATES.find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
  if (!mimeType)
    throw new Error("当前浏览器没有可用的录音格式，请继续使用文字输入。");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    signal.throwIfAborted();
    const recorder = new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: 64_000,
    });
    if (!audioFormat(recorder.mimeType))
      throw new Error("浏览器录音格式不受支持，请使用文字输入。");
    return capture(recorder, stream, signal, onElapsed);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
}

/** 汇集最终 dataavailable 后再生成音频；所有结束路径都停止设备与计时。 */
function capture(
  recorder: MediaRecorder,
  stream: MediaStream,
  signal: AbortSignal,
  onElapsed: (seconds: number) => void,
): RecordingHandle {
  const meter = createLevelMeter(stream);
  const chunks: Blob[] = [];
  const started = performance.now();
  let bytes = 0;
  let settled = false;
  let stopped = false;
  let durationMs = 0;
  let heardSound = false;
  let resolve!: (recording: Recording) => void;
  let reject!: (error: Error) => void;
  const result = new Promise<Recording>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // 启动失败可能先于 Hook 订阅 result，不产生未处理的 Promise 拒绝。
  void result.catch(() => {});
  const fail = (error: Error) => {
    if (settled) return;
    settled = true;
    cleanup();
    reject(error);
  };
  const abort = () =>
    fail(new DOMException("Recording cancelled", "AbortError"));
  const stop = () => {
    if (settled || stopped) return;
    stopped = true;
    durationMs = Math.min(
      performance.now() - started,
      RECORDING_LIMITS.maxSeconds * 1000,
    );
    try {
      recorder.stop();
      // stop 的最终数据事件异步到达，设备无需继续占用。
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      fail(new Error("录音未能结束，请重新录制。"));
    }
  };
  const timer = window.setInterval(() => {
    const elapsed = (performance.now() - started) / 1000;
    onElapsed(Math.min(Math.floor(elapsed), RECORDING_LIMITS.maxSeconds));
    if (meter?.audible()) heardSound = true;
    if (elapsed >= RECORDING_LIMITS.maxSeconds) stop();
  }, 100);

  /** 拆除监听后释放资源，防止停止设备再次触发录音回调。 */
  function cleanup() {
    window.clearInterval(timer);
    signal.removeEventListener("abort", abort);
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
    stream.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      // 设备中断时浏览器可能已经停止录制；音轨已释放，继续清理音量检测。
    } finally {
      meter?.close();
    }
  }

  recorder.ondataavailable = ({ data }) => {
    if (settled || !data.size) return;
    bytes += data.size;
    if (bytes > RECORDING_LIMITS.maxBytes) {
      fail(new Error("录音超过 5 MB，请缩短后重录。"));
      return;
    }
    chunks.push(data);
  };
  recorder.onerror = () =>
    fail(new Error("录音中断，请检查麦克风后重新录制。"));
  recorder.onstop = () => {
    if (settled) return;
    if (!stopped) {
      fail(new Error("麦克风连接中断，请重新录制。"));
      return;
    }
    if (durationMs < RECORDING_LIMITS.minMilliseconds || !bytes) {
      fail(new Error("录音太短，请说完一句话后再结束。"));
      return;
    }
    // 仅拦截明显静音；环境噪声不等于语音，最终仍需用户核对文字。
    if (meter?.available() && !heardSound) {
      fail(new Error("没有检测到声音，请检查麦克风或靠近一些再试。"));
      return;
    }
    settled = true;
    cleanup();
    resolve({
      audio: new Blob(chunks, { type: recorder.mimeType }),
      durationMs: Math.round(durationMs),
    });
  };
  stream.getAudioTracks().forEach((track) => {
    track.onended = () => {
      if (!stopped) fail(new Error("麦克风已断开，请重新录制。"));
    };
  });
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    recorder.start(250);
  } catch (error) {
    fail(error instanceof Error ? error : new Error("无法开始录音，请重试。"));
  }
  return {
    stop,
    result,
  };
}

/** 本地音量检测不保存采样；Web Audio 不可用时不阻塞基本录音。 */
function createLevelMeter(stream: MediaStream) {
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    void context.resume().catch(() => {});
    return {
      available: () => context?.state === "running",
      audible: () => {
        analyser.getFloatTimeDomainData(samples);
        const power = samples.reduce((sum, sample) => sum + sample * sample, 0);
        return Math.sqrt(power / samples.length) > 0.002;
      },
      close: () => {
        source.disconnect();
        void context?.close().catch(() => {});
      },
    };
  } catch {
    void context?.close().catch(() => {});
    return null;
  }
}

/** 将浏览器设备异常转换为可操作提示，不展示设备标识或系统异常原文。 */
export function recordingError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (["NotAllowedError", "SecurityError"].includes(name))
    return "麦克风权限未开启，请在浏览器地址栏的网站设置中允许录音；也可以继续打字。";
  if (name === "NotFoundError")
    return "没有找到麦克风，请连接设备，或继续打字。";
  if (["NotReadableError", "AbortError"].includes(name))
    return "麦克风暂时不可用，可能被其他应用占用，请检查后重试。";
  return error instanceof Error
    ? error.message
    : "录音未能完成，请重试或继续打字。";
}
