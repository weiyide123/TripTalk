import type { Scene, CatalogScene } from "./scene";
import type { Difficulty } from "./difficulty";
import type { VisibleQuestion } from "./dialogue-plan";
import type { Feedback } from "./teaching";
import type { TrainingSession } from "./training-session";

// Explicit public DTOs: no hashes, plans, internal answers or model diagnostics.
export type TeachingTurnView = {
  id: string;
  questionId: string;
  action: "answer" | "hint" | "explain";
  text: string;
  evaluation: Feedback;
};
export type QuestionTurnView = {
  id: string;
  action: "question";
  question: VisibleQuestion;
};
export type CompletedTurnView = {
  id: string;
  action: "completed";
  closingMessage: string;
};
export type SessionView = {
  id: string;
  sceneId: string;
  sceneTitle: string;
  topicTitle: string;
  scenario: string;
  difficulty: Difficulty;
  revision: number;
  status: TrainingSession["status"];
  currentQuestion: VisibleQuestion | null;
  turns: Array<TeachingTurnView | QuestionTurnView | CompletedTurnView>;
  completedCount: number;
  totalCount: number;
  currentNumber: number;
  nextIsClosing: boolean;
  closingMessage: string | null;
  processedRequestIds: string[];
};
export type SessionSummary = {
  id: string;
  topicId: string;
  topicTitle: string;
  difficulty: Difficulty;
  currentGoal: string | null;
  completedCount: number;
  totalCount: number;
};
export type HomeView = {
  onboardingCompleted: boolean;
  scene: Scene;
  scenes: CatalogScene[];
  difficulty: Difficulty;
  initialized: boolean;
  sceneCompleted: boolean;
  topics: {
    id: string;
    title: string;
    description: string;
    sessionId: string | null;
  }[];
  nextTopic: {
    id: string;
    title: string;
  } | null;
  activeSession: SessionSummary | null;
  latestCompletedSession: SessionSummary | null;
  completedTopicIds: string[];
};
export type Receipt = {
  requestId: string;
  revision: number;
  turnId: string;
};
export type MutationResult = {
  session: SessionView;
  receipt: Receipt | null;
};
