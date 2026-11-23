import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  createDatabase,
  openDatabase,
  checkDatabase,
  transaction,
} from "../src/server/storage/database";
import { initializeSchema } from "../src/server/storage/schema-migrations";
import { SqliteStore, getStore } from "../src/server/storage/store";
import { convertJsonSnapshot } from "../src/server/storage/import/convert-json";
import { importSnapshot } from "../src/server/storage/import/import-snapshot";
import { readSnapshotRows } from "../src/server/storage/import/snapshot-rows";
import { sqliteFixture } from "./helpers/sqlite-fixture";
import {
  initialTrainingSession,
  simulatedSubmission,
  append,
} from "./helpers/sqlite-repository-fixture";
import type { TurnRequest } from "../src/contracts/requests";

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "triptalk-repository-check-"));
  const file = join(directory, "practice.sqlite");
  const database = createDatabase(file);
  const store = new SqliteStore({ database, inFlight: new Set() });
  try {
    initializeSchema(database);
    const source = sqliteFixture();
    const snapshot = convertJsonSnapshot({
      ...source,
      profile: null,
      sceneData: [],
    });
    snapshot.scenes.push({
      ...snapshot.scenes[0],
      id: "custom-cafe",
      origin: "custom",
      position: snapshot.scenes.length,
      title: "我的咖啡馆",
      art: "generic",
      plan: null,
    });
    importSnapshot(database, snapshot);
    checkProfile(store, database);
    const plan = source.sceneData[0].plan!;
    const init = { requestId: randomUUID(), sceneId: "hotel" };
    assert.equal(store.catalog.readPlan("hotel"), null);
    assert.equal(store.catalog.findInitialization(init), null);
    assert.deepEqual(store.catalog.initializeCourse(init, plan), plan);
    assert.deepEqual(store.catalog.initializeCourse(init), plan);
    assert.deepEqual(
      store.catalog.initializeCourse({ ...init, requestId: randomUUID() }),
      plan,
    );
    assert.equal(
      database.prepare("SELECT count(*) AS n FROM scene_topics").get()!.n,
      3,
    );
    checkCourseRollback(store, database, plan);
    const request = {
      requestId: randomUUID(),
      sceneId: "hotel",
      topicId: plan.topics[0].id,
    };
    const candidate = initialTrainingSession(
      store.catalog.get("hotel"),
      plan.topics[0],
    );
    const created = store.sessions.create(request, candidate);
    assert.deepEqual(store.sessions.create(request), created);
    assert.equal(
      store.sessions.create({ ...request, requestId: randomUUID() }).id,
      created.id,
    );
    assert.throws(
      () => store.sessions.create({ ...request, topicId: "topic-2" }),
      { code: "REQUEST_ID_CONFLICT" },
    );
    assert.throws(
      () =>
        store.sessions.create({
          ...request,
          topicId: "topic-2",
          requestId: randomUUID(),
        }),
      { code: "ACTIVE_TOPIC_EXISTS" },
    );
    await checkLocks(store, database);
    checkTurnWrites(store, database, created.id);
    checkCompletionAndRepeat(store, request);
    checkDatabase(database);
  } finally {
    database.close();
  }
  const reopened = openDatabase(file, true);
  try {
    const restored = new SqliteStore({
      database: reopened,
      inFlight: new Set(),
    });
    assert.equal(restored.profile.read().lastSceneId, "airport");
    assert.equal(
      restored.sessions
        .progress("hotel")
        .filter((session) => session.status === "topic_completed").length,
      1,
    );
    assert.throws(
      () => restored.profile.updatePreferences({ difficulty: "easy" }),
      { code: "DATABASE_ACCESS_FAILED" },
    );
  } finally {
    reopened.close();
  }
  checkLegacyRecovery(directory);
  await checkResourceCache(directory, file);
  console.log(
    JSON.stringify({
      event: "sqlite_repository_checks_passed",
      directory,
      modelCalls: 0,
      formalDataChanged: false,
    }),
  );
}

