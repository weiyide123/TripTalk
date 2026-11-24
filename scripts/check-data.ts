// 离线服务回归：替换 SDK 返回值，验证真实 SQLite 提交链，不调用收费模型。
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Runner } from "@openai/agents";
import { zodTextFormat } from "openai/helpers/zod";
import { generatedPlanSchema } from "../src/contracts/dialogue-plan";
import {
  evaluationSchema,
  generatedEvaluationSchema,
  type Evaluation,
} from "../src/contracts/jane-turn";
import {
  trainingSessionSchema,
  type TrainingSession,
} from "../src/contracts/training-session";
import { type TurnRequest } from "../src/contracts/requests";
import { submitTurn } from "../src/server/services/turn";
import { createSession } from "../src/server/services/create-session";
import { initializeScene } from "../src/server/services/scene-plan";
import {
  homeView,
  getSessionView,
  sessionView,
} from "../src/server/services/views";
import {
  recordEvaluation,
  applyContinue,
} from "../src/server/services/lesson-state";
import {
  assistanceFor,
  confirmedFacts,
  currentQuestion,
} from "../src/server/services/session-selectors";
import { teachingContext } from "../src/server/agents/context";
import { sqliteFixture } from "./helpers/sqlite-fixture";
import { serviceFixture } from "./helpers/service-fixture";
import { checkTurnErrors } from "./helpers/check-turn-errors";

function request(
  session: TrainingSession,
  action: TurnRequest["action"] = "answer",
): TurnRequest {
  return {
    requestId: randomUUID(),
    expectedRevision: session.revision,
    action,
    text: action === "answer" ? "I would like to stay three nights." : "",
  };
}

function evaluation(
  nextId: string | null,
  patch: Partial<Evaluation> = {},
): Evaluation {
  return {
    learnerIntent: "answer",
    verdict: "correct",
    canContinue: true,
    correctedAnswer: null,
    explanation: null,
    errorTypes: [],
    roleplayLine: "Thank you.",
    roleplayTranslation: "谢谢你。",
    tutorFeedback: "表达清楚了。",
    hint: null,
    continuation: {
      nextQuestionId: nextId,
      english: nextId ? "Actual " + nextId + "?" : null,
      chineseTranslation: nextId ? "实际问题？" : null,
      chineseTask: nextId ? "回答实际问题" : null,
      closingMessage: nextId ? null : "练习完成，出发吧！",
    },
    coveredEarly: [],
    factChanges: [],
    ...patch,
  };
}

function checkStateRules(fresh: TrainingSession) {
  const apply = (value: Evaluation, input = request(fresh)) => {
    const candidate = structuredClone(fresh);
    recordEvaluation(candidate, input, value, fresh.planningCall);
    return trainingSessionSchema.parse(candidate);
  };
  assert.equal(zodTextFormat(generatedPlanSchema, "plan").type, "json_schema");
  assert.equal(
    zodTextFormat(generatedEvaluationSchema, "evaluation").type,
    "json_schema",
  );
  // 新模型返回必须带释义；旧事件不伪造翻译，仍能正常读取。
  assert.equal(
    generatedEvaluationSchema.safeParse(evaluation("q2")).success,
    true,
  );
  assert.equal(
    evaluationSchema.safeParse(
      evaluation("q2", { roleplayTranslation: undefined }),
    ).success,
    true,
  );
  for (const roleplayTranslation of [undefined, null, "", "   "]) {
    assert.equal(
      generatedEvaluationSchema.safeParse({
        ...evaluation("q2"),
        roleplayTranslation,
      }).success,
      false,
    );
  }
  for (const value of [
    evaluation("q1"),
    evaluation("missing"),
    evaluation(null),
    evaluation("q2", { errorTypes: ["meaning"] }),
    evaluation("q2", { learnerIntent: "hint" }),
    evaluation("q2", { continuation: null }),
    evaluation("q2", {
      coveredEarly: [{ questionId: "q3", evidence: "not in input" }],
    }),
    evaluation("q2", {
      factChanges: [{ key: "unknown", value: "3", evidence: "three" }],
    }),
  ])
    assert.throws(() => apply(value));
  const advanced = apply(
    evaluation("q2", {
      coveredEarly: [{ questionId: "q3", evidence: "three" }],
      factChanges: [{ key: "nights", value: "3", evidence: "three" }],
    }),
  );
  assert.equal(advanced.revision, 1);
  assert.equal(advanced.turns.length, 3);
  assert.equal(advanced.currentQuestionId, "q2");
  assert.equal(currentQuestion(advanced)?.chineseTranslation, "实际问题？");
  assert.equal(advanced.planSnapshot.facts[0].value, "2");
  assert.equal(confirmedFacts(advanced)[0].value, "3");
  assert.equal(sessionView(advanced, []).completedCount, 2);
  const context = teachingContext(advanced, request(advanced));
  assert.equal(context.recentHistory[0].question?.id, "q1");
  assert.equal(
    context.remainingQuestions.some((q) => q.id === "q3"),
    false,
  );
  assert.equal(
    JSON.stringify(sessionView(advanced, [])).includes("referenceAnswer"),
    false,
  );

  for (const state of ["awaiting_continue", "topic_completed"] as const) {
    const imported = sqliteFixture(state).sessions[0];
    if (state === "awaiting_continue") {
      const revision = imported.revision;
      applyContinue(imported, request(imported, "continue"));
      assert.equal(imported.revision, revision + 1);
      assert.equal(imported.turns.at(-1)?.action, "question");
      trainingSessionSchema.parse(imported);
    } else {
      assert.equal(getCompletedMessage(imported), "练习完成，出发吧！");
      assert.throws(() =>
        applyContinue(imported, request(imported, "continue")),
      );
    }
  }
}

