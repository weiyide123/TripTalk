import { backup, type DatabaseSync } from "node:sqlite";
import { chmod, mkdtemp, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import {
  checkDatabase,
  openDatabase,
  transaction,
} from "../src/server/storage/database";
import {
  assertSchemaVersion,
  assertUpgradeable,
  initializeSchema,
} from "../src/server/storage/schema-migrations";

/** 显式停服升级：先一致性备份，再事务迁移；不自动覆盖恢复，不打印业务文本。 */
async function main() {
  const { values } = parseArgs({ options: { target: { type: "string" } } });
  if (!values.target)
    throw new Error(
      "Usage: npm run sqlite:upgrade -- --target data/triptalk.sqlite",
    );
  const target = resolve(values.target);
  const database = openDatabase(target);
  try {
    assertUpgradeable(database);
    checkDatabase(database);
    try {
      assertSchemaVersion(database);
      console.log("数据库已经是当前版本，无需升级。");
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== "DATABASE_VERSION_MISMATCH")
        throw error;
    }
    const backupRoot = join(dirname(target), "backups");
    await mkdir(backupRoot, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(backupRoot, "before-schema-upgrade-"));
    const backupPath = join(directory, "triptalk.sqlite");
    await backup(database, backupPath);
    await chmod(backupPath, 0o600);
    const copy = openDatabase(backupPath, true);
    try {
      checkDatabase(copy);
      const tables = copy
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations' ORDER BY name",
        )
        .all()
        .map((row) => String(row.name));
      const before = learningDigest(copy, tables);
      if (before !== learningDigest(database, tables))
        throw new Error(
          "Database changed during backup; stop the development server first",
        );
      initializeSchema(database);
      assertSchemaVersion(database);
      checkDatabase(database);
      if (before !== learningDigest(database, tables))
        throw new Error(
          "Learning records changed during upgrade; inspect backup before continuing",
        );
      console.log(
        JSON.stringify({
          event: "sqlite_upgraded",
          backupPath,
          learningRecordsUnchanged: true,
        }),
      );
    } finally {
      copy.close();
    }
  } finally {
    database.close();
  }
}

/** 对升级前全部业务表做摘要，包括已有收藏；新建表不影响前后比较。 */
function learningDigest(database: DatabaseSync, tables: string[]) {
  return transaction(
    database,
    () => {
      const hash = createHash("sha256");
      for (const table of tables) {
        hash.update(table);
        const rows = database
          .prepare(
            `SELECT * FROM "${table.replaceAll('"', '""')}" ORDER BY rowid`,
          )
          .all();
        hash.update(JSON.stringify(rows));
      }
      return hash.digest("hex");
    },
    "read",
  );
}

main().catch((error: unknown) => {
  console.error(
    "升级失败；保留现有库与备份，不会自动覆盖恢复。",
    (error as Error).name,
  );
  process.exitCode = 1;
});
