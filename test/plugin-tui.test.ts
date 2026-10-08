import type { Plugin } from "@opencode/plugin/tui"
import type { TestContext } from "node:test"
import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import * as nodeModule from "node:module"
import { fileURLToPath } from "node:url"
import tui from "../tui.js"
import { TrackerRpc } from "../lib/rpc.js"

function fixture(t: TestContext, warnings: unknown = []) {
  const toasts: unknown[] = []
  let listener: ((event: { location: { directory: string }; data: unknown }) => void) | undefined
  let signal: AbortSignal | undefined
  let unsubscribed = false
  const context = {
    location: { directory: "/project" },
    client: {
      rpc: (definition: unknown) => {
        assert.equal(definition, TrackerRpc)
        return {
          warnings: async () => warnings,
          events: { on: (name: string, callback: typeof listener, options: { signal: AbortSignal }) => {
            assert.equal(name, "toast")
            signal = options.signal
            listener = callback
            return () => { unsubscribed = true }
          } },
        }
      },
    },
    ui: { toast: { show: (toast: unknown) => toasts.push(toast) } },
  } as unknown as Plugin.Context
  const cleanup = tui.setup(context)
  assert.equal(typeof cleanup, "function")
  // 此入口同步注册；不读取日志、不实例化服务端记账器。
  const dispose = cleanup as () => void
  t.after(dispose)
  const send = (data: unknown, directory = "/project") => listener?.({ data, location: { directory } })
  return { toasts, send, dispose, get aborted() { return signal?.aborted }, get unsubscribed() { return unsubscribed } }
}

const toast = { title: "Tokens", message: "1K", variant: "info", duration: 3000, sessionID: "ses_1" }

describe("OpenCode V2 TUI", () => {
  it("显示本位置 RPC 提示并携带会话 ID", t => {
    const f = fixture(t)
    f.send(toast)
    assert.deepEqual(f.toasts, [toast])
  })
  it("丢弃其他项目和不合法提示", t => {
    const f = fixture(t)
    f.send(toast, "/other")
    for (const value of [null, [], {}, { ...toast, variant: "invalid" }, { ...toast, duration: NaN }]) f.send(value)
    assert.deepEqual(f.toasts, [])
  })
  it("从 RPC 读取启动配置警告", async t => {
    const f = fixture(t, ["bad config"])
    await Promise.resolve()
    assert.deepEqual(f.toasts, [{ title: "Token Tracker: config warning", message: "bad config", variant: "warning", duration: 5000 }])
  })
  it("卸载后注销订阅，忽略晚到提示及配置查询", async t => {
    const f = fixture(t, ["bad config"])
    f.dispose()
    f.send(toast)
    await Promise.resolve()
    assert.equal(f.aborted, true)
    assert.equal(f.unsubscribed, true)
    assert.deepEqual(f.toasts, [])
  })
  it("多个 TUI 各自显示一次提示", t => {
    const a = fixture(t)
    const b = fixture(t)
    a.send(toast)
    b.send(toast)
    assert.equal(a.toasts.length, 1)
    assert.equal(b.toasts.length, 1)
  })
  it("官方 Host 按包 exports 找到并加载服务端和 TUI 入口", {
    skip: "registerHooks" in nodeModule ? false : "官方 Node Host 需要 Node >= 22.15；Node 18 验证插件逻辑与独立 CLI",
  }, async () => {
    const { Host } = await import("@opencode/plugin/host")
    const directory = fileURLToPath(new URL("../../", import.meta.url))
    const entries = Host.resolve({ directory, name: "opencode-token-tracker" })
    assert.ok(entries.server, "缺少服务端入口")
    assert.ok(entries.tui, "缺少 TUI 入口")
    const server = await Host.load(entries.server) as { default: { id: string; setup: unknown } }
    const terminal = await Host.load(entries.tui) as { default: { id: string; setup: unknown } }
    assert.equal(server.default.id, "opencode-token-tracker")
    assert.equal(typeof server.default.setup, "function")
    assert.equal(terminal.default.id, "opencode-token-tracker.tui")
    assert.equal(typeof terminal.default.setup, "function")
  })
})
