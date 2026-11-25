# TripTalk

由 Jane 陪伴的奶蓝色旅行英语学习网页。TypeScript + Next.js 全栈 + OpenAI Agents SDK，单人本机运行。

P1 已实现奶蓝首页、固定 Jane、动态场景目录、三档难度、对话、提示纠错、本机保存与续学。酒店、机场、餐厅、交通四个固定场景共用生成流程；新场景生成 3–8 个主题，每主题一段 8–15 问的计划。用户已确认 P1 基本验收完成，具体状态及待补专项检查见 [开发节奏](docs/development-plan.md)。自由聊天和错题页暂未开放。

## 本机启动

已确认顺序：P1 核心流程 → P1.5 SQLite → P1.6 录音输入与句子播放 → P1.7 用户自定义场景 → P2 主题结束后自由聊天 → P3a 收藏 → P3b 错题与基础复习，最后整体回归验收。P3c 与 P4 均不作为本期发布门槛。SQLite 和录音功能已获用户确认；自定义场景 A 版已接入，待真实课程生成与学习验收。句子播放待单独确认；P2/P3 尚未实施，范围见 [开发节奏](docs/development-plan.md)。

需要 Node >=24.18 <25；从本目录运行：

```bash
npm install
# 已有数据库直接启动；全新安装先按下节初始化
npm run dev
```

打开 http://127.0.0.1:3000 。读取、刷新和 /api/health 不调用模型。“开始场景”生成并保存主题目录，再点击“开始学习”生成当前主题对话计划。目录生成前进度留白，默认中等，可切换简单/高级，已有对话难度不变。回答/提示/解释调用模型；回答通过后自动接着提问，反馈和下一问一起保存；含义错误或求助停留当前题。完成主题后回到场景开始下一主题，不自动重复。已保存的待继续状态可使用一次“恢复对话”，正常作答不会逐题暂停。健康接口仅返回配置存在性，不代表云端连通。

开发模式暂用 Next.js 内置 Webpack，保留 Fast Refresh。当前本机 Turbopack 热更新订阅会返回 `restart`，造成页面循环重载；切换后需要停止旧服务并重新执行启动命令，不是仅刷新网页。未改生产构建器，也未增加 Vite 或独立服务。

若本机需要 Clash，使用已配置的 `with-proxy npm run dev` 启动；代理变量必须由启动 Next 的进程继承，仅给 smoke 命令设置无效。若终端仍有旧的全局 key，可用 `with-proxy env -u OPENAI_API_KEY npm run dev`，让 Next 读取项目 .env。不要同时启动第二个服务，先在原终端停止旧服务再重启。

正式记录位于 `data/triptalk.sqlite`（或 DATA_DIR/triptalk.sqlite），只通过 SQLite 保存；原 JSON 不再读写。浏览器仅暂存草稿和未确认操作，不是进度权威。请勿同时运行两个写入同库的服务。

## 数据库初始化与检查

已有本机学习库无需重新初始化。全新安装且没有旧学习记录时：

```bash
npm run sqlite:init -- --target data/triptalk.sqlite --catalog content/scenes.json
```

