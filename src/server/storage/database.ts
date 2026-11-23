import { DatabaseSync } from "node:sqlite";
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { AppError, sqliteError } from "../errors";

// 本模块只管理连接和短事务，不导入业务服务，不在 import/build 时创建文件。
/** 显式创建私有数据库文件并连接；已有文件直接报错，不覆盖数据，也不负责建业务表。 */
export function createDatabase(file: string) {
  assertSupportedNode();
  const target = assertDatabasePath(file);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  assertDatabasePath(target);
  // wx 保证不覆盖已有库；失败候选文件留给操作者检查，不自动删除。
  closeSync(openSync(target, "wx", 0o600));
  return connect(target, false);
}

/** 打开已存在的安全数据库文件；readOnly 禁止写入，不在此处初始化或升级表结构。 */
export function openDatabase(file: string, readOnly = false) {
  assertSupportedNode();
  const target = assertDatabasePath(file);
  if (!lstatSync(target).isFile() || lstatSync(target).isSymbolicLink()) {
    throw new AppError("DATABASE_PATH_UNSAFE", "数据库必须是普通文件。", 500);
  }
  return connect(target, readOnly);
}

/**
 * 在短事务内执行同步 SQL 并返回 work 的结果：全部成功才提交，失败尝试回滚。
 * mode=read 用于一致性读取，可复用外层事务；写事务禁止嵌套，所有模式禁止 Promise。
 * 模型/网络调用必须在事务外进行；无法确认回滚时不宣称数据未保存。
 */
export function transaction<T>(
  database: DatabaseSync,
  work: () => T extends PromiseLike<unknown> ? never : T,
  mode: "read" | "write" = "write",
): T {
  if (work.constructor.name === "AsyncFunction") {
    throw new AppError(
      "DATABASE_TRANSACTION_INVALID",
      "不允许嵌套或异步写事务。",
      500,
    );
  }
  // 读聚合可复用外层写事务的快照；不创建嵌套事务或持有额外写锁。
  if (database.isTransaction) {
    if (mode === "read") return synchronousResult(work());
    throw new AppError(
      "DATABASE_TRANSACTION_INVALID",
      "不允许嵌套写事务。",
      500,
    );
  }
  let committing = false;
  try {
    database.exec(mode === "read" ? "BEGIN" : "BEGIN IMMEDIATE");
    const result = synchronousResult(work());
    committing = true;
    database.exec("COMMIT");
    return result;
  } catch (error) {
    let rolledBack = false;
    if (database.isTransaction) {
      try {
        database.exec("ROLLBACK");
        rolledBack = true;
      } catch (rollbackError) {
        database.close();
        throw new AppError(
          "DATABASE_ROLLBACK_FAILED",
          "数据库回滚失败，请停止写入并检查。",
          500,
          false,
          { submission: "unknown" },
          rollbackError,
        );
      }
    }
    // 提交阶段 I/O 错误且无法确认回滚时，不能声称“尚未保存”。
    const submission = !committing || rolledBack ? "not_committed" : "unknown";
    throw sqliteError(error, submission) ?? error;
  }
}

/** 拒绝普通函数返回的 Promise/thenable，避免把异步结果误当作事务已同步完成。 */
function synchronousResult<T>(result: T): T {
  if (result && typeof (result as { then?: unknown }).then === "function") {
    throw new AppError(
      "DATABASE_TRANSACTION_INVALID",
      "事务不能返回 Promise。",
      500,
    );
  }
  return result;
}

/** 检查 SQLite 文件完整性和外键关联；失败抛错，不修复数据，也不替代业务校验。 */
export function checkDatabase(database: DatabaseSync) {
  const integrity = database.prepare("PRAGMA integrity_check").all();
  const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
  if (
    integrity.length !== 1 ||
    integrity[0].integrity_check !== "ok" ||
    foreignKeys.length
  ) {
    throw new AppError(
      "DATABASE_INTEGRITY_FAILED",
      "数据库完整性或关联检查未通过。",
      500,
    );
  }
}

/** 建立连接并配置外键、忙锁等待及可写库的 WAL/FULL 同步；配置失败关闭连接。 */
function connect(file: string, readOnly: boolean) {
  const database = new DatabaseSync(file, {
    readOnly,
    timeout: 1000,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
  });
  try {
    database.exec("PRAGMA trusted_schema = OFF");
    if (!readOnly) {
      database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL");
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

/** 限定项目已验证的 Node 24.18+（不含 25），避免内置 SQLite API 版本不一致。 */
function assertSupportedNode() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major !== 24 || minor < 18) {
    throw new AppError(
      "DATABASE_RUNTIME_UNSUPPORTED",
      "SQLite 模块需要 Node 24.18 或更高的 Node 24 版本。",
      500,
    );
  }
}

/** 返回绝对路径；解析已有祖先目录，防止经目录别名把数据库放进项目根目录或 public。 */
function assertDatabasePath(file: string) {
  const target = resolve(file);
  const project = realpathSync(process.cwd());
  // 解析已有祖先，避免经符号链接把私有数据库落到 public。
  let ancestor = dirname(target);
  while (true) {
    try {
      const canonical = resolve(
        realpathSync(ancestor),
        relative(ancestor, target),
      );
      const publicRelative = relative(resolve(project, "public"), canonical);
      const outsidePublic =
        publicRelative === ".." ||
        publicRelative.startsWith("../") ||
        isAbsolute(publicRelative);
      if (dirname(canonical) === project || !outsidePublic) {
        throw new AppError(
          "DATABASE_PATH_UNSAFE",
          "数据库不能放在项目根或 public 目录。",
          500,
        );
      }
      return target;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      ancestor = dirname(ancestor);
    }
  }
}
