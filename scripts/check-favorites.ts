import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  createDatabase,
  openDatabase,
  checkDatabase,
} from "../src/server/storage/database";
import {
  assertSchemaVersion,
  initializeSchema,
} from "../src/server/storage/schema-migrations";
import {
  insertSnapshotRows,
  readSnapshotRows,
} from "../src/server/storage/snapshots/snapshot-rows";
import {
  assertEquivalentSnapshot,
  writeSnapshotToEmptyDatabase,
} from "../src/server/storage/snapshots/write-snapshot";
import { SqliteStore } from "../src/server/storage/store";
import {
  favoriteQuerySchema,
  favoriteSourceSchema,
  favoriteSourceHref,
} from "../src/contracts/favorite";
import { sqliteFixture } from "./helpers/sqlite-fixture";

/** 全部使用临时数据库和当前契约夹具，不读取正式数据、不调用模型。 */
async function main() {
  const directory = await mkdtemp(join(tmpdir(), "triptalk-favorites-check-"));
  const file = join(directory, "fixture.sqlite");
  const snapshot = sqliteFixture("topic_completed");
  const session = snapshot.sessions[0];
  const answer = session.turns.find((turn) => turn.action === "answer")!;
  if (answer.action !== "answer") throw new Error("Missing answer fixture");
  answer.payload.feedback.correctedAnswer = "I would like to check in, please.";
  answer.payload.feedback.explanation = "使用 would like 更礼貌。";
  answer.payload.feedback.roleplayTranslation = "谢谢你。";
  const database = createDatabase(file);
  try {
    initializeSchema(database);
    writeSnapshotToEmptyDatabase(database, snapshot);
    const store = new SqliteStore({ database, inFlight: new Set() });
    const first = session.turns[0];
    const source = { sourceTurnId: first.id, sourcePart: "question" as const };
    const saved = store.favorites.save(source);
    assert.match(saved.id, /^[a-f0-9-]{36}$/);
    assert.equal(saved.chineseTranslation, null);
    assert.equal(saved.sourceSessionId, session.id);
    assert.deepEqual(store.favorites.save(source), saved);
    assert.equal(
      favoriteSourceHref(saved),
      `/lessons/${session.id}?turn=${first.id}&part=question`,
    );
    const roleplay = store.favorites.save({
      sourceTurnId: answer.id,
      sourcePart: "roleplay",
    });
    const correction = store.favorites.save({
      sourceTurnId: answer.id,
      sourcePart: "corrected_answer",
    });
    assert.notEqual(roleplay.id, correction.id);
    assert.equal(roleplay.chineseTranslation, "谢谢你。");
    assert.equal(correction.chineseTranslation, null);
    assert.equal(correction.explanation, answer.payload.feedback.explanation);
    store.favorites.save({
      sourceTurnId: session.turns.at(-1)!.id,
      sourcePart: "closing",
    });
    assert.equal(store.favorites.forSession(session.id).length, 4);
    assert.equal(store.favorites.forSession("unknown").length, 0);
    assert.equal(store.favorites.list({ offset: 0 }).total, 4);
    assert.equal(
      store.favorites.list({
        offset: 0,
        sceneId: "hotel",
        topicId: session.topicId,
      }).items.length,
      4,
    );
    assert.equal(
      store.favorites.list({ offset: 0, sceneId: "airport" }).items.length,
      0,
    );
    assert.equal(store.favorites.list({ offset: 0 }).filters.length, 1);
    assert.throws(() => favoriteQuerySchema.parse({ topicId: "x" }));
    assert.throws(() =>
      favoriteSourceSchema.parse({ ...source, english: "tampered" }),
    );
    assert.throws(
      () =>
        store.favorites.save({
          sourceTurnId: "missing",
          sourcePart: "question",
        }),
      { code: "FAVORITE_SOURCE_NOT_FOUND" },
    );
    assert.throws(
      () =>
        store.favorites.save({
          sourceTurnId: first.id,
          sourcePart: "roleplay",
        }),
      { code: "FAVORITE_SOURCE_INVALID" },
    );
    assert.throws(
      () =>
        store.favorites.save({
          sourceTurnId: session.turns.find((turn) => turn.action === "hint")!
            .id,
          sourcePart: "roleplay",
        }),
      { code: "FAVORITE_SOURCE_INVALID" },
    );
    store.favorites.remove(saved.id);
    store.favorites.remove(saved.id);
    const recreated = store.favorites.save(source);
    assert.notEqual(recreated.id, saved.id);
    store.favorites.remove(saved.id);
    assert.equal(store.favorites.forSession(session.id).length, 4);
    assert.deepEqual(store.sessions.get(session.id), session);
    const withFavorites = readSnapshotRows(database);
    const roundtrip = createDatabase(join(directory, "roundtrip.sqlite"));
    try {
      initializeSchema(roundtrip);
      writeSnapshotToEmptyDatabase(roundtrip, withFavorites);
      assertEquivalentSnapshot(withFavorites, readSnapshotRows(roundtrip));
    } finally {
      roundtrip.close();
    }
    database.exec(
      `CREATE TEMP TRIGGER reject_favorite BEFORE INSERT ON favorites BEGIN SELECT RAISE(ABORT, 'fixture'); END`,
    );
    const nextQuestion = session.turns.find(
      (turn) => turn.action === "question" && turn.id !== first.id,
    )!;
    assert.throws(() =>
      store.favorites.save({
        sourceTurnId: nextQuestion.id,
        sourcePart: "question",
      }),
    );
    assert.equal(store.favorites.list({ offset: 0 }).total, 4);
    database.exec("DROP TRIGGER reject_favorite");
    // 仅夹具直接移除事件，验证 SET NULL 与快照保留；正式应用不开放删除历史。
    database.prepare("DELETE FROM turns WHERE id = ?").run(first.id);
    const orphan = store.favorites
      .list({ offset: 0 })
      .items.find((item) => item.id === recreated.id)!;
    assert.equal(orphan.sourceTurnId, null);
    assert.equal(favoriteSourceHref(orphan), null);
    assert.equal(orphan.english, recreated.english);
    // 独立快照条目用于分页测试，不伪造来源关系。
    const insert = database.prepare(`INSERT INTO favorites
      (id, source_turn_id, source_part, scene_id, topic_id, scene_title, topic_title, english, created_at)
      VALUES (?, NULL, 'question', 'hotel', 'topic-1', '酒店英语', '办理入住', 'Hello.', ?)`);
    for (let index = 0; index < 55; index++)
      insert.run(
        randomUUID(),
        `2026-11-25T00:00:${String(index).padStart(2, "0")}.000Z`,
      );
    const page = store.favorites.list({ offset: 0 });
    const next = store.favorites.list({ offset: 50 });
    assert.equal(page.items.length, 50);
    assert.equal(next.items.length, 9);
    assert.equal(
      new Set([...page.items, ...next.items].map((item) => item.id)).size,
      59,
    );
    checkDatabase(database);
  } finally {
    database.close();
  }
  await checkUpgrade(await mkdtemp(join(directory, "upgrade-001-")), 1);
  await checkUpgrade(await mkdtemp(join(directory, "upgrade-002-")), 2);
  console.log(JSON.stringify({ event: "favorites_checks_passed", directory }));
}

