# 代码目录与数据流导读

更新于 2026-11-19，描述当前 SQLite 实现。本文讲调用链；字段规则见[数据契约](data-contracts.md)，物理表与迁移见[SQLite 导读](sqlite-migration-guide.md)，验收状态见[开发节奏](development-plan.md)。

## 1. 先建立整体概念

TripTalk 是 Next.js 全栈项目：浏览器与 API 同仓库，Agent 在服务端调用，SQLite 保存正式记录。没有独立后端服务器、ORM 或 React Router。

```text
页面 / Hook → lib/api.ts → app/api Route Handler
                              ├─ 简单偏好 → ProfileRepository
                              └─ 多步骤流程 → services → Agent
                                                   ↓ 校验后的候选
                                    Repository → 短事务 → SQLite
                                                   ↓
                                    views.ts → DTO → React state
```

页面管交互，Service 编排模型与业务，Repository 限定可写内容，SQLite 执行事务。模型不能直接写库；成功生成不等于成功保存。

## 2. 核心文件与职责

路径相对项目根；完整目录索引见[项目目录](project-structure.md)。

| 文件 | 负责什么 |
| --- | --- |
| src/app/page.tsx | 首页入口；URL scene 优先，其次 profile.lastSceneId，再取目录首项 |
| src/app/lessons/[sessionId]/page.tsx | 对话页入口；URL 中的 sessionId 是一次主题练习的 ID |
| src/features/home/useHome.ts | 首页加载、偏好、初始化/创建请求编号暂存、课程弹窗和导航 |
| src/features/conversation/useConversationSubmission.ts | 草稿、乐观消息、发送锁、失败重试及回执核对 |
| src/features/conversation/Conversation.tsx | 按统一事件展示题目与教学结果；hint 只展示在输入框上方 |
| src/lib/api.ts | 拼接 /api、fetch、解析安全错误；不访问模型或数据库 |
| src/server/services/scene-plan.ts | 首次生成 3–8 个主题；已有目录复用 |
| src/server/services/create-session.ts | 检查主题准入、生成 8–15 问计划、构造首问事件 |
| src/server/services/turn.ts | 先核对回执/版本，再调用模型，最后提交候选 |
| src/server/services/lesson-state.ts | 校验反馈、证据与推进条件；仅修改内存候选，不写库 |
| src/server/services/session-selectors.ts | 从事件取得实际问题、已完成目标、求助次数与当前事实 |
| src/server/services/views.ts | homeView / getSessionView；组装公开 DTO，不泄漏参考答案或模型诊断 |
| src/server/agents/context.ts | 组装当前题、事实、近期教学历史与求助等级 |
| src/server/agents/jane.ts、scene.ts、runner.ts | Agent 配置与 SDK 执行；prompts/ 保存指令 |
| src/server/repositories/profile-repository.ts | 白名单偏好合并、场景存在性检查、首次引导 |
| src/server/repositories/catalog-repository.ts | 唯一场景目录入口、课程读取及原子初始化 |
| src/server/repositories/session-repository.ts | 会话读取、顺序创建/重练、受控事件提交与去重 |
| src/server/repositories/session-records.ts | 仓库内部的参数化 SQL 和行映射 |
| src/server/repositories/session-write-rules.ts | 提交时检查身份/历史不可改、版本、事件与请求一致 |
| src/server/repositories/learning-progress.ts | 首页摘要 SQL，不加载所有对话正文 |
| src/server/repositories/operation-receipts.ts | 统一编号/摘要核对；只在业务事务内写成功回执 |
| src/server/storage/store.ts | 打开已安装数据库、组装仓库、共享连接和在途锁 |
| src/server/storage/database.ts | 安全路径、连接设置、同步短事务、完整性检查 |
| src/server/storage/schema-migrations.ts、migrations/ | 显式结构升级和 SQL 校验和；请求不会自动建表 |
| src/contracts/ | 模型输出、请求、训练事件、会话、回执及 DTO 契约 |
| src/contracts/legacy/、src/server/storage/import/ | 仅用于旧 JSON 离线导入，不参与网页运行 |

## 3. 数据位置、文件创建和写入职责

正式数据在 `DATA_DIR/triptalk.sqlite`，默认 `data/triptalk.sqlite`。全新安装由 sqlite:init 创建；已有 JSON 由 sqlite:import 生成候选，经校验后安装。GET、getStore 和构建过程均不会创建空库。

- SQLite 是权威数据。scenes 保存目录，scene_topics 保存主题，sessions 保存练习状态，turns 保存学习事件，operation_receipts 保存成功操作编号，profile 保存偏好。
- React state 是当前挂载组件的展示副本。切页会卸载，返回时重新请求数据。
- sessionStorage 只保存草稿和未确认请求；不是进度数据库。初始化目录也保留完整 requestId/sceneId 以便重试。
- globalThis.triptalkSqliteResources 位于 Node 进程，缓存连接与在途锁，不缓存学习对象。浏览器访问不到它。getStore 每次组装当前版本的仓库，避免热更新继续使用旧校验器。
- 仓库读取的是独立快照；修改返回对象不会改数据库。必须调用具名方法提交，通过 SQL 才写入磁盘。
- 原 JSON 及备份保留但不再读写；没有双写或失败时退回 JSON 的逻辑。

## 4. 完整用户操作链路

### 4.1 进入首页

