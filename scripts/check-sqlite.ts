import assert from "node:assert/strict";
import { backup } from "node:sqlite";
import { mkdtemp, stat, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs, isDeepStrictEqual } from "node:util";
import {
  createDatabase,
  openDatabase,
  transaction,
  checkDatabase,
} from "../src/server/storage/database";
import {
  initializeSchema,
  assertSchemaVersion,
} from "../src/server/storage/schema-migrations";
import { convertJsonSnapshot } from "../src/server/storage/import/convert-json";
import { readJsonSource } from "../src/server/storage/import/read-json-source";
import {
  importSnapshot,
  assertEquivalentSnapshot,
} from "../src/server/storage/import/import-snapshot";
import { readSnapshotRows } from "../src/server/storage/import/snapshot-rows";
import { sqliteSnapshotSchema } from "../src/contracts/sqlite-snapshot";
import { trainingSessionSchema } from "../src/contracts/training-session";
import type { SqliteSnapshot } from "../src/contracts/sqlite-snapshot";
import type { Session } from "../src/contracts/legacy/session";
import { sqliteFixture } from "./helpers/sqlite-fixture";
import { SqliteStore } from "../src/server/storage/store";

// 仅临时目录；不加载 .env，不调用模型，不修改 DATA_DIR。
async function main() {
  const { values } = parseArgs({
    options: { source: { type: "string" }, catalog: { type: "string" } },
  });
  const directory = await mkdtemp(join(tmpdir(), "triptalk-sqlite-check-"));
  assert.throws(() => openDatabase(join(directory, "missing.sqlite")));
  assert.throws(
    () => createDatabase(resolve("public/..private/test.sqlite")),
    /public/,
  );
  assert.throws(() => createDatabase(resolve("test.sqlite")), /项目根/);
  checkEarlyCoverage();
  for (const status of [
    "active",
    "awaiting_continue",
    "topic_completed",
  ] as const) {
    const input = sqliteFixture(status);
    const snapshot = convertJsonSnapshot(input);
    const original = Object.values(input.sceneData[0].sessions)[0];
    checkConversion(original, snapshot);
    checkContractRejections(snapshot);
    const file = join(directory, status + ".sqlite");
    const database = createDatabase(file);
    try {
      initializeSchema(database);
      initializeSchema(database);
      assertSchemaVersion(database);
      assert.equal(
        database
          .prepare(
            "SELECT count(*) AS count FROM sqlite_schema WHERE type='table'",
          )
          .get()?.count,
        7,
      );
      const empty = convertJsonSnapshot({
        catalog: input.catalog,
        profile: null,
        sceneData: [],
      });
      importSnapshot(database, empty);
      assert.equal(
        database.prepare("SELECT count(*) AS count FROM profile").get()?.count,
        0,
      );
      // 仅此临时夹具清空种子，正式导入函数没有清表能力。
      database.exec("DELETE FROM scenes");
      checkRollback(database, snapshot);
      importSnapshot(database, snapshot);
      assertEquivalentSnapshot(snapshot, readSnapshotRows(database));
      assert.throws(
        () => importSnapshot(database, snapshot),
        /no business records/,
      );
      checkSqlConstraints(database, snapshot);
      const competing = openDatabase(file);
      try {
        transaction(database, () => {
          assert.throws(() => transaction(competing, () => 1), {
            code: "DATABASE_BUSY",
          });
        });
      } finally {
        competing.close();
      }
      const backupPath = join(directory, status + "-backup.sqlite");
      const reserved = await open(backupPath, "wx", 0o600);
      await reserved.close();
      await backup(database, backupPath);
      const restored = openDatabase(backupPath, true);
      try {
        checkDatabase(restored);
        assertSchemaVersion(restored);
        assertEquivalentSnapshot(snapshot, readSnapshotRows(restored));
      } finally {
        restored.close();
      }
      assert.equal((await stat(file)).mode & 0o777, 0o600);
      assert.throws(() => createDatabase(file), { code: "EEXIST" });
    } finally {
      database.close();
    }
    const reopened = openDatabase(file, true);
    try {
      assertEquivalentSnapshot(snapshot, readSnapshotRows(reopened));
    } finally {
      reopened.close();
    }
  }
  let sourceCounts: object | null = null;
  if (values.source) {
    const catalog = resolve(values.catalog ?? "content/scenes.json");
    const before = await readJsonSource(resolve(values.source), catalog);
    const database = createDatabase(join(directory, "source-copy.sqlite"));
    try {
      initializeSchema(database);
      importSnapshot(database, before.snapshot);
      assertEquivalentSnapshot(before.snapshot, readSnapshotRows(database));
      checkRepositoryReads(database, before.snapshot);
      const after = await readJsonSource(resolve(values.source), catalog);
      assert.ok(
        isDeepStrictEqual(before.manifest, after.manifest),
        "Source changed during verification",
      );
      sourceCounts = {
        scenes: before.snapshot.scenes.length,
        sessions: before.snapshot.sessions.length,
        events: before.snapshot.sessions.reduce(
          (count, session) => count + session.turns.length,
          0,
        ),
        receipts: before.snapshot.receipts.length,
        sourceFilesUnchanged: true,
      };
    } finally {
      database.close();
    }
  }
  console.log(
    JSON.stringify({
      event: "sqlite_checks_passed",
      directory,
      variants: 3,
      modelCalls: 0,
      sourceCounts,
    }),
  );
}

