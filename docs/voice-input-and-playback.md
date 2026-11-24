# 录音转文字与句子朗读：框架、技术和代码流程

更新于 2026-11-24，依据当前实现。阅读顺序：先理解整体框架，再了解各自的技术，最后沿着函数走完整流程。真实设备和识别效果的验收状态以[开发节奏](development-plan.md)为准。

## 1. 整体框架

这不是一套新的语音教学系统，而是在现有文字对话两端增加输入和输出能力。

```text
① 录音转文字：另一种输入方式
用户说话 → 浏览器录音 → 项目服务端 → 云端转写 → 输入框草稿
                                                     ↓
                                          用户核对、编辑、手动发送
                                                     ↓
                                          原有 Jane 教学与保存流程

② 句子朗读：另一种阅读方式
已有 Jane 英文 → 用户点击播放 → 浏览器/系统语音合成 → 扬声器
```

| 对比 | 录音转文字（STT，Speech to Text） | 句子朗读（TTS，Text to Speech） |
| --- | --- | --- |
| 输入 → 输出 | 音频 → 可编辑文字 | 已有英文 → 声音 |
| 浏览器负责 | 采集、上传、回填草稿 | 创建朗读任务、播放、停止 |
| 项目服务端负责 | 校验上传、调用 OpenAI 转写接口 | 不参与 |
| 是否调用 Jane Agent | 转写不调用；用户发送文字后才进入教学 | 不调用 |
| 是否写 SQLite | 转写不写；后续发送按原教学流程保存 | 不写 |
| 是否保存音频 | 本项目不保存原始录音 | 不生成项目音频文件 |

**当前不是实时通话。** 录音结束才识别，识别后不自动发送，Jane 回复也不自动播放。没有发音评分或专属 Jane 音色。

## 2. 录音转文字

### 2.1 原理：录音与识别是两件事

麦克风产生声音数据，浏览器把声音编码成一段音频，云端模型再把音频识别为文本。数据在流程中的形态依次是：

```text
MediaStream（实时音轨）
  → Blob（录制完成的音频二进制）
  → FormData（包含音频和时长的上传表单）
  → File（服务端校验后的音频对象）
  → { text: "识别出的原话" }
  → draft（输入框草稿）
```

`Blob` 和 `File` 是数据对象，不表示一定在磁盘创建了文件。当前音频只在内存和网络中传递。

### 2.2 使用的技术

| 技术 | 来源 | 作用 |
| --- | --- | --- |
| `getUserMedia()` | 浏览器 | 请求麦克风权限，获取实时音轨 |
| `MediaRecorder` | 浏览器 | 将音轨编码为浏览器支持的 WebM、MP4 等音频 |
| `AudioContext` / `AnalyserNode` | 浏览器 Web Audio API | 检测音量，辅助拦截明显静音；不识别语言、不评估发音 |
| `FormData` / `fetch` | 浏览器 | 上传整段录音，接收文本响应 |
| React Hook | React | 管理授权、录音、识别状态及取消逻辑 |
| Next.js Route Handler | Next.js | 服务端接收上传，将 API key 与浏览器隔离 |
| `openai` SDK | 项目依赖 | 调用文件转写接口 `audio.transcriptions.create()` |
| Zod | 项目依赖 | 运行时校验上传字段与返回文字 |

没有新增录音插件，也没有使用浏览器的 `SpeechRecognition`。转写使用普通 `openai` SDK，**不是**教学使用的 `@openai/agents`。

### 2.3 文件分工

