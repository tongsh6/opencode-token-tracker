# opencode-token-tracker

Real-time token usage and cost tracking plugin for [OpenCode](https://opencode.ai).

![Toast Screenshot](./docs/toast-demo.png)

## Features

- **Real-time Toast notifications** - See token usage and cost after each AI response
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

When a session becomes idle, you'll see a summary:

```
Session: 45.2K tokens
$0.156 | 8 msgs | 5min
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

Currently the plugin works out of the box with no configuration needed.

Future versions may support:
- Custom pricing overrides
- Toast display options
- Export formats

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
