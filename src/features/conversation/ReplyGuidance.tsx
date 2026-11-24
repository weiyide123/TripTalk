import type { TeachingTurnView } from "@/contracts/views";
import type { Feedback } from "@/contracts/teaching";
import { Icon } from "@/components/Icon";

type Hint = NonNullable<Feedback["hint"]>;
type QuestionHints = Partial<
  Record<
    Hint["level"],
    {
      turnId: string;
      hint: Hint;
    }
  >
>;

/** 每级只取当前题的最新记录；由父组件筛选题目，不补请求、不改写历史。 */
export function collectQuestionHints(turns: TeachingTurnView[]): QuestionHints {
  const hints: QuestionHints = {};
  for (const turn of turns) {
    const hint = turn.evaluation.hint;
    if (hint) {
      hints[hint.level] = {
        turnId: turn.id,
        hint,
      };
    }
  }
  return hints;
}

/** 将任务与已获取的提示并列呈现；参考表达单独折叠，不占用 Jane 头图。 */
export function ReplyGuidance({
  task,
  hints,
  exampleOpen,
  disabled,
  onFill,
}: {
  task: string | undefined;
  hints: QuestionHints;
  exampleOpen: boolean;
  disabled: boolean;
  onFill: (text: string) => void;
}) {
  const example = hints.example?.hint;
  return (
    <div className="reply-guidance">
      <div className="guidance-row guidance-task">
        <span className="guidance-label">本轮目标</span>
        <p>{task}</p>
      </div>
      <div
        className="guidance-hints"
        aria-live="polite"
      >
        {hints.keywords && (
          <div className="guidance-row">
            <span className="guidance-label">关键词</span>
            <p>{keywordBody(hints.keywords.hint.text)}</p>
          </div>
        )}
        {hints.pattern && (
          <div className="guidance-row">
            <span className="guidance-label">句式</span>
            <p>{hints.pattern.hint.text}</p>
          </div>
        )}
      </div>
      {example && (
        <div
          id="reply-reference"
          className="guidance-reference"
          hidden={!exampleOpen}
        >
          <div className="guidance-reference-heading">
            <span>参考表达</span>
            <button
              className="text-button"
              disabled={disabled}
              onClick={() => onFill(example.text)}
            >
              填入输入框
              <Icon
                name="arrow"
                size={14}
              />
            </button>
          </div>
          <p>{example.text}</p>
        </div>
      )}
    </div>
  );
}

/** 仅去掉旧正文明确的重复前缀；保留原句，不按标点拆分模型内容。 */
function keywordBody(text: string) {
  const cleaned = text.replace(/^\s*(?:关键词提示|关键词)\s*[:：]\s*/, "");
  return cleaned.trim() ? cleaned : text;
}
