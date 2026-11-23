import type { DatabaseSync } from "node:sqlite";
import {
  sqliteSnapshotSchema,
  type SqliteSnapshot,
} from "@/contracts/sqlite-snapshot";

export function insertSnapshotRows(
  database: DatabaseSync,
  snapshot: SqliteSnapshot,
) {
  const sceneInsert = database.prepare(`INSERT INTO scenes
    (id, origin, position, version, title, description, scope, english_title, art,
     course_source, course_generated_at, course_planning_call_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const topicInsert = database.prepare(`INSERT INTO scene_topics
    (scene_id, topic_id, position, title, scope, boundaries) VALUES (?, ?, ?, ?, ?, ?)`);
  for (const scene of snapshot.scenes) {
    sceneInsert.run(
      scene.id,
      scene.origin,
      scene.position,
      scene.version,
      scene.title,
      scene.description,
      scene.scope,
      scene.englishTitle,
      scene.art,
      scene.plan?.source ?? null,
      scene.plan?.createdAt ?? null,
      scene.plan ? JSON.stringify(scene.plan.planningCall) : null,
    );
    scene.plan?.topics.forEach((topic, position) => {
      topicInsert.run(
        scene.id,
        topic.id,
        position,
        topic.title,
        topic.scope,
        topic.boundaries,
      );
    });
  }
  if (snapshot.profile) {
    const profile = snapshot.profile;
    database
      .prepare(
        `INSERT INTO profile
      (id, onboarding_completed_at, difficulty, last_scene_id) VALUES (1, ?, ?, ?)`,
      )
      .run(
        profile.onboardingCompletedAt,
        profile.difficulty,
        profile.lastSceneId,
      );
  }
  insertSessions(database, snapshot);
  const receiptInsert = database.prepare(`INSERT INTO operation_receipts
    (operation, scope_id, request_id, input_hash, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
  for (const receipt of snapshot.receipts) {
    receiptInsert.run(
      receipt.operation,
      receipt.scopeId,
      receipt.requestId,
      receipt.inputHash,
      JSON.stringify(receipt.result),
      receipt.createdAt,
    );
  }
}

function insertSessions(database: DatabaseSync, snapshot: SqliteSnapshot) {
  const sessionInsert = database.prepare(`INSERT INTO sessions
    (id, scene_id, topic_id, mode, status, revision, current_question_id,
     config_snapshot_json, plan_snapshot_json, planning_call_json, pending_continuation_json,
     created_at, updated_at, topic_completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const eventInsert = database.prepare(`INSERT INTO turns
    (id, session_id, sequence, action, question_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const session of snapshot.sessions) {
    sessionInsert.run(
      session.id,
      session.sceneId,
      session.topicId,
      session.mode,
      session.status,
      session.revision,
      session.currentQuestionId,
      JSON.stringify(session.configSnapshot),
      JSON.stringify(session.planSnapshot),
      JSON.stringify(session.planningCall),
      session.pendingContinuation
        ? JSON.stringify(session.pendingContinuation)
        : null,
      session.createdAt,
      session.updatedAt,
      session.topicCompletedAt,
    );
    for (const event of session.turns) {
      eventInsert.run(
        event.id,
        event.sessionId,
        event.sequence,
        event.action,
        event.questionId,
        JSON.stringify(event.payload),
        event.createdAt,
      );
    }
  }
}

export function readSnapshotRows(database: DatabaseSync): SqliteSnapshot {
  const profile = database.prepare("SELECT * FROM profile WHERE id = 1").get();
  const scenes = database
    .prepare("SELECT * FROM scenes ORDER BY position")
    .all();
  const topics = database
    .prepare("SELECT * FROM scene_topics ORDER BY scene_id, position")
    .all();
  const sessions = database.prepare("SELECT * FROM sessions ORDER BY id").all();
  const events = database
    .prepare("SELECT * FROM turns ORDER BY session_id, sequence")
    .all();
  const receipts = database
    .prepare(
      "SELECT * FROM operation_receipts ORDER BY operation, scope_id, request_id",
    )
    .all();
  for (const scene of scenes) {
    const children = topics.filter((topic) => topic.scene_id === scene.id);
    if (
      (scene.course_generated_at === null && children.length) ||
      children.some((topic, index) => topic.position !== index)
    ) {
      throw new Error("Course metadata/topics mismatch");
    }
  }
  return sqliteSnapshotSchema.parse({
    profile: profile
      ? {
          schemaVersion: 1,
          onboardingCompletedAt: profile.onboarding_completed_at,
          difficulty: profile.difficulty,
          lastSceneId: profile.last_scene_id,
        }
      : null,
    scenes: scenes.map((scene) => ({
      id: scene.id,
      origin: scene.origin,
      position: scene.position,
      version: scene.version,
      title: scene.title,
      description: scene.description,
      scope: scene.scope,
      englishTitle: scene.english_title,
      art: scene.art,
      plan:
        scene.course_generated_at === null
          ? null
          : {
              sceneId: scene.id,
              source: scene.course_source,
              createdAt: scene.course_generated_at,
              planningCall: JSON.parse(String(scene.course_planning_call_json)),
              topics: topics
                .filter((topic) => topic.scene_id === scene.id)
                .map((topic) => ({
                  id: topic.topic_id,
                  title: topic.title,
                  scope: topic.scope,
                  boundaries: topic.boundaries,
                })),
            },
    })),
    sessions: sessions.map((session) => ({
      id: session.id,
      sceneId: session.scene_id,
      topicId: session.topic_id,
      mode: session.mode,
      status: session.status,
      revision: session.revision,
      currentQuestionId: session.current_question_id,
      configSnapshot: JSON.parse(String(session.config_snapshot_json)),
      planSnapshot: JSON.parse(String(session.plan_snapshot_json)),
      planningCall: JSON.parse(String(session.planning_call_json)),
      pendingContinuation:
        session.pending_continuation_json === null
          ? null
          : JSON.parse(String(session.pending_continuation_json)),
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      topicCompletedAt: session.topic_completed_at,
      turns: events
        .filter((event) => event.session_id === session.id)
        .map((event) => ({
          id: event.id,
          sessionId: event.session_id,
          sequence: event.sequence,
          action: event.action,
          questionId: event.question_id,
          payload: JSON.parse(String(event.payload_json)),
          createdAt: event.created_at,
        })),
    })),
    receipts: receipts.map((receipt) => ({
      operation: receipt.operation,
      scopeId: receipt.scope_id,
      requestId: receipt.request_id,
      inputHash: receipt.input_hash,
      result: JSON.parse(String(receipt.result_json)),
      createdAt: receipt.created_at,
    })),
  });
}