function getCompletedMessage(session: TrainingSession) {
  return sessionView(session, []).closingMessage;
}

async function main() {
  const environment = {
    DATA_DIR: process.env.DATA_DIR,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
  };
  const originalRun = Runner.prototype.run;
  const originalFetch = globalThis.fetch;
  const { directory, store, session, plan } = await serviceFixture();
  let output: unknown;
  let calls = 0;
  try {
    process.env.DATA_DIR = directory;
    process.env.OPENAI_API_KEY = "offline-only";
    process.env.OPENAI_MODEL = "offline-model";
    globalThis.fetch = async () => {
      throw new Error("Network forbidden in offline checks");
    };
    Runner.prototype.run = (async () => {
      calls += 1;
      return {
        finalOutput: output,
        state: { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      };
    }) as unknown as typeof originalRun;
    checkStateRules(session);
    assert.equal(homeView().scene.id, "hotel");
    assert.equal(homeView().activeSession?.id, session.id);
    assert.equal(JSON.stringify(homeView()).includes("turns"), false);
    store.profile.updatePreferences({
      lastSceneId: "airport",
      difficulty: "advanced",
    });
    assert.equal(homeView().scene.id, "airport");
    assert.equal(homeView().initialized, false);
    assert.equal(homeView("hotel").activeSession?.id, session.id);
    assert.equal(store.profile.read().lastSceneId, "airport");

    // 初始化目录重试、创建会话重试均不再次生成；新场景真实经过服务编排。
    const init = { requestId: randomUUID(), sceneId: "airport" };
    output = { topics: plan.topics.map(({ id: _, ...topic }) => topic) };
    await initializeScene(init);
    await initializeScene(init);
    assert.equal(calls, 1);
    const topic = store.catalog.readPlan("airport")!.topics[0];
    const create = {
      requestId: randomUUID(),
      sceneId: "airport",
      topicId: topic.id,
    };
    output = {
      ...session.planSnapshot,
      topicId: topic.id,
      questions: session.planSnapshot.questions.map(
        ({ id: _, ...question }) => question,
      ),
    };
    const started = await createSession(create);
    const again = await createSession(create);
    assert.equal(calls, 2);
    assert.equal(again.session.id, started.session.id);
    assert.equal(started.session.turns[0].action, "question");
    assert.equal(started.session.difficulty, "advanced");

    // 提示只增加教学事件，不推进；分级能从数据库恢复。
    let current = store.sessions.get(session.id);
    for (const level of ["keywords", "pattern", "example"] as const) {
      output = evaluation(null, {
        learnerIntent: "hint",
        verdict: "not_applicable",
        canContinue: false,
        continuation: null,
        hint: { level, text: "提示内容" },
      });
      await submitTurn(session.id, request(current, "hint"));
      current = store.sessions.get(session.id);
      assert.equal(current.currentQuestionId, "q1");
    }
    assert.equal(assistanceFor(current, "q1").hints, 3);

    // 回答 + 实际下一问原子提交；同请求重试不会重复生成或推进。
    output = evaluation("q2");
    const input = request(current);
    const result = await submitTurn(session.id, input);
    const callCount = calls;
    const duplicate = await submitTurn(session.id, input);
    assert.deepEqual(duplicate, result);
    assert.equal(calls, callCount);
    assert.equal(result.session.revision, current.revision + 1);
    assert.deepEqual(
      result.session.turns.slice(-2).map((turn) => turn.action),
      ["answer", "question"],
    );
    assert.ok(result.session.processedRequestIds.includes(input.requestId));
    const savedAnswer = getSessionView(session.id).turns.at(-2)!;
    assert.ok(savedAnswer.action === "answer");
    assert.equal(savedAnswer.evaluation.roleplayTranslation, "谢谢你。");
    await assert.rejects(
      submitTurn(session.id, { ...input, text: "different" }),
      { code: "REQUEST_ID_CONFLICT" },
    );
    await assert.rejects(
      submitTurn(session.id, { ...input, requestId: randomUUID() }),
      { code: "STALE_REVISION" },
    );

    for (let index = 2; index <= 8; index++) {
      current = store.sessions.get(session.id);
      output = evaluation(index < 8 ? "q" + (index + 1) : null);
      await submitTurn(session.id, request(current));
    }
    const completed = getSessionView(session.id);
    assert.equal(completed.status, "topic_completed");
    assert.equal(completed.completedCount, 8);
    assert.equal(completed.turns.at(-1)?.action, "completed");
    assert.equal(completed.closingMessage, "练习完成，出发吧！");
    assert.equal(homeView("hotel").nextTopic?.id, plan.topics[1].id);
    assert.deepEqual(homeView("hotel").completedTopicIds, [plan.topics[0].id]);
    assert.equal(homeView("airport").completedTopicIds.length, 0);
    assert.equal(
      (await submitTurn(session.id, input)).session.status,
      "topic_completed",
    );
    console.log("SQLite service checks passed:", directory);
  } finally {
    Runner.prototype.run = originalRun;
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  await checkTurnErrors();
  console.log(
    "Input guidance, network/model errors and privacy checks passed.",
  );
}

await main();
