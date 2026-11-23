# 项目目录与命令

更新于 2026-11-19。这里维护文件位置；调用链见[数据流导读](code-and-data-flow.md)，职责边界见[架构](architecture.md)，阶段验收见[开发节奏](development-plan.md)。

## 1. 当前目录

```text
triptalk/
├── AGENTS.md / README.md          开发约定 / 启动入口
├── docs/                         产品、架构、数据契约与开发记录
├── design/                       已确认视觉稿与设计资产
├── content/scenes.json           显式初始化的场景种子，不是运行时目录
├── public/jane/                  可公开访问的 Jane 图片
├── src/
│   ├── app/                     Next 页面和 API 路由
│   ├── features/home/           首页组件、课程弹窗、useHome
│   ├── features/conversation/   对话、草稿、发送/重试状态
│   ├── components/              Jane、复制、释义、确认弹窗等公共展示
│   ├── lib/api.ts               浏览器同源 HTTP 包装
│   ├── styles/                  视觉 tokens
│   ├── contracts/               共享 Zod 契约与 DTO
│   │   └── legacy/              旧 JSON 契约，仅离线导入使用
│   └── server/
│       ├── agents/              SDK 配置、提示词与上下文
│       ├── services/            模型/教学流程编排与公开视图
│       ├── repositories/        具名业务读写、SQL、提交约束
│       └── storage/             连接、事务、迁移和导入
│           ├── migrations/      版本化 SQL
│           └── import/          JSON 候选转换/校验，不参与请求
├── scripts/                     smoke、初始化、导入、离线回归
└── data/                        Git 忽略，禁止 public
    ├── triptalk.sqlite          正式学习库
    ├── triptalk.sqlite-wal/shm  SQLite 按需管理的伴随文件
    ├── profile.json / scenes/  切换前原数据，留档、不再读写
    └── backups/                迁移备份与候选库，不自动恢复
```

不再有运行时 FileStore、JsonFile、SceneRepository、scene-rules 或文件目录读取入口。没有新旧存储开关；保留 legacy 契约是为了校验离线导入，不是网页兼容层。

## 2. 页面、接口与共享契约

| 位置 | 职责 |
| --- | --- |
| app/page.tsx → features/home/Home.tsx | 首页 /；useHome 负责加载、初始化、创建/续学和偏好 |
| app/lessons/[sessionId]/page.tsx → Conversation.tsx | 学习页 /lessons/:sessionId |
| app/api/home、preferences、onboarding | 首页聚合视图、偏好和欢迎状态 |
| app/api/scenes/initialize | requestId/sceneId 初始化课程 |
| app/api/sessions、[sessionId]、turns、continue | 创建/读取、教学提交、旧待继续恢复 |
| app/api/health | 配置存在性检查，不调用模型 |
| contracts/scene.ts / difficulty.ts / lesson.ts | 场景、目录、难度和会话配置快照 |
| contracts/dialogue-plan.ts / jane-turn.ts / teaching.ts | 模型计划、评估、反馈与调用元数据 |
| contracts/training-session.ts / training-session-integrity.ts | 会话与历史关联规则 |
| contracts/learning-event.ts / operation-receipt.ts | 统一学习事件与独立操作回执 |
| contracts/requests.ts / views.ts | API 输入、公开 DTO |
| contracts/sqlite-snapshot.ts | 离线整库快照校验，不作为首页数据模型 |

组件分工：Home 只组合，useHome 管请求；SceneLearningCard、CoursePlanDialog、DifficultyPicker、SceneExplorer 负责展示。Conversation 组合对话及输入，useConversationSubmission 管提交，submission-state 管草稿备忘，SubmissionStatus 管轻量状态提示。组件不直接依赖 server。

## 3. 服务端核心文件

