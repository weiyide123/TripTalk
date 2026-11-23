import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../../src/server/storage/database";
import { initializeSchema } from "../../src/server/storage/schema-migrations";
import { importSnapshot } from "../../src/server/storage/import/import-snapshot";
import { convertJsonSnapshot } from "../../src/server/storage/import/convert-json";
import { getStore } from "../../src/server/storage/store";
import { sqliteFixture } from "./sqlite-fixture";
import { initialTrainingSession } from "./sqlite-repository-fixture";

// 仅在系统临时目录建库，不读取 .env 或正式学习数据。
export async function serviceFixture() {
  const directory = await mkdtemp(join(tmpdir(), "triptalk-service-check-"));
  const file = join(directory, "triptalk.sqlite");
  const database = createDatabase(file);
  const source = sqliteFixture();
  try {
    initializeSchema(database);
    importSnapshot(
      database,
      convertJsonSnapshot({
        ...source,
        profile: null,
        sceneData: [],
      }),
    );
  } finally {
    database.close();
  }
  const store = getStore(file);
  const plan = source.sceneData[0].plan!;
  store.catalog.initializeCourse(
    { requestId: randomUUID(), sceneId: "hotel" },
    plan,
  );
  const candidate = initialTrainingSession(
    store.catalog.get("hotel"),
    plan.topics[0],
  );
  const session = store.sessions.create(
    {
      requestId: randomUUID(),
      sceneId: "hotel",
      topicId: plan.topics[0].id,
    },
    candidate,
  );
  return { directory, file, store, session, plan };
}
