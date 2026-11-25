"use client";

import type { SceneId } from "@/contracts/scene";
import type { HomeView } from "@/contracts/views";
import { AppShell } from "@/components/AppShell";
import { useHome } from "./useHome";
import { DifficultyPicker } from "./DifficultyPicker";
import { SceneLearningCard } from "./SceneLearningCard";
import { SceneExplorer } from "./SceneExplorer";
import { HomeNotices } from "./HomeNotices";
import { CoursePlanDialog } from "./CoursePlanDialog";

export function Home({ sceneId }: { sceneId: SceneId }) {
  const state = useHome(sceneId);
  const { home, busy, pending, failedDifficulty } = state;
  const greeting = homeGreeting(home);
  const disabled = Boolean(busy) || Boolean(failedDifficulty);
  const start = () => void state.start(home?.sceneCompleted);
  const notices = (
    <HomeNotices
      error={state.error}
      busy={Boolean(busy)}
      pending={Boolean(pending)}
      failedDifficulty={Boolean(failedDifficulty)}
      onSync={state.load}
      onRetryDifficulty={state.retryDifficulty}
      onRetryCreate={start}
      onDiscardPending={state.discardPending}
    />
  );

  return (
    <AppShell
      {...greeting}
      busy={Boolean(busy)}
    >
      <main className="home-content">
        <div className="section-heading home-heading">
          <h2>
            <span>把想去的远方，</span>
            <span>聊成下一站。</span>
          </h2>
        </div>
        {home && (
          <>
            <DifficultyPicker
              difficulty={home.difficulty}
              activeDifficulty={home.activeSession?.difficulty}
              disabled={Boolean(busy) || Boolean(pending)}
              onChange={state.changeDifficulty}
            />
            <SceneLearningCard
              home={home}
              busy={busy}
              disabled={disabled}
              startLabel={state.startLabel}
              onStart={start}
              onOpenPlan={state.openCoursePlan}
            />
          </>
        )}
        {!home && busy && (
          <div
            className="loading-card"
            role="status"
          >
            <span className="spinner" />
            正在读取你的学习记录…
          </div>
        )}
        {!state.coursePlanOpen && notices}
        {home && (
          <SceneExplorer
            scenes={home.scenes}
            selectedSceneId={sceneId}
            difficulty={home.difficulty}
            disabled={Boolean(busy)}
            onSelect={state.changeScene}
            onCreated={state.addCreatedScene}
          />
        )}
      </main>
      {home?.initialized && (
        <CoursePlanDialog
          home={home}
          open={state.coursePlanOpen}
          busy={Boolean(busy)}
          disabled={disabled}
          startLabel={state.startLabel}
          difficulty={
            pending?.difficulty ??
            home.activeSession?.difficulty ??
            home.difficulty
          }
          onClose={state.closeCoursePlan}
          onStart={start}
        >
          {notices}
        </CoursePlanDialog>
      )}
    </AppShell>
  );
}

function homeGreeting(home: HomeView | null) {
  if (home?.activeSession) {
    return {
      title: "Welcome back!",
      subtitle: `你的${home.activeSession.topicTitle}练习还在这里，我们接着聊吧。`,
    };
  }
  if (home?.sceneCompleted) {
    return {
      title: "Nice work, traveler!",
      subtitle: "这个场景的主题都练过啦，去下一站看看吧。",
    };
  }
  return {
    title: home?.onboardingCompleted ? "Hello again!" : "Hello，我是 Jane！",
    subtitle: "很高兴认识你，让我们一起开始旅行英语学习吧。",
  };
}