| 文件 | 关键入口及职责 |
| --- | --- |
| [VoiceInput.tsx](../src/features/conversation/VoiceInput.tsx) | 录音按钮、云端识别说明、状态和超长文本预览 |
| [useVoiceInput.ts](../src/features/conversation/useVoiceInput.ts) | `start` 串联录音、识别、回填；`requestTranscript` 上传音频 |
| [audio-recording.ts](../src/features/conversation/audio-recording.ts) | `startRecording` 获取设备；`capture` 汇集音频并释放资源 |
| [transcriptions/route.ts](../src/app/api/transcriptions/route.ts) | `POST`：HTTP 入口，组合上传校验与转写服务 |
| [audio-upload.ts](../src/server/audio-upload.ts) | `readAudioUpload`：限制读取大小/耗时，检查字段、格式与容器签名 |
| [transcribe-audio.ts](../src/server/services/transcribe-audio.ts) | `transcribeAudio`：调用云端、校验结果、转换错误 |
| [useConversationSubmission.ts](../src/features/conversation/useConversationSubmission.ts) | `insertTranscript`：追加到原有输入框草稿 |
| [transcription.ts](../src/contracts/transcription.ts) | 共用限制、音频格式、返回结构与 `appendTranscript` 拼接规则 |

### 2.4 完整代码链路

#### 第一步：点击录音，进入授权状态

`Conversation.tsx` 把 `insertTranscript` 作为 `onTranscript` 传给 `VoiceInput`。录音组件因此不需要维护另一份回答，也不需要访问数据库。

`VoiceInput` 首次使用先展示云端识别说明，用户确认后调用 `useVoiceInput.start()`。Hook 创建 `AbortController`，进入 `permission` 状态，并通知页面语音操作开始。

应用说明和浏览器麦克风授权是两回事：前者告知音频会上传，后者决定能否采集声音。用户确认后，当前站点的 localStorage 保存 `triptalk:voice-input-consent` 及说明版本；刷新或换主题不再重复弹窗。取消不保存确认，清除网站数据、无痕新会话或说明版本升级后会再次询问。存储不可用时退回组件 ref，仅记住本次页面内的确认；这不替代浏览器麦克风授权。

#### 第二步：获取麦克风，开始录音

`start()` 调用 `startRecording()`，后者执行：

```ts
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
```

这里等的是设备授权与音轨，不是识别文字。录音需要安全上下文和用户许可，普通局域网 HTTP 地址不保证可用。

拿到音轨后创建 `MediaRecorder`，交给 `capture()`。它通过 `dataavailable` 事件收集音频块。`recorder.start(250)` 请求分批交付录制数据，**不是每 250ms 上传一次**，也不是精确计时保证。

#### 第三步：结束录音，取得完整音频

Hook 中的两个等待可简化理解为：

```ts
const handle = await startRecording(signal, onElapsed);
const captured = await handle.result;
```

- 第一个 `await` 等设备准备好，获得操作句柄 `{ stop, result }`。
- 第二个 `await` 等录制结束和最终数据到达，获得 `{ audio, durationMs }`。

发送左侧的录音图标原位切换：麦克风 → 准备时 loading → 录音时双竖线 → 识别时 loading。点击双竖线（可访问名称「停止录音」）会调用 `handle.stop()`，随后开始识别，不是暂停后继续录制；达到时限也会停止。停止请求不直接返回音频：浏览器交付最后一段数据后触发 `onstop`，代码检查时长、大小、明显静音，合并 Blob，再 resolve `handle.result`。

停止编码还不够，代码同时用 `track.stop()` 释放麦克风，并清理计时器与音量检测。

#### 第四步：把音频上传到项目服务端

Hook 进入 `transcribing` 状态，调用 `requestTranscript()`，构造表单：

```ts
form.append("audio", recording.audio, "recording." + format.extension);
form.append("durationMs", String(recording.durationMs));
```

随后 `fetch` POST 到 `/api/transcriptions`。浏览器自动生成 multipart 边界，不手动设置 `Content-Type`。音频表单不经过项目专门发送 JSON 的 `lib/api.ts`。

#### 第五步：服务端校验，调用云端转写

