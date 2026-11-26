import { generatedEvaluationSchema } from "@/contracts/jane-turn";
import { ModelBehaviorError, ModelRefusalError } from "@openai/agents";
import type { TrainingSession } from "@/contracts/training-session";
import type { ModelCall } from "@/contracts/teaching";
import type { OperationReceipt } from "@/contracts/operation-receipt";
import type { TurnRequest } from "@/contracts/requests";
import type { MutationResult } from "@/contracts/views";
import { PROMPT_VERSION } from "../agents/prompts/jane";
import { getStore } from "../storage/store";
import { getAgentConfig } from "../config";
import { createJaneTeachingAgent } from "../agents/jane";
import { createJaneRunner } from "../agents/runner";
import { teachingContext } from "../agents/context";
import { AppError, publicError } from "../errors";
import { logLearnerGuidance } from "../logging";
import { applyContinue, recordEvaluation } from "./lesson-state";
import { getSessionView } from "./views";
/**
 * 处理一次对话操作：先核对回执/版本，再生成候选，最后原子保存并返回页面视图。
 * 同一练习禁止并发提交；模型调用在数据库事务外，已成功的重试不再次调用模型。
 */
export async function submitTurn(
  sessionId: string,
  input: TurnRequest,
): Promise<MutationResult> {
  const store = getStore();
  return store.withSessionOperation(sessionId, async () => {
    // 回执核对优先于版本检查；响应丢失的重试不再次调用模型。
    const previous = store.sessions.findTurn(sessionId, input);
    if (previous) return mutationResult(sessionId, previous);
    const original = store.sessions.get(sessionId);
    if (original.revision !== input.expectedRevision) {
      throw new AppError(
        "STALE_REVISION",
        "记录已更新，请先同步，再按当前题作答。",
        409,
      );
    }
    const candidate = structuredClone(original);
    if (input.action === "continue") {
      applyContinue(candidate, input);
    } else {
      if (candidate.status !== "active") {
        throw new AppError("INVALID_STATE", "请先同步记录，或返回首页。", 409);
      }
      await evaluateBeforeCommit(candidate, input);
    }
    // 模型调用结束才进入短事务：状态、新事件与回执一次提交。
    const saved = store.sessions.commitTurn(sessionId, input, candidate);
    const answer = saved.session.turns.find(
      (turn) => turn.id === saved.receipt.result.turnId,
    );
    if (
      answer?.action === "answer" &&
      answer.payload.feedback.verdict === "uncertain"
    ) {
      logLearnerGuidance(input.requestId, sessionId);
    }
    return mutationResult(sessionId, saved.receipt);
  });
}

/** 用最新练习视图和本次成功回执组装响应；重试时视图可能已包含后续操作。 */
function mutationResult(
  sessionId: string,
  receipt: Extract<OperationReceipt, { operation: "session-turn" }>,
): MutationResult {
  return {
    session: getSessionView(sessionId),
    receipt: {
      requestId: receipt.requestId,
      revision: receipt.result.revision,
      turnId: receipt.result.turnId,
    },
  };
}

/** 生成并校验待提交的教学结果；此阶段尚未写库，失败统一标记为未提交。 */
async function evaluateBeforeCommit(
  candidate: TrainingSession,
  input: TurnRequest,
) {
  try {
    await evaluateAnswer(candidate, input);
  } catch (error) {
    const safe = evaluationError(error);
    throw new AppError(
      safe.code,
      safe.message,
      safe.status,
      safe.retryable,
      {
        ...safe.details,
        stage: safe.details.stage ?? "evaluation",
        submission: "not_committed",
      },
      error,
    );
  }
}

/** 调用教学模型并校验结构，将反馈交给 lesson-state 更新内存候选；本函数不落盘。 */
async function evaluateAnswer(candidate: TrainingSession, input: TurnRequest) {
  const config = getAgentConfig();
  const started = Date.now();

  const content = teachingContext(candidate, input);

  const result = await createJaneRunner(config.apiKey, 60_000).run(
    createJaneTeachingAgent(config.model),
    JSON.stringify(content),
    { maxTurns: 1 },
  );
  const parsed = generatedEvaluationSchema.safeParse(result.finalOutput);
  if (!parsed.success)
    throw new AppError(
      "AGENT_OUTPUT_INVALID",
      "回复格式不完整，没有提交本次反馈，请重试。",
      502,
      true,
      { reason: "OUTPUT_SCHEMA_INVALID", stage: "model_output" },
    );
  const evaluation = parsed.data;
  if (
    (evaluation.canContinue && !evaluation.learnerTranslation) ||
    Boolean(evaluation.correctedAnswer?.trim()) !==
      Boolean(evaluation.correctedTranslation)
  ) {
    throw new AppError(
      "AGENT_OUTPUT_INVALID",
      "回复释义不完整，请重试。",
      502,
      true,
      {
        reason: "ANSWER_TRANSLATION_MISMATCH",
        stage: "model_output",
      },
    );
  }
  const u = result.state.usage;
  const usage: ModelCall = {
    promptVersion: PROMPT_VERSION,
    model: config.model,
    elapsedMs: Date.now() - started,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    totalTokens: u.totalTokens,
  };
  return recordEvaluation(candidate, input, parsed.data, usage);
}

/** 区分模型拒绝、输出异常及其他错误，转换成可对外返回的安全错误信息。 */
function evaluationError(error: unknown) {
  if (error instanceof ModelRefusalError) {
    return new AppError(
      "AGENT_REFUSED",
      "这次内容暂时无法处理，请使用虚构信息，回到当前旅行任务再试。",
      422,
      false,
      { reason: "MODEL_REFUSAL", stage: "model_output" },
    );
  }
  if (error instanceof ModelBehaviorError) {
    return new AppError(
      "AGENT_OUTPUT_INVALID",
      "Jane 这次的回复没有整理好，未保存本次回答。请稍后重新发送。",
      502,
      true,
      { reason: "SDK_MODEL_OUTPUT_INVALID", stage: "model_output" },
    );
  }
  return publicError(error);
}
