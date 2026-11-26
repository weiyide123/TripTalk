"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./translation-popover.css";

type Position = {
  top: number;
  left: number;
  width: number;
};

export function TranslatableText({
  text,
  translation,
  loadTranslation,
}: {
  text: string;
  translation?: string;
  loadTranslation?: () => Promise<string>;
}) {
  const id = useId();
  const trigger = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [loaded, setLoaded] = useState("");
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);

  /** 关闭气泡并使在途补译失效，迟到结果不重新打开。 */
  function close() {
    generation.current++;
    cancelTimer();
    setPosition(null);
    setLoading(false);
  }

  /** 取消当前自动消失计时，避免重复点击留下旧定时器。 */
  function cancelTimer() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }

  /** 优先显示已有翻译；缺失时按需获取，完整释义显示后才开始计时。 */
  async function show() {
    // 保留原生拖选、双击选词；选中文字时不触发释义。
    if (!window.getSelection()?.isCollapsed || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 32);
    setPosition({
      top: rect.bottom + 10,
      left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
      width,
    });
    cancelTimer();
    const current = ++generation.current;
    setFailed(false);
    if (!translation && !loaded && loadTranslation) {
      setLoading(true);
      try {
        const result = await loadTranslation();
        if (current !== generation.current) return;
        setLoaded(result);
      } catch {
        if (current !== generation.current) return;
        setFailed(true);
        return;
      } finally {
        if (current === generation.current) setLoading(false);
      }
    }
    // 完整释义出现后才开始 10 秒计时，关闭后迟到响应不会重新弹出。
    timer.current = setTimeout(close, 10_000);
  }

  function toggle() {
    if (!window.getSelection()?.isCollapsed) return;
    if (position) close();
    else void show();
  }

  useEffect(() => {
    // 问题变化或组件卸载时清理计时，不让旧释义停留到下一题。
    setPosition(null);
    setLoaded("");
    setFailed(false);
    setLoading(false);
    return () => {
      generation.current++;
      cancelTimer();
    };
  }, [text, translation]);

  useEffect(() => {
    if (!position) return;
    const node = bubble.current;
    if (node) {
      node.style.top = `${Math.max(16, Math.min(position.top, window.innerHeight - node.offsetHeight - 16))}px`;
    }
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !trigger.current?.contains(target) &&
        !bubble.current?.contains(target)
      ) {
        close();
      }
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    function scroll(event: Event) {
      if (!bubble.current?.contains(event.target as Node)) close();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [position, loaded, loading, failed]);

  if (!translation && !loadTranslation) return <>{text}</>;

  let content = translation || loaded;
  if (loading) content = "正在生成中文释义…";
  if (failed) content = "释义暂未生成，点击这里重试。";

  return (
    <>
      <span
        ref={trigger}
        className="translatable-text"
        role="button"
        tabIndex={0}
        aria-label={`${text}（点击切换中文释义）`}
        aria-expanded={Boolean(position)}
        aria-describedby={position ? id : undefined}
        onClick={(event) => {
          if (event.detail < 2) toggle();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
          }
        }}
      >
        {text}
      </span>
      {position &&
        createPortal(
          <div
            ref={bubble}
            id={id}
            role="tooltip"
            className="translation-popover"
            style={position}
            lang="zh-CN"
            tabIndex={0}
            onClick={() => {
              // 点按关闭，拖选中文时仍保留浏览器的原生复制能力。
              if (!window.getSelection()?.isCollapsed) return;
              if (failed) void show();
              else close();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (failed) void show();
                else close();
              }
            }}
          >
            <span role="status">{content}</span>
          </div>,
          document.body,
        )}
    </>
  );
}
