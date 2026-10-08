import type { Plugin } from "@opencode/plugin"
import type { TestContext } from "node:test"
import type { TrackerToast } from "../lib/rpc.js"
import { TokenTrackerPlugin } from "../index.js"

type ServerEvent = ReturnType<Plugin.Context["event"]["subscribe"]> extends AsyncIterable<infer Event> ? Event : never
type SessionInfo = Awaited<ReturnType<Plugin.Context["session"]["get"]>>
type Messages = Awaited<ReturnType<Plugin.Context["session"]["context"]>>

export async function createHarness(t: TestContext, directory: string, options: {
  getSession?: (id: string) => Promise<SessionInfo>
  getMessages?: (id: string) => Promise<Messages>
  notify?: (toast: TrackerToast) => Promise<void>
} = {}) {
  const toasts: TrackerToast[] = []
  let signal: AbortSignal | undefined
  let deliver: ((event?: ServerEvent) => void) | undefined
  let processed: (() => void) | undefined
  let sequence = 0
  let disposed = false
  let warningHandler: (() => Promise<string[]>) | undefined
  const context = {
    location: { directory, project: { id: "project", directory, canonical: directory } },
    event: {
      subscribe: async function* (options: { signal: AbortSignal }) {
        signal = options.signal
        while (!signal.aborted) {
          const next = new Promise<ServerEvent | undefined>((resolve) => { deliver = resolve })
          processed?.()
          processed = undefined
          const stop = () => deliver?.()
          signal.addEventListener("abort", stop, { once: true })
          const event = await next
          signal.removeEventListener("abort", stop)
          if (!event) break
          yield event
        }
      },
    },
    rpc: {
      register: async (_definition: unknown, handlers: { warnings: () => Promise<string[]> }) => {
        warningHandler = handlers.warnings
        return {
          events: { emit: async (_name: string, toast: TrackerToast) => {
            toasts.push(toast)
            await options.notify?.(toast)
          } },
          dispose: async () => { disposed = true },
        }
      },
    },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => {
        if (!options.getSession) throw new Error("测试会话不存在")
        return options.getSession(sessionID)
      },
      context: async ({ sessionID }: { sessionID: string }) => options.getMessages?.(sessionID) ?? [],
    },
  } as unknown as Plugin.Context
  const cleanup = await TokenTrackerPlugin.setup(context)
  t.after(async () => { await cleanup?.() })

  const send = async <Type extends ServerEvent["type"]>(type: Type,
    data: Extract<ServerEvent, { type: Type }>["data"],
    overrides: { id?: string; location?: { directory: string } | null } = {}) => {
    if (signal?.aborted) throw new Error("测试订阅已关闭")
    const event = {
      type, data, id: overrides.id ?? `evt_${++sequence}`, created: Date.now(),
      durable: { aggregateID: "session", seq: sequence, version: 1 },
      location: overrides.location === null ? undefined : overrides.location ?? { directory },
    } as ServerEvent
    await new Promise<void>((resolve) => {
      processed = resolve
      deliver?.(event)
    })
  }
  const message = async (sessionID: string, input: number, messageID: string) => {
    await send("session.step.started", {
      sessionID, assistantMessageID: messageID, agent: "build",
      model: { id: "test-model", providerID: "test-provider" }, started: Date.now(),
    })
    await send("session.step.ended", {
      sessionID, assistantMessageID: messageID, finish: "stop", cost: 0,
      tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })
  }
  return { send, message, toasts, cleanup, warnings: () => warningHandler?.(),
    get aborted() { return signal?.aborted }, get disposed() { return disposed } }
}
