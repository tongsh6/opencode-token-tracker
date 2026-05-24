# 真实 OpenCode CLI Dogfood 机制

本机制用于插件作者在本机真实 `opencode` CLI 环境中验证 `opencode-token-tracker`，不是 mock、不是 `opencode server`。

## 命令

```bash
npm run build && node scripts/real-opencode-cli-smoke.mjs
```

常用稳定写法：

```bash
npm run build && node scripts/real-opencode-cli-smoke.mjs --model deepseek/deepseek-chat --prompt "Reply with OK only."
```

如果本机 OpenCode 当前解析到的 npm 包不是本仓库，可以显式启用临时替换：

```bash
npm run build && node scripts/real-opencode-cli-smoke.mjs --use-temporary-link --model deepseek/deepseek-chat
```

`--use-temporary-link` 会在运行期间把已发现的 OpenCode package 解析路径临时替换为指向当前仓库的 symlink，并在结束后恢复原路径。默认不做这个替换。

当前脚本会检查两类路径：

- `~/.config/opencode/node_modules/opencode-token-tracker`
- `~/.cache/opencode/packages/opencode-token-tracker@*/node_modules/opencode-token-tracker`

这点很重要：OpenCode CLI 可能优先使用 cache package，即使 `~/.config/opencode/node_modules` 已经指向当前仓库，旧 cache package 仍可能被加载。

## 验收内容

脚本会执行真实：

```bash
opencode run --print-logs --log-level DEBUG --format json [--model ...] "<prompt>"
```

并检查：

- `opencode` 进程退出码为 0
- stdout 中存在 `step_finish`
- stderr 中没有 `failed to load plugin ... opencode-token-tracker`
- `~/.config/opencode/logs/token-tracker/tokens.jsonl` 新增匹配的 `tokens` 记录
- debug 日志中出现 `type=tui.toast.show publishing`
- 记录插件成本与 OpenCode stdout 成本的 drift

价格 source of truth 以 provider 官网为准。OpenCode stdout 的 `cost` 只作为对照信号，因为 OpenCode 自身的定价表可能滞后于官网。

如果需要把 OpenCode reported cost 当作临时 oracle，可以显式加：

```bash
npm run build && node scripts/real-opencode-cli-smoke.mjs --fail-on-opencode-cost-drift --model deepseek/deepseek-chat
```

## 产物

每次运行会写入：

```text
dogfood-artifacts/<timestamp>/
  stdout.jsonl
  stderr.log
  token-log-delta.jsonl
  summary.json
```

该目录已加入 `.gitignore`。`summary.json` 是主要验收摘要，`stderr.log` 用于定位 OpenCode 插件加载器、provider、toast bus 等真实信号。

## 环境变量

- `OPENCODE_CLI`：指定 `opencode` 二进制路径
- `OPENCODE_DOGFOOD_MODEL`：默认模型参数
- `OPENCODE_DOGFOOD_PROMPT`：默认 prompt
- `OPENCODE_DOGFOOD_TIMEOUT_MS`：超时时间，默认 120000
- `OPENCODE_DOGFOOD_ARTIFACTS`：产物目录
