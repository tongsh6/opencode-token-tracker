import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import {
  BUILTIN_PRICING,
  BUILTIN_PRICING_AUDITS,
  DEFAULT_CONFIG,
  calculateCost,
  getBuiltinPricingAudit,
  getEffectivePricingAudit,
  getPricingFreshness,
  resolvePricingStatus,
  validateConfig,
} from "../lib/shared.js"

const AUDIT_TIME = Date.parse("2026-10-05T12:00:00Z")

describe("已核验模型计价", () => {
  for (const model of ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"]) {
    it(`${model} 的精确名和 provider 前缀均使用 Flash 峰时价格`, () => {
      for (const name of [model, `deepseek/${model}`, `DeepSeek/${model.toUpperCase()}`]) {
        assert.equal(resolvePricingStatus(DEFAULT_CONFIG, name, "deepseek"), "built-in")
        assert.ok(Math.abs(calculateCost(name, "deepseek", 1_000_000, 1_000_000, 1_000_000, 1_000_000) - 1.506) < 1e-9)
        assert.equal(getBuiltinPricingAudit(name)?.basis, "peak")
      }
    })
  }

  it("V4 Pro 不再使用旧促销价格", () => {
    assert.ok(Math.abs(calculateCost("deepseek-v4-pro", "deepseek", 1_000_000, 1_000_000, 1_000_000, 1_000_000) - 5.324) < 1e-9)
    assert.equal(getBuiltinPricingAudit("deepseek-v4-pro")?.expiresAt, undefined)
  })

  it("Kimi 标准版使用独立缓存价格", () => {
    for (const model of ["kimi-k2.7-code", "moonshotai/kimi-k2.7-code"]) {
      assert.equal(resolvePricingStatus(DEFAULT_CONFIG, model, "moonshotai"), "built-in")
      assert.equal(calculateCost(model, "moonshotai", 0, 0, 1_000_000), 0.19)
      assert.ok(Math.abs(calculateCost(model, "moonshotai", 1_000_000, 1_000_000, 1_000_000, 1_000_000) - 5.14) < 1e-9)
    }
  })

  it("未核价变体不会误套普通型号的内置价格", () => {
    for (const model of ["kimi-k2.7-code-highspeed", "moonshotai/kimi-k2.7-code-highspeed", "custom-kimi-k2.7-code", "deepseek-v4-flash-custom"]) {
      assert.equal(resolvePricingStatus(DEFAULT_CONFIG, model, "other"), "default")
      assert.equal(getBuiltinPricingAudit(model), undefined)
      assert.equal(calculateCost(model, "other", 1_000_000, 1_000_000), 5)
    }
  })

  it("用户精确覆盖优先，宽泛覆盖仍不能盖过已核验内置型号", () => {
    const { config } = validateConfig({
      models: {
        "kimi-k2.7-code": { moonshotai: { input: 0.1, output: 0.2, cacheRead: 0.01 } },
        deepseek: { input: 2, output: 3 },
      },
    })
    assert.equal(resolvePricingStatus(config, "kimi-k2.7-code", "moonshotai"), "model cfg")
    assert.equal(getEffectivePricingAudit(config, "kimi-k2.7-code", "moonshotai"), undefined)
    assert.ok(Math.abs(calculateCost("kimi-k2.7-code", "moonshotai", 1_000_000, 1_000_000, 1_000_000, 0, config) - 0.31) < 1e-9)
    assert.equal(resolvePricingStatus(config, "deepseek-flash", "deepseek"), "built-in")
    assert.equal(calculateCost("deepseek-flash", "deepseek", 1_000_000, 1_000_000, 0, 0, config), 1.5)
    assert.equal(resolvePricingStatus(config, "deepseek-unverified", "deepseek"), "model cfg")
  })

  it("provider 零价覆盖高于内置价格，不产生内置过期告警", () => {
    const { config } = validateConfig({ providers: { deepseek: { input: 0, output: 0 } } })
    assert.equal(resolvePricingStatus(config, "deepseek-chat", "deepseek"), "provider cfg")
    assert.equal(getEffectivePricingAudit(config, "deepseek-chat", "deepseek"), undefined)
    assert.equal(calculateCost("deepseek-v4-pro", "deepseek", 1_000_000, 1_000_000, 1_000_000, 1_000_000, config), 0)
  })
})

describe("定价时效", () => {
  it("本次核验不刷新其他型号的日期", () => {
    const flash = getBuiltinPricingAudit("deepseek/deepseek-flash")
    const claude = getBuiltinPricingAudit("claude-sonnet-4.6")
    assert.ok(flash)
    assert.ok(claude)
    assert.equal(flash.reviewedAt, "2026-10-05")
    assert.equal(claude.reviewedAt, "2026-05-29")
    assert.equal(getPricingFreshness(flash, AUDIT_TIME), "recent")
    assert.equal(getPricingFreshness(claude, AUDIT_TIME), "stale")
  })

  it("超过 90 天才标记 stale，并且可在不同时间确定性判断", () => {
    const audit = { reviewedAt: "2026-10-05" }
    const threshold = Date.parse("2026-10-05T00:00:00Z") + 90 * 86_400_000
    assert.equal(getPricingFreshness(audit, threshold), "recent")
    assert.equal(getPricingFreshness(audit, threshold + 1), "stale")
  })

  it("到期边界使用 UTC，expired 优先于核验日期新旧", () => {
    const audit = { reviewedAt: "2026-10-05", expiresAt: "2026-10-05T16:00:00Z" }
    assert.equal(getPricingFreshness(audit, Date.parse("2026-10-05T15:59:59.999Z")), "recent")
    assert.equal(getPricingFreshness(audit, Date.parse("2026-10-05T16:00:00Z")), "expired")
    const legacy = getBuiltinPricingAudit("deepseek-chat")
    assert.ok(legacy)
    assert.equal(getPricingFreshness(legacy, AUDIT_TIME), "expired")
  })

  it("无效日期或时钟早于核验日时不能误标为近期核验", () => {
    assert.equal(getPricingFreshness({ reviewedAt: "invalid" }, AUDIT_TIME), "unknown")
    assert.equal(getPricingFreshness({ reviewedAt: "2026-10-06" }, AUDIT_TIME), "unknown")
    assert.equal(getPricingFreshness({ reviewedAt: "2026-10-05", expiresAt: "invalid" }, AUDIT_TIME), "unknown")
  })

  it("每条型号核验信息都有对应单价，不给默认回退伪造日期", () => {
    for (const key of Object.keys(BUILTIN_PRICING_AUDITS)) assert.ok(BUILTIN_PRICING[key], key)
    assert.equal(getBuiltinPricingAudit("_default"), undefined)
    assert.equal(getBuiltinPricingAudit("unknown-model"), undefined)
  })
})
