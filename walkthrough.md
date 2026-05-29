# OpenCode Token Tracker Walkthrough

本文档是一条端到端使用路径，帮助用户确认插件已经安装、正在记录真实 OpenCode CLI 用量，并能通过 CLI 查看统计与预算。

## 1. 安装插件

### 1.1 OpenCode 插件

在 OpenCode 配置文件 `~/.config/opencode/opencode.json` 中加入插件名：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-token-tracker"]
}
```

重启 OpenCode 后，OpenCode 会自动安装并加载插件。

这一步只负责 OpenCode 插件运行时，不会把 `opencode-tokens` CLI 命令加入
shell `PATH`。

### 1.2 CLI 命令

如果只是偶尔查看统计，可以不做持久安装：

```bash
npx -y --package opencode-token-tracker opencode-tokens today
```

也可以使用显式 npm exec 写法：

```bash
npm exec --yes --package opencode-token-tracker -- opencode-tokens today
```

如果希望直接执行 `opencode-tokens today`，需要让 npm 建立全局 bin 链接：

```bash
npm install -g opencode-token-tracker
opencode-tokens today
```

因此，如果只配置了 OpenCode 插件却看到 `opencode-tokens: command not found`，
应先按本节安装或运行 CLI。

## 2. 产生一条真实用量记录

在任意 OpenCode 工作目录中发起一次真实请求。示例：

```bash
opencode run --format json --model deepseek/deepseek-chat "Reply with OK only."
```

请求完成后，插件会把 token 记录写入：

```text
~/.config/opencode/logs/token-tracker/tokens.jsonl
```

单条记录包含 session、message、model、provider、input、output、cacheRead、cacheWrite 和估算 cost。

## 3. 查看统计

```bash
# 全量汇总
opencode-tokens

# 今日统计
opencode-tokens today

# 按模型分组
opencode-tokens today --by model

# 查看模型定价来源
opencode-tokens models
```

`models` 命令会显示每个模型当前使用的是 provider 覆盖、用户配置、内置价格，还是默认 fallback。

## 4. 生成配置

如果只是想查看推荐配置：

```bash
opencode-tokens config init
```

`config init` 只向 stdout 输出干净 JSON，不写文件，适合重定向或管道处理。

如果要直接写入配置文件：

```bash
opencode-tokens config generate
```

`config generate` 会写入 `~/.config/opencode/token-tracker.json`，stdout 保持为空，说明信息走 stderr；已有配置会先备份到 `token-tracker.json.bak`。

## 5. 设置预算

```bash
opencode-tokens config set budget.daily 10
opencode-tokens config set budget.weekly 50
opencode-tokens config set budget.monthly 200
opencode-tokens config set budget.warnAt 0.8
```

查看预算状态：

```bash
opencode-tokens budget
```

预算只提供提醒，不会阻断 OpenCode 请求。

## 6. 本地开发 dogfood

仓库内提供真实 OpenCode CLI dogfood 脚本，用于插件作者验证当前工作区代码：

```bash
npm run build
node scripts/real-opencode-cli-smoke.mjs --use-temporary-link --model deepseek/deepseek-chat --prompt "Reply with OK only."
```

脚本会临时把 OpenCode 解析到的 package 路径指向当前仓库，覆盖 `~/.config/opencode/node_modules` 与 `~/.cache/opencode/packages` 中发现的插件路径，运行结束后恢复。

dogfood 会验证：

- OpenCode CLI 真实请求退出码为 0
- stdout 中存在 `step_finish`
- 没有 `failed to load plugin opencode-token-tracker`
- token log 中新增匹配记录
- debug 日志中出现 Toast 事件
- 成本 drift 被写入 summary 供人工审阅

产物写入：

```text
dogfood-artifacts/<timestamp>/
  stdout.jsonl
  stderr.log
  token-log-delta.jsonl
  summary.json
```

价格 source of truth 以 provider 官网为准。OpenCode 自身 reported cost 仅作为对照信号，因为 OpenCode 的内置价格表可能滞后于官网。
