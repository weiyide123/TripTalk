import type { DatabaseSync } from "node:sqlite";
import {
  operationReceiptSchema,
  type OperationReceipt,
} from "@/contracts/operation-receipt";
import { AppError } from "../errors";
import { inputHash } from "../request-hash";

type Operation = OperationReceipt["operation"];
type ReceiptFor<T extends Operation> = Extract<
  OperationReceipt,
  { operation: T }
>;

/**
 * 按操作类型、作用域和请求编号查成功回执；无记录返回 null，同编号不同输入拒绝。
 * 应先于版本检查和模型调用，确保响应丢失后的重试不会重复执行业务。
 */
export function findOperationReceipt<T extends Operation>(
  database: DatabaseSync,
  operation: T,
  scopeId: string,
  input: { requestId: string },
): ReceiptFor<T> | null {
  const row = database
    .prepare(
      `SELECT * FROM operation_receipts
    WHERE operation = ? AND scope_id = ? AND request_id = ?`,
    )
    .get(operation, scopeId, input.requestId);
  if (!row) return null;
  const receipt = operationReceiptSchema.parse({
    operation: row.operation,
    scopeId: row.scope_id,
    requestId: row.request_id,
    inputHash: row.input_hash,
    result: JSON.parse(String(row.result_json)),
    createdAt: row.created_at,
  });
  if (receipt.inputHash !== inputHash(input)) {
    throw new AppError("REQUEST_ID_CONFLICT", "操作标识已用于不同请求。", 409);
  }
  return receipt as ReceiptFor<T>;
}

/** 在现有业务事务内校验关联并插入成功回执；不允许脱离业务写入单独提交“成功”。 */
export function insertOperationReceipt(
  database: DatabaseSync,
  input: OperationReceipt,
) {
  if (!database.isTransaction) {
    throw new AppError(
      "RECEIPT_TRANSACTION_REQUIRED",
      "回执必须和业务数据一起提交。",
      500,
    );
  }
  const receipt = operationReceiptSchema.parse(input);
  if (!receipt.createdAt) {
    throw new AppError(
      "RECEIPT_TIME_REQUIRED",
      "新回执必须提供提交时间。",
      500,
    );
  }
  assertReceiptTarget(database, receipt);
  database
    .prepare(
      `INSERT INTO operation_receipts
    (operation, scope_id, request_id, input_hash, result_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      receipt.operation,
      receipt.scopeId,
      receipt.requestId,
      receipt.inputHash,
      JSON.stringify(receipt.result),
      receipt.createdAt,
    );
}

/** 读取指定练习已成功的对话请求编号，供页面判断待确认消息是否已经保存。 */
export function processedRequestIds(database: DatabaseSync, sessionId: string) {
  return database
    .prepare(
      `SELECT request_id FROM operation_receipts
    WHERE operation = 'session-turn' AND scope_id = ? ORDER BY created_at, request_id`,
    )
    .all(sessionId)
    .map((row) => String(row.request_id));
}

/** 核对回执指向的场景、练习或事件已存在且归属/版本吻合，防止保存虚假成功记录。 */
function assertReceiptTarget(
  database: DatabaseSync,
  receipt: OperationReceipt,
) {
  let valid = false;
  switch (receipt.operation) {
    case "initialize-scene":
      valid =
        receipt.scopeId === receipt.result.sceneId &&
        Boolean(
          database
            .prepare(
              "SELECT 1 FROM scenes WHERE id = ? AND course_generated_at IS NOT NULL",
            )
            .get(receipt.result.sceneId),
        );
      break;
    case "create-scene":
      valid = Boolean(
        database
          .prepare("SELECT 1 FROM scenes WHERE id = ?")
          .get(receipt.result.sceneId),
      );
      break;
    case "create-session":
      valid = Boolean(
        database
          .prepare("SELECT 1 FROM sessions WHERE id = ? AND scene_id = ?")
          .get(receipt.result.sessionId, receipt.scopeId),
      );
      break;
    case "session-turn":
      valid =
        receipt.result.sessionId === receipt.scopeId &&
        Boolean(
          database
            .prepare(
              `SELECT 1 FROM turns t JOIN sessions s ON s.id = t.session_id
         WHERE t.id = ? AND s.id = ? AND t.sequence > 1 AND s.revision = ?`,
            )
            .get(
              receipt.result.turnId,
              receipt.scopeId,
              receipt.result.revision,
            ),
        );
      break;
  }
  if (!valid) {
    throw new AppError(
      "RECEIPT_TARGET_INVALID",
      "回执与已保存记录不一致。",
      500,
    );
  }
}
