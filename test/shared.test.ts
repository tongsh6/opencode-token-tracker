import { describe, it } from "node:test"
import { strict as assert } from "node:assert"
import {
  BUILTIN_PRICING,
  DEFAULT_CONFIG,
  findModelConfigPricing,
  formatCost,
  formatTokens,
  getStartOfDay,
  getStartOfWeek,
  getStartOfMonth,
  validateConfig,
} from "../lib/shared.js"
import { getProviderFamily, calculateCost } from "../index.js"


// ============================================================================
// formatCost
// ============================================================================

describe("formatCost", () => {
  it("should format tiny costs with 4 decimals", () => {
    assert.equal(formatCost(0.001), "$0.0010")
    assert.equal(formatCost(0.0099), "$0.0099")
    assert.equal(formatCost(0), "$0.0000")
  })

  it("should format sub-dollar costs with 3 decimals", () => {
    assert.equal(formatCost(0.01), "$0.010")
    assert.equal(formatCost(0.123), "$0.123")
    assert.equal(formatCost(0.999), "$0.999")
  })

  it("should format dollar+ costs with 2 decimals", () => {
    assert.equal(formatCost(1), "$1.00")
    assert.equal(formatCost(12.345), "$12.35")
    assert.equal(formatCost(100), "$100.00")
  })
})

// ============================================================================
// formatTokens
// ============================================================================

describe("formatTokens", () => {
  it("should format raw numbers below 1K", () => {
    assert.equal(formatTokens(0), "0")
    assert.equal(formatTokens(999), "999")
  })

  it("should format K-level with 1 decimal", () => {
    assert.equal(formatTokens(1_000), "1.0K")
    assert.equal(formatTokens(1_500), "1.5K")
    assert.equal(formatTokens(999_999), "1000.0K")
  })

  it("should format M-level with default 1 decimal", () => {
    assert.equal(formatTokens(1_000_000), "1.0M")
    assert.equal(formatTokens(1_500_000), "1.5M")
    assert.equal(formatTokens(12_345_678), "12.3M")
  })

  it("should respect millionDecimals parameter", () => {
    assert.equal(formatTokens(1_234_567, 0), "1M")
    assert.equal(formatTokens(1_234_567, 2), "1.23M")
    assert.equal(formatTokens(1_234_567, 3), "1.235M")
  })
})

// ============================================================================
// getStartOfDay
// ============================================================================

describe("getStartOfDay", () => {
  it("should return midnight of the given date", () => {
    const date = new Date(2026, 1, 11, 14, 30, 45) // Feb 11, 2026 14:30:45
    const start = getStartOfDay(date)
    const result = new Date(start)
    assert.equal(result.getHours(), 0)
    assert.equal(result.getMinutes(), 0)
    assert.equal(result.getSeconds(), 0)
    assert.equal(result.getMilliseconds(), 0)
    assert.equal(result.getDate(), 11)
    assert.equal(result.getMonth(), 1) // February
  })

  it("should default to today when no argument", () => {
    const start = getStartOfDay()
    const result = new Date(start)
    const now = new Date()
    assert.equal(result.getFullYear(), now.getFullYear())
    assert.equal(result.getMonth(), now.getMonth())
    assert.equal(result.getDate(), now.getDate())
    assert.equal(result.getHours(), 0)
  })
})

// ============================================================================
// getStartOfWeek
// ============================================================================

describe("getStartOfWeek", () => {
  it("should return Monday 00:00 for a mid-week date", () => {
    // Wednesday Feb 11, 2026
    const date = new Date(2026, 1, 11, 10, 0, 0)
    const start = getStartOfWeek(date)
    const result = new Date(start)
    assert.equal(result.getDay(), 1) // Monday
    assert.equal(result.getDate(), 9) // Feb 9, 2026 is Monday
    assert.equal(result.getHours(), 0)
  })

  it("should handle Sunday correctly (go back to previous Monday)", () => {
    // Sunday Feb 15, 2026
    const date = new Date(2026, 1, 15, 10, 0, 0)
    const start = getStartOfWeek(date)
    const result = new Date(start)
    assert.equal(result.getDay(), 1) // Monday
    assert.equal(result.getDate(), 9) // Feb 9 is the Monday of that week
  })

  it("should handle Monday correctly (same day)", () => {
    // Monday Feb 9, 2026
    const date = new Date(2026, 1, 9, 15, 30, 0)
    const start = getStartOfWeek(date)
    const result = new Date(start)
    assert.equal(result.getDay(), 1)
    assert.equal(result.getDate(), 9)
    assert.equal(result.getHours(), 0)
  })
})

