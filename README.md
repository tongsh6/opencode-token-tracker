# opencode-token-tracker

Real-time token usage and cost tracking plugin for [OpenCode](https://opencode.ai).

[English](./README.md) | [简体中文](./README.zh-CN.md)

## Features

- **Real-time Toast notifications** - See token usage and cost after each AI response
- **Budget control** - Set daily/weekly/monthly spending limits with warnings
- **Session statistics** - Track cumulative usage across your entire session
- **CLI statistics tool** - Query usage by day/week/month with breakdowns by model/agent
- **Cost calculation** - Automatic cost estimation based on model pricing
- **JSONL logging** - All usage data saved locally for analysis
- **Multi-model support** - Claude, GPT, DeepSeek, Gemini, and more

## AI Engineering Framework

This project uses the [AI Engineering Framework (AIEF)](https://github.com/tongsh6/ai-engineering-framework) to organize AI collaboration context and conventions.

- `AGENTS.md` defines repository-level collaboration rules
- `context/` stores technical snapshots, coding conventions, and business semantics

If you are building AI-assisted engineering workflows, we strongly recommend adopting AIEF in your own repositories for clearer context management and more consistent agent outputs.


## Accuracy & Limitations

- **Costs are estimates**, computed locally from your token logs and the built-in (or user-configured) pricing table. They may differ from your provider's official invoice — for example, when promotional credits, discounts, or enterprise pricing structures apply.
- **Budgets are warnings, not enforcement.** This plugin does not block API calls, throttle requests, or interrupt active sessions. It is designed purely as an observability and tracking tool.
- **Subscription or bundled providers** (such as GitHub Copilot, Cursor, etc.) or free local models should be configured with zero-cost overrides in your configuration file (see [Configuration](#configuration)).
- **Pricing freshness**: The built-in pricing table is manually maintained. Please run `opencode-tokens models` to inspect which of your used models currently fall back to the default pricing, and configure overrides if necessary.

## Installation

### Plugin

Add to your OpenCode config file (`~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-token-tracker"]
}
```

Restart OpenCode and the plugin will be automatically installed.

This installs the package for OpenCode's plugin runtime. It does not add the
`opencode-tokens` CLI command to your shell `PATH`.

### CLI

If you only need to run the CLI occasionally, use it through npm without a
persistent install:

```bash
npx -y --package opencode-token-tracker opencode-tokens today
```

Equivalent `npm exec` form:

```bash
npm exec --yes --package opencode-token-tracker -- opencode-tokens today
```

If you want `opencode-tokens` to be available as a normal shell command, install
the package with npm's global bin linking:

```bash
npm install -g opencode-token-tracker
opencode-tokens today
```

If `opencode-tokens: command not found` appears after configuring the plugin,
the plugin is still installed for OpenCode, but the CLI command has not been
installed into your shell `PATH`. Use one of the CLI options above.

## Usage

For an end-to-end setup and verification path, see [walkthrough.md](./walkthrough.md).

### Toast Notifications

Once installed, you'll see Toast notifications after each AI response:

```
12.5K tokens
$0.023 | Session: 45.2K · $0.156
```

> `Session:` is the cumulative token and cost total of the whole top-level task. When the main agent spawns sub-agents, their usage is rolled up into the parent session, so the main and sub-agent toasts converge on the same task total.

When budget limits are configured, you'll see warnings:

```
12.5K tokens
$0.023 | Session: 45.2K · Daily: $4.20/$5.00 (84%)
```

When a budget is exceeded, the toast switches to an alert:

```
⚠️ Budget exceeded!
Daily: $5.50/$5.00 (110%)
```

When a session becomes idle, you'll see a summary:

```
Session: 45.2K tokens
$0.156 | 8 msgs | 5min
```

### Budget Control

Set spending limits to avoid unexpected costs:

```bash
# Check current budget status
opencode-tokens budget
```

Example output:

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

Configure budget in `~/.config/opencode/token-tracker.json`:

```json
{
  "budget": {
    "daily": 10,      // $10 per day
    "weekly": 50,     // $50 per week
    "monthly": 200,   // $200 per month
    "warnAt": 0.8     // Warn at 80% usage
  }
}
```

### CLI Statistics

Query your token usage from the command line:

```bash
# All-time summary
opencode-tokens

# Today's usage
opencode-tokens today

# This week's usage with model breakdown
opencode-tokens week --by model

# This month with all breakdowns
opencode-tokens month --by all

# Day-by-day breakdown
opencode-tokens --by daily
```

Example output:

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

Breakdown options (`--by`):
- `model` - Group by model (e.g., claude-opus-4.5)
- `agent` - Group by agent (e.g., sisyphus, coder)
- `provider` - Group by provider (e.g., anthropic, openai)
- `daily` - Show day-by-day breakdown
- `session` - Group by top-level session, rolling sub-agent sessions up into their parent (labelled by the parent's title)
- `raw-session` - Group by each session id without rollup, so sub-agent sessions stay as separate rows labelled by their own title
- `all` - Show all breakdowns

### Trend Chart

Visualize your daily token usage and cost over time:

```bash
# 30-day cost trend (default)
opencode-tokens trend

# 7-day token count trend
opencode-tokens trend --days 7 --metric tokens

# Compact chart
opencode-tokens trend --width 40
```

Options:
- `--days N` — Number of days to chart (default 30)
- `--metric` — `cost` (default), `tokens`, or `messages`
- `--width W` — Chart width in characters (default 60)

### Data Export

Export your token usage data for analysis:

```bash
# Export all data as CSV
opencode-tokens export

# Export this month as JSON
opencode-tokens export --format json --period month

# Export to file
opencode-tokens export --format csv --output usage.csv
```

Options:
- `--format` — `csv` (default) or `json`
- `--period` — `today`, `week`, `month`, `all` (default)
- `--output FILE` — Write to file instead of stdout

### Config Management

Manage budget and toast settings directly from the CLI:

```bash
# Show current config
opencode-tokens config

# Set daily budget to $10
opencode-tokens config set budget.daily 10

# Disable toast notifications
opencode-tokens config set toast.enabled false

# Check a value
opencode-tokens config get budget.warnAt

# Reset to default
opencode-tokens config unset budget.daily
```

Settable keys:
- `budget.daily`, `budget.weekly`, `budget.monthly`, `budget.warnAt`
- `toast.enabled`, `toast.duration`, `toast.showOnIdle`

Config changes are automatically backed up to `token-tracker.json.bak`.

### Pricing & Config Commands

```bash
# Check budget status
opencode-tokens budget

# Diagnose plugin config, logs, and pricing fallbacks
opencode-tokens doctor

# Show built-in pricing table
opencode-tokens pricing

# Show your used models and their pricing status
opencode-tokens models

# Show current config
opencode-tokens config

# Print clean example JSON to stdout without writing a file
opencode-tokens config init

# Write example config to ~/.config/opencode/token-tracker.json
# Existing config is backed up to token-tracker.json.bak
opencode-tokens config generate
```

Example `models` output:
```
  Model                     Provider              Msgs  Pricing     
  ------------------------  ----------------  --------  ------------
  claude-opus-4.5           github-copilot         379  provider cfg
  deepseek-chat             deepseek                 6  built-in    
  gpt-5.2                   openai                  18  built-in    
```

This helps you understand:
- Which models/providers you're using
- Whether pricing is from built-in table, your config, or default fallback
- What to add to your config file

`config init` is safe for piping because stdout contains only valid JSON and no file is written. `config generate` is the file-writing path: stdout stays empty, guides and status messages go to stderr, the parent directory is created when needed, and an existing config is backed up before overwrite. Both commands inspect local logs and pre-fill likely zero-cost providers such as GitHub Copilot, Cursor, and Ollama.

`doctor` is a read-only setup check. It reports whether the OpenCode plugin
entry is present, whether the tracker config and token log exist, the latest log
record, default-priced models, and the next command to run.

## Log Files

Token usage is logged to:

```
~/.config/opencode/logs/token-tracker/tokens.jsonl
```

Each line is a JSON object:

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

## Supported Models

| Provider | Models |
|----------|--------|
| Anthropic | Claude Opus 4.5, Sonnet 4/4.5, Haiku 4/4.5 |
| OpenAI | GPT-5.x, GPT-4.x, o1, o3 |
| DeepSeek | deepseek-chat, deepseek-reasoner |
| Google | Gemini 2.x, 3.x |

Unknown models use a default pricing estimate.

## Configuration

Create a config file at `~/.config/opencode/token-tracker.json`:

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

### Budget Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `daily` | number | - | Maximum daily spend in USD |
| `weekly` | number | - | Maximum weekly spend in USD |
| `monthly` | number | - | Maximum monthly spend in USD |
| `warnAt` | number | `0.8` | Warning threshold (0-1), e.g., 0.8 = warn at 80% |

When you exceed a budget limit:
- Toast notifications change to warning/error style
- Use `opencode-tokens budget` to check detailed status
- Budgets reset at midnight (daily), Monday (weekly), or 1st of month (monthly)

### Pricing Fields Explained

All prices are in **USD per 1 million tokens**:

| Field | Description | Example |
|-------|-------------|---------|
| `input` | Cost for input/prompt tokens | `15` = $15 per 1M tokens |
| `output` | Cost for output/completion tokens | `75` = $75 per 1M tokens |
| `cacheRead` | Cost for cached input tokens (optional) | `1.5` = $1.5 per 1M tokens |
| `cacheWrite` | Cost for cache write tokens (optional) | `18.75` = $18.75 per 1M tokens |

**How to find pricing for your model:**

1. Check the provider's official pricing page:
   - [Anthropic Claude](https://www.anthropic.com/pricing)
   - [OpenAI](https://openai.com/pricing)
   - [DeepSeek](https://platform.deepseek.com/api-docs/pricing)
   - [Google Gemini](https://ai.google.dev/pricing)

2. Or run `opencode-tokens pricing` to see built-in prices

**Common scenarios:**

| Scenario | Config |
|----------|--------|
| Subscription service (GitHub Copilot, Cursor) | Provider override: `{ "input": 0, "output": 0 }` |
| Free/local provider (Ollama, LM Studio, localhost) | Provider override: `{ "input": 0, "output": 0 }` |
| Free/local model under a paid provider | Model override: `{ "input": 0, "output": 0 }` |
| Custom API with known pricing | Look up provider's pricing page |

### Pricing Override

Pricing is resolved in this order (first match wins):

1. **Provider-level override** - Override all models for a provider
2. **Exact user model config** - Custom pricing for a specific model or provider-specific model entry
3. **Built-in exact match** - Exact key in the built-in pricing table
4. **Built-in partial match** - Longest matching built-in key for variant model names
5. **User model partial match** - Longest matching user config key
6. **Fallback** - $1/M input, $4/M output

Exact user config is intentionally checked before built-ins, while broad partial user keys are checked after built-ins so a generic key like `"claude"` does not accidentally override a precise built-in model price.

#### Example: Free providers

If you're using GitHub Copilot, Ollama, LM Studio, or other subscription/local providers, set their provider cost to $0:

```json
{
  "providers": {
    "github-copilot": { "input": 0, "output": 0 },
    "cursor": { "input": 0, "output": 0 },
    "ollama": { "input": 0, "output": 0 }
  }
}
```

#### Example: Custom model pricing

Override or add pricing for specific models (prices in USD per 1M tokens):

```json
{
  "models": {
    "claude-opus-4.5": { "input": 12, "output": 60, "cacheRead": 1.2 },
    "my-local-model": { "input": 0, "output": 0 }
  }
}
```

#### Example: Same model, different provider pricing

If the same model has different prices under different providers, nest provider names under the model key:

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

You can still mix this with the original flat model pricing format.

### Toast Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Show toast notifications |
| `duration` | number | `3000` | Toast display duration (ms) |
| `showOnIdle` | boolean | `true` | Show session summary on idle |

## Development

```bash
# Clone the repo
git clone https://github.com/tongsh6/opencode-token-tracker.git
cd opencode-token-tracker

# Install dependencies
npm install

# Build
npm run build

# Unit and CLI tests
npm test

# Real local OpenCode CLI dogfood
node scripts/real-opencode-cli-smoke.mjs --use-temporary-link --model deepseek/deepseek-chat
```

The dogfood script is repo-only and is not published as an npm command. It verifies the real local `opencode run` path, including OpenCode's cache package directory, and restores any temporary package links after the run.

## License

MIT © [tongsh6](https://github.com/tongsh6)

## Related

- [OpenCode](https://opencode.ai) - The AI coding assistant
- [OpenCode Plugins](https://opencode.ai/docs/plugins) - Plugin documentation
- [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) - OpenCode enhancement plugin