function checkRepositoryReads(
  database: ReturnType<typeof createDatabase>,
  snapshot: SqliteSnapshot,
) {
  const store = new SqliteStore({ database, inFlight: new Set() });
  for (const session of snapshot.sessions) {
    const loaded = store.sessions.readWithReceipts(session.id);
    assert.deepEqual(loaded.session, session);
    const requests = snapshot.receipts
      .filter(
        (receipt) =>
          receipt.operation === "session-turn" &&
          receipt.scopeId === session.id,
      )
      .map((receipt) => receipt.requestId);
    assert.deepEqual(new Set(loaded.processedRequestIds), new Set(requests));
    const resolved = new Set<string>();
    for (const event of session.turns) {
      if (event.action !== "answer" || !event.payload.feedback.canContinue)
        continue;
      resolved.add(event.questionId);
      for (const covered of event.payload.effects.coveredEarly)
        resolved.add(covered.questionId);
    }
    const progress = store.sessions
      .progress(session.sceneId)
      .find((item) => item.id === session.id);
    assert.equal(progress?.completedCount, resolved.size);
    const question = session.turns.find(
      (event) =>
        event.action === "question" &&
        event.questionId === session.currentQuestionId,
    );
    assert.equal(
      progress?.currentGoal,
      question?.action === "question" ? question.payload.goal : null,
    );
  }
}

function checkConversion(original: Session, snapshot: SqliteSnapshot) {
  const converted = snapshot.sessions[0];
  assert.equal(converted.revision, original.revision);
  assert.equal(converted.status, original.status);
  assert.equal(converted.currentQuestionId, original.currentQuestionId);
  assert.deepEqual(converted.pendingContinuation, original.pendingContinuation);
  assert.equal(converted.turns.length, original.turns.length + 1);
  for (const event of converted.turns) {
    if (event.action === "question") {
      assert.deepEqual(
        { id: event.questionId, ...event.payload },
        original.presentedQuestions[event.questionId],
      );
    } else if (event.action === "completed") {
      assert.equal(event.payload.closingMessage, original.closingMessage);
    } else {
      const source = original.turns.find((turn) => turn.id === event.id)!;
      assert.notEqual(source.action, "continue");
      if (source.action === "continue")
        throw new Error("Unexpected fixture event");
      assert.deepEqual(event.payload, {
        text: source.text,
        feedback: source.feedback,
        effects: source.effects,
        modelCall: source.modelCall,
      });
    }
  }
  for (const turn of original.turns) {
    const receipt = snapshot.receipts.find(
      (item) => item.requestId === turn.requestId,
    );
    assert.ok(receipt && receipt.operation === "session-turn");
    assert.equal(receipt.inputHash, turn.inputHash);
    assert.deepEqual(receipt.result, {
      sessionId: original.id,
      turnId: turn.id,
      revision: turn.revision,
    });
  }
}

function checkContractRejections(snapshot: SqliteSnapshot) {
  const session = snapshot.sessions[0];
  const invalidSequence = structuredClone(session);
  invalidSequence.turns[0].sequence = 2;
  assert.equal(trainingSessionSchema.safeParse(invalidSequence).success, false);
  const invalidCurrent = { ...session, currentQuestionId: "unseen" };
  assert.equal(trainingSessionSchema.safeParse(invalidCurrent).success, false);
  const invalidReceipt = structuredClone(snapshot);
  invalidReceipt.receipts[0].scopeId = "airport";
  assert.equal(sqliteSnapshotSchema.safeParse(invalidReceipt).success, false);
  const duplicate = structuredClone(snapshot);
  duplicate.sessions.push(duplicate.sessions[0]);
  assert.equal(sqliteSnapshotSchema.safeParse(duplicate).success, false);
  const noCourse = structuredClone(snapshot);
  noCourse.scenes.find((scene) => scene.id === "hotel")!.plan = null;
  assert.equal(sqliteSnapshotSchema.safeParse(noCourse).success, false);
}

