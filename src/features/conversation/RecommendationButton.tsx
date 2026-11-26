"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/Icon";

const label = "建议收藏下方的推荐表达";

/** 点击后的可见提示与推荐高亮共用生命周期；浮层不占布局，也不被历史滚动区裁掉。 */
export function RecommendationButton({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const notice = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!active) return;
    /** 贴近触发按钮并避开窗口边界；滚动时重新定位，不滚动页面或转移焦点。 */
    function place() {
      if (!button.current || !notice.current) return;
      const rect = button.current.getBoundingClientRect();
      const { width, height } = notice.current.getBoundingClientRect();
      // 优先放在工具栏下方，不盖住原回答；仅在窗口底部空间不足时翻到上方。
      const top =
        rect.bottom + 6 + height <= window.innerHeight - 12
          ? rect.bottom + 6
          : rect.top - height - 6;
      setPosition({
        left: Math.max(
          16,
          Math.min(rect.right - width, window.innerWidth - width - 16),
        ),
        top: Math.max(12, Math.min(top, window.innerHeight - height - 12)),
      });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [active]);

  return (
    <span
      className="recommendation-action"
      data-attention={active}
    >
      <button
        ref={button}
        type="button"
        className="text-button bookmark-button recommendation-button"
        title={active ? undefined : label}
        aria-label={label}
        aria-describedby={active ? id : undefined}
        onClick={onClick}
      >
        <Icon
          name="bookmark"
          size={15}
        />
      </button>
      {active &&
        createPortal(
          <span
            ref={notice}
            id={id}
            role="status"
            className="recommendation-notice"
            style={{
              ...position,
              visibility: position ? "visible" : "hidden",
            }}
          >
            <Icon
              name="sparkles"
              size={14}
            />
            <span>{label}</span>
          </span>,
          document.body,
        )}
    </span>
  );
}