// ============================================================================
// getStartOfMonth
// ============================================================================

describe("getStartOfMonth", () => {
  it("should return the 1st of the month at midnight", () => {
    const date = new Date(2026, 1, 15, 12, 0, 0) // Feb 15
    const start = getStartOfMonth(date)
    const result = new Date(start)
    assert.equal(result.getDate(), 1)
    assert.equal(result.getMonth(), 1)
    assert.equal(result.getHours(), 0)
    assert.equal(result.getMinutes(), 0)
  })

  it("should handle first day of month", () => {
    const date = new Date(2026, 0, 1, 23, 59, 59) // Jan 1
    const start = getStartOfMonth(date)
    const result = new Date(start)
    assert.equal(result.getDate(), 1)
    assert.equal(result.getMonth(), 0)
    assert.equal(result.getHours(), 0)
  })
})

// ============================================================================
// BUILTIN_PRICING integrity
// ============================================================================

describe("BUILTIN_PRICING", () => {
  it("should contain _default entry", () => {
    assert.ok(BUILTIN_PRICING["_default"])
    assert.equal(typeof BUILTIN_PRICING["_default"].input, "number")
    assert.equal(typeof BUILTIN_PRICING["_default"].output, "number")
  })

  it("should have positive input/output for all entries", () => {
    for (const [model, pricing] of Object.entries(BUILTIN_PRICING)) {
      assert.ok(pricing.input >= 0, `${model}.input should be >= 0`)
      assert.ok(pricing.output >= 0, `${model}.output should be >= 0`)
    }
  })

  it("should have cacheRead <= input when cacheRead is present", () => {
    for (const [model, pricing] of Object.entries(BUILTIN_PRICING)) {
      if (pricing.cacheRead !== undefined) {
        assert.ok(
          pricing.cacheRead <= pricing.input,
          `${model}.cacheRead ($${pricing.cacheRead}) should be <= input ($${pricing.input})`
        )
      }
    }
  })

  it("should contain all expected provider groups", () => {
    // Anthropic
    assert.ok(BUILTIN_PRICING["claude-opus-4.6"], "missing claude-opus-4.6")
    assert.ok(BUILTIN_PRICING["claude-sonnet-4.5"], "missing claude-sonnet-4.5")
    assert.ok(BUILTIN_PRICING["claude-haiku-4.5"], "missing claude-haiku-4.5")
    // OpenAI
    assert.ok(BUILTIN_PRICING["gpt-5.2"], "missing gpt-5.2")
    assert.ok(BUILTIN_PRICING["o3"], "missing o3")
    // DeepSeek
    assert.ok(BUILTIN_PRICING["deepseek-chat"], "missing deepseek-chat")
    // Google
    assert.ok(BUILTIN_PRICING["gemini-3-pro"], "missing gemini-3-pro")
    assert.ok(BUILTIN_PRICING["gemini-2.5-flash"], "missing gemini-2.5-flash")
    assert.ok(BUILTIN_PRICING["gemini-2.0-flash-lite"], "missing gemini-2.0-flash-lite")
  })

  it("should have at least 35 model entries (including _default)", () => {
    const count = Object.keys(BUILTIN_PRICING).length
    assert.ok(count >= 35, `expected >= 35 entries, got ${count}`)
  })
})

// ============================================================================
// validateConfig
// ============================================================================

