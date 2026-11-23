"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { RECORDING_LIMITS } from "@/contracts/transcription";
import { useVoiceInput } from "./useVoiceInput";
import "./voice-input.css";

type Props = {
  contextKey: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onTranscript: (text: string) => boolean;
};

/** 录音入口及局部状态；首次使用先说明云端识别，再申请麦克风权限。 */
export function VoiceInput(props: Props) {
  const voice = useVoiceInput(props);
  const [consentOpen, setConsentOpen] = useState(false);
  const consented = useRef(false);
  const active = voice.phase !== "idle";
  let status = voice.message;
  if (voice.phase === "permission") status = "请允许浏览器使用麦克风…";
  if (voice.phase === "recording")
    status = `录音中 ${voice.seconds}s / ${RECORDING_LIMITS.maxSeconds}s`;
  if (voice.phase === "transcribing") status = "正在识别，文字不会自动发送…";

  return (
    <div className="voice-input">
      <div className="voice-input-row">
        {!active && !voice.uninserted && (
          <button
            type="button"
            className="text-button voice-start"
            disabled={props.disabled}
            title="录音转文字，核对后再发送"
            onClick={() => {
              if (consented.current) void voice.start();
              else setConsentOpen(true);
            }}
          >
            <Icon
              name="microphone"
              size={17}
            />
            录音输入
          </button>
        )}
        {active && (
          <Icon
            name="microphone"
            size={17}
          />
        )}
        <span
          className="voice-status"
          role="status"
        >
          {status}
        </span>
        {voice.phase === "recording" && (
          <button
            type="button"
            className="button soft voice-stop"
            onClick={voice.stop}
          >
            <Icon
              name="stop"
              size={14}
            />
            结束并识别
          </button>
        )}
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
      <ConfirmDialog
        open={consentOpen}
        title="把想说的话，先说出来"
        description="结束录音后，音频将发送至 OpenAI 识别，本项目不保存原始录音。每段最多 60 秒；文字会追加到现有草稿，请核对后再发送。请勿录入真实身份或支付信息。"
        confirmLabel="开始录音"
        cancelLabel="继续打字"
        onCancel={() => setConsentOpen(false)}
        onConfirm={() => {
          consented.current = true;
          setConsentOpen(false);
          void voice.start();
        }}
      />
    </div>
  );
}
