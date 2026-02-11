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

## 安装

在 OpenCode 配置文件 `~/.config/opencode/opencode.json` 中添加插件：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-token-tracker"]
}
```

重启 OpenCode 后会自动安装插件。

## 使用

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

```bash
# 查看预算状态
opencode-tokens budget
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

# 基于当前使用情况生成示例配置
opencode-tokens config init
```

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

- `input`：输入 token 单价
- `output`：输出 token 单价
- `cacheRead`：缓存读取 token 单价（可选）
- `cacheWrite`：缓存写入 token 单价（可选）

定价解析顺序（命中即止）：

1. provider 覆盖
2. 用户 model 配置
3. 内置定价
4. 默认回退（$1/M input，$4/M output）

## 开发

```bash
# 克隆仓库
git clone https://github.com/tongsh6/opencode-token-tracker.git
cd opencode-token-tracker

# 安装依赖
npm install

# 构建
npm run build

# 本地联调
npm link
cd ~/.config/opencode
npm link opencode-token-tracker
```

## License

MIT © [tongsh6](https://github.com/tongsh6)

## Related

- [OpenCode](https://opencode.ai) - AI coding assistant
- [OpenCode Plugins](https://opencode.ai/docs/plugins) - 插件文档
- [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) - OpenCode 增强插件
