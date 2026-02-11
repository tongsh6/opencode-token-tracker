import { describe, it } from "node:test"
import { strict as assert } from "node:assert"
import {
  BUILTIN_PRICING,
  formatCost,
  formatTokens,
  getStartOfDay,
  getStartOfWeek,
  getStartOfMonth,
} from "../lib/shared.js"

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
