import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { AppError } from "../errors";
import { transaction } from "./database";

/** 核对已安装结构的版本、名称和校验和与代码完全一致；只检查，不执行升级。 */
export function assertSchemaVersion(database: DatabaseSync) {
  const expected = migrations();
  const rows = installedMigrations(database);
  assertMigrationPrefix(rows, expected);
  if (rows.length !== expected.length) throw versionMismatch();
}

/** 在同一事务执行尚未安装的结构版本并记账；仅供显式初始化/升级，页面读取不得调用。 */
export function initializeSchema(database: DatabaseSync) {
  transaction(database, () => {
    const expected = migrations();
    const rows = installedMigrations(database);
    assertMigrationPrefix(rows, expected);
    for (const migration of expected.slice(rows.length)) {
      database.exec(migration.sql);
      database
        .prepare(
          "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
        )
        .run(
          migration.version,
          migration.name,
          migration.checksum,
          new Date().toISOString(),
        );
    }
  });
}

/** 读取代码明确登记的 SQL 版本及内容校验和；不自动发现或执行目录中的任意 SQL。 */
function migrations() {
  // 新结构追加版本，不扫描任意 SQL 文件，也不修改已执行的版本。
  return ["initial", "favorites", "answer_favorites"].map((name, index) => {
    const version = index + 1;
    const filename = `${String(version).padStart(3, "0")}_${name}.sql`;
    const sql = readFileSync(
      join(process.cwd(), "src/server/storage/migrations", filename),
      "utf8",
    );
    return {
      version,
      name,
      checksum: createHash("sha256").update(sql).digest("hex"),
      sql,
    };
  });
}

/** 升级前只核对历史版本前缀，拒绝未知或被改写的结构，不执行 SQL。 */
export function assertUpgradeable(database: DatabaseSync) {
  const rows = installedMigrations(database);
  if (!rows.length) throw versionMismatch();
  assertMigrationPrefix(rows, migrations());
}

/** 读取已安装版本；空库返回空列表，已有业务表却缺少版本账本时拒绝继续。 */
function installedMigrations(database: DatabaseSync) {
  const tables = database
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all();
  if (!tables.length) return [];
  if (!tables.some((table) => table.name === "schema_migrations"))
    throw versionMismatch();
  const rows = database
    .prepare(
      "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
    )
    .all();
  if (!rows.length) throw versionMismatch();
  return rows;
}

/** 要求已安装记录是代码版本列表的完整前缀，拒绝未知版本或被改写的历史 SQL。 */
function assertMigrationPrefix(
  rows: Record<string, SQLOutputValue>[],
  expected: ReturnType<typeof migrations>,
) {
  if (
    rows.length > expected.length ||
    rows.some((row, index) => {
      const migration = expected[index];
      return (
        row.version !== migration.version ||
        row.name !== migration.name ||
        row.checksum !== migration.checksum
      );
    })
  )
    throw versionMismatch();
}

/** 构造统一的结构不匹配错误，提示显式处理而不是自动重建数据库。 */
function versionMismatch() {
  return new AppError(
    "DATABASE_VERSION_MISMATCH",
    "数据库结构版本不匹配，请显式升级；不会自动重建。",
    500,
  );
}
