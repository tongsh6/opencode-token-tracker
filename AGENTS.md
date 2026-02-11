# AGENTS.md

本仓库的 AI 编码代理工作指南。

## 项目概述

OpenCode Token Tracker — 一个用于实时 token 用量和成本追踪的 OpenCode 插件。
两个主要源文件：`index.ts`（插件本体）和 `bin/opencode-tokens.ts`（CLI 工具）。
使用 TypeScript（strict 模式）编写，编译为 ESM，发布到 npm。

## 构建 / 检查 / 测试命令

```bash
# 安装依赖
npm install

# 构建（TypeScript 编译）
npm run build        # 实际执行: tsc

# 本项目没有配置测试框架，没有测试文件。
# 验证改动的方式是构建并检查类型错误：
npm run build

# 本地测试：link 后配合 OpenCode 使用
npm link
# 然后在 ~/.config/opencode/opencode.json 的 plugin 数组中添加 "opencode-token-tracker"

# CLI 手动测试
node dist/bin/opencode-tokens.js
node dist/bin/opencode-tokens.js today --by model
node dist/bin/opencode-tokens.js budget
node dist/bin/opencode-tokens.js pricing
```

## 项目结构

```
index.ts                          # 插件主入口（导出 TokenTrackerPlugin）
bin/opencode-tokens.ts            # CLI 工具，用于查看统计、预算、定价
dist/                             # 编译输出目录（不要手动编辑）
token-tracker.example.json        # 用户配置示例
package.json                      # ESM 模块，Node >= 18
tsconfig.json                     # strict, ES2022, ESNext modules, bundler resolution
```

## TypeScript 配置

- **Target:** ES2022
- **Module:** ESNext，模块解析使用 `bundler`
- **Strict 模式:** 开启（所有严格检查均启用）
- **声明文件:** 生成在 `dist/` 目录
- **Include:** `*.ts`, `bin/**/*.ts`

## 代码风格指南

### 导入

- 类型导入使用 `import type`（如 `import type { Plugin } from "@opencode-ai/plugin"`）
- Node.js 内置模块使用命名导入（如 `import { readFileSync, existsSync } from "fs"`）
- 导入顺序：类型导入优先，其次 Node.js 内置模块，最后本地模块
- Node.js 模块不使用默认导入，一律使用命名导入

### 格式化

- 2 空格缩进
- 无分号（semicolon-free 风格）
- 字符串使用双引号（不用单引号）
- 多行对象/数组使用尾逗号
- 大数字使用数字分隔符：`1_000_000` 而非 `1000000`
- 代码段落使用 `// ====...====` 注释块作为分隔标题

### 类型与接口

- 对象结构使用 `interface`（不用 `type` 别名定义对象）
- 接口字段用行内注释说明（如 `input: number // per 1M input tokens`）
- 字符串键的映射使用 `Record<string, T>`
- 可选属性优先使用 `field?: Type`，而非 `| undefined`
- 少用 `as` 类型断言，优先使用类型收窄
- 非空断言 `!` 仅在 `Map.has()` 检查之后使用

### 命名规范

- **变量/函数:** camelCase（`formatCost`, `loadEntries`, `sessionStats`）
- **接口:** PascalCase（`ModelPricing`, `SessionStats`, `BudgetConfig`）
- **常量:** 模块级常量使用 UPPER_SNAKE_CASE（`CONFIG_DIR`, `LOG_FILE`, `BUILTIN_PRICING`）
- **函数:** 动词开头（`getModelPricing`, `calculateCost`, `loadConfig`, `formatTokens`）
- **CLI 命令函数:** `cmd` 前缀（`cmdStats`, `cmdBudget`, `cmdPricing`）
- **布尔变量/函数:** `is`/`has` 前缀（`isDuplicate`, `hasTokens`）

### 错误处理

- 非关键性失败使用 try/catch 配空 catch 块（如配置解析、JSON 行解析）
- 静默 catch 时写注释说明意图：`// Config parse error - use defaults`
- 出错时返回安全默认值（空数组、默认配置对象等）
- `showToast` 调用需包裹 try/catch + 空 catch（toast 失败不影响主流程）
- 不使用 `throw` — 本项目采用静默降级策略，不崩溃

### 函数

- 优先使用纯辅助函数（如 `formatCost`, `formatTokens`, `padLeft`）
- 相关函数用段落注释块分组
- 函数签名中使用默认参数值：`cacheRead: number = 0`
- 使用 `??`（空值合并）作为兜底：`e.input ?? 0`
- 使用 `?.`（可选链）访问嵌套属性：`info.tokens.cache?.read`

### 模块模式

- 插件同时导出为命名导出（`TokenTrackerPlugin`）和默认导出
- 模块级可变状态使用 `let` 声明配置，`Map`/`Set` 存储运行时数据
- 不使用 class — 全部使用函数和普通对象
- 除 `@opencode-ai/plugin` 外无其他运行时依赖

## 架构要点

### 数据流

1. 插件接收来自 OpenCode 的 `message.updated` 和 `session.idle` 事件
2. Token 数据通过 `messageId-input-output` 作为 key 去重
3. 成本计算的定价查找顺序：provider 覆盖 → 用户 model 配置 → 内置精确匹配 → 部分匹配 → 默认值
4. 数据记录到 `~/.config/opencode/logs/token-tracker/tokens.jsonl`（JSONL 格式）
5. 会话统计通过 `Map<string, SessionStats>` 保存在内存中
6. Toast 通知通过 `client.tui.showToast()` 显示

### 重要的代码重复

`BUILTIN_PRICING` 在 `index.ts` 和 `bin/opencode-tokens.ts` 中各有一份。
更新定价时**必须同步修改两个文件**（代码注释中也有标注）。

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: 新功能
fix: 修复 bug
docs: 文档更新
chore: 维护性工作
refactor: 代码重构
```

## 分支策略

- `main` — 稳定发布版，发布到 npm
- `dev` — 开发分支，功能先合并到这里
- `feature/*` — 功能分支，PR 到 `dev`
- `fix/*` — 修复分支，PR 到 `dev`

## 常见陷阱

- 没有配置 linter 或 formatter — 需要手动遵循现有代码风格
- `dist/` 目录在 gitignore 中；修改后务必运行 `npm run build` 确认编译通过
- 插件 API 类型来自 `@opencode-ai/plugin`；event properties 是松散类型，需要手动 `as` 转换
- 防内存泄漏：`seen` 去重 Set 上限为 10,000 条，超出后清理前半部分
- 预算检查每次都会读取完整的 JSONL 日志文件 — 日志量大时注意性能
