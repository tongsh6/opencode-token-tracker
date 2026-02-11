# opencode-token-tracker

Real-time token usage and cost tracking plugin for [OpenCode](https://opencode.ai).

## Features

- **Real-time Toast notifications** - See token usage and cost after each AI response
- **Budget control** - Set daily/weekly/monthly spending limits with warnings
- **Session statistics** - Track cumulative usage across your entire session
- **CLI statistics tool** - Query usage by day/week/month with breakdowns by model/agent
- **Cost calculation** - Automatic cost estimation based on model pricing
- **JSONL logging** - All usage data saved locally for analysis
- **Multi-model support** - Claude, GPT, DeepSeek, Gemini, and more

## Installation

Add to your OpenCode config file (`~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-token-tracker"]
}
```

Restart OpenCode and the plugin will be automatically installed.

## Usage

### Toast Notifications

Once installed, you'll see Toast notifications after each AI response:

```
12.5K tokens
$0.023 | Session: $0.156
```

When budget limits are configured, you'll see warnings:

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
- `all` - Show all breakdowns

### Pricing & Config Commands

```bash
# Check budget status
opencode-tokens budget

# Show built-in pricing table
opencode-tokens pricing

# Show your used models and their pricing status
opencode-tokens models

# Show current config
opencode-tokens config

# Generate example config based on your usage
opencode-tokens config init
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
| Subscription service (GitHub Copilot, Cursor) | `{ "input": 0, "output": 0 }` |
| Free/local model | `{ "input": 0, "output": 0 }` |
| Custom API with known pricing | Look up provider's pricing page |

### Pricing Override

Pricing is resolved in this order (first match wins):

1. **Provider-level** - Override all models for a provider
2. **User model config** - Custom model pricing in config file
3. **Built-in pricing** - Default pricing table
4. **Fallback** - $1/M input, $4/M output

#### Example: Free providers

If you're using GitHub Copilot or other subscription-based services, set their cost to $0:

```json
{
  "providers": {
    "github-copilot": { "input": 0, "output": 0 },
    "cursor": { "input": 0, "output": 0 }
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

# Link for local testing
npm link
cd ~/.config/opencode
npm link opencode-token-tracker
```

## License

MIT © [tongsh6](https://github.com/tongsh6)

## Related

- [OpenCode](https://opencode.ai) - The AI coding assistant
- [OpenCode Plugins](https://opencode.ai/docs/plugins) - Plugin documentation
- [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) - OpenCode enhancement plugin