function checkProfile(store: SqliteStore, database: DatabaseSync) {
  assert.equal(store.profile.read().difficulty, "medium");
  assert.equal(
    database.prepare("SELECT count(*) AS n FROM profile").get()!.n,
    0,
  );
  store.profile.updatePreferences({
    lastSceneId: "hotel",
    difficulty: "advanced",
  });
  store.profile.updatePreferences({
    lastSceneId: "airport",
    difficulty: undefined,
  });
  assert.equal(store.profile.read().difficulty, "advanced");
  assert.equal(
    store.catalog.resolveHomeScene(null, store.profile.read().lastSceneId).id,
    "airport",
  );
  assert.equal(store.catalog.resolveHomeScene("hotel", "airport").id, "hotel");
  const before = store.profile.read();
  assert.throws(
    () => store.profile.updatePreferences({ lastSceneId: "missing" }),
    { code: "SCENE_NOT_FOUND" },
  );
  assert.deepEqual(store.profile.read(), before);
  store.profile.completeOnboarding();
  const onboarded = store.profile.read();
  store.profile.completeOnboarding();
  assert.deepEqual(store.profile.read(), onboarded);
  store.profile.updatePreferences({ lastSceneId: null });
  assert.equal(store.profile.read().lastSceneId, null);
  store.profile.updatePreferences({ lastSceneId: "airport" });
  store.profile.updatePreferences({ lastSceneId: "custom-cafe" });
  assert.equal(
    store.catalog.resolveHomeScene(null, store.profile.read().lastSceneId)
      .title,
    "我的咖啡馆",
  );
  store.profile.updatePreferences({ lastSceneId: "airport" });
}

function checkCourseRollback(
  store: SqliteStore,
  database: DatabaseSync,
  plan: NonNullable<ReturnType<SqliteStore["catalog"]["readPlan"]>>,
) {
  const before = readSnapshotRows(database);
  database.exec(`CREATE TEMP TRIGGER fail_course BEFORE INSERT ON scene_topics
    WHEN NEW.scene_id = 'airport' AND NEW.position = 1
    BEGIN SELECT RAISE(ABORT, 'offline injected failure'); END`);
  const request = { requestId: randomUUID(), sceneId: "airport" };
  assert.throws(
    () =>
      store.catalog.initializeCourse(request, { ...plan, sceneId: "airport" }),
    { code: "DATABASE_CONSTRAINT_FAILED" },
  );
  assert.deepEqual(readSnapshotRows(database), before);
  database.exec("DROP TRIGGER fail_course");
  store.catalog.initializeCourse(request, { ...plan, sceneId: "airport" });
  const topic = plan.topics[0];
  const airport = initialTrainingSession(store.catalog.get("airport"), topic);
  store.sessions.create(
    { requestId: randomUUID(), sceneId: "airport", topicId: topic.id },
    airport,
  );
}

