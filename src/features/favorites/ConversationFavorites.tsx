"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  favoriteSourceKey,
  type FavoriteMark,
  type FavoriteSource,
  type FavoriteView,
} from "@/contracts/favorite";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import "./favorites.css";
import { useSentenceTranslation } from "./useSentenceTranslation";

const FavoritesContext = createContext<ReturnType<
  typeof useFavoriteMarks
> | null>(null);

/** 每次练习共享一份收藏状态；来源不同部分独立，失败重试保留原操作方向。 */
function useFavoriteMarks(sessionId: string) {
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const locks = useRef(new Set<string>());
  const failed = useRef(new Map<string, { id?: string }>());
  const generation = useRef(0);
  const mounted = useRef(false);

  /** 页面重开和恢复焦点时批量核对；迟到读取不能覆盖正在保存的结果。 */
  async function refresh() {
    if (locks.current.size) return;
    const current = ++generation.current;
    setReady(false);
    try {
      const rows = await api<FavoriteMark[]>(
        `/sessions/${encodeURIComponent(sessionId)}/favorites`,
      );
      if (!mounted.current || current !== generation.current) return;
      setMarks(
        Object.fromEntries(rows.map((row) => [favoriteSourceKey(row), row.id])),
      );
      // 核对成功后以权威状态为准，不再显示先前的不确定失败。
      failed.current.clear();
      setErrors({});
      setLoadError("");
      setReady(true);
    } catch {
      if (mounted.current && current === generation.current)
        setLoadError("收藏状态读取失败，请重试；答题不受影响。");
    }
  }

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => {
      mounted.current = false;
      generation.current++;
      window.removeEventListener("focus", focus);
    };
    // Provider 随 sessionId 重新挂载；焦点刷新不依赖旧 marks。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  /** 非 toggle API：请求方向固定，丢响应后的重试仍是保存或删除原 UUID。 */
  async function toggle(source: FavoriteSource) {
    const key = favoriteSourceKey(source);
    if (!ready || locks.current.has(key)) return;
    const operation = failed.current.get(key) ?? { id: marks[key] };
    locks.current.add(key);
    generation.current++;
    setPending([...locks.current]);
    try {
      let id: string | undefined;
      let created: FavoriteView | undefined;
      if (operation.id) await api(`/favorites/${operation.id}`, {}, "DELETE");
      else {
        created = await api<FavoriteView>("/favorites", source);
        id = created.id;
      }
      if (!mounted.current) return;
      setMarks((previous) => {
        const next = { ...previous };
        if (id) next[key] = id;
        else delete next[key];
        return next;
      });
      failed.current.delete(key);
      setErrors((previous) => ({
        ...previous,
        [key]: "",
      }));
      return created;
    } catch {
      if (!mounted.current) return;
      failed.current.set(key, operation);
      setErrors((previous) => ({
        ...previous,
        [key]: "结果未确认，点击重试。",
      }));
    } finally {
      locks.current.delete(key);
      if (mounted.current) setPending([...locks.current]);
    }
  }
  return {
    marks,
    ready,
    pending,
    errors,
    loadError,
    refresh,
    toggle,
  };
}

export function ConversationFavorites({
  sessionId,
  children,
}: {
  sessionId: string;
  children: ReactNode;
}) {
  const state = useFavoriteMarks(sessionId);
  return (
    <FavoritesContext.Provider value={state}>
      {children}
    </FavoritesContext.Provider>
  );
}

/** 读取失败放在对话布局内，不向一屏练习页外追加错误区。 */
export function FavoriteStatus() {
  const state = useContext(FavoritesContext);
  if (!state?.loadError) return null;
  return (
    <div
      className="favorite-load-notice"
      role="status"
    >
      {state.loadError}
      <button
        className="text-button"
        onClick={() => void state.refresh()}
      >
        重试读取
      </button>
    </div>
  );
}

/** 仅由可收藏内容传入来源，不读取或信任气泡显示文字。 */
export function FavoriteButton({ source }: { source: FavoriteSource }) {
  const state = useContext(FavoritesContext);
  const translation = useSentenceTranslation(source);
  if (!state) return null;
  const key = favoriteSourceKey(source);
  const saved = Boolean(state.marks[key]);
  const busy = state.pending.includes(key);
  const error = state.errors[key];
  let label = saved ? "取消收藏" : "收藏表达";
  if (!saved && source.sourcePart === "learner_answer") label = "收藏这句回答";
  if (!saved && source.sourcePart === "corrected_answer")
    label = "收藏推荐表达";
  if (error) label = "重试收藏操作";
  if (!state.ready) label = "正在核对收藏状态";
  return (
    <span
      className="favorite-action"
      data-attention={Boolean(
        error || busy || (saved && (translation.busy || translation.error)),
      )}
    >
      <button
        type="button"
        className="text-button bookmark-button"
        aria-label={label}
        title={label}
        aria-pressed={saved}
        disabled={!state.ready || busy}
        onClick={async () => {
          const created = await state.toggle(source);
          if (created && !created.chineseTranslation) void translation.load();
        }}
      >
        {busy ? (
          <span className="spinner" />
        ) : (
          <Icon
            name={error ? "refresh" : "bookmark"}
            size={15}
          />
        )}
      </button>
      {error && (
        <span
          className="favorite-error"
          role="status"
        >
          {error}
        </span>
      )}
      {saved && translation.busy && (
        <span
          className="copy-status"
          role="status"
        >
          已收藏，释义生成中…
        </span>
      )}
      {saved && translation.error && (
        <span
          className="favorite-error"
          role="status"
        >
          {translation.error}
          <button
            type="button"
            className="text-button"
            onClick={() => void translation.load()}
          >
            重试补译
          </button>
        </span>
      )}
    </span>
  );
}

/** 未提交消息没有稳定来源，只展示说明，不发收藏请求。 */
export function PendingFavoriteButton() {
  return (
    <span
      title="回复完成后可收藏"
      className="favorite-action"
      tabIndex={0}
      aria-label="回复完成后可收藏"
    >
      <button
        type="button"
        className="text-button bookmark-button"
        disabled
        aria-label="回复完成后可收藏"
      >
        <Icon
          name="bookmark"
          size={15}
        />
      </button>
    </span>
  );
}