describe("validateConfig", () => {
  it("should return defaults for null/undefined/array input", () => {
    for (const input of [null, undefined, [], 42, "string"]) {
      const result = validateConfig(input)
      assert.deepEqual(result.config, DEFAULT_CONFIG)
      assert.ok(result.warnings.length > 0, `expected warnings for input: ${JSON.stringify(input)}`)
    }
  })

  it("should return defaults with no warnings for empty object", () => {
    const result = validateConfig({})
    assert.deepEqual(result.config, DEFAULT_CONFIG)
    assert.equal(result.warnings.length, 0)
  })

  it("should accept valid complete config", () => {
    const raw = {
      providers: { "my-provider": { input: 0, output: 0 } },
      models: { "my-model": { input: 1, output: 2, cacheRead: 0.1 } },
      toast: { enabled: false, duration: 5000, showOnIdle: false },
      budget: { daily: 10, weekly: 50, monthly: 200, warnAt: 0.9 },
    }
    const result = validateConfig(raw)
    assert.equal(result.warnings.length, 0)
    assert.deepEqual(result.config.providers, { "my-provider": { input: 0, output: 0 } })
    assert.deepEqual(result.config.models, { "my-model": { input: 1, output: 2, cacheRead: 0.1 } })
    assert.equal(result.config.toast.enabled, false)
    assert.equal(result.config.toast.duration, 5000)
    assert.equal(result.config.budget.daily, 10)
    assert.equal(result.config.budget.warnAt, 0.9)
  })

  it("should accept provider-specific model pricing", () => {
    const result = validateConfig({
      models: {
        "deepseek/deepseek-v4-flash": {
          "openrouter": { input: 0.14, output: 0.28, cacheRead: 0.0028 },
          "siliconflow": { input: 0.2, output: 0.4 },
        },
      },
    })
    assert.equal(result.warnings.length, 0)
    assert.deepEqual(result.config.models["deepseek/deepseek-v4-flash"], {
      "openrouter": { input: 0.14, output: 0.28, cacheRead: 0.0028 },
      "siliconflow": { input: 0.2, output: 0.4 },
    })
  })

  it("should warn and ignore non-object providers/models", () => {
    const result = validateConfig({ providers: "invalid", models: 123 })
    assert.deepEqual(result.config.providers, {})
    assert.deepEqual(result.config.models, {})
    assert.ok(result.warnings.some(w => w.includes("providers")))
    assert.ok(result.warnings.some(w => w.includes("models")))
  })

  it("should warn and skip pricing entries with invalid input/output", () => {
    const result = validateConfig({
      models: {
        "good": { input: 1, output: 2 },
        "bad-input": { input: "free", output: 2 },
        "bad-output": { input: 1, output: -5 },
        "missing-input": { output: 2 },
        "not-object": "hello",
      },
    })
    assert.ok(result.config.models["good"])
    assert.equal(result.config.models["bad-input"], undefined)
    assert.equal(result.config.models["bad-output"], undefined)
    assert.equal(result.config.models["missing-input"], undefined)
    assert.equal(result.config.models["not-object"], undefined)
    assert.ok(result.warnings.length >= 4)
  })

  it("should warn and ignore invalid cacheRead/cacheWrite but keep entry", () => {
    const result = validateConfig({
      models: {
        "m1": { input: 1, output: 2, cacheRead: "bad", cacheWrite: -1 },
      },
    })
    const m1 = result.config.models["m1"]
    assert.ok(m1)
    assert.equal(m1.input, 1)
    assert.equal(m1.output, 2)
    assert.equal(m1.cacheRead, undefined)
    assert.equal(m1.cacheWrite, undefined)
    assert.ok(result.warnings.some(w => w.includes("cacheRead")))
    assert.ok(result.warnings.some(w => w.includes("cacheWrite")))
  })

  it("should warn and skip invalid provider-specific model pricing entries", () => {
    const result = validateConfig({
      models: {
        "deepseek/deepseek-v4-flash": {
          "openrouter": { input: 0.14, output: 0.28 },
          "bad-provider": { input: "free", output: 0.28 },
        },
      },
    })
    assert.deepEqual(result.config.models["deepseek/deepseek-v4-flash"], {
      "openrouter": { input: 0.14, output: 0.28 },
    })
    assert.ok(result.warnings.some(w => w.includes("bad-provider.input")))
  })

  it("should allow provider-specific model pricing even when provider name matches pricing fields", () => {
    const result = validateConfig({
      models: {
        "field-named-provider-model": {
          "input": { input: 0.14, output: 0.28 },
          "output": { input: 0.2, output: 0.4 },
        },
      },
    })

    assert.equal(result.warnings.length, 0)
    assert.deepEqual(result.config.models["field-named-provider-model"], {
      "input": { input: 0.14, output: 0.28 },
      "output": { input: 0.2, output: 0.4 },
    })
  })

  it("should warn and use default toast for invalid toast fields", () => {
    const result = validateConfig({
      toast: { enabled: "yes", duration: -100, showOnIdle: 1 },
    })
    assert.equal(result.config.toast.enabled, DEFAULT_CONFIG.toast.enabled)
    assert.equal(result.config.toast.duration, DEFAULT_CONFIG.toast.duration)
    assert.equal(result.config.toast.showOnIdle, DEFAULT_CONFIG.toast.showOnIdle)
    assert.ok(result.warnings.length >= 3)
  })

  it("should warn and use default toast for non-object toast", () => {
    const result = validateConfig({ toast: "invalid" })
    assert.deepEqual(result.config.toast, DEFAULT_CONFIG.toast)
    assert.ok(result.warnings.some(w => w.includes("toast")))
  })

  it("should warn and ignore invalid budget fields", () => {
    const result = validateConfig({
      budget: { daily: "ten", weekly: 0, monthly: -5, warnAt: 2 },
    })
    assert.equal(result.config.budget.daily, undefined)
    assert.equal(result.config.budget.weekly, undefined)
    assert.equal(result.config.budget.monthly, undefined)
    assert.equal(result.config.budget.warnAt, DEFAULT_CONFIG.budget.warnAt)
    assert.ok(result.warnings.length >= 4)
  })

  it("should warn and use default budget for non-object budget", () => {
    const result = validateConfig({ budget: [] })
    assert.deepEqual(result.config.budget, DEFAULT_CONFIG.budget)
    assert.ok(result.warnings.some(w => w.includes("budget")))
  })

  it("should accept zero pricing (free provider)", () => {
    const result = validateConfig({
      providers: { "free": { input: 0, output: 0 } },
    })
    assert.equal(result.warnings.length, 0)
    assert.deepEqual(result.config.providers["free"], { input: 0, output: 0 })
  })

  it("should handle Infinity and NaN gracefully", () => {
    const result = validateConfig({
      budget: { daily: Infinity, warnAt: NaN },
      models: { "m": { input: NaN, output: 1 } },
    })
    assert.equal(result.config.budget.daily, undefined)
    assert.equal(result.config.budget.warnAt, DEFAULT_CONFIG.budget.warnAt)
    assert.equal(result.config.models["m"], undefined)
    assert.ok(result.warnings.length >= 3)
  })
})