function checkTurnWrites(
  store: SqliteStore,
  database: DatabaseSync,
  sessionId: string,
) {
  const original = store.sessions.get(sessionId);
  const { input, candidate } = simulatedSubmission(original);
  const before = readSnapshotRows(database);
  database.exec(`CREATE TEMP TRIGGER fail_receipt BEFORE INSERT ON operation_receipts
    WHEN NEW.operation = 'session-turn' BEGIN SELECT RAISE(ABORT, 'offline injected failure'); END`);
  assert.throws(() => store.sessions.commitTurn(sessionId, input, candidate), {
    code: "DATABASE_CONSTRAINT_FAILED",
  });
  assert.deepEqual(readSnapshotRows(database), before);
  assert.equal(store.sessions.findTurn(sessionId, input), null);
  database.exec("DROP TRIGGER fail_receipt");
  const result = store.sessions.commitTurn(sessionId, input, candidate);
  assert.equal(result.session.revision, original.revision + 1);
  assert.equal(result.session.turns.length, original.turns.length + 2);
  assert.deepEqual(
    store.sessions.commitTurn(sessionId, input, original),
    result,
  );
  assert.throws(
    () =>
      store.sessions.commitTurn(
        sessionId,
        { ...input, text: "different" },
        candidate,
      ),
    { code: "REQUEST_ID_CONFLICT" },
  );
  assert.throws(
    () =>
      store.sessions.commitTurn(
        sessionId,
        { ...input, requestId: randomUUID() },
        candidate,
      ),
    { code: "STALE_REVISION" },
  );
  assert.equal(
    store.sessions
      .processedRequestIds(sessionId)
      .filter((id) => id === input.requestId).length,
    1,
  );
  const progress = store.sessions.progress("hotel")[0];
  assert.equal(progress.completedCount, 1);
  assert.equal(progress.currentGoal, candidate.planSnapshot.questions[1].goal);
  assert.equal("turns" in progress, false);
  for (const action of ["hint", "explain", "answer"] as const) {
    const pending = simulatedSubmission(
      store.sessions.get(sessionId),
      action,
      false,
    );
    const saved = store.sessions.commitTurn(
      sessionId,
      pending.input,
      pending.candidate,
    );
    assert.equal(saved.session.currentQuestionId, "q2");
    assert.equal(store.sessions.progress("hotel")[0].completedCount, 1);
  }
  const replay = store.sessions.commitTurn(sessionId, input, original);
  assert.equal(replay.receipt.result.revision, 1);
  assert.equal(replay.session.revision, 4);
  const coherent = store.sessions.readWithReceipts(sessionId);
  assert.deepEqual(coherent.session, replay.session);
  assert.ok(coherent.processedRequestIds.includes(input.requestId));
  const invalidHint = simulatedSubmission(
    store.sessions.get(sessionId),
    "hint",
  );
  assert.throws(
    () =>
      store.sessions.commitTurn(
        sessionId,
        invalidHint.input,
        invalidHint.candidate,
      ),
    { code: "STORAGE_VALIDATION_FAILED" },
  );
  const tampered = simulatedSubmission(store.sessions.get(sessionId));
  tampered.candidate.configSnapshot.lesson.title = "changed";
  assert.throws(
    () =>
      store.sessions.commitTurn(sessionId, tampered.input, tampered.candidate),
    { code: "STORAGE_VALIDATION_FAILED" },
  );
  const historyChanged = simulatedSubmission(store.sessions.get(sessionId));
  const first = historyChanged.candidate.turns[0];
  assert.equal(first.action, "question");
  if (first.action === "question") first.payload.english = "Changed history?";
  assert.throws(
    () =>
      store.sessions.commitTurn(
        sessionId,
        historyChanged.input,
        historyChanged.candidate,
      ),
    { code: "STORAGE_VALIDATION_FAILED" },
  );
  const crossing = simulatedSubmission(store.sessions.get(sessionId));
  assert.throws(() =>
    store.sessions.commitTurn(
      store.sessions.progress("airport")[0].id,
      crossing.input,
      crossing.candidate,
    ),
  );
  assert.equal(store.sessions.progress("airport")[0].completedCount, 0);
  // 提前覆盖只计一次；首页 SQL 与事件模型保持一致。
  const early = simulatedSubmission(store.sessions.get(sessionId));
  const answer = early.candidate.turns.at(-2)!;
  assert.equal(answer.action, "answer");
  if (answer.action === "answer") {
    answer.payload.effects.coveredEarly = [
      { questionId: "q4", evidence: "two" },
    ];
  }
  store.sessions.commitTurn(sessionId, early.input, early.candidate);
  assert.equal(store.sessions.progress("hotel")[0].completedCount, 3);
}

function checkCompletionAndRepeat(
  store: SqliteStore,
  creation: { requestId: string; sceneId: string; topicId: string },
) {
  let session = store.sessions.get(
    store.sessions.findCreation(creation)!.result.sessionId,
  );
  while (session.status !== "topic_completed") {
    const step = simulatedSubmission(session);
    // q4 已提前覆盖，下一实际问题直接跳到 q5。
    const last = step.candidate.turns.at(-1)!;
    if (last.action === "question" && last.questionId === "q4") {
      const {
        id,
        referenceAnswer: _,
        ...payload
      } = step.candidate.planSnapshot.questions[4];
      last.questionId = id;
      last.payload = payload;
      step.candidate.currentQuestionId = id;
    }
    session = store.sessions.commitTurn(
      session.id,
      step.input,
      step.candidate,
    ).session;
  }
  assert.equal(store.sessions.progress("hotel")[0].completedCount, 8);
  assert.equal(
    session.turns.filter((event) => event.action === "completed").length,
    1,
  );
  assert.throws(
    () =>
      store.sessions.creationContext({ ...creation, requestId: randomUUID() }),
    { code: "TOPIC_ORDER_REQUIRED" },
  );
  const plan = store.catalog.readPlan("hotel")!;
  const next = {
    requestId: randomUUID(),
    sceneId: "hotel",
    topicId: plan.topics[1].id,
  };
  assert.equal(
    store.sessions.creationContext(next).topic.id,
    plan.topics[1].id,
  );
  assert.throws(
    () => store.sessions.creationContext({ ...next, repeat: true }),
    { code: "TOPIC_NOT_COMPLETED" },
  );
  const repeat = { ...creation, requestId: randomUUID(), repeat: true };
  const again = initialTrainingSession(
    store.catalog.get("hotel"),
    plan.topics[0],
  );
  assert.notEqual(store.sessions.create(repeat, again).id, session.id);
  // 重放旧创建请求仍定位原会话，不偷偷变成最新重练。
  assert.equal(store.sessions.create(creation).id, session.id);
}

