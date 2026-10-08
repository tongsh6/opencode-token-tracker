import { createHarness } from "./plugin-harness.js"
import type { TestContext } from "node:test"
import { strict as assert } from "node:assert"
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire, syncBuiltinESMExports } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"

const require = createRequire(import.meta.url)
const os = require("node:os") as typeof import("node:os")
const fs = require("node:fs") as typeof import("node:fs")


interface BudgetScenario {
  name: string
  period: "daily" | "weekly" | "monthly"
  before: string
  after: string
  rollover: boolean
}

async function createFixture(t: TestContext, period: BudgetScenario["period"], before: string) {
  const fixture = mkdtempSync(join(tmpdir(), "token-tracker-budget-"))
  const configDir = join(fixture, ".config", "opencode")
  const logDir = join(configDir, "logs", "token-tracker")
  const logFile = join(logDir, "tokens.jsonl")
  mkdirSync(logDir, { recursive: true })
  writeFileSync(join(configDir, "token-tracker.json"), JSON.stringify({
    providers: { "test-provider": { input: 0.5, output: 0 } },
    budget: { [period]: 1, warnAt: 0.4 },
  }))

  const RealDate = Date
  const clock = { now: new RealDate(before).getTime() }
  const records = () => readFileSync(logFile, "utf8").trim().split("\n")
    .map((line) => JSON.parse(line) as { cost: number; _ts: number })
  const appendHistory = (cost: number) => appendFileSync(logFile, `${JSON.stringify({
    type: "tokens", cost, input: 1, _ts: clock.now,
  })}\n`)
  appendHistory(0.125)

  // 每个用例单独加载插件实例，隔离模块内的预算、会话和去重状态。
  t.mock.method(os, "homedir", () => fixture)
  syncBuiltinESMExports()
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args) {
      return Reflect.construct(target, args.length ? args : [clock.now])
    },
    get(target, key, receiver) {
      return key === "now" ? () => clock.now : Reflect.get(target, key, receiver)
    },
  })
  t.after(() => {
    globalThis.Date = RealDate
    t.mock.restoreAll()
    syncBuiltinESMExports()
    rmSync(fixture, { recursive: true, force: true })
  })

  const { toasts, message } = await createHarness(t, fixture)
  const send = (id: string) => message("test-session", 1_000_000, id)

  return { clock, toasts, records, appendHistory, send }
}

const scenarios: BudgetScenario[] = [
  { name: "跨日", period: "daily", before: "2026-10-05T23:59:59", after: "2026-10-06T00:00:01", rollover: true },
  { name: "周一跨周", period: "weekly", before: "2026-10-04T23:59:59", after: "2026-10-05T00:00:01", rollover: true },
  { name: "月初跨月", period: "monthly", before: "2026-09-30T23:59:59", after: "2026-10-01T00:00:01", rollover: true },
  ...(["daily", "weekly", "monthly"] as const).map((period) => ({
    name: `日周月同时切换的 ${period}`, period,
    before: "2027-01-31T23:59:59", after: "2027-02-01T00:00:01", rollover: true,
  })),
  { name: "日内连续消息", period: "daily", before: "2026-10-06T10:00:00", after: "2026-10-06T10:01:00", rollover: false },
  { name: "跨日但未跨周", period: "weekly", before: "2026-10-05T23:59:59", after: "2026-10-06T00:00:01", rollover: false },
  { name: "跨周但未跨月", period: "monthly", before: "2026-10-04T23:59:59", after: "2026-10-05T00:00:01", rollover: false },
  { name: "跨月但未跨周", period: "weekly", before: "2026-09-30T23:59:59", after: "2026-10-01T00:00:01", rollover: false },
]

