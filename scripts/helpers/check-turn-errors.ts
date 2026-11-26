import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Runner, ModelBehaviorError, ModelRefusalError } from "@openai/agents";
import type { Evaluation } from "../../src/contracts/jane-turn";
import { submitTurn } from "../../src/server/services/turn";
import { AppError, publicError } from "../../src/server/errors";
import { logRequestFailure } from "../../src/server/logging";
import { serviceFixture } from "./service-fixture";
import { currentQuestion } from "../../src/server/services/session-selectors";

// 复用现有离线检查：SDK 返回值被替换，任何真实网络请求立即失败。
export async function checkTurnErrors() {
  const { directory, store, session } = await serviceFixture();
  const environment = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    DATA_DIR: process.env.DATA_DIR,
  };
  const run = Runner.prototype.run;
  const fetch = globalThis.fetch;
  const info = console.info;
  const logs: string[] = [];
  let output = evaluation();
  let failure: unknown;
  try {
    process.env.OPENAI_API_KEY = "offline-only-not-a-real-key";
    process.env.OPENAI_MODEL = "offline-model";
    process.env.DATA_DIR = directory;
    globalThis.fetch = async () => {
      throw new Error("Offline check must not call the network");
    };
    console.info = (message) => logs.push(String(message));
    Runner.prototype.run = (async () => {
      if (failure) throw failure;
      return {
        finalOutput: output,
        state: { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      };
    }) as unknown as typeof run;
    let revision = session.revision;
    const input = (text: string) => ({
      requestId: randomUUID(),
      expectedRevision: revision,
      action: "answer" as const,
      text,
    });

    // 模型将无意义数字判为含义错，也应变成正常引导，不记错、不推进。
    for (const text of ["11", "你好", "???"]) {
      const result = await submitTurn(session.id, input(text));
      revision = result.session.revision;
      assert.equal(result.session.completedCount, 0);
      assert.equal(result.session.currentQuestion?.id, "q1");
      const turn = result.session.turns.at(-1)!;
      assert.ok(turn.action === "answer");
      assert.equal(turn.evaluation.verdict, "uncertain");
      assert.deepEqual(turn.evaluation.errorTypes, []);
      assert.equal(turn.evaluation.correctedAnswer, null);
      assert.equal(turn.evaluation.roleplayTranslation, "你能再试一次吗？");
      assert.match(turn.evaluation.tutorFeedback, /我还没理解你的意思/);
      assert.ok(
        turn.evaluation.tutorFeedback.includes(
          currentQuestion(session)!.chineseTask,
        ),
      );
    }
    assert.equal(logs.length, 3);
    assert.equal(JSON.parse(logs[0]).event, "learner_input_guidance");
    output = evaluation({
      learnerIntent: "off_topic",
      verdict: "not_applicable",
      errorTypes: [],
    });
    const offTopic = await submitTurn(
      session.id,
      input("Tell me about football"),
    );
    revision = offTopic.session.revision;
    assert.equal(offTopic.session.completedCount, 0);

    // 错误英文仍正常纠正，不因本次友好引导而吞掉真实语言错误。
    output = evaluation();
    const correction = await submitTurn(
      session.id,
      input("Wrong but understandable answer"),
    );
    revision = correction.session.revision;
    const corrected = correction.session.turns.at(-1)!;
    assert.ok(corrected.action === "answer");
    assert.equal(corrected.evaluation.verdict, "needs_correction");

    const before = store.sessions.readWithReceipts(session.id);
    output = evaluation({ roleplayTranslation: undefined });
    await assert.rejects(submitTurn(session.id, input("test")), {
      code: "AGENT_OUTPUT_INVALID",
    });
    assert.deepEqual(store.sessions.readWithReceipts(session.id), before);
    for (const [error, code] of [
      [{ name: "APIConnectionTimeoutError" }, "NETWORK_TIMEOUT"],
      [{ cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }, "NETWORK_TIMEOUT"],
      [{ cause: { code: "ECONNRESET" } }, "NETWORK_CONNECTION_FAILED"],
      [{ status: 401 }, "API_AUTH_FAILED"],
      [{ status: 429, code: "insufficient_quota" }, "API_QUOTA_EXHAUSTED"],
      [{ status: 429 }, "API_RATE_LIMITED"],
      [{ status: 503 }, "AI_SERVICE_UNAVAILABLE"],
      [new ModelBehaviorError("private model output"), "AGENT_OUTPUT_INVALID"],
      [new ModelRefusalError("private refusal"), "AGENT_REFUSED"],
      [new TypeError("private learner input"), "INTERNAL_ERROR"],
    ] as const) {
      failure = error;
      await assert.rejects(submitTurn(session.id, input("test")), (error) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, code);
        assert.equal(error.details.submission, "not_committed");
        assert.equal(error.message.includes("private"), false);
        return true;
      });
      assert.deepEqual(store.sessions.readWithReceipts(session.id), before);
    }
    failure = undefined;
    output = evaluation({
      canContinue: true,
      verdict: "correct",
      errorTypes: [],
    });
    await assert.rejects(submitTurn(session.id, input("test")), (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.details.reason, "CONTINUATION_MISSING");
      return true;
    });
    assert.deepEqual(store.sessions.readWithReceipts(session.id), before);

    // 对需要数字的任务不一刀切；当前服务端允许模型通过准确数字回答。
    output = evaluation({
      verdict: "correct",
      errorTypes: [],
      canContinue: true,
      continuation: {
        nextQuestionId: "q2",
        english: "What room would you like?",
        chineseTranslation: "您想要什么房型？",
        chineseTask: "说明房型",
        closingMessage: null,
      },
    });
    const numeric = await submitTurn(session.id, input("11"));
    assert.equal(numeric.session.completedCount, 1);
    assert.equal(numeric.session.currentQuestion?.id, "q2");
    checkSafeLogs();
  } finally {
    Runner.prototype.run = run;
    globalThis.fetch = fetch;
    console.info = info;
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function evaluation(patch: Partial<Evaluation> = {}): Evaluation {
  return {
    learnerIntent: "answer",
    verdict: "needs_correction",
    canContinue: false,
    correctedAnswer: "Thank you!",
    learnerTranslation: "原回答释义。",
    correctedTranslation: "谢谢！",
    explanation: "请表达感谢",
    errorTypes: ["meaning"],
    roleplayLine: "Could you try again?",
    roleplayTranslation: "你能再试一次吗？",
    tutorFeedback: "请再试一次",
    hint: null,
    continuation: null,
    coveredEarly: [],
    factChanges: [],
    ...patch,
  };
}

function checkSafeLogs() {
  const original = console.error;
  let line = "";
  try {
    console.error = (message) => {
      line = String(message);
    };
    const error = new TypeError("secret-api-key and learner text");
    logRequestFailure(error, publicError(error), {
      requestId: "test-request-id",
      method: "POST",
      path: "/api/sessions/test/turns",
      elapsedMs: 10,
    });
    assert.equal(line.includes("secret-api-key"), false);
    assert.equal(line.includes("learner text"), false);
    assert.equal(JSON.parse(line).category, "internal");
    assert.equal(JSON.parse(line).errorType, "TypeError");
    assert.equal(JSON.parse(line).requestId, "test-request-id");
  } finally {
    console.error = original;
  }
}
