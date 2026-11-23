"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { HomeView } from "@/contracts/views";
import { DIFFICULTIES, type Difficulty } from "@/contracts/difficulty";
import { Icon } from "@/components/Icon";
import "./course-plan-dialog.css";

type Props = {
  home: HomeView;
  open: boolean;
  busy: boolean;
  disabled: boolean;
  startLabel: string;
  difficulty: Difficulty;
  onClose: () => void;
  onStart: () => void;
  children: ReactNode;
};

// 弹窗只展示课程安排；所有真实请求、重试与导航继续由 useHome 负责。
export function CoursePlanDialog({
  home,
  open,
  busy,
  disabled,
  startLabel,
  difficulty,
  onClose,
  onStart,
  children,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const opener = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    // 原生模态提供背景隔离与焦点约束；额外阻止背景页面滚动。
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="course-plan-dialog"
      aria-labelledby="course-plan-title"
      aria-describedby="course-plan-meta"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <CoursePlanHeader
        home={home}
        difficulty={difficulty}
        busy={busy}
        onClose={onClose}
      />
      <div className="course-plan-body">
        {children}
        <ol
          className="course-plan-topics"
          aria-label="按学习顺序排列的主题"
        >
          {home.topics.map((topic, index) => (
            <CourseTopic
              key={topic.id}
              topic={topic}
              index={index}
              home={home}
            />
          ))}
        </ol>
      </div>
      <footer className="course-plan-footer">
        <button
          className="button secondary"
          disabled={busy}
          onClick={onClose}
        >
          关闭
        </button>
        <button
          className="button primary"
          disabled={disabled}
          onClick={onStart}
        >
          {busy && <span className="spinner" />}
          {busy ? "正在准备…" : startLabel}
          {!busy && (
            <Icon
              name="arrow"
              size={18}
            />
          )}
        </button>
      </footer>
      <span
        className="sr-only"
        role="status"
      >
        {busy ? "正在处理，请稍候。" : ""}
      </span>
    </dialog>
  );
}

function CoursePlanHeader({
  home,
  difficulty,
  busy,
  onClose,
}: Pick<Props, "home" | "difficulty" | "busy" | "onClose">) {
  let summary = `${home.topics.length} 个主题`;
  if (home.completedTopicIds.length > 0) {
    summary = `已完成 ${home.completedTopicIds.length} / ${home.topics.length}`;
  }
  return (
    <header className="course-plan-header">
      <div className="course-plan-heading">
        <h2 id="course-plan-title">{home.scene.title} · 课程安排</h2>
        <button
          className="course-plan-close"
          aria-label="关闭课程安排"
          disabled={busy}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <p
        id="course-plan-meta"
        className="course-plan-meta"
      >
        <span>{summary}</span>
        <span>{DIFFICULTIES[difficulty].label}难度</span>
        <span>每主题 8–15 问</span>
      </p>
    </header>
  );
}

function CourseTopic({
  topic,
  index,
  home,
}: {
  topic: HomeView["topics"][number];
  index: number;
  home: HomeView;
}) {
  // 明确重练时，进行中优先于历史上的已完成。
  const active = home.activeSession?.topicId === topic.id;
  const done = !active && home.completedTopicIds.includes(topic.id);
  const next = !home.activeSession && home.nextTopic?.id === topic.id;
  let status = "";
  if (active) status = "进行中";
  else if (done) status = "已完成";
  else if (next) status = "待学习";
  let className = "course-topic";
  if (active || next) className += " current";
  if (done) className += " completed";
  return (
    <li className={className}>
      <span
        className="course-topic-number"
        aria-hidden="true"
      >
        {done ? (
          <Icon
            name="check"
            size={15}
          />
        ) : (
          String(index + 1).padStart(2, "0")
        )}
      </span>
      <div className="course-topic-copy">
        <h3>{topic.title}</h3>
        <p>{topic.description}</p>
      </div>
      {status && <span className="course-topic-status">{status}</span>}
    </li>
  );
}
