import { Icon } from "@/components/Icon";
import {
  isInFlight,
  submissionMessage,
  type Submission,
} from "./submission-state";
import "./submission-status.css";

type Props = {
  submission: Submission;
  busy: boolean;
  onRetry: () => void;
};

export function PendingMessage(props: Props) {
  return (
    <div
      className="pending-message"
      aria-label="本地待确认消息"
    >
      <div className="pending-message-row">
        <RetryControl {...props} />
        <div className="message-bubble">
          <span className="sr-only">你：</span>
          <p>{props.submission.operation.text}</p>
        </div>
      </div>
      <StatusText submission={props.submission} />
    </div>
  );
}

export function SubmissionNotice(props: Props) {
  return (
    <div className="submission-notice">
      <RetryControl {...props} />
      <StatusText submission={props.submission} />
    </div>
  );
}

function RetryControl({ submission, busy, onRetry }: Props) {
  if (isInFlight(submission)) {
    return (
      <span
        className="submission-spinner spinner"
        aria-hidden="true"
      />
    );
  }
  if (submission.status === "conflict") return null;
  return (
    <button
      type="button"
      className="text-button message-retry"
      aria-label="重试这条消息"
      title="重试原内容"
      disabled={busy}
      onClick={onRetry}
    >
      <Icon
        name="refresh"
        size={16}
      />
    </button>
  );
}

function StatusText({ submission }: { submission: Submission }) {
  const failure = submission.failure;
  return (
    <div
      className="submission-status"
      data-status={submission.status}
    >
      <span role="status">{submissionMessage(submission)}</span>
      {failure && !isInFlight(submission) && (
        <details className="submission-details">
          <summary>查看详情</summary>
          <p>{failure.message}</p>
          <p>错误代码：{failure.code}</p>
          {failure.requestId && <p>诊断编号：{failure.requestId}</p>}
        </details>
      )}
    </div>
  );
}
