import { isDeepStrictEqual } from "node:util";
import type { DatabaseSync } from "node:sqlite";
import {
  sqliteSnapshotSchema,
  type SqliteSnapshot,
} from "@/contracts/sqlite-snapshot";
import { checkDatabase, transaction } from "../database";
import { assertSchemaVersion } from "../schema-migrations";
import { insertSnapshotRows, readSnapshotRows } from "./snapshot-rows";

export function importSnapshot(database: DatabaseSync, input: SqliteSnapshot) {
  const snapshot = sqliteSnapshotSchema.parse(input);
  assertSchemaVersion(database);
  transaction(database, () => {
    // 只允许一次性导入全新候选库；不 upsert、不清表、不覆盖任何历史。
    for (const table of [
      "profile",
      "scenes",
      "scene_topics",
      "sessions",
      "turns",
      "operation_receipts",
    ]) {
      if (database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) {
        throw new Error("Import target must have no business records");
      }
    }
    insertSnapshotRows(database, snapshot);
    checkDatabase(database);
    assertEquivalentSnapshot(snapshot, readSnapshotRows(database));
  });
}

export function assertEquivalentSnapshot(
  expected: SqliteSnapshot,
  actual: SqliteSnapshot,
) {
  if (!isDeepStrictEqual(canonical(expected), canonical(actual))) {
    // 不用 assert.deepEqual 输出差异，避免把整段对话泄漏到终端日志。
    throw new Error("Database snapshot differs from converted source");
  }
}

function canonical(snapshot: SqliteSnapshot) {
  return {
    profile: snapshot.profile,
    scenes: [...snapshot.scenes].sort((a, b) => a.position - b.position),
    sessions: [...snapshot.sessions].sort((a, b) => a.id.localeCompare(b.id)),
    receipts: [...snapshot.receipts].sort((a, b) => {
      const key = (receipt: typeof a) =>
        JSON.stringify([receipt.operation, receipt.scopeId, receipt.requestId]);
      return key(a).localeCompare(key(b));
    }),
  };
}
