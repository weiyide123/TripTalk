"use client";

import { useEffect, useRef, useState } from "react";
import { favoriteSourceKey, type FavoriteSource } from "@/contracts/favorite";
import { translationResultSchema } from "@/contracts/sentence-translation";
import { api } from "@/lib/api";

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

/** 仅由点击/收藏触发；同来源在途请求复用，失败不缓存，持久缓存由服务端负责。 */
export function requestSentenceTranslation(source: FavoriteSource) {
  const key = favoriteSourceKey(source);
  const saved = cache.get(key);
  if (saved) return Promise.resolve(saved);
  const existing = pending.get(key);
  if (existing) return existing;
  const request = api("/sentence-translations", source)
    .then((result) => {
      const { chineseTranslation } = translationResultSchema.parse(result);
      cache.set(key, chineseTranslation);
      if (cache.size > 256) cache.delete(cache.keys().next().value!);
      return chineseTranslation;
    })
    .finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

/** 收藏成功与补译分别反馈；失败保留英文收藏，刷新后仍可主动重试。 */
export function useSentenceTranslation(source?: FavoriteSource) {
  const key = source ? favoriteSourceKey(source) : "";
  const current = useRef(key);
  current.current = key;
  const alive = useRef(true);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    alive.current = true;
    setText(cache.get(key) ?? "");
    setError("");
    setBusy(false);
    return () => {
      alive.current = false;
    };
  }, [key]);
  /** 显式补译并隔离旧来源响应；错误只影响释义，不回滚收藏。 */
  async function load() {
    if (!source) return;
    setBusy(true);
    setError("");
    try {
      const value = await requestSentenceTranslation(source);
      if (alive.current && current.current === key) setText(value);
    } catch {
      if (alive.current && current.current === key)
        setError("释义暂未生成，英文收藏已保留。");
    } finally {
      if (alive.current && current.current === key) setBusy(false);
    }
  }
  return {
    text,
    busy,
    error,
    load,
  };
}