function checkEarlyCoverage() {
  const input = sqliteFixture();
  const session = Object.values(input.sceneData[0].sessions)[0];
  const answer = session.turns.find((turn) => turn.action === "answer")!;
  if (answer.action !== "answer") throw new Error("Missing fixture answer");
  answer.text = "I would like to stay for three nights.";
  answer.effects = {
    coveredEarly: [{ questionId: "q3", evidence: "three nights" }],
    factChanges: [{ key: "nights", value: "3", evidence: "three nights" }],
  };
  const converted = convertJsonSnapshot(input);
  checkConversion(session, converted);
  const invalid = structuredClone(converted);
  const event = invalid.sessions[0].turns.find(
    (turn) => turn.action === "answer",
  )!;
  if (event.action !== "answer") throw new Error("Missing converted answer");
  event.payload.effects.coveredEarly[0].evidence = "not in source";
  assert.equal(sqliteSnapshotSchema.safeParse(invalid).success, false);
}

function checkRollback(
  database: ReturnType<typeof createDatabase>,
  snapshot: SqliteSnapshot,
) {
  database.exec(`CREATE TEMP TRIGGER fail_import BEFORE INSERT ON turns
    WHEN NEW.sequence = 2 BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
  assert.throws(() => importSnapshot(database, snapshot), {
    code: "DATABASE_CONSTRAINT_FAILED",
  });
  for (const table of [
    "scenes",
    "scene_topics",
    "profile",
    "sessions",
    "turns",
    "operation_receipts",
  ]) {
    assert.equal(
      database.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count,
      0,
    );
  }
  database.exec("DROP TRIGGER fail_import");
  assert.throws(
    () => transaction(database, () => transaction(database, () => 1)),
    /嵌套/,
  );
  assert.equal(database.isTransaction, false);
}

function checkSqlConstraints(
  database: ReturnType<typeof createDatabase>,
  snapshot: SqliteSnapshot,
) {
  const sessionId = snapshot.sessions[0].id;
  assert.throws(() =>
    database
      .prepare("UPDATE turns SET action = 'continue' WHERE session_id = ?")
      .run(sessionId),
  );
  assert.throws(() =>
    database
      .prepare("UPDATE profile SET last_scene_id = 'unknown' WHERE id = 1")
      .run(),
  );
  assert.throws(() =>
    database.exec(
      "UPDATE scenes SET course_source = NULL WHERE course_generated_at IS NOT NULL",
    ),
  );
  assert.throws(() =>
    database.exec(
      "INSERT INTO turns SELECT id || '-duplicate', session_id, sequence, action, question_id, payload_json, created_at FROM turns LIMIT 1",
    ),
  );
  const checksum = database
    .prepare("SELECT checksum FROM schema_migrations WHERE version = 1")
    .get()!.checksum;
  database
    .prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 1")
    .run("b".repeat(64));
  assert.throws(() => assertSchemaVersion(database), /结构版本/);
  database
    .prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 1")
    .run(checksum);
  if (snapshot.sessions[0].status !== "topic_completed") {
    assert.throws(() =>
      database
        .prepare(
          `INSERT INTO sessions SELECT
      id || '-another', scene_id, topic_id, mode, status, revision, current_question_id,
      config_snapshot_json, plan_snapshot_json, planning_call_json, pending_continuation_json,
      created_at, updated_at, topic_completed_at FROM sessions WHERE id = ?`,
        )
        .run(sessionId),
    );
  }
  checkDatabase(database);
}

main().catch((error: unknown) => {
  // 不输出断言实际值，可能包含源对话；只保留定位和错误类型。
  console.error(
    JSON.stringify({
      event: "sqlite_check_failed",
      errorType: (error as Error).name,
      locations: (error as Error).stack
        ?.split("\n")
        .filter((line) => /^\s+at /.test(line))
        .slice(0, 5),
    }),
  );
  process.exitCode = 1;
});
