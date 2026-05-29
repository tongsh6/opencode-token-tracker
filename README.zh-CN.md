# opencode-token-tracker

面向 [OpenCode](https://opencode.ai) 的实时 token 用量与成本追踪插件。

[English](./README.md) | [简体中文](./README.zh-CN.md)

## 功能特性

- **实时 Toast 提示**：每次 AI 响应后展示 token 用量和成本
- **预算控制**：支持日/周/月预算与阈值预警
- **会话统计**：跟踪整个 session 的累计消耗
- **CLI 统计工具**：按 day/week/month 查看统计，支持按 model/agent/provider 分组
- **成本估算**：基于模型定价自动计算估算成本
- **JSONL 日志**：本地持久化所有用量记录，便于分析
- **多模型支持**：Claude、GPT、DeepSeek、Gemini 等

## AI Engineering Framework

本项目使用 [AI Engineering Framework (AIEF)](https://github.com/tongsh6/ai-engineering-framework) 组织 AI 协作上下文与规范。

- `AGENTS.md`：仓库级 AI 协作规则
- `context/`：技术快照、编码约定、业务语义文档

如果你在构建 AI-assisted engineering 工作流，推荐在你的仓库中采用 AIEF，以获得更清晰的上下文管理与更稳定的 agent 输出。


## 准确性与限制

- **成本均为估算值**，由本地 Token 日志及内置（或用户配置）的定价表计算得出。这可能与您的 Provider 官方账单存在差异 —— 例如，当您使用促销额度、企业折扣或特定定价优惠时。
- **预算提醒仅为警告，非强制阻断**。本插件不会拦截 API 调用、节流请求或中断您的会话。其设计初衷纯粹是为了可观测性与用量追踪。
- **订阅制或打包服务商**（如 GitHub Copilot、Cursor 等）或免费的本地模型，应在您的配置文件中将其价格覆写为 0（参见 [配置说明](#配置说明)）。
- **定价数据时效性**：内置的定价表为手动维护。请运行 `opencode-tokens models` 来检查您当前使用的哪些模型退化（fallback）到了默认定价，并在需要时手动配置覆写。

## 安装

### 插件

在 OpenCode 配置文件 `~/.config/opencode/opencode.json` 中添加插件：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-token-tracker"]
}
```

重启 OpenCode 后会自动安装插件。

这一步只会让 OpenCode 的插件运行时安装并加载该包，不会把
`opencode-tokens` CLI 命令加入你的 shell `PATH`。

### CLI

如果只是偶尔查看统计，可以不做持久安装，直接通过 npm 运行：

```bash
npx -y --package opencode-token-tracker opencode-tokens today
```

等价的 `npm exec` 写法：

```bash
npm exec --yes --package opencode-token-tracker -- opencode-tokens today
```

如果希望 `opencode-tokens` 成为普通 shell 命令，需要让 npm 建立全局
bin 链接：

```bash
npm install -g opencode-token-tracker
opencode-tokens today
```

如果你已经在 OpenCode 配置里添加了插件，但执行 `opencode-tokens today`
提示 `opencode-tokens: command not found`，说明插件已供 OpenCode 加载，
但 CLI 命令还没有安装到 shell `PATH`。请使用上面的任一 CLI 运行方式。

## 使用

端到端安装、验证与 dogfood 路径见 [walkthrough.md](./walkthrough.md)。

### Toast 提示

安装后，每次 AI 响应会看到类似提示：

```
12.5K tokens
$0.023 | Session: $0.156
```

配置预算后，超阈值会显示预警：

```
⚠️ Budget exceeded!
Daily: $5.50/$5.00 (110%)
```

当会话 idle 时，会显示会话摘要：

```
Session: 45.2K tokens
$0.156 | 8 msgs | 5min
```

### 预算控制

设置预算限额，避免意外超支：

```bash
# 查看预算状态
opencode-tokens budget
```

示例输出：

```
  Budget Status
  ══════════════════════════════════════════════════════════════════

  🟢 Daily
    $3.50 / $10.00  [███████░░░░░░░░░░░░░] 35%
    Remaining: $6.50

  🟡 Weekly
    $42.00 / $50.00  [████████████████░░░░] 84%
    Remaining: $8.00

  🟢 Monthly
    $120.00 / $200.00  [████████████░░░░░░░░] 60%
    Remaining: $80.00

  Legend: 🟢 OK  🟡 Warning (>80%)  🔴 Exceeded
```

预算配置文件：`~/.config/opencode/token-tracker.json`

```json
{
  "budget": {
    "daily": 10,
    "weekly": 50,
    "monthly": 200,
    "warnAt": 0.8
  }
}
```

### CLI 统计

```bash
# 全量汇总
opencode-tokens

# 今日统计
opencode-tokens today

# 本周统计（按模型分组）
opencode-tokens week --by model

# 本月统计（展示全部分组）
opencode-tokens month --by all

# 按天拆分
opencode-tokens --by daily
```

`--by` 可选：
- `model`：按模型分组
- `agent`：按 agent 分组
- `provider`：按 provider 分组
- `daily`：按天分组
- `all`：显示全部

示例输出：

```
  Today's Usage
  ──────────────────────────────────────────────────
  Total Tokens:           2.81M
    Input:                2.74M
    Output:               72.9K
    Reasoning:             7.1K
  Cache Read:            12.62M
  Total Cost:            $32.93
  Messages:                 230

  By Model
  ─────────────────────────────────────────────────────
  Model                Tokens        Cost    Msgs
  ---------------  ----------  ----------  ------
  claude-opus-4.5       2.70M      $32.93     206
  deepseek-chat         23.4K     $0.0025       6
  gpt-5.2               86.9K     $0.0000      18
```

`--by` 可选：
- `model`：按模型分组
- `agent`：按 agent 分组
- `provider`：按 provider 分组
- `daily`：按天分组
- `session`：按 session ID 分组
- `all`：显示全部分组

### 趋势图

查看每日 token、成本或消息数趋势：

```bash
# 30 天成本趋势（默认）
opencode-tokens trend

# 7 天 token 趋势
opencode-tokens trend --days 7 --metric tokens

# 更紧凑的图表
opencode-tokens trend --width 40
```

可选参数：
- `--days N`：统计天数，默认 30
- `--metric`：`cost`、`tokens` 或 `messages`，默认 `cost`
- `--width W`：图表宽度，默认 60

### 数据导出

导出 JSONL 聚合后的用量数据：

```bash
# 导出全部数据为 CSV
opencode-tokens export

# 导出本月数据为 JSON
opencode-tokens export --format json --period month

# 写入文件
opencode-tokens export --format csv --output usage.csv
```

可选参数：
- `--format`：`csv` 或 `json`，默认 `csv`
- `--period`：`today`、`week`、`month`、`all`，默认 `all`
- `--output FILE`：写入文件，而不是 stdout

### 配置管理

可直接通过 CLI 管理预算与 Toast 配置：

```bash
# 查看当前配置
opencode-tokens config

# 设置每日预算为 $10
opencode-tokens config set budget.daily 10

# 关闭 Toast
opencode-tokens config set toast.enabled false

# 查看某个值
opencode-tokens config get budget.warnAt

# 恢复默认
opencode-tokens config unset budget.daily
```

可设置字段：
- `budget.daily`、`budget.weekly`、`budget.monthly`、`budget.warnAt`
- `toast.enabled`、`toast.duration`、`toast.showOnIdle`

配置变更会自动备份到 `token-tracker.json.bak`。

### 定价与配置命令

```bash
# 查看预算状态
opencode-tokens budget

# 查看内置定价表
opencode-tokens pricing

# 查看你实际使用的模型与定价来源
opencode-tokens models

# 查看当前配置
opencode-tokens config

# 输出干净 JSON 到 stdout，不写文件
opencode-tokens config init

# 写入 ~/.config/opencode/token-tracker.json
# 已有配置会备份到 token-tracker.json.bak
opencode-tokens config generate
```

`models` 示例输出：

```
  Model                     Provider              Msgs  Pricing     
  ------------------------  ----------------  --------  ------------
  claude-opus-4.5           github-copilot         379  provider cfg
  deepseek-chat             deepseek                 6  built-in    
  gpt-5.2                   openai                  18  built-in    
```

可以帮助你了解：
- 当前使用了哪些模型和 provider
- 定价来源是内置表、用户配置还是默认回退
- 需要在配置文件中补充哪些模型定价

`config init` 适合管道重定向，因为 stdout 只包含合法 JSON，且不会写文件。`config generate` 是写文件路径：stdout 保持为空，说明和状态信息输出到 stderr；父目录不存在时会自动创建，覆盖已有配置前会先备份。

## 日志文件

token 记录保存在：

```
~/.config/opencode/logs/token-tracker/tokens.jsonl
```

单行示例：

```json
{
  "type": "tokens",
  "sessionId": "ses_xxx",
  "messageId": "msg_xxx",
  "agent": "build",
  "model": "claude-opus-4.5",
  "provider": "github-copilot",
  "input": 1500,
  "output": 350,
  "reasoning": 0,
  "cacheRead": 5000,
  "cacheWrite": 0,
  "cost": 0.0234,
  "_ts": 1234567890123
}
```

## 支持模型

| Provider | Models |
| --- | --- |
| Anthropic | Claude Opus 4.5, Sonnet 4/4.5, Haiku 4/4.5 |
| OpenAI | GPT-5.x, GPT-4.x, o1, o3 |
| DeepSeek | deepseek-chat, deepseek-reasoner |
| Google | Gemini 2.x, 3.x |

未知模型会使用默认定价估算。

## 配置说明

在 `~/.config/opencode/token-tracker.json` 创建配置：

```json
{
  "providers": {
    "github-copilot": { "input": 0, "output": 0 }
  },
  "models": {
    "my-custom-model": { "input": 1, "output": 2 }
  },
  "toast": {
    "enabled": true,
    "duration": 3000,
    "showOnIdle": true
  },
  "budget": {
    "daily": 10,
    "weekly": 50,
    "monthly": 200,
    "warnAt": 0.8
  }
}
```

### 定价字段

定价单位均为 **USD / 1M tokens**：

| 字段 | 说明 | 示例 |
| --- | --- | --- |
| `input` | 输入 token 单价 | `15` = $15 / 1M tokens |
| `output` | 输出 token 单价 | `75` = $75 / 1M tokens |
| `cacheRead` | 缓存读取 token 单价（可选） | `1.5` = $1.5 / 1M tokens |
| `cacheWrite` | 缓存写入 token 单价（可选） | `18.75` = $18.75 / 1M tokens |

**如何查找模型定价：**

1. 查看各厂商官方定价页：
   - [Anthropic Claude](https://www.anthropic.com/pricing)
   - [OpenAI](https://openai.com/pricing)
   - [DeepSeek](https://platform.deepseek.com/api-docs/pricing)
   - [Google Gemini](https://ai.google.dev/pricing)

2. 或执行 `opencode-tokens pricing` 查看内置定价表

**常见场景：**

| 场景 | 配置 |
| --- | --- |
| 订阅制服务（GitHub Copilot、Cursor） | `{ "input": 0, "output": 0 }` |
| 免费/本地模型 | `{ "input": 0, "output": 0 }` |
| 自定义 API（已知定价） | 查看 provider 官方定价页 |

### 定价优先级

定价解析顺序（命中即止）：

1. **Provider 覆盖** — 为某个 provider 的所有模型统一设置
2. **用户 model 精确匹配** — 为特定模型或 provider-specific model entry 自定义定价
3. **内置定价精确匹配** — 命中内置定价表中的精确 key
4. **内置定价部分匹配** — 对变体模型名使用最长的内置 key 匹配
5. **用户 model 部分匹配** — 使用最长的用户配置 key 匹配
6. **默认回退** — $1/M input，$4/M output

精确用户配置会优先于内置定价；但宽泛的用户部分匹配会排在内置匹配之后，避免 `"claude"` 这类泛 key 意外覆盖精确的内置模型价格。

#### 示例：免费 provider

使用 GitHub Copilot 等订阅制服务时，将成本设为 $0：

```json
{
  "providers": {
    "github-copilot": { "input": 0, "output": 0 },
    "cursor": { "input": 0, "output": 0 }
  }
}
```

#### 示例：自定义模型定价

为特定模型覆盖或新增定价（单位 USD / 1M tokens）：

```json
{
  "models": {
    "claude-opus-4.5": { "input": 12, "output": 60, "cacheRead": 1.2 },
    "my-local-model": { "input": 0, "output": 0 }
  }
}
```

#### 示例：同一模型在不同 provider 下使用不同价格

如果同一个模型在不同 provider 下价格不同，可以在模型名下继续按 provider 配置：

```json
{
  "models": {
    "deepseek/deepseek-v4-flash": {
      "openrouter": { "input": 0.14, "output": 0.28, "cacheRead": 0.0028 },
      "siliconflow": { "input": 0.2, "output": 0.4 }
    }
  }
}
```

这种写法可以和原来的扁平 `models` 配置同时使用。

### 预算设置

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `daily` | number | - | 每日预算上限（USD） |
| `weekly` | number | - | 每周预算上限（USD） |
| `monthly` | number | - | 每月预算上限（USD） |
| `warnAt` | number | `0.8` | 预警阈值（0-1），如 0.8 = 达到 80% 时预警 |

超出预算时：
- Toast 提示切换为预警/错误样式
- 使用 `opencode-tokens budget` 查看详细状态
- 预算在每日零点（daily）、每周一（weekly）、每月 1 日（monthly）自动重置

### Toast 设置

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 是否显示 Toast 提示 |
| `duration` | number | `3000` | Toast 显示时长（毫秒） |
| `showOnIdle` | boolean | `true` | 会话 idle 时是否显示会话摘要 |

## 开发

```bash
# 克隆仓库
git clone https://github.com/tongsh6/opencode-token-tracker.git
cd opencode-token-tracker

# 安装依赖
npm install

# 构建
npm run build

# 单元与 CLI 测试
npm test

# 真实本机 OpenCode CLI dogfood
node scripts/real-opencode-cli-smoke.mjs --use-temporary-link --model deepseek/deepseek-chat
```

dogfood 脚本只作为仓库内开发工具，不作为 npm 包命令发布。它验证真实本机 `opencode run` 路径，包括 OpenCode 的 cache package 目录；运行结束后会恢复临时 package link。

## License

MIT © [tongsh6](https://github.com/tongsh6)

## Related

- [OpenCode](https://opencode.ai) - AI coding assistant
- [OpenCode Plugins](https://opencode.ai/docs/plugins) - 插件文档
- [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) - OpenCode 增强插件