describe("findModelConfigPricing", () => {
  it("should prefer provider-specific model pricing when available", () => {
    const result = validateConfig({
      models: {
        "deepseek/deepseek-v4-flash": {
          "openrouter": { input: 0.14, output: 0.28 },
        },
      },
    })

    assert.deepEqual(
      findModelConfigPricing(result.config.models, "deepseek/deepseek-v4-flash", "openrouter"),
      { input: 0.14, output: 0.28 }
    )
    assert.equal(
      findModelConfigPricing(result.config.models, "deepseek/deepseek-v4-flash", "siliconflow"),
      undefined
    )
  })

  it("should support partial model matches for provider-specific pricing", () => {
    const result = validateConfig({
      models: {
        "deepseek-v4-flash": {
          "openrouter": { input: 0.14, output: 0.28 },
        },
      },
    })

    assert.deepEqual(
      findModelConfigPricing(result.config.models, "deepseek/deepseek-v4-flash", "openrouter"),
      { input: 0.14, output: 0.28 }
    )
  })

  it("should resolve provider-specific model pricing for providers named like pricing fields", () => {
    const result = validateConfig({
      models: {
        "field-named-provider-model": {
          "input": { input: 0.14, output: 0.28 },
        },
      },
    })

    assert.deepEqual(
      findModelConfigPricing(result.config.models, "field-named-provider-model", "input"),
      { input: 0.14, output: 0.28 }
    )
  })

  it("should keep supporting direct model pricing", () => {
    const result = validateConfig({
      models: {
        "my-model": { input: 1, output: 2, cacheRead: 0.1 },
      },
    })

    assert.deepEqual(
      findModelConfigPricing(result.config.models, "my-model", "any-provider"),
      { input: 1, output: 2, cacheRead: 0.1 }
    )
  })

  it("should support partial model matches for direct model pricing", () => {
    const result = validateConfig({
      models: {
        "my-model": { input: 1, output: 2 },
      },
    })

    assert.deepEqual(
      findModelConfigPricing(result.config.models, "prefix/my-model", "any-provider"),
      { input: 1, output: 2 }
    )
  })

  it("should prefer longer key over shorter key in partial matches (longest-first)", () => {
    const result = validateConfig({
      models: {
        "gpt-4.1": { input: 3, output: 12 },
        "gpt-4.1-mini": { input: 0.8, output: 3.2 },
      },
    })

    assert.deepEqual(
      findModelConfigPricing(result.config.models, "gpt-4.1-mini-2025", "openai"),
      { input: 0.8, output: 3.2 }
    )
  })

  it("should prefer longer key regardless of insertion order (longest-first)", () => {
    const result = validateConfig({
      models: {
        "gpt-4.1-mini": { input: 0.8, output: 3.2 },
        "gpt-4.1": { input: 3, output: 12 },
      },
    })

    assert.deepEqual(
      findModelConfigPricing(result.config.models, "gpt-4.1-mini-2025", "openai"),
      { input: 0.8, output: 3.2 }
    )
  })

  it("should not match partial keys when partial=false (exact-only mode)", () => {
    const result = validateConfig({
      models: {
        "claude": { input: 0, output: 0 },
      },
    })

    assert.equal(
      findModelConfigPricing(result.config.models, "claude-opus-4.6", "anthropic", false),
      undefined
    )
  })

  it("should match partial keys when partial=true (backward compatible)", () => {
    const result = validateConfig({
      models: {
        "claude": { input: 0, output: 0 },
      },
    })

    assert.deepEqual(
      findModelConfigPricing(result.config.models, "claude-opus-4.6", "anthropic", true),
      { input: 0, output: 0 }
    )
  })
})

