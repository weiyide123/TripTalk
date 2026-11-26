"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

export type SourceLocation = { turnId: string; part: string };

/** 初次载入来源时定位具体段落；只消费一次，后续新对话仍正常自动滚动。 */
export function useSourceLocation(
  history: RefObject<HTMLDivElement | null>,
  ready: boolean,
  source?: SourceLocation,
) {
  const handled = useRef("");
  const [notice, setNotice] = useState("");
  const key = source ? `${source.turnId}:${source.part}` : "";
  const shouldLocate = Boolean(key && key !== handled.current);
  useEffect(() => {
    if (!ready || !key || handled.current === key) return;
    handled.current = key;
    const container = history.current;
    // 不把 URL 参数拼入 CSS selector，避免特殊字符和错误定位。
    const target = Array.from(
      container?.querySelectorAll<HTMLElement>("[data-source-turn]") ?? [],
    ).find(
      (element) =>
        element.dataset.sourceTurn === source?.turnId &&
        element.dataset.sourcePart === source?.part,
    );
    if (!container || !target) {
      setNotice("未找到这条收藏的原句，当前展示已保存的对话记录。");
      return;
    }
    setNotice("已定位到收藏的原句。");
    target.classList.add("favorite-source-target");
    const top =
      container.scrollTop +
      target.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      24;
    container.scrollTo({ top, behavior: "instant" });
    const timer = setTimeout(() => {
      target.classList.remove("favorite-source-target");
      setNotice("");
    }, 6000);
    return () => {
      clearTimeout(timer);
      target.classList.remove("favorite-source-target");
    };
  }, [ready, key, history, source?.turnId, source?.part]);
  return { shouldLocate, notice };
}
