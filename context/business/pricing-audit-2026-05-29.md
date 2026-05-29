# Pricing Audit 2026-05-29

本文记录 `BUILTIN_PRICING` 的人工核对依据。内置表仍是离线快照，不做运行时联网更新。

## Source of truth

- Anthropic Claude Platform pricing: https://platform.claude.com/docs/en/about-claude/pricing
- OpenAI API pricing and model pages: https://developers.openai.com/api/docs/pricing
- DeepSeek API pricing: https://api-docs.deepseek.com/quick_start/pricing
- Google Vertex AI / Agent Platform pricing: https://cloud.google.com/vertex-ai/generative-ai/pricing

## 更新范围

### Anthropic

- 新增 `claude-opus-4.8`、`claude-opus-4.7`。
- 新增 `claude-sonnet-4.6`。
- 保留 `claude-opus-4.6`、`claude-opus-4.5`、`claude-sonnet-4.5`、`claude-haiku-4.5` 的既有价格。
- 采用 5-minute cache write 与 cache hit 价格；不把 1-hour cache write、data residency、fast mode、batch discount 写入 flat 表。

### OpenAI

- 新增 GPT-5.5 / 5.4 / 5.3 Codex / GPT-5.1 Codex 相关别名。
- 修正 `gpt-5.1`、`gpt-5`、`gpt-4.1` 系列、`o3`、`o4-mini` 等已过期价格。
- 为官方明确列出 cached input 的模型补齐 `cacheRead`。
- 采用 Standard text-token 价格；不把 long context、regional processing、priority、batch、tool call、image/audio/video 单独费用写入 flat 表。

### DeepSeek

- `deepseek-chat` 与 `deepseek-reasoner` 继续按 DeepSeek-V4-Flash 兼容价格维护。
- 当前表中 cache hit、cache miss、output 价格与官方页一致。
- 未新增 `deepseek-v4-pro`，因为 OpenCode 常见模型名仍以兼容别名为主；后续如果 token log 出现该模型，再按实际模型名补 entry。

### Google

- 新增 `gemini-3.1-pro-preview`、`gemini-3.5-flash`、`gemini-3.1-flash-lite`。
- 保留 Gemini 3 Flash Preview、Gemini 2.5、Gemini 2.0 现有价格。
- 采用 Standard global text-token 价格，且在存在 200K 分层时采用 `<=200K input tokens` 档；不把 long context、priority、flex/batch、non-global、image output、grounding 费用写入 flat 表。

## 维护原则

- `pricingLastUpdated` 表示内置表人工核对日期，不代表 provider 价格不会继续变化。
- 内置表只表达 text input/output/cache 的常规估算价格。
- 对订阅制、企业折扣、促销折扣、区域溢价、tool call、长上下文分层，用户应使用 `token-tracker.json` 覆写。
