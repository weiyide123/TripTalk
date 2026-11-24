import assert from "node:assert/strict";
import { backup } from "node:sqlite";
import { mkdtemp, stat, open, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import catalog from "../content/scenes.json";
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
import {
  createCatalogSnapshot,
  writeSnapshotToEmptyDatabase,
  assertEquivalentSnapshot,
} from "../src/server/storage/snapshots/write-snapshot";
import { readSnapshotRows } from "../src/server/storage/snapshots/snapshot-rows";
import { sqliteSnapshotSchema } from "../src/contracts/sqlite-snapshot";
import { trainingSessionSchema } from "../src/contracts/training-session";
import type { SqliteSnapshot } from "../src/contracts/sqlite-snapshot";
import { sqliteFixture } from "./helpers/sqlite-fixture";
import { SqliteStore } from "../src/server/storage/store";

// 仅临时目录；不加载 .env，不调用模型，不修改 DATA_DIR。
async function main() {
  parseArgs({ options: {} });
  checkCatalogSeeds();
  const directory = await mkdtemp(join(tmpdir(), "triptalk-sqlite-check-"));
  await checkInitializationCommand(directory);
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
    const snapshot = sqliteFixture(status);
    checkHistoricalFields(snapshot);
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
      const empty = createCatalogSnapshot(catalog);
      writeSnapshotToEmptyDatabase(database, empty);
      assert.equal(
        database.prepare("SELECT count(*) AS count FROM profile").get()?.count,
        0,
      );
      // 仅此临时夹具清空种子，正式导入函数没有清表能力。
      database.exec("DELETE FROM scenes");
      checkRollback(database, snapshot);
      writeSnapshotToEmptyDatabase(database, snapshot);
      assertEquivalentSnapshot(snapshot, readSnapshotRows(database));
      assert.throws(
        () => writeSnapshotToEmptyDatabase(database, snapshot),
        /no business records/,
      );
      checkSqlConstraints(database, snapshot);
      checkRepositoryReads(database, snapshot);
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
  console.log(
    JSON.stringify({
      event: "sqlite_checks_passed",
      directory,
      variants: 3,
      modelCalls: 0,
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

/** 保留对迁入历史的读取覆盖，不依赖已经退役的 JSON 转换器。 */
function checkHistoricalFields(snapshot: SqliteSnapshot) {
  const session = snapshot.sessions[0];
  const first = session.turns[0];
  assert.equal(first.action, "question");
  if (first.action !== "question") throw new Error("Missing fixture question");
  assert.equal(first.payload.english, "Actual first question?");
  assert.equal(first.payload.chineseTranslation, undefined);
  const answer = session.turns.find((event) => event.action === "answer")!;
  if (answer.action !== "answer") throw new Error("Missing fixture answer");
  assert.equal(answer.payload.feedback.roleplayTranslation, undefined);
  assert.ok(
    snapshot.receipts.some(
      (receipt) =>
        receipt.operation === "create-session" && receipt.createdAt === null,
    ),
  );
}

/** 种子无效必须在建库前拒绝；默认快照不携带用户或示例进度。 */
function checkCatalogSeeds() {
  const seed = createCatalogSnapshot(catalog);
  assert.equal(seed.profile, null);
  assert.deepEqual(seed.sessions, []);
  assert.deepEqual(seed.receipts, []);
  assert.ok(
    seed.scenes.every(
      (scene) => scene.plan === null && scene.origin === "builtin",
    ),
  );
  for (const invalid of [
    null,
    {},
    [],
    [catalog[0], catalog[0]],
    [{ ...catalog[0], id: "../unsafe" }],
  ]) {
    assert.throws(() => createCatalogSnapshot(invalid));
  }
}

/** 实际执行初始化 CLI：成功安装、重复目标拒绝、坏种子不创建文件；全部在临时目录。 */
async function checkInitializationCommand(directory: string) {
  const target = join(directory, "fresh.sqlite");
  const initialize = (file: string, seed: string) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/initialize-sqlite.ts",
        "--target",
        file,
        "--catalog",
        seed,
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
  assert.equal(initialize(target, "content/scenes.json").status, 0);
  assert.notEqual(initialize(target, "content/scenes.json").status, 0);
  const database = openDatabase(target, true);
  try {
    assertSchemaVersion(database);
    checkDatabase(database);
    assertEquivalentSnapshot(
      createCatalogSnapshot(catalog),
      readSnapshotRows(database),
    );
  } finally {
    database.close();
  }
  const invalidCatalog = join(directory, "invalid-catalog.json");
  await writeFile(invalidCatalog, JSON.stringify([catalog[0], catalog[0]]));
  const invalidTarget = join(directory, "invalid.sqlite");
  assert.notEqual(initialize(invalidTarget, invalidCatalog).status, 0);
  await assert.rejects(stat(invalidTarget), { code: "ENOENT" });
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
  const snapshot = sqliteFixture();
  const session = snapshot.sessions[0];
  const answer = session.turns.find((turn) => turn.action === "answer")!;
  if (answer.action !== "answer") throw new Error("Missing fixture answer");
  answer.payload.text = "I would like to stay for three nights.";
  answer.payload.effects = {
    coveredEarly: [{ questionId: "q3", evidence: "three nights" }],
    factChanges: [{ key: "nights", value: "3", evidence: "three nights" }],
  };
  assert.equal(sqliteSnapshotSchema.safeParse(snapshot).success, true);
  answer.payload.effects.coveredEarly[0].evidence = "not in source";
  assert.equal(sqliteSnapshotSchema.safeParse(snapshot).success, false);
}

function checkRollback(
  database: ReturnType<typeof createDatabase>,
  snapshot: SqliteSnapshot,
) {
  database.exec(`CREATE TEMP TRIGGER fail_import BEFORE INSERT ON turns
    WHEN NEW.sequence = 2 BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
  assert.throws(() => writeSnapshotToEmptyDatabase(database, snapshot), {
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