// ============================================================================
// getProviderFamily
// ============================================================================

describe("getProviderFamily", () => {
  it("should detect anthropic for various combinations", () => {
    assert.equal(getProviderFamily("claude-opus-4.6", "openai"), "anthropic")
    assert.equal(getProviderFamily("some-model", "anthropic"), "anthropic")
    assert.equal(getProviderFamily("claude-3-5-sonnet", "openrouter"), "anthropic")
  })

  it("should detect openai for various combinations", () => {
    assert.equal(getProviderFamily("gpt-4o", "unknown"), "openai")
    assert.equal(getProviderFamily("o1-mini", "openrouter"), "openai")
    assert.equal(getProviderFamily("o3", "together"), "openai")
    assert.equal(getProviderFamily("some-model", "openai"), "openai")
  })

  it("should detect deepseek for various combinations", () => {
    assert.equal(getProviderFamily("deepseek-chat", "siliconflow"), "deepseek")
    assert.equal(getProviderFamily("deepseek-reasoner", "deepseek"), "deepseek")
    assert.equal(getProviderFamily("deepseek/deepseek-r1", "openrouter"), "deepseek")
  })

  it("should detect google for various combinations", () => {
    assert.equal(getProviderFamily("gemini-2.5-pro", "openrouter"), "google")
    assert.equal(getProviderFamily("some-model", "google"), "google")
    assert.equal(getProviderFamily("gemini-2.0-flash", "vertex"), "google")
  })

  it("should fallback to other for unknown providers/models", () => {
    assert.equal(getProviderFamily("meta-llama-3-8b", "together"), "other")
    assert.equal(getProviderFamily("unknown", "unknown"), "other")
  })
})

// ============================================================================
// calculateCost (provider-specific defaults verification)
// ============================================================================

