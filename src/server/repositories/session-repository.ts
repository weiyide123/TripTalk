import type { DatabaseSync } from "node:sqlite";
import {
  trainingSessionSchema,
  type TrainingSession,
} from "@/contracts/training-session";
import {
  createRequestSchema,
  turnRequestSchema,
  type CreateRequest,
  type TurnRequest,
} from "@/contracts/requests";
import { CatalogRepository } from "./catalog-repository";
import {
  findOperationReceipt,
  insertOperationReceipt,
  processedRequestIds,
} from "./operation-receipts";
import {
  readSession,
  insertSession,
  updateSessionState,
  appendEvents,
} from "./session-records";
import { assertNewSession, assertTurnCommit } from "./session-write-rules";
import { readLearningProgress } from "./learning-progress";
import { AppError } from "../errors";
import { inputHash } from "../request-hash";
import { transaction } from "../storage/database";

export class SessionRepository {
  constructor(private readonly database: DatabaseSync) {}

  /** 在同一读事务加载练习和有序事件，返回独立数据快照；修改返回值不会自动落盘。 */
  get(sessionId: string) {
    return transaction(
      this.database,
      () => readSession(this.database, sessionId),
      "read",
    );
  }

  /** 一致性读取练习与成功请求编号，避免页面拿到不同提交时刻的状态和回执。 */
  readWithReceipts(sessionId: string) {
    return transaction(
      this.database,
      () => ({
        session: this.get(sessionId),
        processedRequestIds: this.processedRequestIds(sessionId),
      }),
      "read",
    );
  }

  /** 查询场景下各次练习的进度摘要，不加载完整对话记录。 */
  progress(sceneId: string) {
    return readLearningProgress(this.database, sceneId);
  }

  /** 列出已成功提交的对话请求编号，供前端核对待确认消息。 */
  processedRequestIds(sessionId: string) {
    return processedRequestIds(this.database, sessionId);
  }

  /** 查找创建练习的成功回执；同编号不同输入报冲突，尚未成功返回 null。 */
  findCreation(input: CreateRequest) {
    const request = createRequestSchema.parse(input);
    return findOperationReceipt(
      this.database,
      "create-session",
      request.sceneId,
      request,
    );
  }

  /** 查找该练习的对话提交回执，响应丢失后可据此恢复，而不重复调用模型。 */
  findTurn(sessionId: string, input: TurnRequest) {
    const request = turnRequestSchema.parse(input);
    return findOperationReceipt(
      this.database,
      "session-turn",
      sessionId,
      request,
    );
  }

  /** 检查目录、主题顺序和重练条件，返回目标主题及可复用的活跃练习；生成前/提交时共用。 */
  creationContext(input: CreateRequest) {
    const request = createRequestSchema.parse(input);
    const plan = new CatalogRepository(this.database).readPlan(request.sceneId);
    if (!plan)
      throw new AppError(
        "SCENE_NOT_INITIALIZED",
        "请先生成场景主题目录。",
        409,
      );
    const topic = plan.topics.find((topic) => topic.id === request.topicId);
    if (!topic)
      throw new AppError(
        "TOPIC_UNAVAILABLE",
        "没有找到这个主题，请刷新页面。",
        404,
      );
    const progress = this.progress(request.sceneId);
    const active = progress.find(
      (session) => session.status !== "topic_completed",
    );
    if (active) {
      if (active.topicId !== request.topicId) {
        throw new AppError(
          "ACTIVE_TOPIC_EXISTS",
          "请先完成当前主题，或回到场景继续学习。",
          409,
        );
      }
      return { topic, active: this.get(active.id) };
    }
    const completed = new Set(
      progress
        .filter((session) => session.status === "topic_completed")
        .map((session) => session.topicId),
    );
    if (request.repeat) {
      if (!completed.has(topic.id))
        throw new AppError(
          "TOPIC_NOT_COMPLETED",
          "只能主动重练已完成的主题。",
          409,
        );
    } else if (
      plan.topics.find((topic) => !completed.has(topic.id))?.id !== topic.id
    ) {
      throw new AppError(
        "TOPIC_ORDER_REQUIRED",
        "请按目录学习下一主题；重练需要明确选择。",
        409,
      );
    }
    return { topic, active: null };
  }

  /** 事务内复用活跃练习或保存校验后的新练习，并同时写成功回执；不调用模型。 */
  create(input: CreateRequest, candidate?: TrainingSession) {
    const request = createRequestSchema.parse(input);
    return transaction(this.database, () => {
      const previous = this.findCreation(request);
      if (previous) return this.get(previous.result.sessionId);
      const context = this.creationContext(request);
      let session = context.active;
      if (!session) {
        session = parseCandidate(candidate);
        const scene = new CatalogRepository(this.database).get(request.sceneId);
        assertNewSession(session, request, scene, context.topic);
        insertSession(this.database, session);
      }
      insertOperationReceipt(this.database, {
        operation: "create-session",
        scopeId: request.sceneId,
        requestId: request.requestId,
        inputHash: inputHash(request),
        createdAt: new Date().toISOString(),
        result: { sessionId: session.id },
      });
      return session;
    });
  }

  /**
   * 校验候选副本的版本、身份和不可改历史，原子保存状态、新事件与成功回执。
   * 重试先返回已提交结果；不允许调用方任意覆盖整段练习，也不在事务内调用模型。
   */
  commitTurn(
    sessionId: string,
    input: TurnRequest,
    candidate: TrainingSession,
  ) {
    const request = turnRequestSchema.parse(input);
    return transaction(this.database, () => {
      const previous = this.findTurn(sessionId, request);
      if (previous) {
        return { session: this.get(sessionId), receipt: previous };
      }
      const original = this.get(sessionId);
      const session = parseCandidate(candidate);
      const turn = assertTurnCommit(original, session, request);
      // 一次操作只增加一个 revision，新增事件则按 sequence 分别追加。
      updateSessionState(this.database, session, request.expectedRevision);
      appendEvents(this.database, session.turns.slice(original.turns.length));
      const receipt = {
        operation: "session-turn" as const,
        scopeId: sessionId,
        requestId: request.requestId,
        inputHash: inputHash(request),
        createdAt: session.updatedAt,
        result: {
          sessionId,
          turnId: turn.id,
          revision: session.revision,
        },
      };
      insertOperationReceipt(this.database, receipt);
      return { session, receipt };
    });
  }
}

/** 校验待提交练习的结构与内部一致性，失败转换为未提交的存储校验错误。 */
function parseCandidate(candidate: unknown) {
  const parsed = trainingSessionSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new AppError(
      "STORAGE_VALIDATION_FAILED",
      "记录结构校验失败，本次内容未保存。",
      500,
      false,
      {
        reason: "CANDIDATE_SCHEMA_INVALID",
        stage: "storage_validation",
        submission: "not_committed",
      },
    );
  }
  return parsed.data;
}
