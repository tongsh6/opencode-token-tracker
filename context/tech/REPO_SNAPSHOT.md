# REPO SNAPSHOT

更新时间：2026-10-08

## 项目定位

- 名称：`opencode-token-tracker`
- 类型：OpenCode 插件 + 配套 CLI
- 目标：记录 token 用量并估算成本，支持会话提醒与命令行统计

## 技术栈

- 语言：TypeScript（strict）
- 运行时：Node.js >= 18
- 模块系统：ESM（`"type": "module"`）
- 编译目标：ES2022
- 模块解析：`bundler`
- 运行时依赖：`@opencode/plugin@2.0.25`
- 测试：Node.js 内置 `node:test` + `node:assert`（零额外依赖）
- 构建：`tsc`

## 代码结构

```
index.ts
tui.ts
lib/tracker.ts
lib/rpc.ts
lib/shared.ts
bin/opencode-tokens.ts
scripts/real-opencode-cli-smoke.mjs
scripts/release.js
scripts/package-smoke.mjs
test/shared.test.ts
test/cli.test.ts
test/session-display.test.ts
test/plugin-budget.test.ts
test/plugin-session.test.ts
test/plugin-v2.test.ts
test/plugin-tui.test.ts
test/plugin-harness.ts
test/toast.test.ts
test/pricing-audit.test.ts
.github/workflows/ci.yml
.github/workflows/release.yml
token-tracker.example.json
CHANGELOG.md
walkthrough.md
AGENTS.md
context/
```

## 关键模块

- `lib/shared.ts`
  - 共享模块：`ModelPricing` 接口、`BUILTIN_PRICING` 定价表
  - 定价核验：`BUILTIN_PRICING_AUDITS` 按型号覆盖全表基线日期；`getPricingFreshness()` 区分 recent/stale/expired/unknown，90 天为复核提示阈值
  - 内置匹配由计价、来源标签、核验信息共用；本次新核价 DeepSeek/Kimi 条目只接受精确名或 `/` 前缀名，其他既有型号继续按最长 key 部分匹配
  - 配置类型：`TrackerConfig`、`ToastConfig`、`BudgetConfig`、`ConfigValidationResult`
  - 配置验证：`validateConfig(raw)` — 将任意输入规范化为有效配置，收集 warnings
  - 默认配置：`DEFAULT_CONFIG` 常量
  - 工具函数：`formatCost`、`formatTokens`、`formatLocalDateKey`、`getStartOfDay`/`Week`/`Month`
  - 共享口径：`hasBillableTokenUsage()` 统一判断 `input`、`output`、`cacheRead`、`cacheWrite` 是否构成可计费 token 记录
  - 会话展示：`aggregateRootSession()` 按根会话汇总，`buildMessageToast()` 统一普通提示、预算预警和超限文案
  - 由 `index.ts` 和 `bin/opencode-tokens.ts` 共同导入

- `index.ts`
  - V2 `Plugin.define` 服务端入口，目标 OpenCode >= 2.0.25 且 < 3
  - 按 location 隔离 `ctx.event.subscribe()`，cleanup abort 订阅并 dispose RPC
  - 关联 step.started 与 ended/failed，记录 compaction 用量，执行终态触发摘要
  - 通过 created/renamed 和 session.get 恢复会话元数据；消息模型缺失时查询 session.context
  - V2 可见输出 + reasoning 转为历史日志 output，累计 usage 事件不重复处理

- `lib/tracker.ts`
  - 每实例配置、JSONL、预算和会话统计；保留原配置与日志路径
  - 日志写入成功后才确认去重与累计统计；日/周/月重载在当前记录写入前完成
  - 其他实例追加日志后，按大小变化重新读取预算窗口
  - 启动流式恢复 sessions.jsonl，Toast 不回放历史 token

- `lib/rpc.ts` / `tui.ts`
  - TrackerRpc 传递提示及启动配置警告；TUI 只展示，不写日志
  - 包导出 `./tui`，按 location 过滤提示，卸载时注销订阅

- `bin/opencode-tokens.ts`
  - CLI 入口：统计、预算、定价相关命令
  - 读取同一份日志文件并执行聚合计算
  - 支持 stats、budget、pricing、models、doctor、config、export、trend 等本地分析命令
  - daily 分组使用本地自然日；日志加载使用 `hasBillableTokenUsage()` 纳入 cache-only 记录
  - session 分组从 `sessions.jsonl` 读取标题与父子关系，按根会话汇总
  - raw-session 分组保留主、子会话的独立行，用于查看各自消耗
  - pricing/models 展示型号核验日期与估算口径，doctor 对已使用的陈旧/到期内置价格提示；用户覆盖不继承内置日期

- `scripts/release.js`
  - 分段式 release controller：`check`、`prepare`、`tag`
  - 默认只做本地检查；metadata commit 与 tag push 必须通过独立命令触发
  - 使用 npm 命令口径，与 CI/release workflow 保持一致；`prepare` 只允许改动 release metadata 白名单文件

## 数据与配置

- 日志文件：`~/.config/opencode/logs/token-tracker/tokens.jsonl`
- 会话元数据：同目录 `sessions.jsonl`，保存标题与父子关系，不保存额外计费记录
- 可选配置：`token-tracker.example.json`（用户可复制后自定义）
- 构建产物：`dist/`（不手动编辑）

## 工程与发布

- 分支策略：`feature/*` 或 `fix/*` -> PR 到 `dev` -> PR 到 `main`
- 提交规范：Conventional Commits
- CI：GitHub Actions（Node 18 + 22 + 24 矩阵，push/PR 到 main/dev 触发）
- 发布：`npm run release:check` -> `npm run release:prepare` -> PR 合并到 `main` -> `npm run release:tag`；tag 触发 GitHub Actions 执行 `npm publish`
- 当前待发布版本：`2.0.0`

## 常用命令

```bash
npm install
npm run build
npm test
npm run test:package
npm run release:check
npm run release:prepare
npm run release:tag
npm run build && node scripts/real-opencode-cli-smoke.mjs
node dist/bin/opencode-tokens.js
node dist/bin/opencode-tokens.js today --by model
node dist/bin/opencode-tokens.js budget
node dist/bin/opencode-tokens.js pricing
node dist/bin/opencode-tokens.js models
node dist/bin/opencode-tokens.js doctor
```

## 维护提醒

- `BUILTIN_PRICING` 已统一到 `lib/shared.ts`，修改定价只需改一处
- 配置验证统一在 `lib/shared.ts` 的 `validateConfig()`，无效字段静默修正为默认值
- 插件通过 Toast 展示配置警告；CLI 输出到 stderr
- 去重集合和 step 模型缓存上限为 10,000；终态按 sessionId/messageId 去重
- 插件 budget 检查已优化为内存累加器，不再每条消息读文件
- CLI `budget` 命令使用 `loadEntries(since)` 仅加载相关周期数据
- CLI 与插件的 token 记录准入必须继续复用 `hasBillableTokenUsage()`，避免 cache-only 记录在某一侧被漏统
- 日期维度统计必须使用本地自然日口径；避免在 CLI breakdown 中重新引入 UTC `toISOString().slice(0, 10)` 分组
- 预算回归测试通过插件事件入口验证日/周/月切换、未切换周期累计、日志失败及午夜写入边界；测试使用临时目录与隔离的时钟，不改动本机 OpenCode 数据
- 会话回归测试通过插件事件入口验证多层归并、任务隔离、晚到关系、标题更新、无父会话自身消耗、重启恢复与元数据读取降级

V2 完整契约和验证边界见 [opencode-v2-migration.md](opencode-v2-migration.md)。
