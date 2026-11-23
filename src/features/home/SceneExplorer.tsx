import type { Scene, SceneId } from "@/contracts/scene";
import { Icon } from "@/components/Icon";
import { SceneArt } from "@/components/SceneArt";

type Props = {
  scenes: Scene[];
  selectedSceneId: SceneId;
  disabled: boolean;
  onSelect: (sceneId: SceneId) => void;
};

export function SceneExplorer({
  scenes,
  selectedSceneId,
  disabled,
  onSelect,
}: Props) {
  return (
    <>
      <div className="section-heading explore-heading">
        <h2>探索其他场景</h2>
      </div>
      <div className="scene-grid">
        {scenes
          .filter((s) => s.id !== selectedSceneId)
          .map((scene) => (
            <button
              className="small-scene scene-choice"
              key={scene.id}
              disabled={disabled}
              onClick={() => onSelect(scene.id)}
            >
              <div className="small-art">
                <SceneArt scene={scene.art} />
              </div>
              <div>
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
      </div>
    </>
  );
}
