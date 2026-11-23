# OpenAI 云端模型与 Agents SDK 接入

文档基线 v0.6 · 2026-11-06。P0 接入代码已建立；真实验证结果见开发节奏，不以代码已存在代替调用成功。P0 先跑通纯文本单轮，P1 再加多轮和教学结构化输出。

## 1. 账号、API 与 SDK 的区别

- 你已有 OpenAI 账号，可以用它登录 API Platform；实际能调用哪些模型、是否有可用额度，要看对应项目的权限和账单状态。
- 不要仅凭已注册账号或 ChatGPT 订阅就假定 API 可用；在 Platform 核对实际额度/付款设置与使用限制。
- 云端模型负责推理；`@openai/agents` 在本地 Node 服务中组织指令、上下文、可选工具与结果处理；SDK 本身不是模型，也不会自动替项目完成本地业务存储。
- 本项目明确采用标准 API key 方式，不使用 ChatGPT 登录、Codex SDK 或托管 Agents API；没有 API 额度时不得用模拟回复宣称云端验证通过。

创建项目 API key 并用环境变量提供给服务端，参照 [OpenAI API Quickstart](https://developers.openai.com/api/docs/quickstart)。SDK 安装与 Agent/run 的基本形式见 [Agents SDK Quickstart](https://developers.openai.com/api/docs/guides/agents/quickstart)。

## 2. 一次性准备

1. 登录 [OpenAI Platform](https://platform.openai.com/)，选择/建立用于 TripTalk 的 API 项目。
2. 在项目中创建 API key；本机保存，不发到聊天、截图、源码或前端页面。
3. 核对账单、可用额度和项目使用限制，先设置合理的花费告警。告警不一定等同硬限额；应用也应限制调用频率和长度。
4. 从账户可用模型中选择支持文本和结构化输出的模型，把准确 ID 填入 `OPENAI_MODEL`。用户已委托选择低成本验证模型，当前起点为 gpt-6-luna；不保证账户已有访问权限，月预算仍待补充。
5. 当前项目已有 `.env`，只在本机编辑；新 checkout 无该文件时才从 [.env.example](../.env.example) 复制，避免覆盖凭据。`.gitignore` 已忽略 `.env` 和数据目录。

```dotenv
OPENAI_API_KEY=填入你自己的项目API密钥
OPENAI_MODEL=gpt-6-luna
AI_MODE=openai
DATA_DIR=./data
```

Next.js 在服务端自动加载项目根 `.env`；独立 CLI 从项目根使用 Node `--env-file-if-exists=.env` 加载同一文件。SDK 读取的是进程环境变量，不负责读取文件。只维护根 `.env`，避免其他 .env.local 等文件覆盖导致 CLI 与网页配置不一致。不要使用 `NEXT_PUBLIC_` 密钥，也不通过 next.config 的 env 字段注入密钥或向浏览器传递。模型调用只发生在 Node.js 后端模块，CLI 无需启动网页。[Next.js 环境变量](https://nextjs.org/docs/app/guides/environment-variables)

## 3. 已实现的 P0 入口

代码是唯一实现来源，不在文档再复制一份示例：

- [agent-smoke.ts](../scripts/agent-smoke.ts)：读取配置，执行一次 run，显示 finalOutput 和脱敏用量；错误退出码为 1。
- [jane.ts](../src/server/agents/jane.ts)：Jane 工厂，P0 仅生成一句欢迎语。
- [runner.ts](../src/server/agents/runner.ts)：Agents SDK Runner + OpenAIProvider；关闭 tracing 和响应存储，同时关闭 Runner 与底层 HTTP 重试。
- [config.ts](../src/server/config.ts)：惰性 Zod 校验；健康检查不要求有效 key，也不泄露配置值。

执行 `npm run agent:smoke`。CLI 使用 Node `--env-file-if-exists=.env`，缺文件时仍能显示明确配置错误；进程环境变量优先于 .env，若与预期不符需检查本机终端配置，但不要打印凭据。

已安装 Agents SDK 0.21.0；教学使用 Agents SDK，显式依赖 openai 用于底层 HTTP client（关闭默认重试），以及 P1.6 独立音频转写接口。P0 欢迎语验证采用 maxTurns=1、30 秒超时、gpt-6-luna reasoning=none / 128 输出 token；不是当前教学流程的统一预算。

模型选择依据：[GPT-6 Luna 官方模型页](https://developers.openai.com/api/docs/models/gpt-6-luna)，2026-11-06 查阅，标准文本每百万输入 token $0.10、输出 token $0.50。价格与权限可能变化；不把一次问候验证等同教学质量验收。

## 4. 多轮接入边界

P1 通过网页调用服务端核心，独立 smoke 继续保留；多轮 CLI 非必交项，若后续需要则复用 src/server 核心，不导入 Next.js 专用入口。教学上下文、历史裁剪与结构化输出唯一见 [Agent 设计](agent-design.md)，提交与恢复见 [数据契约](data-contracts.md)。

采用本地可见对话重建输入这一种历史策略，不同时叠加云端 continuation ID 或 SDK session 自动回放。[官方运行说明](https://developers.openai.com/api/docs/guides/agents/running-agents) 区分了这些策略；[Agent definitions](https://developers.openai.com/api/docs/guides/agents/define-agents) 提供动态 instructions 与 outputType。SDK 接口以实际安装版本为准。

## 5. 本地文件不等于“所有数据不出电脑”

本地文件保存的是应用的权威学习记录；请求云端模型会发送当前回答、课程和必要上下文。SDK 默认有 tracing，因此本项目默认用 `tracingDisabled: true`，不额外上传调试轨迹。[官方 tracing 说明](https://developers.openai.com/api/docs/guides/agents/integrations-observability)

`store:false` 用于关闭可后续检索的响应存储；不是对供应商日志、滥用监控或所有留存机制的零留存承诺。上线前核对当前项目的数据控制与服务政策；需要特殊留存保证时单独确认，不在产品里写“绝不上传/零留存”。[OpenAI 数据控制说明](https://developers.openai.com/api/docs/guides/your-data)

运行日志只保存脱敏用量元数据（model、耗时、token usage、请求 ID），不保存推理内部内容、不默认保存录音。模型历史窗口与本地归档分开：归档可以完整，发给模型的内容必须有限。

## 6. 调用成本与错误处理

- 日常问候优先本地模板，不每次刷新请求模型；有有效输入才评估。
- 设置输入长度上限、超时、最大轮数、同 session 单请求；maxTurns 限制 run 循环，不是 HTTP 重试上限；输出限制依模型支持配置，不盲填所有模型通用的 temperature/maxTokens。
- 记录实际 usage；单轮成本、日额度和月预算待用户确认。正式单价按选定模型的官方价格页核对，不把本文当报价。
- 401：核对 key 与项目，不打印 key；403/模型不存在：核对权限及准确 ID；429：区分限流与额度不足，不无限重试；超时/5xx：保留输入并允许用户重试。
- P0/P1 不要求实现 mock；缺 key 显示未配置即可。AI_MODE 当前只需支持 openai，其他值明确拒绝。若 P2 确需加入 mock，须标“演示反馈”、不写真实记录，也不作为 Agent 验收；真实模式出错绝不静默降级。

## 7. 接入验收

真实单轮/多轮的验收和当前前置项统一见 [开发节奏](development-plan.md)。关闭页面不等于取消云端已发生的计费。出现连接错误时先检查网络；不要关闭 TLS 校验，也不要未经确认把 key 发往第三方地址。

## 录音转文字接入（P1.6）

服务端接收浏览器录制的完整短音频，通过 `openai.audio.transcriptions.create` 获取文本。它是独立识别步骤，Jane 教学仍使用 Agents SDK；无需 Realtime SDK、WebRTC 或额外 Agent。已核对 2026-11-23 的[官方语音转文字指南](https://developers.openai.com/api/docs/guides/speech-to-text)与安装的 openai 7.52.0；默认采用 gpt-transcribe，不再以已弃用的旧转写模型作为新接入默认值。

- API key 仅在服务端使用，复用 OPENAI_API_KEY。独立 OPENAI_TRANSCRIPTION_MODEL 默认 gpt-transcribe，不沿用教学的 OPENAI_MODEL；`.env.example` 已补充，实际 .env 未修改。账户权限、价格与真实识别效果须本机确认。
- 提交原始英语音频做转写，不用翻译接口，不增加润色指令。用学习者口音和含语法错误的真实样本验证保真度；模型仍可能误听或自动规范化，保留用户编辑确认。
- 应用限制 60 秒/5 MB，支持浏览器 WebM/MP4/OGG，服务端也接受 WAV；详细校验见数据契约。转写单次上游超时 30 秒、SDK maxRetries=0；单进程只允许一个转写在途。转写与教学分别计费，尚无月度费用封顶；取消不能保证撤销上游已发生费用。
- 不默认保存音频或转写全文日志；音频会发送到云端识别，“本地不落盘”不代表供应商零留存。首次录音前告知这一点，按实际服务的数据政策表述。
- 验收必须包含真实转写及确认后的正常教学，也要验证权限拒绝、静音、格式错误、网络超时、取消与迟到响应。没有转写配置时保持文字可用，不伪造识别结果。

Jane 句子播放使用浏览器 SpeechSynthesis，而非 OpenAI 音频 API；不消耗本项目 API 额度。优先本机英语音色，浏览器仍可能选择需联网的语音；不承诺音色一致或完全离线。参见 [MDN SpeechSynthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis)。

此节仅规定接入边界；交互见 [产品第 4.8 节](product.md#48-录音输入与句子播放p16)，接口见 [数据契约第 9 节](data-contracts.md#9-录音输入与播放边界p16)。
