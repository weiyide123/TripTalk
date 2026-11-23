type Props = {
  error: string;
  busy: boolean;
  pending: boolean;
  failedDifficulty: boolean;
  onSync: () => void;
  onRetryDifficulty: () => void;
  onRetryCreate: () => void;
  onDiscardPending: () => void;
};

// 只展示恢复入口；是否重试、同步或清除备忘由 useHome 决定。
export function HomeNotices({
  error,
  busy,
  pending,
  failedDifficulty,
  onSync,
  onRetryDifficulty,
  onRetryCreate,
  onDiscardPending,
}: Props) {
  return (
    <>
      {error && (
        <div
          className="error-box"
          role="alert"
        >
          <p>{error}</p>
          <div className="error-actions">
            <button
              className="text-button"
              disabled={busy}
              onClick={onSync}
            >
              同步记录
            </button>
            {failedDifficulty && (
              <button
                className="text-button"
                disabled={busy}
                onClick={onRetryDifficulty}
              >
                重试保存难度
              </button>
            )}
            {pending && (
              <button
                className="text-button"
                disabled={busy}
                onClick={onRetryCreate}
              >
                用原操作重试
              </button>
            )}
          </div>
        </div>
      )}
      {pending && !busy && (
        <p className="tiny-note pending-create-note">
          有一条创建请求待确认；重试会复用原操作，不重新选择难度。
          <button
            className="text-button"
            onClick={onDiscardPending}
          >
            同步后放弃重试
          </button>
        </p>
      )}
    </>
  );
}
