import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabase } from "../src/server/storage/database";
import { initializeSchema } from "../src/server/storage/schema-migrations";
import {
  createCatalogSnapshot,
  writeSnapshotToEmptyDatabase,
} from "../src/server/storage/snapshots/write-snapshot";

/** 全新安装专用：先校验种子，再独占创建目标；拒绝覆盖已有数据库。 */
async function main() {
  const { values } = parseArgs({
    options: {
      target: { type: "string" },
      catalog: { type: "string" },
    },
  });
  if (!values.target || !values.catalog) {
    throw new Error(
      "Usage: npm run sqlite:init -- --target <new.sqlite> --catalog <scenes.json>",
    );
  }
  const catalog: unknown = JSON.parse(
    await readFile(resolve(values.catalog), "utf8"),
  );
  const snapshot = createCatalogSnapshot(catalog);
  const database = createDatabase(resolve(values.target));
  try {
    initializeSchema(database);
    writeSnapshotToEmptyDatabase(database, snapshot);
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    console.log(
      JSON.stringify({
        event: "sqlite_initialized",
        target: resolve(values.target),
        scenes: snapshot.scenes.length,
      }),
    );
  } finally {
    database.close();
  }
}

main().catch(() => {
  console.error(
    "初始化失败：检查目标是否已存在、路径权限及场景目录。不会覆盖已有数据库。",
  );
  process.exitCode = 1;
});