async function checkLocks(store: SqliteStore, database: DatabaseSync) {
  await store.withSceneOperation("hotel", async () => {
    assert.equal(database.isTransaction, false);
    await assert.rejects(
      store.withSceneOperation("hotel", async () => 1),
      { code: "REQUEST_BUSY" },
    );
    await store.withSceneOperation("airport", async () =>
      store.profile.updatePreferences({ difficulty: "easy" }),
    );
  });
  await assert.rejects(
    store.withSessionOperation("lock-fixture", async () => {
      throw new Error("offline");
    }),
  );
  assert.equal(
    await store.withSessionOperation("lock-fixture", async () => 1),
    1,
  );
}

function checkLegacyRecovery(directory: string) {
  const source = sqliteFixture("awaiting_continue");
  const snapshot = convertJsonSnapshot(source);
  const database = createDatabase(join(directory, "recovery.sqlite"));
  try {
    initializeSchema(database);
    importSnapshot(database, snapshot);
    const store = new SqliteStore({ database, inFlight: new Set() });
    const session = store.sessions.get(snapshot.sessions[0].id);
    const candidate = structuredClone(session);
    const pending = session.pendingContinuation!;
    candidate.revision++;
    candidate.updatedAt = new Date().toISOString();
    candidate.status = "active";
    candidate.currentQuestionId = pending.nextQuestionId;
    candidate.pendingContinuation = null;
    append(candidate, {
      action: "question",
      questionId: pending.nextQuestionId!,
      payload: {
        english: pending.english!,
        chineseTranslation: pending.chineseTranslation ?? undefined,
        chineseTask: pending.chineseTask!,
        goal: session.planSnapshot.questions[1].goal,
      },
    });
    const request: TurnRequest = {
      requestId: randomUUID(),
      expectedRevision: session.revision,
      action: "continue",
      text: "",
    };
    const saved = store.sessions.commitTurn(session.id, request, candidate);
    assert.equal(saved.session.turns.at(-1)!.action, "question");
    assert.equal(saved.session.revision, session.revision + 1);
    assert.deepEqual(
      store.sessions.commitTurn(session.id, request, candidate),
      saved,
    );
    const oldSession = Object.values(source.sceneData[0].sessions)[0];
    const oldTurn = oldSession.turns[0];
    const oldRequest = {
      requestId: oldTurn.requestId,
      expectedRevision: oldTurn.revision - 1,
      action: oldTurn.action,
      text: "I would like to check in.",
    };
    assert.equal(
      store.sessions.findTurn(session.id, oldRequest)!.result.turnId,
      oldTurn.id,
    );
    assert.ok(
      store.sessions
        .processedRequestIds(session.id)
        .includes(oldTurn.requestId),
    );
  } finally {
    database.close();
  }
}

async function checkResourceCache(directory: string, file: string) {
  assert.throws(() => getStore(join(directory, "missing.sqlite")), {
    code: "DATABASE_NOT_INITIALIZED",
  });
  const link = join(directory, "alias.sqlite");
  await symlink(file, link);
  assert.throws(() => getStore(link), { code: "DATABASE_PATH_UNSAFE" });
  const first = getStore(file);
  const second = getStore(file);
  assert.notEqual(first, second);
  assert.notEqual(first.sessions, second.sessions);
  await first.withSceneOperation("hotel", async () => {
    await assert.rejects(
      second.withSceneOperation("hotel", async () => 1),
      { code: "REQUEST_BUSY" },
    );
  });
  const competing = openDatabase(file);
  try {
    transaction(competing, () => {
      assert.throws(
        () => first.profile.updatePreferences({ difficulty: "medium" }),
        { code: "DATABASE_BUSY" },
      );
    });
  } finally {
    competing.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: "sqlite_repository_check_failed",
      code: (error as { code?: string }).code,
      errorType: (error as Error).name,
      locations: (error as Error).stack
        ?.split("\n")
        .filter((line) => /^\s+at /.test(line))
        .slice(0, 5),
    }),
  );
  process.exitCode = 1;
});
