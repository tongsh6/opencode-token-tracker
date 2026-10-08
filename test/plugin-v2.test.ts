import type { TestContext } from "node:test"
import { strict as assert } from "node:assert"
import { createRequire, syncBuiltinESMExports } from "node:module"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import { createHarness } from "./plugin-harness.js"

const require = createRequire(import.meta.url)
const os = require("node:os") as typeof import("node:os")
const fs = require("node:fs") as typeof import("node:fs")
const tokens = { input: 1_000, output: 200, reasoning: 300, cache: { read: 400, write: 500 } }

async function fixture(t: TestContext, options: Parameters<typeof createHarness>[2] = {}) {
  const directory = mkdtempSync(join(tmpdir(), "token-tracker-v2-"))
  const config = join(directory, ".config", "opencode")
  mkdirSync(config, { recursive: true })
  writeFileSync(join(config, "token-tracker.json"), JSON.stringify({
    providers: { "test-provider": { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 } },
    budget: { daily: 1, warnAt: 0.4 },
  }))
  t.mock.method(os, "homedir", () => directory)
  syncBuiltinESMExports()
  t.after(() => {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    rmSync(directory, { recursive: true, force: true })
  })
  const harness = await createHarness(t, directory, options)
  const records = () => {
    const file = join(config, "logs", "token-tracker", "tokens.jsonl")
    return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line)) : []
  }
  const start = (messageID = "msg_1") => harness.send("session.step.started", {
    sessionID: "ses_1", assistantMessageID: messageID, agent: "build",
    model: { id: "test-model", providerID: "test-provider" }, started: Date.now(),
  })
  const end = (messageID = "msg_1", usage = tokens) => harness.send("session.step.ended", {
    sessionID: "ses_1", assistantMessageID: messageID, finish: "stop", tokens: usage, cost: 99,
  })
  return { ...harness, directory, records, start, end, config }
}

