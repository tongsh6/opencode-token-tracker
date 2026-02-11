# AGENTS.md

OpenCode Token Tracker 仓库的 AI 协作入口（AIEF L0+）。

## 1) 项目概览

- 项目：OpenCode Token Tracker（OpenCode 插件）
- 目标：实时追踪 token 用量与成本，提供 Toast 提示与 CLI 统计
- 主文件：`index.ts`（插件）、`bin/opencode-tokens.ts`（CLI）
- 技术栈：TypeScript strict + ESM（Node >= 18）
- 发布：npm 包 `opencode-token-tracker`

## 2) 语言与输出规则

- 默认使用中文沟通
- 技术术语、命令、标识符保留英文
- 文档新增优先中文，除非仓库已有明确英文规范

## 3) 知识库导航（context/）

| 路径 | 用途 |
| --- | --- |
| `context/INDEX.md` | context 总入口与导航 |
| `context/tech/REPO_SNAPSHOT.md` | 当前仓库结构与技术快照 |
| `context/tech/conventions/typescript.md` | TypeScript 代码风格与约定 |
| `context/business/INDEX.md` | 业务背景、术语定义与语义口径 |
| `context/experience/INDEX.md` | 经验库索引 |
| `context/experience/lessons/` | 复盘与经验沉淀 |

## 4) 开发硬约束

- 分支策略遵循 `CONTRIBUTING.md`：`feature/*` 或 `fix/*` -> PR 到 `dev` -> PR 到 `main`
- 提交信息遵循 Conventional Commits（`feat|fix|docs|chore|refactor|test`）
- 本项目无测试框架，验证方式为 `npm run build`
- `dist/` 为构建产物目录，不手动编辑
- 除 `@opencode-ai/plugin` 外不引入额外运行时依赖
- 代码风格细则统一放在 `context/tech/conventions/typescript.md`

## 5) 架构与实现要点

### 数据流

1. 监听 OpenCode 事件：`message.updated`、`session.idle`
2. 使用 `messageId-input-output` 去重 token 记录
3. 定价查找顺序：provider 覆盖 -> 用户 model 配置 -> 内置精确匹配 -> 部分匹配 -> 默认值
4. 持久化到 `~/.config/opencode/logs/token-tracker/tokens.jsonl`（JSONL）
5. 会话统计保存在内存 `Map<string, SessionStats>`
6. 通过 `client.tui.showToast()` 输出提示

### 关键注意事项

- `BUILTIN_PRICING` 在 `index.ts` 与 `bin/opencode-tokens.ts` 各有一份，修改定价必须双改
- `seen` 去重集合上限 10,000，避免内存持续增长
- 预算检查会读取完整 JSONL，日志很大时需关注性能

## 6) 自动行为约定（Agent Runtime）

- 执行任务前优先读取 `context/INDEX.md` 与相关 tech 文档
- 涉及代码风格判断时，优先依据 `context/tech/conventions/typescript.md`
- 新增经验/坑位时，补充到 `context/experience/lessons/` 并更新索引
- 若 context 信息与代码现状冲突，以代码现状为准，并回写更新 context

## 7) 常用命令

```bash
# 安装依赖
npm install

# 构建与类型检查
npm run build

# 本地联调插件
npm link

# CLI 手动验证
node dist/bin/opencode-tokens.js
node dist/bin/opencode-tokens.js today --by model
node dist/bin/opencode-tokens.js budget
node dist/bin/opencode-tokens.js pricing
```

## 8) 工具适配（可选）

- 当前未配置额外工具适配器（MCP/外部检索）
- 如后续引入，需在本文件补充入口、权限边界与回退策略
