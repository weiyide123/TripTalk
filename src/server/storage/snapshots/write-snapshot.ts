import { isDeepStrictEqual } from "node:util";
import type { DatabaseSync } from "node:sqlite";
import { sceneSchema } from "@/contracts/scene";
import {
  sqliteSnapshotSchema,
  type SqliteSnapshot,
} from "@/contracts/sqlite-snapshot";
import { checkDatabase, transaction } from "../database";
import { assertSchemaVersion } from "../schema-migrations";
import { insertSnapshotRows, readSnapshotRows } from "./snapshot-rows";

/** 从场景种子创建全新安装快照；不包含课程、用户进度或旧 JSON 转换。 */
export function createCatalogSnapshot(input: unknown): SqliteSnapshot {
  const catalog = sceneSchema.array().min(1).parse(input);
  return sqliteSnapshotSchema.parse({
    profile: null,
    scenes: catalog.map((scene, position) => ({
      ...scene,
      origin: "builtin",
      position,
      plan: null,
    })),
    sessions: [],
    receipts: [],
  });
}

/** 将当前格式快照原子写入空库并读回核对；仅用于显式安装与离线检查，拒绝覆盖。 */
export function writeSnapshotToEmptyDatabase(
  database: DatabaseSync,
  input: SqliteSnapshot,
) {
  const snapshot = sqliteSnapshotSchema.parse(input);
  assertSchemaVersion(database);
  transaction(database, () => {
    // 只向空库写入当前快照；不 upsert、不清表、不覆盖任何历史。
    for (const table of [
      "profile",
      "scenes",
      "scene_topics",
      "sessions",
      "turns",
      "operation_receipts",
    ]) {
      if (database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) {
        throw new Error("Snapshot target must have no business records");
      }
    }
    insertSnapshotRows(database, snapshot);
    checkDatabase(database);
    assertEquivalentSnapshot(snapshot, readSnapshotRows(database));
  });
}

/** 比较完整业务快照，忽略集合顺序；失败不打印用户内容。 */
export function assertEquivalentSnapshot(
  expected: SqliteSnapshot,
  actual: SqliteSnapshot,
) {
  if (!isDeepStrictEqual(canonical(expected), canonical(actual))) {
    // 不用 assert.deepEqual 输出差异，避免把整段对话泄漏到终端日志。
    throw new Error("Database snapshot differs from expected data");
  }
}

/** 归一化无业务顺序的集合，保留会话内事件及主题的原顺序。 */
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
