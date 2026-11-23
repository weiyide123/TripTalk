# 参考项目与设计决策

文档基线 v0.6；仅供背景查阅，不增加阶段要求。调研日期：2026-11-06。此前查阅官方文档、SDK 示例源码与示例项目 README；本轮补查实际目录和部分入口源码，范围见第 5 节。未本机运行这些仓库，也未做完整安全审计。GitHub main 会变化，实施时对照安装版本复核。

优先选择官方维护、源码可读且与文字/旅行对话相关的项目；社区关注不等于生产可靠性。这里是有依据的设计取舍，不是“最佳项目”排名。

## 1. OpenAI Agents SDK 官方入门与 TypeScript 示例

[官方 Quickstart](https://developers.openai.com/api/docs/guides/agents/quickstart) 从单 Agent 单轮开始，再增加状态和能力。由此将单次真实调用放 P0，而不是等 UI 和存储系统全部完成。

实际查阅的示例：

| 源码 | 借鉴 | 不照搬 |
| --- | --- | --- |
| [hello-world.ts](https://github.com/openai/openai-agents-js/blob/main/examples/basic/hello-world.ts) | Agent 定义、run、finalOutput，独立脚本验证调用 | 示例人物设定、隐式模型默认值 |
| [chat.ts](https://github.com/openai/openai-agents-js/blob/main/examples/basic/chat.ts) | CLI 连续输入与逐轮历史传递 | 天气工具、handoff、默认 tracing；Jane 不需要这些才会聊天 |
| [dynamic-system-prompt.ts](https://github.com/openai/openai-agents-js/blob/main/examples/basic/dynamic-system-prompt.ts) | 从本地 context 显式生成 instructions | 随机风格；我们的任务和偏好须来自真实状态 |
| [json-schema-output-type.ts](https://github.com/openai/openai-agents-js/blob/main/examples/basic/json-schema-output-type.ts) | 用结构化输出把模型判断交给应用处理 | 天气示例内容；本项目采用小型教学 schema |

采用的不是示例的整套业务，而是最小 SDK 调用形状。当前版本、模型权限、API key 与实际输出必须在开发时验证。

## 2. OpenAI Customer Service Agents Demo

[项目](https://github.com/openai/openai-cs-agents-demo) 使用独立 Python Agent 后端和 Next.js 对话界面，展示客服编排。README 说明后端可以独立运行，也说明这是演示项目。

借鉴：Agent 核心先独立可运行，再连接交互界面；分开 UI 与业务上下文。对 TripTalk 保留 TypeScript 业务模块，但用 Next.js Route Handlers 承接接口，不另启后端服务、不改 Python，不照搬客服的多专家分流、预订/退款工具或 ChatKit UI。我们练习酒店语言，不执行真实旅行交易。

## 3. OpenAI Realtime Agents Demo

[项目](https://github.com/openai/openai-realtime-agents) 是 Next.js/TypeScript 的实时语音 Agent 演示，包含 Chat-Supervisor 与 Sequential Handoff 等模式。

借鉴：后续语音阶段的会话、角色和事件组织思路。现在只把它放 P4 参考，不引入实时音频、双模型监督或复杂交接。项目是语音演示，并不能据此证明我们的文字学习必须采用多 Agent。

## 4. 对本项目的结论（我们的推导）

1. 先单轮真实调用，再多轮教学，再 UI；自动化工程不做前置。
2. 一个可见 Jane + 程序控制状态。场景目录规划、主题规划、教学分别配置 Agent，由程序调用，不扩展成 handoff 协作平台。
3. 角色台词与教学解释结构化分开，避免漂亮 UI 只能承载一大段自由文本。
4. P1 直接在网页验证真实对话，并交付基础 JSON 保存和续学；复杂恢复机制后置。
5. 模型只给语言判断，程序拥有任务推进和持久化权，避免提示注入直接改业务状态。
6. 保留 API key 安全、运行时校验、类型/构建与人工验证；它们不是需延后的自动化测试平台。

详见 [开发节奏](development-plan.md) 与 [Jane Agent 设计](agent-design.md)。

## 5. 目录组织复核（2026-11-06）

本轮直接查看以下目录和文件，而非仅依据 README 推断。选择理由是官方示例可核查、与所选 SDK/Next.js 接近；不把关注度当成架构质量证明。

| 证据 | 实际看到的组织方式 | TripTalk 取舍 |
| --- | --- | --- |
| [SDK basic 目录](https://github.com/openai/openai-agents-js/tree/main/examples/basic) 与 [chat.ts](https://github.com/openai/openai-agents-js/blob/main/examples/basic/chat.ts) | hello-world、chat、动态指令和结构化输出分别是小型示例；chat 有独立输入循环与历史管理 | 保留 smoke 诊断入口，chat CLI 为后置可选；生产逻辑提取共用，不照搬示例的工具/handoff 或整仓 monorepo |
| [Realtime src/app](https://github.com/openai/openai-realtime-agents/tree/main/src/app) | agentConfigs、api、components、contexts、hooks、lib 与页面入口分开 | 借鉴职责分离；我们的 Agent 要供 Node CLI 使用，因此移出 app 放 server/agents；features 是本项目的前端业务组织选择，不是该示例原样结构 |
| [Realtime session Route Handler](https://github.com/openai/openai-realtime-agents/blob/main/src/app/api/session/route.ts) | Next route.ts 在服务端使用环境 key 请求实时会话 | 借鉴 Next 后端入口；不照搬其模型 ID、实时协议或将完整业务写在路由中的简化方式 |
| [客服示例根目录](https://github.com/openai/openai-cs-agents-demo) | python-backend 与 ui 是两个独立目录 | 只借鉴界面/Agent 边界；不采用双语言、双服务 |

结论：这些仓库提供可参考的模式，没有规定统一产品目录。[官方 SDK 总览](https://developers.openai.com/api/docs/guides/agents/sdk) 也将 SDK 定位为应用内部的运行能力。TripTalk 的 app / features / server / contracts 分层是结合本项目约束的设计推导；累计目录及逐项说明以 [项目目录](project-structure.md) 为准。