目标必须不存在；只录入场景种子，不生成课程或示例进度。SQLite 切换已完成，旧 JSON 导入命令已退役；不要用全新安装替代已有学习库。历史转换规则及备份边界见 [SQLite 导读](docs/sqlite-migration-guide.md#8-迁移实施顺序)。

`npm run data:check` 检查真实服务 + 临时 SQLite（模拟 SDK，无收费调用）；`sqlite:check-repositories` 检查事务/幂等/并发；`sqlite:check` 检查种子校验、当前快照写入、约束和备份恢复；全部使用临时库，不读取旧 JSON 或正式学习库。

## 第一次 Agent 调用

本机 .env 已创建（Git 忽略）；新 checkout 可将 [.env.example](.env.example) 复制为 .env，再填写 API key。不要覆盖已有凭据，不要把 key 发到聊天中。

模板默认模型为 gpt-6-luna；实际使用本机 OPENAI_MODEL，不自动替换。本次 P1 联调使用用户配置的 gpt-5.5。

```bash
npm run agent:smoke
```

此命令调用真实云端模型，会产生 API 费用；无 mock、无自动重试。成功时输出 Jane 欢迎语、模型、耗时和 token 用量；失败时仅输出脱敏错误类别。详情见 [OpenAI 接入](docs/openai-setup.md)。

## 检查与生产模式

```bash
npm run typecheck
npm run data:check
npm run build
npm start
```

dev/start 都占用 3000 端口，不要同时启动。当前无自动化测试框架；已有类型、构建和针对性服务检查。若当前环境阻止 Turbopack 的 PostCSS 子进程绑定端口，可用 `npm run build -- --webpack` 验证生产构建；默认 build 仍为 Turbopack，dev 为 Webpack。

`data:check` 使用临时目录和合成数据验证数据规则、保存与恢复，不调用模型，不修改正式学习记录。

## 代码风格与格式化

长期约定见 [AGENTS.md](AGENTS.md#5-代码风格用户长期偏好)：多属性对象逐行写，一行一条语句，2 空格缩进；代码不挤成一行。Prettier 版本已锁定，配置见 [.prettierrc.json](.prettierrc.json)。

```bash
npm run format        # 整理源码和工程配置
npm run format:check  # 只检查，不修改
```

VS Code 以 triptalk 为工作区根目录打开，安装推荐扩展 Prettier - Code formatter（esbenp.prettier-vscode），即可使用项目的保存时格式化配置。若打开的是父目录，子项目 .vscode 设置不一定生效，请单独打开 triptalk。没有自动安装编辑器扩展或修改全局设置。

多属性对象应从 `{` 后换行开始书写。[Prettier 的 objectWrap](https://prettier.io/docs/options#object-wrap) 保留这种展开方式，不会强制所有短对象换行，所以仍须遵守项目约定。短参数列表、import、数组不机械地按逗号拆行。学习数据、凭据、素材、备份和生成文件排除在格式化范围外。

## 数据结构与版本

使用 6 张业务表和 schema_migrations。目录、练习、事件与成功回执分开保存；实际提问也是事件。字段与接口见[数据契约](docs/data-contracts.md)，列字典见[SQLite 导读](docs/sqlite-migration-guide.md)。

普通请求不会创建数据库、执行迁移或回退旧文件；缺库、版本不符或数据损坏会明确报错。数据库及 WAL/SHM、备份不可放 public 或提交 Git。运行中的数据库不能只复制主文件；恢复前必须停写并校验，不能用旧 JSON 覆盖新进度。

场景运行时统一查 scenes；content/scenes.json 仅为种子。首页自定义入口可创建场景，超过四个场景时提供全部目录、搜索与来源筛选；创建和生成课程分开，幂等重试不重复创建，暂不开放编辑/删除。

## 开发入口

`docs/` 为本地开发文档，不随 Git 提交；下方指向该目录的链接仅在保留本地文档时可用。

项目每日设计与功能进展见 [每日进展](docs/daily-progress.md)，当前阶段和待办仍以 [开发节奏](docs/development-plan.md) 为准。

初次阅读代码，可先看 [代码目录与数据流导读](docs/code-and-data-flow.md)：按“进入首页 → 生成场景目录 → 创建主题对话 → 作答并自动推进 → 保存与续学”追踪核心文件，区分 Service、Repository 和 SQLite，以及数据库显式初始化的时机。它是辅助说明，不替代架构、数据契约和开发计划。

语音功能单独看 [录音输入与句子播放导读](docs/voice-input-and-playback.md)：从浏览器录音、云端转写到草稿回填，以及系统语音播放、取消清理和文件分工；先讲技术概念，再跟实际函数。

模型先读 [AGENTS.md](AGENTS.md)，再按当前阶段查看 [开发节奏](docs/development-plan.md)、[项目目录](docs/project-structure.md)。当前进行 P1.6 真实语音验收，不同时扩展自由聊天或复习。转写配置及隐私见 [OpenAI 接入](docs/openai-setup.md#录音转文字接入p16)；`npm run voice:check` 仅做离线边界回归，不调用收费模型。