| 文件（src/server/ 下） | 职责 |
| --- | --- |
| services/scene-plan.ts | 场景主题生成和初始化流程 |
| services/create-session.ts | 主题准入、计划生成、首问会话候选 |
| services/turn.ts | 请求去重/版本检查、调用模型、提交候选 |
| services/lesson-state.ts | 反馈业务校验、自动推进及待继续恢复，不执行 SQL |
| services/session-selectors.ts | 实际题目、求助次数、进度与事实派生 |
| services/views.ts | 从仓库组装首页和对话公开数据 |
| agents/jane.ts / scene.ts / context.ts / runner.ts / prompts/ | 模型配置、输入、指令和执行 |
| repositories/profile-repository.ts | 偏好与引导，严格白名单 |
| repositories/catalog-repository.ts | 场景目录、选择与课程原子初始化 |
| repositories/session-repository.ts | 会话读取、创建、重练、事件提交 |
| repositories/session-records.ts | 内部参数化 SQL 与行映射 |
| repositories/session-write-rules.ts | 内部写入边界与不可变历史检查 |
| repositories/learning-progress.ts | 首页 SQL 摘要 |
| repositories/operation-receipts.ts | 事务内幂等核对和成功回执 |
| storage/store.ts | 按路径共享连接/锁，组装最新仓库 |
| storage/database.ts | 安全路径、显式建库/打开、同步短事务 |
| storage/schema-migrations.ts / migrations/001_initial.sql | 显式版本升级、校验和及 6+1 表 DDL |
| storage/import/read-json-source.ts / convert-json.ts | 只读源文件指纹、转换实际事件和回执 |
| storage/import/import-snapshot.ts / snapshot-rows.ts | 全新候选整批导入、读回业务比对 |
| http.ts / errors.ts / logging.ts | HTTP 边界、安全错误映射与分类诊断 |
| config.ts / web-entry.ts / request-hash.ts | 惰性配置、Next 专用入口、统一输入摘要 |

核心文件按业务职责拆分，不按每张表各建一套 service/repository，不增加纯转发层。详细方法调用见数据流导读。

## 4. 语音增量与后续位置

P1.6 已接入的文件（不新增学习状态或音频表）：

| 位置 | 分工 |
| --- | --- |
| features/conversation/VoiceInput.tsx / voice-input.css | 录音按钮、首次说明、计时与局部反馈 |
| features/conversation/useVoiceInput.ts | 录音/转写状态、取消令牌、最新草稿回填 |
| features/conversation/audio-recording.ts | 浏览器权限、格式、音量检测、计时和资源释放 |
| features/conversation/SentencePlayback.tsx | 单句播放/停止、单通道互斥与图标 |
| app/api/transcriptions/route.ts | 同源 HTTP 入口，不访问学习仓库 |
| server/audio-upload.ts | 有界 multipart 读取和音频容器校验 |
| server/services/transcribe-audio.ts | SDK 转写、单在途/超时控制及错误映射 |
| contracts/transcription.ts | 前后端限制、结果 schema 与草稿合并规则 |

P2/P3 的位置约定（各行均为计划新增，具体接口以数据契约为准）：

- `src/app/free-chat/[sessionId]/`、`src/features/free-chat/`（P2）：独立聊天页与输入，不复用训练进度状态。
- `src/app/api/free-chats/`（P2）：独立聊天创建、读取与消息接口。
- 错题列表/详情作为下方复习页内部视图，不额外增加一级导航。
- `src/app/review/`：复习页面入口。
- 收藏表达作为复习页内 Tab，不额外建立一级导航。
- `src/app/settings/`：偏好与学习记录页面入口。
- `src/features/mistakes/`：错题展示与筛选组件。
- `src/features/review/`：复习作答和反馈交互。
- `src/features/phrasebook/`：收藏表达查询与取消交互。
- `src/features/settings/`：偏好设置表单。
- `src/app/api/`：按资源增补接口，不把复习逻辑写进 route.ts。
- `src/server/services/`：增补复习、收藏等业务服务，复用既有 Jane 和业务仓库，不另建 JSON 存储。
- `src/contracts/`：增补对应 schema，避免前后端各写一份类型。


## 5. 当前命令

从项目根运行，Node >=24.18 <25。package.json 是命令准确信息源。

| 命令 | 用途 |
| --- | --- |
| npm install | 安装项目锁定依赖 |
| npm run dev | Webpack 开发服务，127.0.0.1:3000 |
| npm run build / npm start | 生产构建 / 启动；不能与 dev 同占 3000 |
| npm run typecheck | 路由类型和 TypeScript 检查 |
| npm run format / format:check | 排版 / 只检查，不处理学习数据或凭据 |
| npm run data:check | 临时 SQLite + 模拟 SDK 的服务回归，禁止网络调用 |
| npm run voice:check | 音频边界/SDK 请求封装/错误/并发离线检查，不访问麦克风、模型或学习库 |
| npm run sqlite:check-repositories | 业务仓库、并发、回执和回滚回归 |
| npm run sqlite:check | 转换、约束、重开、备份恢复；可加 -- --source data 只读核对旧 JSON |
| npm run sqlite:init -- --target … --catalog … | 全新安装：创建不存在的库、建表、录入种子，不生成课程 |
| npm run sqlite:import -- --source … --catalog … --target … | 旧数据导入全新候选并校验，不自动安装/覆盖 |
| npm run agent:smoke | 真实云端单轮调用，会产生 API 费用 |

next.config.ts 明确项目根并把版本 SQL 纳入构建追踪。无凭据构建不调用模型；数据库按请求惰性打开，但缺库时不会自动初始化。
