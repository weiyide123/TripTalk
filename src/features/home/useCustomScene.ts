"use client";

import { useEffect, useRef, useState } from "react";
import {
  customSceneRequestSchema,
  type CustomSceneRequest,
} from "@/contracts/requests";
import type { CatalogScene } from "@/contracts/scene";
import { api, ApiError } from "@/lib/api";

const STORAGE_KEY = "triptalk:pending-custom-scene";

/** 管理创建草稿与幂等重试；确认后通知首页追加场景，不切换学习或生成课程。 */
export function useCustomScene(onCreated: (scene: CatalogScene) => void) {
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState<CustomSceneRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const lock = useRef(false);
  const operation = useRef<CustomSceneRequest | null>(null);

  useEffect(() => {
    try {
      const saved = customSceneRequestSchema.safeParse(
        JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null"),
      );
      if (saved.success) {
        operation.current = saved.data;
        setPending(saved.data);
        setDescription(saved.data.description);
        setError("上次创建结果尚未确认，重试会核对原操作，不会重复创建。");
      }
    } catch {
      setStorageWarning(true);
    }
    const warn = (event: BeforeUnloadEvent) => {
      if (!lock.current && !operation.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  /** 先暂存完整请求再发送；暂存不可用时保留内存请求并明确提示用户。 */
  function remember(request: CustomSceneRequest | null) {
    operation.current = request;
    setPending(request);
    try {
      if (request) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(request));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      setStorageWarning(true);
    }
  }

  /** 未确认请求只重放原输入，确认创建成功后更新目录并清除暂存。 */
  async function create() {
    if (lock.current) return false;
    const parsed = customSceneRequestSchema.safeParse(
      operation.current ?? {
        requestId: crypto.randomUUID(),
        description,
      },
    );
    if (!parsed.success) {
      setError("请用 5–500 个字符描述想练习的场景，不要只填写数字或符号。");
      return false;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    remember(parsed.data);
    try {
      const scene = await api<CatalogScene>("/scenes", parsed.data);
      onCreated(scene);
      remember(null);
      setDescription("");
      return true;
    } catch (cause) {
      setError((cause as Error).message);
      // 只有明确未提交才允许改写输入；未知结果保留原文和编号供核对。
      if (cause instanceof ApiError && cause.submission === "not_committed")
        remember(null);
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return {
    description,
    setDescription,
    pending,
    busy,
    error,
    storageWarning,
    create,
  };
}