```text
POST /api/transcriptions
  → handle：同源保护、统一响应和错误日志
  → readAudioUpload：返回通过校验的 File
  → transcribeAudio
      → getTranscriptionConfig：读取服务端 key 与转写模型配置
      → client.audio.transcriptions.create(...)
      → transcriptionResultSchema.safeParse(result)
  → 返回 { text }
```

这里有两次独立网络请求：**浏览器 → 项目服务端**，再由 **项目服务端 → OpenAI**。API key 不进入浏览器。

转写调用传入音频、模型、JSON 响应格式和忠实转写指令，不传参考答案或课程历史。目的是保留原话、语法错误及重复，而不是替用户润色；实际识别结果仍需用户核对。

SDK 返回后，Zod 检查 `text` 非空且未超长，再返回所需的 `{ text }`。模型配置见 [OpenAI 接入](openai-setup.md#录音转文字接入p16)。

#### 第六步：追加到草稿，等待手动发送

浏览器校验响应后，Hook 调用 `onTranscript(text)`，对应原对话 Hook 的 `insertTranscript(text)`：

```text
insertTranscript(text)
  → 读取 latest.current.draft（此刻最新草稿）
  → appendTranscript(draft, text)
  → update({ draft })
```

录音开始时草稿是 A，识别期间用户改成 B，结果会追加到 **B**，不会用 A 覆盖新输入。需要时在两段文字之间补换行。

合并后超长则保留原草稿、展示完整转写，不静默截断。这份未填入预览只在组件内存中，离页不保证保留。

**到这里没有调用 Jane、没有推进题目、没有写 SQLite。** 用户核对后发送，才进入原有 `/api/sessions/[sessionId]/turns` 教学与保存流程。

### 2.5 失败和取消的边界

- 权限拒绝、无设备、明显静音：浏览器提示，不进入云端转写。
- 上传大小或格式不合规：服务端拒绝。容器签名不是完整解码校验，客户端时长也不是服务端测得的真实时长。
- 网络/转写失败：保留原草稿，可重录或继续打字；SDK 关闭自动重试，避免悄悄重复调用。
- 取消、切后台、离页或上下文变化：中止操作并释放资源。异步结果返回时检查操作身份，旧录音不能填入新草稿；权限迟到也要释放新获得的音轨。
- `triptalkTranscriptionBusy` 只限制同一 Node 进程内的转写并发，不保存音频或文字，也不是分布式锁。

取消请求不能保证上游尚未处理或不收费；本项目不落盘，不等于供应商不留存。具体大小、时长等以 `RECORDING_LIMITS` 和[数据契约](data-contracts.md#9-录音输入与播放边界p16)为准。

## 3. 句子朗读

### 3.1 原理：把已有文字交给语音引擎

英文已存在于对话记录中。点击播放，只需让浏览器/系统语音引擎把文字读出来，不需要请求 Jane，也不需要提前制作 MP3。

### 3.2 使用的技术

| 技术 | 含义及职责 |
| --- | --- |
| `SpeechSynthesisUtterance` | 一次朗读任务：要读的文字、语言、音色、语速 |
| `window.speechSynthesis` | 浏览器朗读控制器：获取音色、开始、取消 |
| React Context | 让各句播放按钮共用一个控制器 |
| `useState` / `useRef` | state 更新图标；ref 保存当前任务和计时器 |

当前不调用 OpenAI TTS，不产生本项目 OpenAI 播放 API 费用。但系统音色可能依赖网络，不能保证完全离线；不同设备声音也可能不同。

### 3.3 文件分工

| 文件 | 职责 |
| --- | --- |
| [Conversation.tsx](../src/features/conversation/Conversation.tsx) | 创建共享控制器，在 Jane 消息下接入按钮，协调录音互斥 |
| [SentencePlayback.tsx](../src/features/conversation/SentencePlayback.tsx) | `SentencePlayButton` 展示入口；`useSentencePlayback` 管播放生命周期；Context 连接两者 |
| [voice-input.css](../src/features/conversation/voice-input.css) | 录音/播放入口及提示样式，不处理业务调用 |

### 3.4 完整代码链路

#### 第一步：页面创建共用控制器

`Conversation` 调用一次 `useSentencePlayback(contextKey, voiceBusy)`，把返回值放入 `SentencePlaybackContext.Provider`。

各按钮通过 `useContext()` 取得同一控制器，`useId()` 区分不同按钮。Context 只在当前组件树中共享，不是数据库或跨页永久状态。

#### 第二步：点击图标，传入本句英文

```ts
playback.toggle(id, text);
```

如果点的是正在播放的句子，就停止；如果是另一句，先取消旧任务，再开始新任务，不让多句话排队播放。

#### 第三步：创建任务，选择音色并朗读

`toggle()` 检查浏览器支持情况后创建任务：

```ts
const utterance = new SpeechSynthesisUtterance(text);
```

通过 `speechSynthesis.getVoices()` 筛选英语音色，优先本机美式英语，其次其他本机英语等可用英语音色。没有可列出的音色时，让浏览器按 `en-US` 选择。当前语速是 `0.9`。

最后调用 `synthesis.speak(utterance)`。它不是返回 MP3 的异步请求，不需要 `await` 等文件；后续依靠事件通知状态。

#### 第四步：播放事件驱动界面，结束后清理

- 创建任务：`loading`。
- `onstart`：`playing`，显示停止图标。
- `onend`：清空任务与状态，恢复播放图标。
- `onerror`：释放任务，在按钮附近显示提示。

代码设置启动和播放超时，避免浏览器事件异常导致一直显示忙碌。

`stop()` 调用 `release()`，清掉计时器，移除旧任务回调，再 `speechSynthesis.cancel()`。先移除回调，是为防止旧句的取消事件误修改新句状态。

### 3.5 与翻译、复制的关系

播放按钮独立于句子文本：点击英文仍走翻译逻辑，双击/拖动选词和复制不由播放逻辑接管。

当前仅 Jane 提问和角色回应提供整句朗读。用户消息、头图不重复放入口，也没有「选中一个单词单独朗读」。播放不会改变学习进度。

## 4. 两条链路在页面上怎样配合

两项能力在 `Conversation.tsx` 汇合，不互相调用：

- `changeVoiceBusy()` 在录音启动时先停止朗读，避免扬声器声音被麦克风录进去。
- `voiceLock.current` 即时拦截发送；`voiceBusy` 驱动按钮禁用。录音/识别期间不能发送、求助或播放，但仍可编辑输入框。
- 结束或取消后恢复文字操作。语音失败不应阻断文字学习。
- 会话/版本等上下文变化和离页时清理旧录音与播放，不让旧结果影响当前题目。

## 5. 如何对照浏览器验证

| 操作 | 应观察到的结果 |
| --- | --- |
| 开始录音并讲话 | 出现录音状态，尚无转写请求 |
| 停止录音 | Network 出现 `POST /api/transcriptions` |
| 识别成功 | 收到 `{ text }`，只追加草稿，不自动出现 `/turns` 请求 |
| 核对后发送 | 才进入 `/turns` 教学流程 |
| 点击 Jane 句子播放 | 图标切换并朗读，不调用项目转写或教学接口 |
| 再点同句、切句、开始录音 | 旧朗读停止 |

浏览器日志：`voice_input_failed`、`transcription_request_failed`、`sentence_playback_failed`。服务端日志：通过 `request_failed` 的诊断编号与 `audio_upload` / `audio_transcription` 阶段关联。不要打印录音、转写全文或 key。

`npm run voice:check` 使用模拟网络进行离线检查，不调用真实麦克风或付费模型，不能替代真实识别质量与设备播放验收。

建议先按第 2.4 节追一次录音，再按第 3.4 节追一次朗读；文件总览见[项目目录](project-structure.md#4-语音增量与后续位置)。
