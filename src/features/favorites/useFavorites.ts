"use client";

import { useEffect, useRef, useState } from "react";
import type { FavoriteList } from "@/contracts/favorite";
import { api } from "@/lib/api";

/** 管理收藏筛选和分页；查询代次阻止慢响应覆盖新筛选，删除失败保留原卡片。 */
export function useFavorites() {
  const [sceneId, setSceneId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [data, setData] = useState<FavoriteList | null>(null);
  // 切换筛选时仅清空结果卡片，保留目录，避免菜单名称和禁用状态闪动。
  const [filters, setFilters] = useState<FavoriteList["filters"]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string[]>([]);
  const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({});
  const generation = useRef(0);
  const loading = useRef(false);
  const locks = useRef(new Set<string>());
  const alive = useRef(true);
  const latestLoad = useRef(load);
  latestLoad.current = load;

  /** 同一查询代次才接收结果；分页按收藏 UUID 去重，筛选变化重读第一页。 */
  async function load(offset = 0) {
    if (offset && loading.current) return;
    const current = ++generation.current;
    loading.current = true;
    setBusy(true);
    setError("");
    const query = new URLSearchParams({ offset: String(offset) });
    if (sceneId) query.set("sceneId", sceneId);
    if (topicId) query.set("topicId", topicId);
    try {
      const result = await api<FavoriteList>(`/favorites?${query}`);
      if (!alive.current || current !== generation.current) return;
      setFilters(result.filters);
      setData((previous) => ({
        ...result,
        items: offset
          ? [
              ...new Map(
                [...(previous?.items ?? []), ...result.items].map((item) => [
                  item.id,
                  item,
                ]),
              ).values(),
            ]
          : result.items,
      }));
    } catch {
      if (alive.current && current === generation.current)
        setError("收藏加载失败，请重试。");
    } finally {
      if (alive.current && current === generation.current) {
        loading.current = false;
        setBusy(false);
      }
    }
  }

  useEffect(() => {
    alive.current = true;
    setData(null);
    void load();
    const focus = () => {
      if (!locks.current.size) void load();
    };
    window.addEventListener("focus", focus);
    return () => {
      alive.current = false;
      generation.current++;
      window.removeEventListener("focus", focus);
    };
    // 筛选变化主动重读第一页，不依赖返回数据。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId, topicId]);

  /** 删除确认后用最新筛选重读，防止并发取消和切换筛选留下过期卡片。 */
  async function remove(id: string) {
    if (locks.current.has(id)) return;
    locks.current.add(id);
    setRemoving([...locks.current]);
    try {
      await api(`/favorites/${id}`, {}, "DELETE");
      if (!alive.current) return;
      setRemoveErrors((previous) => ({ ...previous, [id]: "" }));
      // 重新读第一页，防止 OFFSET 在删除后跳过下一条；保留当前筛选。
      await latestLoad.current();
    } catch {
      if (alive.current)
        setRemoveErrors((previous) => ({
          ...previous,
          [id]: "取消结果未确认，请点击重试。",
        }));
    } finally {
      locks.current.delete(id);
      if (alive.current) setRemoving([...locks.current]);
    }
  }

  function selectScene(id: string) {
    setSceneId(id);
    setTopicId("");
  }
  return {
    sceneId,
    topicId,
    data,
    filters,
    busy,
    error,
    removing,
    removeErrors,
    load,
    remove,
    selectScene,
    setTopicId,
  };
}
