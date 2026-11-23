import { lstatSync, realpathSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CatalogRepository } from "../repositories/catalog-repository";
import { ProfileRepository } from "../repositories/profile-repository";
import { SessionRepository } from "../repositories/session-repository";
import { AppError } from "../errors";
import { openDatabase } from "./database";
import { assertSchemaVersion } from "./schema-migrations";

type StoreResources = {
  database: DatabaseSync;
  inFlight: Set<string>;
};
const globalStore = globalThis as typeof globalThis & {
  triptalkSqliteResources?: Map<string, StoreResources>;
};

export class SqliteStore {
  readonly profile;
  readonly catalog;
  readonly sessions;

  constructor(private readonly resources: StoreResources) {
    this.profile = new ProfileRepository(resources.database);
    this.catalog = new CatalogRepository(resources.database);
    this.sessions = new SessionRepository(resources.database);
  }

  /** 防止同一场景的初始化/创建练习并发执行；只加进程内业务锁，不开启 SQL 事务。 */
  async withSceneOperation<T>(sceneId: string, work: () => Promise<T>) {
    return this.exclusive("scene:" + sceneId, work);
  }

  /** 同一练习同时只处理一个提交；重复并发请求立即报忙，不排队，也不锁其他练习。 */
  async withSessionOperation<T>(sessionId: string, work: () => Promise<T>) {
    return this.exclusive("session:" + sessionId, work);
  }

  /**
   * 按 key 互斥执行 work 并返回其结果；无论成功失败都释放占用标记。
   * key 是内部的 scene:场景ID 或 session:练习ID；占用中立即拒绝，不排队。
   * 仅保护当前 Node 进程，不代替数据库事务、版本检查或幂等回执。
   */
  private async exclusive<T>(key: string, work: () => Promise<T>) {
    if (this.resources.inFlight.has(key)) {
      throw new AppError(
        "REQUEST_BUSY",
        "上一条请求仍在处理中，请稍后同步记录。",
        409,
        true,
      );
    }
    this.resources.inFlight.add(key);
    try {
      return await work();
    } finally {
      this.resources.inFlight.delete(key);
    }
  }
}

/**
 * 返回业务仓库入口，按规范路径复用数据库连接和在途锁，不缓存学习数据。
 * 仅打开并校验已安装的库；不创建文件、不读 JSON、不自动迁移。
 */
export function getStore(
  file = resolve(
    process.cwd(),
    process.env.DATA_DIR?.trim() || "data",
    "triptalk.sqlite",
  ),
) {
  const databasePath = canonicalDatabasePath(file);
  globalStore.triptalkSqliteResources ??= new Map();
  let resources = globalStore.triptalkSqliteResources.get(databasePath);
  if (!resources) {
    const database = openDatabase(databasePath);
    try {
      assertSchemaVersion(database);
    } catch (error) {
      database.close();
      throw error;
    }
    resources = { database, inFlight: new Set() };
    globalStore.triptalkSqliteResources.set(databasePath, resources);
  } else {
    assertSchemaVersion(resources.database);
  }
  // 热更新仅复用连接/在途锁，不保留旧 schema 或仓库闭包。
  return new SqliteStore(resources);
}

/**
 * 将数据库路径归一化，供连接缓存使用，避免父目录别名产生多份连接/锁。
 * 要求文件已存在且为普通文件；拒绝数据库文件自身的符号链接，不创建目录或文件。
 */
function canonicalDatabasePath(file: string) {
  try {
    // 统一父目录别名，但不追随数据库文件自身的符号链接。
    const target = resolve(realpathSync(dirname(file)), basename(file));
    if (!lstatSync(target).isFile() || lstatSync(target).isSymbolicLink()) {
      throw new AppError("DATABASE_PATH_UNSAFE", "数据库必须是普通文件。", 500);
    }
    return target;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new AppError(
        "DATABASE_NOT_INITIALIZED",
        "数据库尚未安装，请先完成显式初始化或迁移。",
        503,
      );
    }
    throw error;
  }
}
