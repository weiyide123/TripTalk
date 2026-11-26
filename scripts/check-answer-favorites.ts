import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Runner } from "@openai/agents";
import { canFavoriteLearnerAnswer } from "../src/contracts/favorite";
import { generatedEvaluationSchema } from "../src/contracts/jane-turn";
import { createDatabase } from "../src/server/storage/database";
import { initializeSchema } from "../src/server/storage/schema-migrations";
import {
  writeSnapshotToEmptyDatabase,
  assertEquivalentSnapshot,
} from "../src/server/storage/snapshots/write-snapshot";
import { readSnapshotRows } from "../src/server/storage/snapshots/snapshot-rows";
import { SqliteStore } from "../src/server/storage/store";
import { translateSentence } from "../src/server/services/translate-sentence";
import { sqliteFixture } from "./helpers/sqlite-fixture";

/** 临时库验证原回答收藏/补译与并发；禁用网络，不调用真实模型或正式学习库。 */
async function main() {
  const directory = await mkdtemp(join(tmpdir(), "triptalk-answer-favorites-"));
  const database = createDatabase(join(directory, "triptalk.sqlite"));
  const snapshot = sqliteFixture("topic_completed");
  const session = snapshot.sessions[0];
  const base = session.turns.find((event) => event.action === "answer")!;
  assert.equal(base.action, "answer");
  if (base.action !== "answer") throw new Error("Missing answer");
  base.payload.text = "I would like a quiet room.";
  base.payload.feedback.verdict = "correct";
  base.payload.feedback.learnerIntent = "answer";
  base.payload.feedback.canContinue = true;
  base.payload.feedback.errorTypes = [];
  base.payload.feedback.correctedAnswer = null;
  base.payload.feedback.learnerTranslation = "我想要一间安静的房间。";
  base.payload.feedback.correctedTranslation = null;
  base.payload.feedback.roleplayTranslation = "好的。";
  const answers = session.turns.filter((event) => event.action === "answer");
  const legacy = answers[1];
  if (legacy.action !== "answer") throw new Error("Missing legacy answer");
  legacy.payload.feedback = { ...base.payload.feedback };
  legacy.payload.text = "a".repeat(2000);
  delete legacy.payload.feedback.learnerTranslation;
  const correction = answers[2];
  if (correction.action !== "answer") throw new Error("Missing correction");
  correction.payload.feedback = { ...base.payload.feedback };
  correction.payload.feedback.correctedAnswer =
    "Could I have a quiet room, please?";
  correction.payload.feedback.correctedTranslation =
    "请给我一间安静的房间，好吗？";
  const wrong = session.turns.find((event) => event.action === "hint")!;
  if (wrong.action !== "hint") throw new Error("Missing hint");
  initializeSchema(database);
  writeSnapshotToEmptyDatabase(database, snapshot);
  const store = new SqliteStore({
    database,
    inFlight: new Set(),
  });
  const original = JSON.stringify(store.sessions.get(session.id));
  const ownSource = {
    sourceTurnId: base.id,
    sourcePart: "learner_answer" as const,
  };
  const saved = store.favorites.save(ownSource);
  assert.equal(saved.english, base.payload.text);
  assert.equal(
    saved.chineseTranslation,
    base.payload.feedback.learnerTranslation,
  );
  assert.equal(store.favorites.save(ownSource).id, saved.id);
  for (const event of [correction, wrong]) {
    assert.equal(canFavoriteLearnerAnswer(event.payload.feedback), false);
    assert.throws(
      () =>
        store.favorites.save({
          sourceTurnId: event.id,
          sourcePart: "learner_answer",
        }),
      { code: "FAVORITE_SOURCE_INVALID" },
    );
  }
  const correctedSource = {
    sourceTurnId: correction.id,
    sourcePart: "corrected_answer" as const,
  };
  assert.equal(
    store.favorites.save(correctedSource).chineseTranslation,
    correction.payload.feedback.correctedTranslation,
  );
  const legacySource = {
    sourceTurnId: legacy.id,
    sourcePart: "learner_answer" as const,
  };
  const oldSaved = store.favorites.save(legacySource);
  assert.equal(oldSaved.english.length, 2000);
  assert.equal(oldSaved.chineseTranslation, null);
  assert.equal(
    generatedEvaluationSchema.safeParse({
      ...base.payload.feedback,
      continuation: null,
      coveredEarly: [],
      factChanges: [],
    }).success,
    true,
  );
  assert.equal(
    generatedEvaluationSchema.safeParse({
      ...base.payload.feedback,
      learnerTranslation: undefined,
      continuation: null,
      coveredEarly: [],
      factChanges: [],
    }).success,
    false,
  );

  const environment = {
    DATA_DIR: process.env.DATA_DIR,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
  };
  const originalRun = Runner.prototype.run;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let release: (() => void) | undefined;
  let fail = false;
  try {
    process.env.DATA_DIR = directory;
    process.env.OPENAI_API_KEY = "offline-only";
    process.env.OPENAI_MODEL = "offline-model";
    globalThis.fetch = async () => {
      throw new Error("Network forbidden");
    };
    Runner.prototype.run = (async () => {
      calls++;
      if (fail) throw new Error("simulated translation failure");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { finalOutput: { chineseTranslation: "旧句中文释义。" } };
    }) as unknown as typeof originalRun;
    assert.deepEqual(await translateSentence(ownSource), {
      chineseTranslation: saved.chineseTranslation,
    });
    assert.equal(calls, 0);
    const inFlight = translateSentence(legacySource);
    await assert.rejects(translateSentence(legacySource), {
      code: "REQUEST_BUSY",
    });
    release!();
    await inFlight;
    assert.equal(calls, 1);
    assert.equal(
      store.favorites
        .list({ offset: 0 })
        .items.find((item) => item.id === oldSaved.id)?.chineseTranslation,
      "旧句中文释义。",
    );
    await translateSentence(legacySource);
    assert.equal(calls, 1);
    store.favorites.remove(oldSaved.id);
    assert.equal(
      store.favorites.save(legacySource).chineseTranslation,
      "旧句中文释义。",
    );
    const missingSource = {
      sourceTurnId: session.turns[0].id,
      sourcePart: "question" as const,
    };
    const question = store.favorites.save(missingSource);
    fail = true;
    await assert.rejects(translateSentence(missingSource));
    assert.ok(
      store.favorites
        .list({ offset: 0 })
        .items.some((item) => item.id === question.id),
    );
    fail = false;
    const pending = translateSentence(missingSource);
    store.favorites.remove(question.id);
    release!();
    await pending;
    assert.ok(
      !store.favorites
        .list({ offset: 0 })
        .items.some((item) => item.id === question.id),
    );
    assert.equal(JSON.stringify(store.sessions.get(session.id)), original);
    const roundtrip = createDatabase(join(directory, "roundtrip.sqlite"));
    try {
      initializeSchema(roundtrip);
      const result = readSnapshotRows(database);
      writeSnapshotToEmptyDatabase(roundtrip, result);
      assertEquivalentSnapshot(result, readSnapshotRows(roundtrip));
    } finally {
      roundtrip.close();
    }
    console.log(
      JSON.stringify({
        event: "answer_favorite_checks_passed",
        modelCalls: 0,
        directory,
      }),
    );
  } finally {
    Runner.prototype.run = originalRun;
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    database.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