/** 直接安装原始 001，执行真实升级命令并核对备份、旧数据、重复升级与校验和保护。 */
async function checkUpgrade(directory: string, version: number) {
  const file = join(directory, "old.sqlite");
  const old = createDatabase(file);
  const sql = await readFile(
    resolve("src/server/storage/migrations/001_initial.sql"),
    "utf8",
  );
  old.exec(sql);
  old
    .prepare("INSERT INTO schema_migrations VALUES (1, 'initial', ?, ?)")
    .run(
      createHash("sha256").update(sql).digest("hex"),
      new Date().toISOString(),
    );
  const snapshot = sqliteFixture();
  if (version === 2) {
    const favoritesSql = await readFile(
      resolve("src/server/storage/migrations/002_favorites.sql"),
      "utf8",
    );
    old.exec(favoritesSql);
    old
      .prepare("INSERT INTO schema_migrations VALUES (2, 'favorites', ?, ?)")
      .run(
        createHash("sha256").update(favoritesSql).digest("hex"),
        new Date().toISOString(),
      );
  }
  // 001 没有收藏表，直接从已验证的新夹具复制旧六表数据。
  const seed = createDatabase(join(directory, "seed.sqlite"));
  try {
    initializeSchema(seed);
    insertSnapshotRows(seed, snapshot);
    if (version === 2) {
      const store = new SqliteStore({ database: seed, inFlight: new Set() });
      snapshot.favorites.push(
        store.favorites.save({
          sourceTurnId: snapshot.sessions[0].turns[0].id,
          sourcePart: "question",
        }),
      );
      // 快照契约不含视图派生字段。
      snapshot.favorites = readSnapshotRows(seed).favorites;
    }
    const tables = [
      "scenes",
      "profile",
      "scene_topics",
      "sessions",
      "turns",
      "operation_receipts",
    ];
    if (version === 2) tables.push("favorites");
    for (const table of tables) {
      const rows = seed.prepare(`SELECT * FROM ${table}`).all();
      for (const row of rows) {
        const columns = Object.keys(row);
        old
          .prepare(
            `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
          )
          .run(...Object.values(row));
      }
    }
  } finally {
    seed.close();
    old.close();
  }
  const run = () =>
    spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/upgrade-sqlite.ts", "--target", file],
      { encoding: "utf8" },
    );
  assert.equal(run().status, 0);
  assert.equal(run().status, 0);
  const upgraded = openDatabase(file);
  try {
    assertSchemaVersion(upgraded);
    assertEquivalentSnapshot(snapshot, readSnapshotRows(upgraded));
    upgraded
      .prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 1")
      .run("0".repeat(64));
  } finally {
    upgraded.close();
  }
  assert.notEqual(run().status, 0);
  const backups = await readdir(join(directory, "backups"));
  assert.equal(backups.length, 1);
  const copy = openDatabase(
    join(directory, "backups", backups[0], "triptalk.sqlite"),
    true,
  );
  try {
    checkDatabase(copy);
    assert.equal(
      copy.prepare("SELECT count(*) AS n FROM turns").get()!.n,
      snapshot.sessions[0].turns.length,
    );
    assert.equal(
      copy.prepare("SELECT count(*) AS n FROM schema_migrations").get()!.n,
      version,
    );
  } finally {
    copy.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
