// ============================================================================
// Shared types, pricing data, and utilities for opencode-token-tracker
// ============================================================================

// ============================================================================
// Types
// ============================================================================

export interface ModelPricing {
  input: number       // per 1M input tokens
  output: number      // per 1M output tokens
  cacheRead?: number  // per 1M cached input tokens (usually cheaper)
  cacheWrite?: number // per 1M cache write tokens
}

// ============================================================================
// Built-in Pricing (USD per 1M tokens) - Updated 2026-02-11
// Sources:
// - Anthropic: https://www.anthropic.com/pricing#api
// - OpenAI: https://openai.com/api/pricing/
// - DeepSeek: https://api-docs.deepseek.com/quick_start/pricing
// - Google: https://cloud.google.com/vertex-ai/generative-ai/pricing
// ============================================================================

export const BUILTIN_PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude (https://www.anthropic.com/pricing#api)
  // Opus 4.6: $5 input, $25 output (≤200K), cache write $6.25, cache read $0.50
  "claude-opus-4.6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  // Opus 4.5 (legacy): same pricing as Opus 4.6
  "claude-opus-4.5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  // Sonnet 4.5: $3 input, $15 output (≤200K), cache write $3.75, cache read $0.30
  "claude-sonnet-4.5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  // Sonnet 4: $3 input, $15 output
  "claude-sonnet-4": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  // Haiku 4.5: $1 input, $5 output, cache write $1.25, cache read $0.10
  "claude-haiku-4.5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-haiku-4": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // Legacy models
  "claude-opus-4.1": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-opus-4": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-haiku-3": { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 },

  // OpenAI GPT (https://openai.com/api/pricing/)
  // GPT-5.2: $1.75 input, $14 output (flagship)
  "gpt-5.2": { input: 1.75, output: 14, cacheRead: 0.175 },
  "gpt-5.2-pro": { input: 21, output: 168 },
  "gpt-5-mini": { input: 0.25, output: 2, cacheRead: 0.025 },
  "gpt-5.1": { input: 2, output: 8 },
  "gpt-5": { input: 5, output: 15 },
  // GPT-4.1 series (fine-tuning prices, base may differ)
  "gpt-4.1": { input: 3, output: 12, cacheRead: 0.75 },
  "gpt-4.1-mini": { input: 0.8, output: 3.2, cacheRead: 0.2 },
  "gpt-4.1-nano": { input: 0.2, output: 0.8, cacheRead: 0.05 },
  // GPT-4o series (may be deprecated)
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  // Reasoning models
  "o3": { input: 10, output: 40 },
  "o3-mini": { input: 1.1, output: 4.4 },
  "o4-mini": { input: 4, output: 16, cacheRead: 1 },
  "o1": { input: 15, output: 60 },
  "o1-mini": { input: 1.1, output: 4.4 },

  // DeepSeek (https://api-docs.deepseek.com/quick_start/pricing)
  // DeepSeek-V3.2: unified pricing for both chat and reasoner
  // $0.28 input (cache miss), $0.028 input (cache hit), $0.42 output
  "deepseek-chat": { input: 0.28, output: 0.42, cacheRead: 0.028 },
  "deepseek-reasoner": { input: 0.28, output: 0.42, cacheRead: 0.028 },

  // Google Gemini (https://cloud.google.com/vertex-ai/generative-ai/pricing)
  // Gemini 3 Pro Preview: $2 input, $12 output (≤200K)
  "gemini-3-pro": { input: 2, output: 12, cacheRead: 0.2 },
  "gemini-3-pro-preview": { input: 2, output: 12, cacheRead: 0.2 },
  // Gemini 3 Flash Preview: $0.5 input, $3 output
  "gemini-3-flash": { input: 0.5, output: 3, cacheRead: 0.05 },
  "gemini-3-flash-preview": { input: 0.5, output: 3, cacheRead: 0.05 },
  // Gemini 2.5 Pro: $1.25 input, $10 output (≤200K)
  "gemini-2.5-pro": { input: 1.25, output: 10, cacheRead: 0.125 },
  // Gemini 2.5 Flash: $0.3 input, $2.5 output
  "gemini-2.5-flash": { input: 0.3, output: 2.5, cacheRead: 0.03 },
  // Gemini 2.5 Flash Lite: $0.1 input
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4, cacheRead: 0.01 },
  // Gemini 2.0 Flash: $0.15 input
  "gemini-2.0-flash": { input: 0.15, output: 0.6, cacheRead: 0.015 },
  // Gemini 2.0 Flash Lite: $0.075 input, $0.3 output
  "gemini-2.0-flash-lite": { input: 0.075, output: 0.3, cacheRead: 0.0075 },

  // Fallback for unknown models
  "_default": { input: 1, output: 4 },
}

// ============================================================================
// Formatting Utilities
// ============================================================================

export function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

/**
 * Format token count for display.
 * @param tokens - raw token count
 * @param millionDecimals - decimal places for M-level values (default 1)
 */
export function formatTokens(tokens: number, millionDecimals: number = 1): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(millionDecimals)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return tokens.toString()
}

// ============================================================================
// Time Utilities
// ============================================================================

export function getStartOfDay(date: Date = new Date()): number {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function getStartOfWeek(date: Date = new Date()): number {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday as first day
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function getStartOfMonth(date: Date = new Date()): number {
  const d = new Date(date)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
