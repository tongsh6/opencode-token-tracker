# REPO SNAPSHOT

更新时间：2026-02-11

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
- 运行时依赖：`@opencode-ai/plugin`
- 测试：Node.js 内置 `node:test` + `node:assert`（零额外依赖）
- 构建：`tsc`

## 代码结构

```
index.ts
lib/shared.ts
bin/opencode-tokens.ts
test/shared.test.ts
.github/workflows/ci.yml
token-tracker.example.json
AGENTS.md
context/
```

## 关键模块

- `lib/shared.ts`
  - 共享模块：`ModelPricing` 接口、`BUILTIN_PRICING` 定价表
  - 工具函数：`formatCost`、`formatTokens`、`getStartOfDay`/`Week`/`Month`
  - 由 `index.ts` 和 `bin/opencode-tokens.ts` 共同导入

- `index.ts`
  - 插件入口（`TokenTrackerPlugin`）
  - 监听 `message.updated`、`session.idle`
  - 记录 JSONL 日志并管理会话内存统计
  - 触发 Toast 成本提示

- `bin/opencode-tokens.ts`
  - CLI 入口：统计、预算、定价相关命令
  - 读取同一份日志文件并执行聚合计算

## 数据与配置

- 日志文件：`~/.config/opencode/logs/token-tracker/tokens.jsonl`
- 可选配置：`token-tracker.example.json`（用户可复制后自定义）
- 构建产物：`dist/`（不手动编辑）

## 工程与发布

- 分支策略：`feature/*` 或 `fix/*` -> PR 到 `dev` -> PR 到 `main`
- 提交规范：Conventional Commits
- CI：GitHub Actions（Node 18 + 22 矩阵，push/PR 到 main/dev 触发）
- 发布：合并到 `main` 后按版本打 tag，执行 `npm publish`

## 常用命令

```bash
npm install
npm run build
npm test
npm link
node dist/bin/opencode-tokens.js
node dist/bin/opencode-tokens.js today --by model
node dist/bin/opencode-tokens.js budget
node dist/bin/opencode-tokens.js pricing
```

## 维护提醒

- `BUILTIN_PRICING` 已统一到 `lib/shared.ts`，修改定价只需改一处
- `seen` 去重集合存在上限（10,000）以控制内存
- 预算命令会全量读取日志，日志增长后要注意性能
