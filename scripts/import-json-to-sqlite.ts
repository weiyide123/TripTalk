import { parseArgs } from "node:util";
import { isDeepStrictEqual } from "node:util";
import { basename, dirname, relative, resolve, isAbsolute } from "node:path";
import { mkdir, realpath } from "node:fs/promises";
import { createDatabase } from "../src/server/storage/database";
import { initializeSchema } from "../src/server/storage/schema-migrations";
import { readJsonSource } from "../src/server/storage/import/read-json-source";
import { importSnapshot } from "../src/server/storage/import/import-snapshot";

// 只生成候选库，不停止服务、不安装到 DATA_DIR、不删除源 JSON。
async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: "string" },
      catalog: { type: "string" },
      target: { type: "string" },
    },
  });
  if (!values.source || !values.catalog || !values.target) {
    throw new Error(
      "Usage: npm run sqlite:import -- --source <backup-data-dir> --catalog <scenes.json> --target <new-candidate.sqlite>",
    );
  }
  const source = await realpath(values.source);
  const target = resolve(values.target);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const canonicalTarget = resolve(
    await realpath(dirname(target)),
    basename(target),
  );
  const fromSource = relative(source, canonicalTarget);
  if (
    fromSource !== ".." &&
    !fromSource.startsWith("../") &&
    !isAbsolute(fromSource)
  ) {
    throw new Error("Candidate database must be outside the source directory");
  }
  const before = await readJsonSource(source, resolve(values.catalog));
  const database = createDatabase(target);
  try {
    initializeSchema(database);
    importSnapshot(database, before.snapshot);
    const after = await readJsonSource(source, resolve(values.catalog));
    if (!isDeepStrictEqual(before.manifest, after.manifest)) {
      throw new Error(
        "Source changed during import; candidate must not be installed",
      );
    }
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    console.log(
      JSON.stringify({
        event: "sqlite_candidate_verified",
        target,
        scenes: before.snapshot.scenes.length,
        sessions: before.snapshot.sessions.length,
        turns: before.snapshot.sessions.reduce(
          (count, session) => count + session.turns.length,
          0,
        ),
        receipts: before.snapshot.receipts.length,
        sourceFiles: before.manifest,
        installed: false,
        modelCalls: 0,
      }),
    );
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  const detail = error as { name?: string; code?: string; issues?: unknown };
  console.error(
    JSON.stringify({
      event: "sqlite_import_failed",
      errorType: detail.name,
      code: detail.code,
      message: detail.issues
        ? "Source or converted data failed validation"
        : (error as Error).message,
      installed: false,
    }),
  );
  process.exitCode = 1;
});
