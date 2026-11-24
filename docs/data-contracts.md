# 本地数据与接口

SQLite 版 · 2026-11-19。本文维护业务字段、公开接口和提交语义；物理列、主外键及关系图只在 [SQLite 导读第 5 节](sqlite-migration-guide.md#5-具体方案关系字段拆列复杂快照保留-json) 维护。准确校验以 [contracts](../src/contracts) 为准。

## 1. 权威数据与场景选择

单用户、单 Next.js Node 进程，正式库为 `DATA_DIR/triptalk.sqlite`。目录相对项目根解析，数据库及备份禁止进入 public 或 Git。原 profile.json / scenes/*.json 只留档，不再作为运行时数据源。

首页选择顺序：URL 显式 scene → profile.lastSceneId → scenes 按 position 排序的首项。显式未知场景拒绝；读取不会改写偏好。lastSceneId 只表示上次选择，不是当前会话或全局进度；不同场景可以分别有一段活跃练习。

React state 是页面快照，sessionStorage 保存草稿和未确认请求，均不是进度权威。getStore 缓存连接与在途锁，不缓存业务对象。读取快照后直接改对象不会写库。

## 2. 用户与场景

| 业务字段 | 含义 / 更新时机 |
| --- | --- |
| profile.onboardingCompletedAt | 首次引导完成 UTC 时间，初始 null，完成一次后不重复改写 |
| profile.difficulty | easy / medium / advanced，默认 medium；只影响新建练习 |
| profile.lastSceneId | 主动选择/开始/继续的场景 ID，初始 null，写入前校验存在 |
| Scene.id / version / title / description / scope / art | 稳定 ID、内容版本、展示和训练范围；art 可用 generic |
| scenes.origin / position | builtin 或 custom、目录顺序；两类共用同一表 |
| ScenePlan.source / createdAt / planningCall | 课程生成元信息，落在 scenes 的 course_* 列；未生成全部为空 |
| ScenePlan.topics | 3–8 个有序主题，落在 scene_topics；id/title/scope/boundaries，顺序由 position 表示 |

主题 ID 在场景内唯一。生成元信息、全部主题与初始化回执同事务提交；已生成目录不可被重复初始化覆盖。content/scenes.json 仅为显式初始化/导入种子，网页目录只查 CatalogRepository。

Profile 契约暂保留 schemaVersion=1 供输入快照标识；数据库没有对应业务列。结构版本由 schema_migrations 管理，不在各业务表复制。

## 3. 训练会话字段

契约：[training-session.ts](../src/contracts/training-session.ts)。Session 表示**一个主题的一次练习**：返回页面继续同一 ID；下一主题或明确重练才产生新 ID。

| 字段 | 含义 |
| --- | --- |
| id / mode / sceneId / topicId | 会话身份与归属；mode 当前固定 practice，不允许提交时改身份 |
| configSnapshot.lesson | 开始时场景 id/version/title/description 与本次 difficulty |
| configSnapshot.topic | 本主题 id/title/available、8–15 问约束及 scope（含边界） |
| planSnapshot | 程序添加 ID 的原始生成计划：topicId、scenario、facts、questions；不可改写 |
| planningCall | 本次计划调用的 model、elapsedMs、token 用量和 promptVersion |
| revision | 新建为 0；每次成功会话操作 +1，与事件条数无关；旧迁入基线保留 |
| status | active / awaiting_continue / topic_completed |
| currentQuestionId | 当前实际 question 事件的题目 ID；完成时 null |
| pendingContinuation | 已保存的待继续内容，正常新提交后为 null；承接旧记录的受控恢复 |
| turns | 从有序事件表组装的历史，不在 sessions 内再存副本 |
| createdAt / updatedAt / topicCompletedAt | 创建、最后提交、完成 UTC 时间；未完成的完成时间为 null |

planSnapshot.questions 包含 id、english、chineseTranslation、chineseTask、referenceAnswer、goal。计划说明“原本准备如何提问”；实际 question 事件说明“当时真正问了什么”。不再保存 presentedQuestions 或会话级 closingMessage。

中文翻译与中文作答任务不同。新计划和实际下一问必须有翻译，历史缺失保持缺失，不借用计划翻译、不自动付费回填。

pendingContinuation：未完成时 nextQuestionId/english/chineseTranslation/chineseTask 有值、closingMessage=null；全部目标完成时问题字段为空、closingMessage 有值。消费后追加 question/completed 并清空，不在教学反馈中重复保存 continuation。

## 4. 统一学习事件

契约：[learning-event.ts](../src/contracts/learning-event.ts)。每条事件共有 id、sessionId、sequence、action、questionId、createdAt；sequence 从 1 连续递增，仅负责顺序，不等于 revision 或请求编号。

| action | questionId | payload |
| --- | --- | --- |
| question | 实际题目 ID | english、chineseTranslation（旧数据可缺）、chineseTask、goal |
| answer / hint / explain | 本次关联的实际题目 ID | text、feedback、effects、modelCall |
| completed | null | closingMessage |

首问就是 sequence=1 的 question。正常通过回答一次追加 answer + question/completed，但只更新一次 revision、保存一份成功回执。新表不保存 continue，也不为程序问题伪造 requestId。hint 是学习事件，但不是必须显示的聊天气泡。

### 教学 payload

- text：用户原文；按钮式 hint 通常为空。
- feedback.learnerIntent：answer / hint / explain / off_topic；不同于用户点击的 action。
- verdict：correct / needs_correction / uncertain / not_applicable。
- canContinue：是否可推进；允许表达清楚但有轻微语法问题的回答继续。
- correctedAnswer / explanation：纠正表达与中文解释，缺省 null。
- errorTypes：grammar / meaning；网络失败不算语言错误。
- roleplayLine / tutorFeedback：英文角色回应 / 中文反馈。
- roleplayTranslation：对应 roleplayLine 的中文释义，新模型输出必填非空字符串；历史记录可缺失。随 feedback 保存在 turns.payload_json 并返回页面，不新增数据库列，不自动补译旧记录。
- hint：null 或 level（keywords / pattern / example）、text。
- effects.coveredEarly：questionId、evidence；effects.factChanges：key、value、evidence。仅可接受回答产生影响，引用必须存在，证据必须来自本次原文。
- modelCall：model、elapsedMs、inputTokens、outputTokens、totalTokens、promptVersion。只作诊断，不下发浏览器。

## 5. 派生数据与回执

| 结果 | 来源 |
| --- | --- |
| 当前题 / 历史实际题 | 对应 question 事件 |
| 完成目标 | 可继续的 answer 当前题 + effects.coveredEarly，去重 |
| 当前事实 | 原计划 facts + 按序应用 effects.factChanges |
| 求助等级 | 同题 feedback.learnerIntent 的 hint 次数 |
| 完成主题 / 场景进度 | sessions.status，按 sceneId/topicId 去重 |
| 已展示问题数 | question 事件数量 |
| 结束语 | completed.payload.closingMessage |
| processedRequestIds | operation_receipts 中本会话的 session-turn 操作编号 |

首页通过摘要 SQL 计算进度，不加载全部历史；教学上下文用 session-selectors 读取当前会话事件。只给模型近期 6 条教学历史，不删除数据库里的完整历史。

operation_receipts 按 operation / scopeId / requestId 唯一，保存输入摘要及最小成功结果：

- initialize-scene：作用域 sceneId，结果 sceneId。
- create-session：作用域 sceneId，结果 sessionId。
- session-turn：作用域 sessionId，结果 sessionId/turnId/revision；回答、提示、解释、恢复共用作用域。
- create-scene 仅预留契约；自定义场景创建 UI/API 尚未开放。

相同编号不同输入拒绝；相同输入返回原回执和最新视图。普通偏好赋值、完成引导本身幂等，不机械地创建回执。回执必须与业务修改同事务提交，失败不会留下成功回执。

## 6. 公共接口与错误

请求见 [requests.ts](../src/contracts/requests.ts)，公开 DTO 见 [views.ts](../src/contracts/views.ts)。

| 接口 | 输入 / 输出 |
| --- | --- |
| GET /api/health | 仅配置存在性，不验证模型连通 |
| GET /api/home?sceneId=… | HomeView：目录、难度、初始化/完成状态、主题摘要、下一主题、活跃/最近完成会话 |
| PATCH /api/preferences | difficulty?、lastSceneId?，至少一项；严格白名单 |
| PATCH /api/onboarding | 空对象，首次完成后复用 |
| POST /api/scenes/initialize | requestId、sceneId；返回 HomeView |
| POST /api/sessions | requestId、sceneId、topicId、difficulty?、repeat?；返回 MutationResult |
| GET /api/sessions/:sessionId | SessionView：当前题、有序公开事件、状态/进度、结束语、processedRequestIds |
| POST /api/sessions/:sessionId/turns | requestId、expectedRevision、action、text；answer/hint/explain |
| POST /api/sessions/:sessionId/continue | 仅恢复已保存待继续状态，action=continue、text 为空 |

SessionView 的 question 事件返回 id/action/question；教学事件返回 id/questionId/action/text/evaluation；completed 返回 id/action/closingMessage。首问不再有单独 firstQuestion 字段。hint 由页面映射为输入区提示，不展示聊天气泡。

MutationResult={session,receipt}；创建响应 receipt=null。教学回执含 requestId/turnId/revision。新提交回执版本等于该次会话版本；重试较早操作时可小于最新视图，不能据此重复发送。公开 DTO 不含计划、参考答案、effects、输入摘要或模型元数据。

所有 API 校验本机来源、请求格式与大小；错误返回 code/message/retryable/requestId/submission。响应 requestId 是诊断编号，与请求体业务幂等编号不同。

### 异常分类与诊断

| 情况 | 错误码 / 事件 | 用户反馈与处理 |
| --- | --- | --- |
| 回答无法理解、偏题、无效数字等 | 正常成功响应；learner_input_guidance | Jane 引导表达当前中文任务，保留当前题，不计错；不是系统故障 |
| 浏览器到本地服务断线 | CONNECTION_FAILED | 原消息和新草稿分别保留；提交结果未知，先同步，再重试原操作 |
| 本地服务到模型超时 / 断线 | NETWORK_TIMEOUT / NETWORK_CONNECTION_FAILED | 检查网络或 Clash；评估阶段明确未保存，可重新发送 |
| 模型限流 / 额度不足 | API_RATE_LIMITED / API_QUOTA_EXHAUSTED | 稍后重试 / 检查 API 余额，不混为一种提示 |
| 凭据 / 模型权限 | API_AUTH_FAILED / MODEL_UNAVAILABLE | 检查本机 API 配置，不提示修改英文答案 |
| AI 上游服务故障 | AI_SERVICE_UNAVAILABLE | 稍后重试，不自动重发模型请求 |
| 模型拒绝 / 输出不合契约 | AGENT_REFUSED / AGENT_OUTPUT_INVALID | 引导使用虚构信息回到任务 / 提示 Jane 回复未整理好；原回答未保存 |
| 数据库访问 / 忙锁 / 约束 / 校验 | DATABASE_ACCESS_FAILED / DATABASE_BUSY / DATABASE_CONSTRAINT_FAILED / STORAGE_VALIDATION_FAILED | 保留原库，按分类提示，不自动清空 |
| 代码未预期异常 | INTERNAL_ERROR | 保留原消息及新草稿，提示核对或根据日志排查，不暴露异常原文 |

- submission=not_committed 只在已明确尚未保存的阶段标记：评估失败、候选校验或已确认回滚的事务失败。前端保留失败备忘用于原内容重试，也允许编辑后以新 requestId 替换；浏览器丢包或未知结果仍为 unknown，先核对再重试原操作，不推断“必定没保存”。
- 浏览器 `triptalk:composer:<sessionId>` 保存 draft、explainMode、submission；submission 包含完整 operation、客户端状态 sending/checking/failed/unknown/conflict 和公开错误信息。新回答/解释发送时，一次暂存完整请求并清空草稿、重置解释模式；原文由 submission 保留，失败不回填。草稿与原请求独立，临时消息不进入服务端 turns 或学习进度。刷新时 sending/checking 按 unknown 核对，processedRequestIds 确认后移除；重试和确认不修改新草稿。交互规则统一见产品细则第 5 节。
- 服务端统一打印 JSON request_failed：category、code、reason、stage、HTTP requestId、method/path、耗时和提交状态；模型业务校验各分支使用独立 reason，数据库/网络故障仅输出白名单系统错误码。未知代码异常仅记录类型及有限源码位置，不打印完整异常、会话、模型原文或 key。
- 输入引导成功保存后打印 learner_input_guidance（使用业务 requestId），不打印用户回答；浏览器 console.warn 打印 api_request_failed，可用响应诊断 requestId 关联服务端日志。日志不写入学习事件，不增加数据字段。


## 7. 提交与并发边界

1. 课程生成/创建按 sceneId 做进程内互斥，已有练习按 sessionId 互斥。
2. 先查回执再查版本；旧版本未处理请求拒绝，不调用模型。
3. 模型调用在 SQL 事务外；lesson-state 只改变内存候选。
4. commitTurn 在事务内重查回执、expectedRevision、身份/计划/已有事件不可改，以及新增事件与原请求一致。
5. 参数化 SQL 只更新允许的状态字段、追加事件、保存回执。任一步失败整体回滚；提交结果不确定则标 unknown 并核对。
6. 客户端只能用服务端返回的 revision，不能按事件数猜测版本。
7. 页面刷新/丢包先读取 processedRequestIds，再复用原请求重试；保留用户草稿。
8. 单进程本机运行，不承诺多实例，也不保证外部模型调用恰好一次；提交前崩溃重试可能再次计费。

每场景最多一段活跃练习；同主题续学、其他主题冲突。无活跃练习时只能开始下一未完成主题；repeat 必须指向已完成主题。重练不重复累计主题进度。

## 8. 结构版本、导入与后续扩展

schema_migrations 保存已执行 SQL 的版本和校验和，旧迁移不可改，新结构追加版本。数据库缺失或版本不匹配时明确报错，不自动创建空库或读取旧 JSON。

旧 JSON 已完成转换，导入命令与旧契约已退役；转换规则作为历史保留在 SQLite 导读。全新安装直接校验场景种子，离线检查直接构造当前格式快照。既有记录缺失翻译、创建回执时间可空以及待继续恢复的语义不变，不因删除转换器而收紧读取规则。

备份恢复见 [SQLite 导读第 8 节](sqlite-migration-guide.md#8-迁移实施顺序)。运行中的 WAL 数据库不能只复制主文件；切换后产生新记录时，不能用旧 JSON 直接回滚。

scenes 已统一 builtin/custom，但自定义场景的创建/编辑/删除策略与界面另行实现。P2 自由聊天必须独立保存、不改训练进度；P3 错题从 answer 反馈及 question 事件还原，不预造空表。P1.6 转写只产生草稿，不需要改学习事件。

## 9. 录音输入与播放边界（P1.6）

`POST /api/transcriptions`：FormData 的 `audio: File`、`durationMs: string` → `{ text: string }`（去首尾空白，1–2,000 字符）。不接受其他或重复字段；不套用 JSON 请求体，也不手动固定 multipart boundary。共享定义见 contracts/transcription.ts。

服务端沿用本机同源检查；只接受 WebM/MP4/OGG/WAV 的 MIME 与容器签名组合，重命名上传文件，最多 5 MB（multipart 总体另留 16 KB 开销）。流式计数不依赖 Content-Length；上传读取最多 10 秒，上游 30 秒，客户端 45 秒。正常浏览器在 60 秒结束录制，服务端验证声明的 600–60,000ms 元数据；此声明**不是解码后的真实时长证明**。本机单人边界内另以大小、超时、单个转写在途和禁用自动重试限制费用；公开部署前需补真实时长/音轨检查、身份和配额，不能直接当公共上传服务。

转写成功只产生可编辑草稿，不提交回答、不更新 revision 或进度、不生成错题。用户确认后调用原 turns 接口，保留既有 requestId、去重和恢复规则；首版不为录音新增会话字段或持久化音频。转写须保留英文原意与语法，不翻译或主动润色。

权限拒绝/设备不可用由浏览器提示。音频边界错误为 AUDIO_FORM_REQUIRED / AUDIO_INVALID / AUDIO_EMPTY / AUDIO_TOO_LARGE / AUDIO_FORMAT_UNSUPPORTED / AUDIO_UPLOAD_INTERRUPTED；无有效文本为 AUDIO_NO_SPEECH，输出超长/异常为 TRANSCRIPTION_OUTPUT_INVALID，并发为 TRANSCRIPTION_BUSY。云端网络/权限/额度复用现有错误码，但替换为语音文案。

HTTP 失败沿用 error.code/message/requestId/submission 和无缓存头；日志含诊断 ID、阶段 audio_upload / audio_transcription、错误码与耗时，不输出音频/转写全文/key。取消忽略迟到结果，不自动重试付费请求；已上传的请求可能已发生费用。播放仅使用已有英文文本和浏览器语音合成，无新增 API、表或回执。