describe("calculateCost", () => {
  it("should apply Anthropic defaults correctly (cacheRead = 10%, cacheWrite = 125%)", () => {
    // claude-sonnet-4 base: input = 3, output = 15.
    // 1M inputs, 1M outputs, 100K cacheRead, 100K cacheWrite
    const cost = calculateCost("claude-sonnet-4", "anthropic", 1_000_000, 1_000_000, 100_000, 100_000)
    
    // Expected details:
    // billable input = 1M - 100K = 900K tokens = 0.9 * 3.00 = $2.70
    // output = 1M tokens = 1.0 * 15.00 = $15.00
    // cacheRead = 100K tokens = 0.1 * 3.00 * 0.1 = $0.03 (10% discount rate)
    // cacheWrite = 100K tokens = 0.1 * 3.00 * 1.25 = $0.375 (125% rate)
    // total = 2.70 + 15.00 + 0.03 + 0.375 = $18.105
    assert.ok(Math.abs(cost - 18.105) < 0.0001, `expected 18.105, got ${cost}`)
  })

  it("should apply OpenAI defaults correctly (cacheRead = 50%, cacheWrite = 0%)", () => {
    // Built-in gpt-4o has input: 2.5, output: 10.
    // 1M inputs, 1M outputs, 100K cacheRead, 100K cacheWrite
    const cost = calculateCost("gpt-4o", "openai", 1_000_000, 1_000_000, 100_000, 100_000)
    
    // Expected details:
    // billable input = 1M - 100K = 900K tokens = 0.9 * 2.50 = $2.25
    // output = 1M tokens = 1.0 * 10.00 = $10.00
    // cacheRead = 100K tokens = 0.1 * 2.50 * 0.5 = $0.125 (50% discount rate)
    // cacheWrite = 100K tokens = 0.1 * 2.50 * 0 = $0 (free)
    // total = 2.25 + 10.00 + 0.125 + 0 = $12.375
    assert.ok(Math.abs(cost - 12.375) < 0.0001, `expected 12.375, got ${cost}`)
  })

  it("should apply DeepSeek defaults correctly (cacheRead = 10%, cacheWrite = 0%)", () => {
    // deepseek-chat has input: 0.28, output: 0.42. cacheRead: 0.028 (explicit in table)
    const costExplicit = calculateCost("deepseek-chat", "deepseek", 1_000_000, 1_000_000, 100_000, 100_000)
    
    // billable input = 900K = 0.9 * 0.28 = $0.252
    // output = 1M = 1.0 * 0.42 = $0.42
    // cacheRead = 100K = 0.1 * 0.028 = $0.0028
    // cacheWrite = 100K = 0.1 * 0 = $0
    // total = 0.252 + 0.42 + 0.0028 = $0.6748
    assert.ok(Math.abs(costExplicit - 0.6748) < 0.0001, `expected 0.6748, got ${costExplicit}`)
    
    // Verify fallback using non-builtin model under deepseek family:
    const costFallback = calculateCost("deepseek-custom", "deepseek", 1_000_000, 1_000_000, 100_000, 100_000)
    
    // Default base: input = 1, output = 4.
    // billable input = 900K = 0.9 * 1.00 = $0.90
    // output = 1M = 1.0 * 4.00 = $4.00
    // cacheRead = 100K = 0.1 * 1.00 * 0.1 = $0.01 (10% rate fallback)
    // cacheWrite = 100K = 0.1 * 1.00 * 0 = $0 (free cache write)
    // total = 0.90 + 4.00 + 0.01 = $4.91
    assert.ok(Math.abs(costFallback - 4.91) < 0.0001, `expected 4.91, got ${costFallback}`)
  })
})

// ============================================================================
// calculateCost partial match — longest-key-first regression
// ============================================================================

describe("calculateCost partial match (longest-key-first)", () => {
  it("should match gpt-4o-mini over gpt-4o for variant model name", () => {
    // gpt-4o-mini-2024-07-18 should match gpt-4o-mini ($0.15/$0.6), not gpt-4o ($2.5/$10)
    const cost = calculateCost("gpt-4o-mini-2024-07-18", "openai", 1_000_000, 1_000_000)
    // Expected: input 0.15 + output 0.6 = 0.75 (no cache in this test)
    assert.ok(Math.abs(cost - 0.75) < 0.001, `expected 0.75, got ${cost}`)
  })

  it("should match o3-mini over o3 for variant model name", () => {
    // o3-mini-high should match o3-mini ($1.1/$4.4), not o3 ($10/$40)
    const cost = calculateCost("o3-mini-high", "openai", 1_000_000, 1_000_000)
    // Expected: input 1.1 + output 4.4 = 5.5
    assert.ok(Math.abs(cost - 5.5) < 0.001, `expected 5.5, got ${cost}`)
  })

  it("should match gemini-2.5-flash-lite over gemini-2.5-flash for variant model name", () => {
    // gemini-2.5-flash-lite-preview should match gemini-2.5-flash-lite ($0.1/$0.4), not gemini-2.5-flash ($0.3/$2.5)
    const cost = calculateCost("gemini-2.5-flash-lite-preview", "google", 1_000_000, 1_000_000)
    // Expected: input 0.1 + output 0.4 = 0.5
    assert.ok(Math.abs(cost - 0.5) < 0.001, `expected 0.5, got ${cost}`)
  })

  it("should match gpt-5.2-pro over gpt-5.2 for variant model name", () => {
    // gpt-5.2-pro-2025 should match gpt-5.2-pro ($21/$168), not gpt-5.2 ($1.75/$14)
    const cost = calculateCost("gpt-5.2-pro-2025", "openai", 1_000_000, 1_000_000)
    // Expected: input 21 + output 168 = 189
    assert.ok(Math.abs(cost - 189) < 0.01, `expected 189, got ${cost}`)
  })

  it("should match o1-mini over o1 for variant model name", () => {
    // o1-mini-high should match o1-mini ($1.1/$4.4), not o1 ($15/$60)
    const cost = calculateCost("o1-mini-high", "openai", 1_000_000, 1_000_000)
    // Expected: input 1.1 + output 4.4 = 5.5
    assert.ok(Math.abs(cost - 5.5) < 0.001, `expected 5.5, got ${cost}`)
  })
})

