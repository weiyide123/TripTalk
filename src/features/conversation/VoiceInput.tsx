"use client";

import { useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { RECORDING_LIMITS } from "@/contracts/transcription";
import { useVoiceInput } from "./useVoiceInput";
import "./voice-input.css";

// 只记录用户已阅读当前云端说明；内容发生实质变化时升级版本重新确认。
const CONSENT_KEY = "triptalk:voice-input-consent";
const CONSENT_VERSION = "1";

type Props = {
  contextKey: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onTranscript: (text: string) => boolean;
  // 只组合操作栏位置，求助和发送仍由 Conversation 管理。
  helpActions?: ReactNode;
  sendAction?: ReactNode;
};

/** 录音入口及局部状态；首次使用先说明云端识别，再申请麦克风权限。 */
export function VoiceInput(props: Props) {
  const voice = useVoiceInput(props);
  const [consentOpen, setConsentOpen] = useState(false);
  const consented = useRef(false);
  const active = voice.phase !== "idle";
  const loading =
    voice.phase === "permission" || voice.phase === "transcribing";
  let buttonLabel = "录音输入";
  if (voice.phase === "permission") buttonLabel = "正在准备录音";
  if (voice.phase === "recording") buttonLabel = "停止录音";
  if (voice.phase === "transcribing") buttonLabel = "正在识别录音";
  let status = voice.message;
  if (voice.phase === "permission") status = "请允许浏览器使用麦克风…";
  if (voice.phase === "recording")
    status = `录音中 ${voice.seconds}s / ${RECORDING_LIMITS.maxSeconds}s`;
  if (voice.phase === "transcribing") status = "正在识别，文字不会自动发送…";

  return (
    <div className="voice-input">
      {(status || active) && (
        <div className="voice-input-row">
          <span
            className="voice-status"
            role="status"
          >
            {status}
          </span>
          {active && (
            <button
              type="button"
              className="text-button"
              onClick={() => voice.cancel()}
            >
              取消
            </button>
          )}
        </div>
      )}
      {voice.uninserted && (
        <div className="voice-transcript">
          <p>{voice.uninserted}</p>
          <button
            type="button"
            className="text-button"
            disabled={props.disabled}
            onClick={voice.insert}
          >
            追加到草稿
          </button>
          <button
            type="button"
            className="text-button"
            onClick={voice.dismiss}
          >
            关闭
          </button>
        </div>
      )}
      <div className="composer-actions">
        {props.helpActions}
        <div className="send-actions">
          <button
            type="button"
            className={
              "voice-toggle" +
              (voice.phase === "recording" ? " is-recording" : "")
            }
            disabled={
              loading ||
              (props.disabled && !active) ||
              Boolean(voice.uninserted)
            }
            aria-label={buttonLabel}
            title={buttonLabel}
            aria-busy={loading}
            onClick={() => {
              if (voice.phase === "recording") voice.stop();
              else if (consented.current || hasRecordingConsent())
                void voice.start();
              else setConsentOpen(true);
            }}
          >
            {loading ? (
              <span className="spinner" />
            ) : (
              <Icon
                name={voice.phase === "recording" ? "pause" : "microphone"}
                size={19}
              />
            )}
          </button>
          {props.sendAction}
        </div>
      </div>
      <ConfirmDialog
        open={consentOpen}
        title="把想说的话，先说出来"
        description="结束录音后，音频将发送至 OpenAI 识别，本项目不保存原始录音。每段最多 60 秒；文字会追加到现有草稿，请核对后再发送。请勿录入真实身份或支付信息。"
        confirmLabel="开始录音"
        cancelLabel="继续打字"
        onCancel={() => setConsentOpen(false)}
        onConfirm={() => {
          consented.current = true;
          rememberRecordingConsent();
          setConsentOpen(false);
          void voice.start();
        }}
      />
    </div>
  );
}

/** 点击时读取当前站点的确认版本；存储不可用时仍需明确确认。 */
function hasRecordingConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY) === CONSENT_VERSION;
  } catch {
    return false;
  }
}

/** 仅在用户确认后保存；写入失败时由组件 ref 保留本次页面内的确认。 */
function rememberRecordingConsent() {
  try {
    localStorage.setItem(CONSENT_KEY, CONSENT_VERSION);
  } catch {
    // 隐私模式或存储受限不阻塞录音，也不冒充已永久保存。
  }
}