describe("OpenCode V2 服务端协议", { concurrency: false }, () => {
  it("只在 step 终态记账，推理输出参与计费并保留历史日志口径", async t => {
    const f = await fixture(t)
    await f.start()
    await f.send("session.text.delta", { sessionID: "ses_1", assistantMessageID: "msg_1", ordinal: 0, delta: "hi" })
    await f.send("session.step.streamed", { sessionID: "ses_1", assistantMessageID: "msg_1" })
    assert.equal(f.records().length, 0)
    await f.end()
    assert.equal(f.records().length, 1)
    assert.deepEqual(f.records().map(({ model, provider, input, output, reasoning, cacheRead, cacheWrite, cost }) =>
      ({ model, provider, input, output, reasoning, cacheRead, cacheWrite, cost: Number(cost.toFixed(9)) })), [{
      model: "test-model", provider: "test-provider", input: 1000, output: 500, reasoning: 300,
      cacheRead: 400, cacheWrite: 500, cost: 0.002665,
    }])
    await f.end()
    await f.send("session.usage.updated", { sessionID: "ses_1", tokens, cost: 99 })
    assert.equal(f.records().length, 1)
    assert.equal(f.toasts.length, 1)
  })

  it("记录有用量的失败请求，无用量的失败不生成记录", async t => {
    const f = await fixture(t)
    await f.start()
    await f.send("session.step.failed", { sessionID: "ses_1", assistantMessageID: "msg_1",
      error: { type: "unknown", message: "provider failed" }, tokens })
    await f.send("session.step.failed", { sessionID: "ses_1", assistantMessageID: "msg_2",
      error: { type: "unknown", message: "provider failed" } })
    assert.equal(f.records().length, 1)
    assert.equal(f.records()[0].output, 500)
  })

  it("reasoning-only 与 cache-only 请求也会记账", async t => {
    const f = await fixture(t)
    await f.start("reasoning")
    await f.end("reasoning", { input: 0, output: 0, reasoning: 10, cache: { read: 0, write: 0 } })
    await f.start("cache")
    await f.end("cache", { input: 0, output: 0, reasoning: 0, cache: { read: 10, write: 0 } })
    assert.equal(f.records().length, 2)
    assert.equal(f.records()[0].cost, 0.00002)
    assert.ok(Math.abs(f.records()[1].cost - 0.000001) < 1e-12)
  })

  it("忽略其他加载位置与缺少 location 的事件", async t => {
    const f = await fixture(t)
    await f.send("session.step.ended", { sessionID: "ses_1", assistantMessageID: "foreign", finish: "stop", tokens, cost: 1 },
      { location: { directory: "/another-project" } })
    await f.send("session.step.ended", { sessionID: "ses_1", assistantMessageID: "unscoped", finish: "stop", tokens, cost: 1 },
      { location: null })
    assert.equal(f.records().length, 0)
  })

  it("请求中途加载时从消息恢复型号，不采用已切换的会话型号", async t => {
    const f = await fixture(t, { getMessages: async () => [{ id: "msg_1", type: "assistant", agent: "plan",
      model: { id: "test-model", providerID: "test-provider" }, content: [], time: { created: 1 } }] })
    await f.end()
    assert.equal(f.records()[0].model, "test-model")
    assert.equal(f.records()[0].agent, "plan")
  })

  it("消息恢复失败保留 unknown 用量，不中断后续消息", async t => {
    const f = await fixture(t, { getMessages: async () => { throw new Error("offline") } })
    await f.end()
    assert.equal(f.records()[0].model, "unknown")
    await f.start("msg_2")
    await f.end("msg_2")
    assert.equal(f.records()[1].model, "test-model")
  })

  it("中途加载时查询并恢复多层父子关系，再按根会话汇总", async t => {
    const f = await fixture(t, { getSession: async id => ({
      id, parentID: id === "child" ? "middle" : id === "middle" ? "root" : undefined,
      title: `${id} title`, projectID: "project", location: { directory: "/project" },
      time: { created: 1, updated: 1 }, cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }) })
    await f.message("root", 1_000, "msg_root")
    await f.message("child", 500, "msg_child")
    await f.send("session.execution.succeeded", { sessionID: "root" })
    assert.equal(f.toasts.at(-1)?.title, "Session: 1.5K tokens")
    assert.match(f.toasts.at(-1)?.message ?? "", /2 msgs/)
    const metadata = readFileSync(join(f.config, "logs", "token-tracker", "sessions.jsonl"), "utf8")
    assert.match(metadata, /"parentID":"middle"/)
    assert.match(metadata, /"parentID":"root"/)
  })

  it("compaction 完成及失败用量记账，累计 usage.updated 不重复计费", async t => {
    const f = await fixture(t)
    const data = { sessionID: "ses_1", reason: "auto" as const, text: "summary", recent: "recent",
      model: { id: "test-model", providerID: "test-provider" }, tokens, cost: 1 }
    await f.send("session.compaction.ended", data, { id: "evt_compact" })
    await f.send("session.compaction.ended", data, { id: "evt_compact" })
    await f.send("session.compaction.failed", { sessionID: "ses_1", reason: "auto",
      error: { type: "unknown", message: "failed" }, tokens })
    await f.send("session.usage.updated", { sessionID: "ses_1", tokens, cost: 2 })
    assert.equal(f.records().length, 2)
    assert.equal(f.records()[0].agent, "compaction")
    assert.equal(f.records()[0].messageId, "evt_compact")
    assert.equal(f.records()[1].model, "unknown")
  })

  it("写入失败可以重放同一消息，统计与预算不重复累计", async t => {
    const f = await fixture(t)
    await f.start()
    const append = fs.appendFileSync
    let fail = true
    t.mock.method(fs, "appendFileSync", (...args: Parameters<typeof append>) => {
      if (fail) { fail = false; throw new Error("模拟写入失败") }
      append(...args)
    })
    syncBuiltinESMExports()
    await f.end()
    assert.equal(f.records().length, 0)
    assert.equal(f.toasts.length, 0)
    await f.end()
    await f.end()
    assert.equal(f.records().length, 1)
    assert.equal(f.toasts.length, 1)
    assert.match(f.toasts[0].message, /Session: 1.5K/)
  })

  it("RPC 展示失败不丢日志，也不使下一条事件停止", async t => {
    const f = await fixture(t, { notify: async () => { throw new Error("TUI disconnected") } })
    await f.start()
    await f.end()
    await f.start("msg_2")
    await f.end("msg_2")
    assert.equal(f.records().length, 2)
  })

  it("多个项目实例共享全局预算，并各自只记录本位置事件", async t => {
    const f = await fixture(t)
    const second = await createHarness(t, join(f.directory, "other"))
    await f.message("first", 300_000, "msg_a")
    await second.message("second", 300_000, "msg_b")
    await f.message("first", 100_000, "msg_c")
    assert.equal(f.records().length, 3)
    assert.match(second.toasts.at(-1)?.message ?? "", /Daily: \$0.600\/\$1.00/)
    assert.match(f.toasts.at(-1)?.message ?? "", /Daily: \$0.700\/\$1.00/)
  })

  it("只响应 execution 终态显示摘要，忽略重复的旧 idle/status 信号", async t => {
    const f = await fixture(t)
    await f.start()
    await f.end()
    await f.send("session.execution.succeeded", { sessionID: "ses_1" })
    await f.send("session.idle", { sessionID: "ses_1" })
    await f.send("session.status", { sessionID: "ses_1", status: { type: "idle" } })
    assert.equal(f.toasts.length, 2)
    assert.match(f.toasts.at(-1)?.message ?? "", /1 msgs/)
  })

  it("清理订阅会 abort 并注销 RPC", async t => {
    const directory = mkdtempSync(join(tmpdir(), "tracker-cleanup-"))
    t.mock.method(os, "homedir", () => directory)
    syncBuiltinESMExports()
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); rmSync(directory, { recursive: true, force: true }) })
    const f = await createHarness(t, directory)
    await f.cleanup?.()
    assert.equal(f.aborted, true)
    assert.equal(f.disposed, true)
    await assert.rejects(() => f.message("s", 1, "m"), /已关闭/)
  })
})
