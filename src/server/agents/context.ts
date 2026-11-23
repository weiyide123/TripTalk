import type { TrainingSession } from "@/contracts/training-session";
import type { TurnRequest } from "@/contracts/requests";
import { DIFFICULTIES } from "@/contracts/difficulty";
import {
  assistanceFor,
  confirmedFacts,
  currentQuestion,
  factChanges,
  isTeachingTurn,
  resolvedQuestionIds,
  questionFor,
} from "../services/session-selectors";

export function teachingContext(session: TrainingSession, input: TurnRequest) {
  const difficulty = session.configSnapshot.lesson.difficulty;
  const help = assistanceFor(session, session.currentQuestionId);
  const resolved = resolvedQuestionIds(session);
  const teaching = session.turns.filter(isTeachingTurn);
  return {
    scene: session.configSnapshot.lesson,
    difficulty: {
      id: difficulty,
      ...DIFFICULTIES[difficulty],
    },
    topic: session.configSnapshot.topic,
    plan: session.planSnapshot,
    facts: confirmedFacts(session),
    factEvents: factChanges(session),
    currentQuestion: currentQuestion(session),
    remainingQuestions: session.planSnapshot.questions.filter(
      (q) => q.id !== session.currentQuestionId && !resolved.has(q.id),
    ),
    requestedHintLevel: ["keywords", "pattern", "example"][
      Math.min(help.hints, 2)
    ],
    recentHistory: teaching.slice(-6).map((t) => ({
      question: questionFor(session, t.questionId),
      action: t.action,
      learnerText: t.payload.text,
      feedback: t.payload.feedback.tutorFeedback,
      verdict: t.payload.feedback.verdict,
    })),
    summary: {
      resolved: resolved.size,
      errors: teaching.filter(
        (t) => t.payload.feedback.verdict === "needs_correction",
      ).length,
      helpRequests: teaching.filter((t) =>
        ["hint", "explain"].includes(t.payload.feedback.learnerIntent),
      ).length,
    },
    action: input.action,
    text: input.text,
  };
}
