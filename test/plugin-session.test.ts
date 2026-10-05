import type { Plugin } from "@opencode-ai/plugin"
import type { TestContext } from "node:test"
import { strict as assert } from "node:assert"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire, syncBuiltinESMExports } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"

const os = createRequire(import.meta.url)("node:os") as typeof import("node:os")
const pluginUrl = new URL("../index.js", import.meta.url)
let fixtureId = 0

interface Toast {
  title: string
  message: string
  variant: string
}

async function createFixture(t: TestContext, options: { history?: string; unreadableHistory?: boolean } = {}) {
  const fixture = mkdtempSync(join(tmpdir(), "token-tracker-session-"))
  const configDir = join(fixture, ".config", "opencode")
  const logDir = join(configDir, "logs", "token-tracker")
  mkdirSync(logDir, { recursive: true })
  writeFileSync(join(configDir, "token-tracker.json"), JSON.stringify({
    providers: { "test-provider": { input: 1, output: 0 } },
  }))
  if (options.history !== undefined) writeFileSync(join(logDir, "sessions.jsonl"), options.history)
  if (options.unreadableHistory) mkdirSync(join(logDir, "sessions.jsonl"))

  t.mock.method(os, "homedir", () => fixture)
  syncBuiltinESMExports()
  t.after(() => {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    rmSync(fixture, { recursive: true, force: true })
  })

  const toasts: Toast[] = []
  const { TokenTrackerPlugin } = await import(`${pluginUrl.href}?session-fixture=${fixtureId++}`) as typeof import("../index.js")
  const plugin = await TokenTrackerPlugin({
    directory: fixture,
    client: { tui: { showToast: async ({ body }: { body: Toast }) => { toasts.push(body) } } },
  } as unknown as Parameters<Plugin>[0])
  const event = plugin.event
  assert.ok(event)

  const message = (sessionID: string, input: number, id = `${sessionID}-${input}`) => event({
    event: {
      type: "message.updated",
      properties: { info: {
        id, sessionID, parentID: "user-message", role: "assistant",
        modelID: "test-model", providerID: "test-provider", mode: "build",
        path: { cwd: fixture, root: fixture }, cost: 0,
        tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: Date.now(), completed: Date.now() },
      } },
    },
  })
  const session = (id: string, parentID?: string, type: "session.created" | "session.updated" = "session.created") => event({
    event: {
      type,
      properties: { info: {
        id, parentID, title: `${id} title`, directory: fixture,
        projectID: "test-project", version: "test",
        time: { created: Date.now(), updated: Date.now() },
      } },
    },
  })
  const idle = (sessionID: string) => event({ event: { type: "session.idle", properties: { sessionID } } })
  const records = () => readFileSync(join(logDir, "tokens.jsonl"), "utf8").trim().split("\n")
    .map((line) => JSON.parse(line) as { sessionId: string; cost: number })
  return { toasts, message, session, idle, records }
}

describe("插件主子会话事件回归", { concurrency: false }, () => {
  it("主、子及孙会话累计一致，隔离其他任务且不重复记账", async (t) => {
    const fixture = await createFixture(t)
    await fixture.session("child", "root")
    await fixture.session("leaf", "child")
    await fixture.message("other", 1_000_000)
    await fixture.message("root", 500_000)
    await fixture.message("child", 250_000)
    await fixture.message("leaf", 125_000)
    assert.equal(fixture.toasts.at(-1)?.message, "$0.125 | Session: 875.0K · $0.875")
    await fixture.message("leaf", 125_000)
    assert.equal(fixture.records().length, 4)
    await fixture.idle("root")
    const rootToast = fixture.toasts.at(-1)
    assert.equal(rootToast?.title, "Session: 875.0K tokens")
    assert.match(rootToast?.message ?? "", /^\$0\.875 \| 3 msgs \|/)
    await fixture.idle("leaf")
    assert.deepEqual(fixture.toasts.at(-1), rootToast)
    assert.deepEqual(fixture.records().map((record) => record.sessionId), ["other", "root", "child", "leaf"])
  })

  it("父子关系晚于首条消息到达时，下次展示归并已有消耗", async (t) => {
    const fixture = await createFixture(t)
    await fixture.message("root", 500_000)
    await fixture.message("child", 250_000)
    assert.equal(fixture.toasts.at(-1)?.message, "$0.250 | Session: 250.0K · $0.250")
    await fixture.session("child", "root", "session.updated")
    await fixture.idle("child")
    assert.equal(fixture.toasts.at(-1)?.title, "Session: 750.0K tokens")
    assert.match(fixture.toasts.at(-1)?.message ?? "", /^\$0\.750 \| 2 msgs \|/)
  })

  it("只更新标题时保留此前已知的父子关系", async (t) => {
    const fixture = await createFixture(t)
    await fixture.session("child", "root")
    await fixture.message("root", 500_000)
    await fixture.message("child", 250_000)
    await fixture.session("child", undefined, "session.updated")
    await fixture.message("child", 125_000)
    assert.equal(fixture.toasts.at(-1)?.message, "$0.125 | Session: 875.0K · $0.875")
  })

  it("主会话尚无自身消耗时仍显示子会话的 idle 汇总", async (t) => {
    const fixture = await createFixture(t)
    await fixture.session("child", "root")
    await fixture.message("child", 250_000)
    await fixture.idle("root")
    assert.equal(fixture.toasts.length, 2)
    assert.equal(fixture.toasts.at(-1)?.title, "Session: 250.0K tokens")
    assert.match(fixture.toasts.at(-1)?.message ?? "", /^\$0\.250 \| 1 msgs \|/)
    await fixture.idle("unrelated")
    assert.equal(fixture.toasts.length, 2)
  })

  it("重启后从元数据恢复父子关系，忽略损坏记录并保留标题更新前的关系", async (t) => {
    const history = [
      JSON.stringify({ type: "session", sessionId: "child", parentID: "root" }),
      "损坏的 JSON",
      "null",
      JSON.stringify({ type: "tokens", sessionId: "child", parentID: "wrong-root" }),
      JSON.stringify({ type: "session", sessionId: "child", title: "新标题" }),
      JSON.stringify({ type: "session", sessionId: "child", parentID: { invalid: true } }),
    ].join("\n")
    const fixture = await createFixture(t, { history })
    await fixture.message("root", 500_000)
    await fixture.message("child", 250_000)
    assert.equal(fixture.toasts.at(-1)?.message, "$0.250 | Session: 750.0K · $0.750")
    assert.equal(fixture.records().length, 2)
  })

  it("空元数据与未知父会话仍可正常记录和汇总", async (t) => {
    const fixture = await createFixture(t, { history: "" })
    await fixture.session("child", "unknown-parent")
    await fixture.message("child", 250_000)
    await fixture.idle("unknown-parent")
    assert.equal(fixture.toasts.at(-1)?.title, "Session: 250.0K tokens")
    assert.match(fixture.toasts.at(-1)?.message ?? "", /^\$0\.250 \| 1 msgs \|/)
  })

  it("元数据文件不可读时，插件仍通过实时事件学习关系", async (t) => {
    const fixture = await createFixture(t, { unreadableHistory: true })
    await fixture.session("child", "root")
    await fixture.message("root", 500_000)
    await fixture.message("child", 250_000)
    assert.equal(fixture.toasts.at(-1)?.message, "$0.250 | Session: 750.0K · $0.750")
    assert.equal(fixture.records().length, 2)
  })
})