describe("插件预算事件回归", { concurrency: false }, () => {
  for (const scenario of scenarios) {
    it(`${scenario.name}只累计一次，保留本周期历史并过滤重复事件`, async (t) => {
      const fixture = await createFixture(t, scenario.period, scenario.before)
      fixture.clock.now = new Date(scenario.after).getTime()
      // 模拟初始化后已有其他进程在新周期写入的记录，重载时也必须保留。
      if (scenario.rollover) fixture.appendHistory(0.25)

      await fixture.send("message-1")
      const label = scenario.period[0].toUpperCase() + scenario.period.slice(1)
      assert.equal(fixture.toasts.length, 1)
      assert.equal(fixture.toasts[0].variant, "warning")
      assert.ok(fixture.toasts[0].message.includes(scenario.rollover
        ? `${label}: $0.750/$1.00 (75%)`
        : `${label}: $0.625/$1.00 (63%)`), fixture.toasts[0].message)

      await fixture.send("message-1")
      assert.equal(fixture.toasts.length, 1)
      await fixture.send("message-2")
      assert.equal(fixture.toasts.length, 2)
      assert.equal(fixture.toasts[1].variant, "error")
      assert.equal(fixture.toasts[1].message, scenario.rollover
        ? `${label}: $1.25/$1.00 (125%)`
        : `${label}: $1.13/$1.00 (113%)`)
      assert.deepEqual(fixture.records().map((entry) => entry.cost), scenario.rollover
        ? [0.125, 0.25, 0.5, 0.5]
        : [0.125, 0.5, 0.5])
    })
  }

  it("写入期间跨午夜时，日志与预算使用同一个时间戳", async (t) => {
    const fixture = await createFixture(t, "daily", "2026-10-05T23:59:59")
    const recordedAt = fixture.clock.now
    const nextDay = new Date("2026-10-06T00:00:01").getTime()
    const append = fs.appendFileSync
    t.mock.method(fs, "appendFileSync", (...args: Parameters<typeof append>) => {
      append(...args)
      fixture.clock.now = nextDay
    })
    syncBuiltinESMExports()

    await fixture.send("message-before-midnight")
    assert.ok(fixture.toasts[0].message.includes("Daily: $0.625/$1.00 (63%)"), fixture.toasts[0].message)
    assert.equal(fixture.records()[1]._ts, recordedAt)
    await fixture.send("message-after-midnight")
    assert.ok(fixture.toasts[1].message.includes("Daily: $0.500/$1.00 (50%)"), fixture.toasts[1].message)
    assert.equal(fixture.records()[2]._ts, nextDay)
  })

  it("写日志失败时不累计预算，下一条成功消息正常计入", async (t) => {
    const fixture = await createFixture(t, "daily", "2026-10-05T23:59:59")
    fixture.clock.now = new Date("2026-10-06T00:00:01").getTime()
    const append = fs.appendFileSync
    let failNext = true
    t.mock.method(fs, "appendFileSync", (...args: Parameters<typeof append>) => {
      if (failNext) {
        failNext = false
        throw new Error("模拟日志写入失败")
      }
      append(...args)
    })
    syncBuiltinESMExports()

    await fixture.send("failed-message")
    assert.equal(fixture.toasts.length, 0)
    await fixture.send("successful-message")
    assert.equal(fixture.toasts.length, 1)
    assert.ok(fixture.toasts[0].message.includes("Daily: $0.500/$1.00 (50%)"), fixture.toasts[0].message)
    assert.deepEqual(fixture.records().map((entry) => entry.cost), [0.125, 0.5])
  })

  it("周期重载失败时仍计入当前成功写入的消耗", async (t) => {
    const fixture = await createFixture(t, "daily", "2026-10-05T23:59:59")
    fixture.clock.now = new Date("2026-10-06T00:00:01").getTime()
    t.mock.method(fs, "readSync", () => { throw new Error("模拟日志读取失败") })
    syncBuiltinESMExports()

    await fixture.send("message-1")
    assert.equal(fixture.toasts.length, 1)
    assert.ok(fixture.toasts[0].message.includes("Daily: $0.500/$1.00 (50%)"), fixture.toasts[0].message)
  })
})
