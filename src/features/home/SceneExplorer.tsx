import { useState } from "react";
import type { CatalogScene, SceneId } from "@/contracts/scene";
import type { Difficulty } from "@/contracts/difficulty";
import { Icon } from "@/components/Icon";
import { SceneArt } from "@/components/SceneArt";
import { SceneDialog } from "./SceneDialog";
import { useCustomScene } from "./useCustomScene";
import "./scene-explorer.css";

type Props = {
  scenes: CatalogScene[];
  difficulty: Difficulty;
  selectedSceneId: SceneId;
  disabled: boolean;
  onSelect: (sceneId: SceneId) => Promise<boolean>;
  onCreated: (scene: CatalogScene) => void;
};

export function SceneExplorer({
  scenes,
  difficulty,
  selectedSceneId,
  disabled,
  onSelect,
  onCreated,
}: Props) {
  const [view, setView] = useState<"create" | "catalog" | null>(null);
  const creation = useCustomScene(onCreated);
  // 接口目录按 position 升序；只反转自定义部分，不改原数组或数据库排序。
  const orderedScenes = [
    ...scenes.filter((scene) => scene.origin === "custom").reverse(),
    ...scenes.filter((scene) => scene.origin === "builtin"),
  ];
  const otherScenes = orderedScenes.filter(
    (scene) => scene.id !== selectedSceneId,
  );
  const busy = disabled || creation.busy;
  return (
    <>
      <div className="section-heading explore-heading">
        <h2>探索其他场景</h2>
        {otherScenes.length > 3 && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setView("catalog")}
          >
            查看全部（{scenes.length}）
            <Icon
              name="arrow"
              size={14}
            />
          </button>
        )}
      </div>
      <div className="scene-grid scene-explorer-grid">
        {otherScenes.slice(0, 3).map((scene) => (
          <button
            className="small-scene scene-choice"
            key={scene.id}
            disabled={busy}
            onClick={() => onSelect(scene.id)}
          >
            <div className="small-art">
              <SceneArt scene={scene.art} />
            </div>
            <div className="scene-choice-copy">
              <span className="scene-en">{scene.englishTitle}</span>
              <h3>{scene.title}</h3>
              <p>
                进入场景{" "}
                <Icon
                  name="arrow"
                  size={12}
                />
              </p>
            </div>
          </button>
        ))}
        <button
          className="custom-scene-entry"
          disabled={busy}
          onClick={() => setView("create")}
        >
          <span
            className="custom-scene-plus"
            aria-hidden="true"
          >
            ＋
          </span>
          <strong>{creation.pending ? "继续创建场景" : "自定义场景"}</strong>
          <span>练习你的下一站</span>
        </button>
      </div>
      <SceneDialog
        view={view}
        onView={setView}
        scenes={orderedScenes}
        selectedSceneId={selectedSceneId}
        difficulty={difficulty}
        disabled={disabled}
        creation={creation}
        onSelect={onSelect}
      />
    </>
  );
}
