import { useEffect, useRef, useState } from "react";
import type { CatalogScene } from "@/contracts/scene";
import { customSceneTitle } from "@/contracts/scene";
import { DIFFICULTIES, type Difficulty } from "@/contracts/difficulty";
import { Icon } from "@/components/Icon";
import { SceneArt } from "@/components/SceneArt";
import type { useCustomScene } from "./useCustomScene";

type Props = {
  view: "create" | "catalog" | null;
  onView: (view: "create" | "catalog" | null) => void;
  scenes: CatalogScene[];
  selectedSceneId: string;
  difficulty: Difficulty;
  disabled: boolean;
  creation: ReturnType<typeof useCustomScene>;
  onSelect: (sceneId: string) => Promise<boolean>;
};
const EXAMPLES = [
  {
    title: "咖啡店点单",
    text: "咖啡店点单。我想点一杯燕麦拿铁，询问是否含糖，并选择外带。",
  },
  {
    title: "购买演出票",
    text: "购买演出票。我想购买两张音乐剧门票，询问座位、票价和开场时间。",
  },
  {
    title: "租车取车",
    text: "租车取车。我想在机场租车柜台取车，确认保险、押金和还车时间。",
  },
];

/** A 版居中弹窗：原生模态隔离背景，创建与目录在同一弹窗内切换。 */
export function SceneDialog(props: Props) {
  const { view, onView, creation, disabled } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectionError, setSelectionError] = useState("");
  const [selecting, setSelecting] = useState(false);
  const selectionLock = useRef(false);
  const open = view !== null;
  const busy = disabled || creation.busy || selecting;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const opener = document.activeElement;
    const previous = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previous;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);
  useEffect(() => {
    setSelectionError("");
    if (open)
      dialogRef.current
        ?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
          "input, textarea",
        )
        ?.focus();
  }, [view, open]);

  /** 切换失败留在目录，用户可以原地重试；只在保存偏好成功后关闭。 */
  async function select(sceneId: string) {
    if (busy || selectionLock.current) return;
    selectionLock.current = true;
    setSelecting(true);
    setSelectionError("");
    try {
      if (await props.onSelect(sceneId)) onView(null);
      else setSelectionError("没有切换成功，请重试。原来的学习进度不会丢失。");
    } finally {
      selectionLock.current = false;
      setSelecting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="scene-dialog"
      aria-labelledby="scene-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onView(null);
      }}
    >
      <header className="scene-dialog-header">
        <h2 id="scene-dialog-title">
          {view === "create" ? "你想在哪种场合用英语？" : "全部场景"}
        </h2>
        <button
          className="scene-dialog-close"
          aria-label="关闭场景弹窗"
          disabled={busy}
          onClick={() => onView(null)}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="scene-dialog-body">
        {view === "create" && (
          <CreateSceneForm
            {...props}
            busy={busy}
          />
        )}
        {view === "catalog" && (
          <SceneCatalog
            {...props}
            busy={busy}
            onChoose={(id) => void select(id)}
          />
        )}
        {selectionError && (
          <p
            className="scene-dialog-error"
            role="alert"
          >
            {selectionError}
          </p>
        )}
      </div>
    </dialog>
  );
}

/** 描述首句即时预览为名称；只提交完整描述，服务端独立校验并生成同一标题。 */
function CreateSceneForm({
  creation,
  difficulty,
  busy,
  onView,
}: Props & { busy: boolean }) {
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (!busy && (await creation.create())) onView(null);
      }}
    >
      <p className="scene-dialog-intro">
        告诉 Jane 你的计划，一起练习真正用得上的对话。
      </p>
      <label htmlFor="custom-scene-description">描述你的场景</label>
      <textarea
        id="custom-scene-description"
        required
        minLength={5}
        maxLength={500}
        readOnly={busy || !!creation.pending}
        value={creation.description}
        onChange={(event) => creation.setDescription(event.target.value)}
        placeholder="例如：咖啡店点单。我想点一杯燕麦拿铁，询问是否含糖，并选择外带。"
      />
      {creation.description.trim() && (
        <p className="custom-title-preview">
          场景名称：{customSceneTitle(creation.description)}
        </p>
      )}
      <div className="scene-examples">
        <span>试试这些</span>
        {EXAMPLES.map((example) => (
          <button
            type="button"
            key={example.title}
            disabled={busy || !!creation.pending}
            onClick={() => creation.setDescription(example.text)}
          >
            {example.title}
          </button>
        ))}
      </div>
      {creation.error && (
        <p
          className="scene-dialog-error"
          role="alert"
        >
          {creation.error}
        </p>
      )}
      {creation.pending && (
        <p className="scene-dialog-hint">
          暂时保留原描述，重试确认结果后才能创建其他场景。
        </p>
      )}
      {creation.storageWarning && (
        <p
          className="scene-dialog-error"
          role="status"
        >
          浏览器无法暂存，请先完成创建，暂勿刷新或关闭页面。
        </p>
      )}
      <footer className="scene-create-footer">
        <p>
          沿用学习难度：{DIFFICULTIES[difficulty].label}
          <br />
          创建后加入探索列表，不切换当前场景。
        </p>
        <button
          type="submit"
          className="button primary"
          disabled={busy}
        >
          {busy && <span className="spinner" />}
          {creation.pending ? "重试创建" : "创建场景"}
          <Icon
            name="arrow"
            size={16}
          />
        </button>
      </footer>
    </form>
  );
}

/** 全部目录仅本地筛选；选择仍复用首页的偏好保存与导航流程。 */
function SceneCatalog({
  scenes,
  selectedSceneId,
  busy,
  onView,
  onChoose,
}: Props & { busy: boolean; onChoose: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const visible = scenes.filter(
    (scene) =>
      (filter === "all" || scene.origin === filter) &&
      scene.title
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <div className="scene-catalog-tools">
        <input
          type="search"
          aria-label="搜索场景名称"
          placeholder="搜索场景名称"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          className="text-button"
          disabled={busy}
          onClick={() => onView("create")}
        >
          ＋ 自定义
        </button>
      </div>
      <div
        className="scene-filters"
        aria-label="场景来源筛选"
      >
        {[
          ["all", "全部"],
          ["builtin", "内置"],
          ["custom", "我的场景"],
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="scene-catalog-grid">
        {visible.map((scene) => (
          <button
            key={scene.id}
            disabled={busy}
            onClick={() => onChoose(scene.id)}
            aria-label={`选择${scene.title}`}
          >
            <span className="catalog-art">
              <SceneArt scene={scene.art} />
            </span>
            <span className="catalog-copy">
              <strong>{scene.title}</strong>
              <small>
                {scene.origin === "custom" ? "我的场景" : "内置场景"}
              </small>
            </span>
            {scene.id === selectedSceneId && (
              <span className="catalog-current">当前学习</span>
            )}
          </button>
        ))}
      </div>
      {!visible.length && (
        <p
          className="scene-empty"
          role="status"
        >
          没有找到这个场景，试试其他名称，或创建自己的场景。
        </p>
      )}
    </>
  );
}
