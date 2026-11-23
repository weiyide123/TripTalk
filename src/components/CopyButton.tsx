"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import "./conversation-actions.css";

type Props = {
  text: string;
  label?: string;
};

export function CopyButton({ text, label = "复制内容" }: Props) {
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await writeClipboard(text);
      setStatus("已复制");
    } catch {
      setStatus("复制受限，请选中文字后手动复制");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(""), 3000);
  }

  return (
    <span className="copy-action">
      <button
        type="button"
        className="text-button copy-button"
        aria-label={label}
        title={status || label}
        disabled={!text.trim()}
        onClick={copy}
      >
        <Icon
          name={status === "已复制" ? "check" : "copy"}
          size={15}
        />
      </button>
      <span
        className={status.startsWith("复制受限") ? "copy-status" : "sr-only"}
        role="status"
      >
        {status}
      </span>
    </span>
  );
}

async function writeClipboard(text: string) {
  // 嵌入式浏览器可能不开放 Clipboard API；只在用户点击后尝试兼容复制。
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const active = document.activeElement;
    const selection = window.getSelection();
    const ranges = Array.from(
      { length: selection?.rangeCount ?? 0 },
      (_, index) => selection!.getRangeAt(index).cloneRange(),
    );
    const field = document.createElement("textarea");
    field.value = text;
    field.style.position = "fixed";
    field.style.opacity = "0";
    // 放在当前模态内，避免被 dialog 的焦点隔离阻止选中。
    (document.querySelector("dialog[open]") ?? document.body).append(field);
    try {
      field.select();
      if (!document.execCommand("copy")) throw new Error("Copy denied");
    } finally {
      field.remove();
      if (active instanceof HTMLElement) active.focus({ preventScroll: true });
      selection?.removeAllRanges();
      ranges.forEach((range) => selection?.addRange(range));
    }
  }
}
