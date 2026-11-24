# 技术栈与架构

更新于 2026-11-19。本文定义运行边界；验收见[开发节奏](development-plan.md)，字段和接口见[数据契约](data-contracts.md)。

## 1. 技术基线

TypeScript strict、Node >=24.18 <25、React + Next.js App Router 单项目；使用 npm 和独立 lockfile。开发使用内置 Webpack，避免本机 Turbopack 热更新重载；默认生产构建仍为 Turbopack。

- 前端：React state/ref + fetch；Tailwind 4、CSS variables 和已有奶蓝视觉。
- HTTP：Next Route Handlers，Node runtime、同源 /api。
- AI：OpenAI Agents SDK，目录规划/主题规划/教学分别配置，单 Jane 人设，不自主 handoff。
- 校验：共享 Zod 契约，模型输出、请求、存储和公开 DTO 分开。
- 数据：本机 SQLite + Node 内置 node:sqlite；参数化 SQL、具名仓库，不引入 ORM。
- 验证：类型/构建、定向离线脚本和人工验收，不引入通用测试平台。

## 2. 职责与调用方向

```text
浏览器 → Route Handler → service → Agent（事务外）
                            ↓ 候选状态
                       repository
                            ↓ 短事务
                 SQLite：状态 + 事件 + 回执
                            ↓
                       公开视图 → 页面
```

简单偏好/引导可由路由直接调用仓库，不需要纯转发 service。lesson-state 只在内存候选上校验和推进；repository 在提交时再次检查版本、身份、历史和关联，才允许写入。

三类仓库：ProfileRepository（偏好）、CatalogRepository（场景及课程目录）、SessionRepository（练习和事件）。session-records、session-write-rules、learning-progress 是会话仓库内部的行映射、提交约束和摘要查询；operation-receipts 共用幂等规则，不单独提交成功回执。

views 组装公开数据，首页直接读取摘要；session-selectors 计算当前练习的实际题、事实和求助等级。没有整库内存缓存、事件总线、万能 CRUD 或层层转发框架。

## 3. Next.js 与 CLI 边界

- 单应用绑定 127.0.0.1:3000。浏览器不能导入 server；核心服务不依赖 NextRequest/NextResponse，CLI 可复用。
- HTTP/数据库路由使用 Node runtime，不使用 Edge、静态导出或无持久磁盘部署。
- import/build 不调用模型、不打开或创建正式数据。运行时 getStore 只打开已安装库；建库/DDL 是显式 CLI 操作。
- 共享 globalThis 仅保存连接和在途锁，仓库每次重新装配，热更新不复用旧业务闭包。
- 页面动态读取；业务响应 Cache-Control: no-store。普通 GET 不更新偏好或进度。
- Next 从项目 .env 读取配置，CLI 按命令显式加载；key、模型诊断和完整对话不输出到浏览器/日志。
- 从项目根启动；版本化 SQL 按项目路径读取并纳入 Next 构建追踪。

## 4. 运行与安全

单用户、单服务进程，数据库位于 DATA_DIR/triptalk.sqlite，目录和备份受权限保护、Git 忽略、禁止 public。本地存储并非加密，不存真实证件或支付信息。绑定回环地址仍保留 Host/Origin、请求大小和内容校验。

模型只接收必要教学上下文；用户文本不能成为系统指令，UI 不直接渲染模型 HTML。网络失败不计语言错误；保存失败不伪装成功。窄屏适配不表示开放局域网手机访问、多用户或云同步。

## 5. SQLite 运行架构（P1.5）

- 6 张业务表 + schema_migrations；课程元信息合并到 scenes，主题独立为 scene_topics。完整列字典见 [SQLite 导读](sqlite-migration-guide.md)。
- scenes 是内置/自定义目录的唯一运行时来源；content/scenes.json 只作显式种子，不覆盖已有目录。
- sessions 保存当前状态和不可变配置/计划；turns 保存 question/answer/hint/explain/completed。实际题目只存一次，不保存 continue 或 presentedQuestions 副本。
- operation_receipts 按操作作用域统一幂等，与业务更新同事务。sequence 是事件顺序，revision 是一次提交的版本，两者分开。
- 模型调用前先查回执/版本；调用在事务外。事务内重查回执/准入/版本，追加事件、更新允许字段、写成功回执；失败整体回滚。
- WAL + FULL 同步、外键和唯一约束、有限 busy timeout。读聚合使用短快照，禁止事务内 await 或网络调用。仅支持同机单服务，不宣称多机多写。
- 首次显式初始化；版本不匹配拒绝运行，不悄悄升级、重建或退回 JSON。
- 正式 SQLite 已接线并完成旧记录导入；旧 JSON 与对应运行时代码留备份，旧文件运行时读写代码、一次性导入命令与旧契约已移除。新安装与离线回归直接使用当前数据结构。
- 活动库备份须用 Online Backup 等安全方式；不能只复制主文件忽略 WAL。切换后有新记录时，旧 JSON 不是无损回滚方案。

恢复、备份和数据转换的唯一操作说明见 [SQLite 导读第 8 节](sqlite-migration-guide.md#8-迁移实施顺序)，当前检查结果见开发节奏。

## 6. 录音输入与句子播放（P1.6）

本节维护技术边界；逐函数实现和基础概念见[录音输入与句子播放导读](voice-input-and-playback.md)。

```text
麦克风 → MediaRecorder 录制完毕 → Next.js 转写接口 → 云端语音转文字
                                                     ↓
现有回答接口 ← 用户确认发送 ← 可编辑的输入框 ← 转写文本
```

浏览器用 getUserMedia 请求权限、MediaRecorder 生成有时长/大小上限的音频；录音 hook 管生命周期，组件管显示。通过 FormData 上传到 Node Route Handler，由转写服务调用 API；转写不是 Jane 的教学任务，不新增教学 Agent，也不更换现有 Agents SDK。

转写服务已接入 OpenAI 文件转写，默认模型及限制见 OpenAI 接入，月预算尚未设置。录音需 HTTPS 或 localhost 安全上下文；窄屏适配不等于局域网 HTTP 能访问麦克风。检查浏览器实际支持的 MIME 类型，不硬编码所有浏览器都输出 WebM。参考 [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) 与 [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)。

不保存原始录音，不建立长连接或实时音频会话；只有用户确认发送的文字进入原教学流程。句子点播独立使用浏览器 SpeechSynthesis，不经过服务器、不改数据库；录音开始时停止点播。交互和隐私边界见 [产品规则](product.md#48-录音输入与句子播放p16)及 [OpenAI 接入](openai-setup.md#录音转文字接入p16)。
