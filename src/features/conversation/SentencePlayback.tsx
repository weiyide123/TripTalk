"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Icon } from "@/components/Icon";
import "./voice-input.css";

type PlaybackState = {
  id: string;
  phase: "loading" | "playing" | "error";
  message?: string;
};
type Playback = ReturnType<typeof useSentencePlayback>;

export const SentencePlaybackContext = createContext<Playback | null>(null);

/** 当前对话共用一个播报通道；切句、录音、换题或离开都会停止旧声音。 */
export function useSentencePlayback(contextKey: string, blocked: boolean) {
  const [state, setState] = useState<PlaybackState | null>(null);
  const active = useRef<SpeechSynthesisUtterance | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  /** 先移除回调再 cancel，忽略浏览器随后发出的 interrupted/canceled 事件。 */
  function release() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const utterance = active.current;
    active.current = null;
    if (!utterance) return;
    utterance.onstart = null;
    utterance.onend = null;
    utterance.onerror = null;
    window.speechSynthesis.cancel();
  }

  function stop() {
    release();
    setState(null);
  }

  useEffect(() => {
    stop();
    const hide = () => {
      if (document.hidden) stop();
    };
    window.addEventListener("pagehide", stop);
    document.addEventListener("visibilitychange", hide);
    return () => {
      release();
      window.removeEventListener("pagehide", stop);
      document.removeEventListener("visibilitychange", hide);
    };
    // 清理只依赖 ref；草稿输入不应中断播放。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey, blocked]);

  /** 只响应用户点击，优先本机英语音色；没有可列出的音色时由系统按 lang 选择。 */
  function toggle(id: string, text: string) {
    if (blocked || !text.trim()) return;
    if (state?.id === id && active.current) {
      stop();
      return;
    }
    stop();
    const fail = (code: string, message: string) => {
      release();
      setState({
        id,
        phase: "error",
        message,
      });
      console.warn(
        JSON.stringify({
          event: "sentence_playback_failed",
          code,
        }),
      );
    };
    if (
      !("speechSynthesis" in window) ||
      !("SpeechSynthesisUtterance" in window)
    ) {
      fail("UNSUPPORTED", "当前浏览器不支持朗读，可尝试 Chrome 或 Safari。");
      return;
    }
    try {
      const synthesis = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(text);
      const voices = synthesis
        .getVoices()
        .filter((voice) => /^en([-_]|$)/i.test(voice.lang));
      const voice =
        voices.find((item) => item.localService && item.lang === "en-US") ??
        voices.find((item) => item.localService) ??
        voices.find((item) => item.lang === "en-US") ??
        voices[0];
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang ?? "en-US";
      utterance.rate = 0.9;
      active.current = utterance;
      setState({
        id,
        phase: "loading",
      });
      const current = () => active.current === utterance;
      const startup = setTimeout(() => {
        if (current())
          fail("START_TIMEOUT", "朗读暂时无法启动，请检查系统英语语音或重试。");
      }, 8_000);
      timers.current.push(startup);
      utterance.onstart = () => {
        if (!current()) return;
        clearTimeout(startup);
        setState({
          id,
          phase: "playing",
        });
        timers.current.push(
          setTimeout(() => {
            if (current())
              fail("PLAYBACK_TIMEOUT", "朗读已停止，可点击重新播放。");
          }, 120_000),
        );
      };
      utterance.onend = () => {
        if (current()) stop();
      };
      utterance.onerror = (event) => {
        if (current())
          fail(
            event.error,
            "朗读暂时不可用，请检查设备音量、英语语音或网络后重试。",
          );
      };
      synthesis.cancel();
      synthesis.speak(utterance);
    } catch {
      fail("PLAYBACK_ERROR", "朗读未能启动，请稍后重试。");
    }
  }

  return {
    state,
    blocked,
    toggle,
    stop,
  };
}

/** 与翻译文本分离的小图标，不接管双击选词，也不创建学习事件。 */
export function SentencePlayButton({ text }: { text: string }) {
  const playback = useContext(SentencePlaybackContext);
  const id = useId();
  if (!playback) return null;
  const state = playback.state?.id === id ? playback.state : null;
  const active = Boolean(state && state.phase !== "error");
  const label = active ? "停止朗读" : "播放英文句子";
  return (
    <span className="sentence-playback">
      <button
        type="button"
        className="text-button sentence-play-button"
        aria-label={label}
        aria-pressed={active}
        title={playback.blocked ? "录音或识别期间暂停播放" : label}
        disabled={playback.blocked}
        onClick={() => playback.toggle(id, text)}
      >
        <Icon
          name={active ? "stop" : "speaker"}
          size={15}
        />
      </button>
      {state?.message && (
        <span
          className="sentence-playback-error"
          role="status"
        >
          {state.message}
        </span>
      )}
    </span>
  );
}
