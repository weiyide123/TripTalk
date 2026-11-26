"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { CopyButton } from "@/components/CopyButton";
import { Icon } from "@/components/Icon";
import { favoriteSourceHref, type FavoriteView } from "@/contracts/favorite";
import {
  SentencePlaybackContext,
  SentencePlayButton,
  useSentencePlayback,
} from "../conversation/SentencePlayback";
import { useFavorites } from "./useFavorites";
import { FavoriteFilter } from "./FavoriteFilter";
import { useSentenceTranslation } from "./useSentenceTranslation";
import "./favorites.css";

/** 收藏以中文检索、英文使用为主；复用已有复制与单通道朗读，不调用模型。 */
export function Favorites() {
  const state = useFavorites();
  const playback = useSentencePlayback(
    `${state.sceneId}:${state.topicId}:${state.data?.items.map((item) => item.id).join(",")}`,
    false,
  );
  const filters = state.filters;
  const scenes = [
    ...new Map(
      filters.map((item) => [item.sceneId, item.sceneTitle]),
    ).entries(),
  ];
  const topics = filters.filter((item) => item.sceneId === state.sceneId);
  const sceneOptions = [
    {
      value: "",
      label: "全部场景",
    },
    ...scenes.map(([value, label]) => ({
      value,
      label,
    })),
  ];
  const topicOptions = [
    {
      value: "",
      label: state.sceneId ? "全部主题" : "先选择场景",
    },
    ...topics.map((item) => ({
      value: item.topicId,
      label: item.topicTitle,
    })),
  ];
  if (state.sceneId && !scenes.some(([id]) => id === state.sceneId)) {
    sceneOptions.push({
      value: state.sceneId,
      label: "当前场景",
    });
  }
  if (state.topicId && !topics.some((item) => item.topicId === state.topicId)) {
    topicOptions.push({
      value: state.topicId,
      label: "当前主题",
    });
  }
  return (
    <SentencePlaybackContext.Provider value={playback}>
      <AppShell activePage="favorites">
        <main className="favorites-content">
          <header className="favorites-heading">
            <h1>收藏表达</h1>
            <span>{state.data ? `${state.data.total} 句` : ""}</span>
          </header>
          <div className="favorites-filters">
            <FavoriteFilter
              label="场景"
              value={state.sceneId}
              options={sceneOptions}
              disabled={sceneOptions.length <= 1}
              onChange={state.selectScene}
            />
            <FavoriteFilter
              label="主题"
              value={state.topicId}
              options={topicOptions}
              disabled={!state.sceneId || topicOptions.length <= 1}
              onChange={state.setTopicId}
            />
          </div>
          {state.error && (
            <p
              className="favorite-page-notice"
              role="alert"
            >
              {state.error}
              <button
                className="text-button"
                disabled={state.busy}
                onClick={() => void state.load()}
              >
                重新加载
              </button>
            </p>
          )}
          {state.busy && (
            <p
              className="favorite-page-notice"
              role="status"
            >
              正在读取收藏…
            </p>
          )}
          {state.data?.items.map((item) => (
            <FavoriteCard
              key={item.id}
              item={item}
              removing={state.removing.includes(item.id)}
              error={state.removeErrors[item.id]}
              onRemove={() => {
                playback.stop();
                void state.remove(item.id);
              }}
            />
          ))}
          {state.data && !state.data.items.length && !state.busy && (
            <div className="favorites-empty">
              {/* <Icon
                name="bookmark"
                size={28}
              /> */}
              <h2>
                {state.sceneId
                  ? "这个筛选下还没有收藏"
                  : "把用得上的表达，留在这里"}
              </h2>
              <p>练习时点击 Jane 句子旁的收藏图标，之后随时查看和朗读。</p>
              <Link
                className="button soft"
                href="/"
              >
                去场景学习
                <Icon
                  name="arrow"
                  size={16}
                />
              </Link>
            </div>
          )}
          {state.data && state.data.items.length < state.data.total && (
            <button
              className="button soft favorites-more"
              disabled={state.busy}
              onClick={() => void state.load(state.data!.items.length)}
            >
              加载更多
            </button>
          )}
        </main>
      </AppShell>
    </SentencePlaybackContext.Provider>
  );
}

function FavoriteCard({
  item,
  removing,
  error,
  onRemove,
}: {
  item: FavoriteView;
  removing: boolean;
  error?: string;
  onRemove: () => void;
}) {
  const href = favoriteSourceHref(item);
  const translation = useSentenceTranslation(
    item.sourceTurnId
      ? {
          sourceTurnId: item.sourceTurnId,
          sourcePart: item.sourcePart,
        }
      : undefined,
  );
  const chinese = item.chineseTranslation || translation.text;
  return (
    <article className="favorite-card">
      <h2
        className={
          chinese
            ? "favorite-chinese"
            : "favorite-chinese favorite-untranslated"
        }
      >
        {chinese || "暂无中文释义"}
      </h2>
      <span className="favorite-origin">
        {item.sceneTitle} · {item.topicTitle}
      </span>
      <p
        className="favorite-english"
        lang="en"
      >
        {item.english}
      </p>
      <div className="favorite-tools">
        <SentencePlayButton text={item.english} />
        <CopyButton
          text={item.english}
          label="复制英文"
        />
        {href ? (
          <Link
            className="text-button favorite-source-link"
            href={href}
            aria-label="查看原对话"
            title="查看原对话"
          >
            <Icon
              name="link"
              size={17}
            />
          </Link>
        ) : (
          <button
            className="text-button favorite-source-link"
            disabled
            aria-label="原对话已不存在"
            title="原对话已不存在"
          >
            <Icon
              name="link"
              size={17}
            />
          </button>
        )}
        <button
          className="text-button bookmark-button"
          aria-label={error ? "重试取消收藏" : "取消收藏"}
          title="取消收藏"
          aria-pressed="true"
          disabled={removing}
          onClick={onRemove}
        >
          {removing ? (
            <span className="spinner" />
          ) : (
            <Icon
              name={error ? "refresh" : "bookmark"}
              size={17}
            />
          )}
        </button>
      </div>
      {item.explanation && (
        <details className="favorite-explanation">
          <summary>学习说明</summary>
          <p>{item.explanation}</p>
        </details>
      )}
      {!chinese && item.sourceTurnId && (
        <div className="favorite-translation-status">
          <button
            className="text-button"
            disabled={translation.busy}
            onClick={() => void translation.load()}
          >
            {translation.busy ? "释义生成中…" : "生成中文释义"}
          </button>
          {translation.error && <span role="status">{translation.error}</span>}
        </div>
      )}
      {error && (
        <p
          className="favorite-error"
          role="status"
        >
          {error}
        </p>
      )}
    </article>
  );
}
