import type { HomeView } from "@/contracts/views";
import { Icon } from "@/components/Icon";
import { SceneArt } from "@/components/SceneArt";
import type { HomeBusy } from "./useHome";

type Props = {
  home: HomeView;
  busy: HomeBusy;
  startLabel: string;
  disabled: boolean;
  onStart: () => void;
  onOpenPlan: () => void;
};

export function SceneLearningCard(props: Props) {
  const { home, busy } = props;
  // 卡片只组合展示区域；状态与开始/续学操作仍由 useHome 管理。
  return (
    <section
      className="featured-scene"
      aria-label={home.scene.title + "学习"}
      aria-busy={busy === "initialize"}
    >
      <div className="featured-art">
        <SceneArt scene={home.scene.art} />
      </div>
      <SceneSummary
        home={home}
        busy={Boolean(busy)}
        onOpenPlan={props.onOpenPlan}
      />
      <SceneStartAction {...props} />
    </section>
  );
}

function SceneSummary({
  home,
  busy,
  onOpenPlan,
}: Pick<Props, "home" | "onOpenPlan"> & { busy: boolean }) {
  const active = home.activeSession;
  return (
    <div className="featured-copy">
      <div className="scene-title-row">
        <h3>{home.scene.title}</h3>
        {home.initialized && (
          <button
            type="button"
            className="scene-plan-info"
            aria-label={`查看${home.scene.title}课程安排`}
            aria-haspopup="dialog"
            title="查看课程安排"
            disabled={busy}
            onClick={onOpenPlan}
          >
            <Icon
              name="info"
              size={14}
            />
          </button>
        )}
      </div>
      {(active || home.nextTopic) && (
        <div className="scene-current-topic">
          {active?.topicTitle ?? home.nextTopic?.title}
        </div>
      )}
      <p>{sceneDescription(home)}</p>
      <SceneProgress home={home} />
    </div>
  );
}

function SceneProgress({ home }: { home: HomeView }) {
  // 目录尚未生成时只留占位，不显示虚假的 0/N。
  if (!home.initialized) {
    return (
      <div
        className="scene-progress-placeholder"
        aria-hidden="true"
      />
    );
  }
  const completed = home.completedTopicIds.length;
  const total = home.topics.length;
  return (
    <div className="scene-progress">
      <span>
        场景进度 {completed} / {total} 个主题
      </span>
      <div className="progress-track">
        <div style={{ width: (completed / total) * 100 + "%" }} />
      </div>
    </div>
  );
}

function SceneStartAction({ busy, startLabel, disabled, onStart }: Props) {
  const preparing = busy === "initialize" || busy === "create";
  const statusText =
    busy === "initialize" ? "正在准备学习主题…" : "正在准备本主题的对话…";
  return (
    <div className="featured-actions">
      <button
        className="button primary"
        disabled={disabled}
        onClick={onStart}
      >
        {preparing ? (
          <>
            <span className="spinner" />
            Jane 正在准备
          </>
        ) : (
          <>
            {startLabel}
            <Icon
              name="arrow"
              size={18}
            />
          </>
        )}
      </button>
      {preparing && (
        <span
          className="tiny-note"
          role="status"
        >
          {statusText}
        </span>
      )}
    </div>
  );
}

function sceneDescription(home: HomeView) {
  if (home.activeSession) {
    return `上次练到「${home.activeSession.currentGoal ?? "确认反馈"}」`;
  }
  if (home.sceneCompleted) return "所有主题已完成，也可以主动再练一次。";
  if (home.initialized) return "主题准备好了，按自己的节奏开始吧。";
  return home.scene.description;
}