`app/page.tsx` → `getStore().profile.read()` / `catalog.resolveHomeScene()` → Home。
随后 `useHome.load()` → GET /api/home → `homeView()`：

读取 profile、scenes、scene_topics，并通过 sessions/turns 摘要查询计算进度 → 一个 HomeView 返回页面。不是浏览器按表发多个请求；此过程不调用模型、不生成课程、不写库。

### 4.2 开始场景，再开始主题

1. useHome.initialize 保存 lastSceneId、完成引导；这两项是独立用户意图，生成失败不回滚。
2. POST /api/scenes/initialize，携带固定 requestId/sceneId。
3. scene-plan 检查回执/已有目录；需要时在事务外调用场景 Agent。
4. catalog.initializeCourse 在事务内重查，写 scenes 的课程元信息、全部 scene_topics 和成功回执。失败全部回滚。
5. 返回 HomeView，页面自动打开课程安排弹窗。
6. 用户点击立即学习，POST /api/sessions。create-session 先核对创建回执和主题顺序，按难度调用计划 Agent。
7. sessions.create 原子写 sessions、第一条 question 事件、创建回执，返回会话；浏览器导航到 /lessons/:sessionId。

一个主题的一次练习是一条 session。退出再回来复用原 ID；明确重练才创建另一条 session。每场景最多一段活跃练习，不同场景可分别进行。

### 4.3 进入对话页

GET /api/sessions/:sessionId → getSessionView → sessions.readWithReceipts。
在同一短读事务中读取会话、有序 turns 和已提交编号，映射为公开 DTO。首问也在 turns 中，不再单独补渲染，不会重新生成问题。

### 4.4 回答并自动推进

1. Hook 一次暂存完整请求并清空输入框，立即显示本地待发送气泡；携带 requestId、expectedRevision、action、text。失败原文保留在气泡请求中，求助不清空草稿。
2. turn.submitTurn 先查成功回执，再核对版本。重复请求返回原回执与最新视图；不同内容复用编号则拒绝。
3. 克隆候选 → context 组装教学输入 → SDK 返回结构化评估。
4. lesson-state 校验反馈/证据/下一题。追加 answer；通过时同次追加 question 或 completed。一次操作 revision 只加 1，每条事件 sequence 分别加 1。
5. sessions.commitTurn 开始短事务，重查回执/版本/身份/历史，更新允许的会话状态、追加事件、写回执，一次提交。
6. 返回最新视图，Hook 根据回执替换临时消息，不改动后来输入的新草稿；气泡重试复用原请求。

模型等待期间不持有 SQL 写事务。无效模型结果不落库；语义不清是正常教学反馈，可以保存但不推进、不记成系统异常。

### 4.5 求助、完成和恢复

- hint/explain 仍调用教学 Agent 并保存事件，不推进。提示等级由同题已有求助记录决定；hint 不新增可见聊天气泡。
- 最后一题通过后追加 completed，保存结束语，session 状态变为 topic_completed。首页按已完成 topicId 去重计算进度。
- 旧 awaiting_continue 记录仍可调用 /continue 恢复，直接消费已保存内容，不调用模型，只追加 question/completed；新表不保存 continue。
- 刷新时先 GET 核对 processedRequestIds。结果未知不能擅自认定失败；同编号/原内容重试不会重复提交。切换前的请求编号也已迁入回执表。
- 点击中文释义、复制、收藏占位不写库；问题翻译从 question 事件读取，10 秒关闭，不临时调用模型。

### 4.6 录音输入与句子播放

录音链路：`VoiceInput` → `useVoiceInput.start()` → `audio-recording.startRecording()` 请求麦克风并收集内存 Blob → 停止后 POST /api/transcriptions → `readAudioUpload()` 校验 → `transcribeAudio()` 调用文件转写 → `{ text }` → `useConversationSubmission.insertTranscript()` 追加到**最新**草稿。用户手动发送后才进入 4.4 的学习提交链，之前不写 SQLite、不更新进度。

取消/后台/换题/卸载会使操作令牌失效并释放设备/请求，迟到结果不能覆盖新输入。完整职责与限制见[项目目录](project-structure.md#4-语音增量与后续位置)和[数据契约第 9 节](data-contracts.md#9-录音输入与播放边界p16)。

播放链路：Jane 消息下方 `SentencePlayButton` → 当前对话共用的 `useSentencePlayback` → 浏览器 SpeechSynthesis。只读取已有英文，无 Agent、转写请求或持久化；点击停止/切句、录音开始或离开时 cancel。翻译、复制和选词入口独立。

## 5. 检查与建议阅读顺序

先读 useHome → scene-plan/create-session → turn → lesson-state → session-repository → database，再看 views 与 Conversation。

| 命令 | 验证边界 |
| --- | --- |
| npm run data:check | 模拟 SDK 返回，运行真实服务和临时 SQLite；自动推进、求助、重试与错误分类 |
| npm run voice:check | 模拟上游 fetch，检查上传、转写边界与草稿合并；不验证真实声学质量 |
| npm run sqlite:check-repositories | 仓库准入、历史不可改、事务故障回滚、锁、恢复 |
| npm run sqlite:check | 旧格式转换、约束、重开、备份恢复；--source data 只读旧 JSON 核对 |
| npm run typecheck / format:check / build | 类型、排版与构建，不调用模型 |

真实模型质量与代理连通性仍需用户试聊；这些离线检查不代替真实调用验收。
