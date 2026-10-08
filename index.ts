import * as Plugin from "@opencode/plugin/promise/plugin"
import { TrackerRpc } from "./lib/rpc.js"
import { createTracker } from "./lib/tracker.js"

// 直接引用轻量入口，避免为服务端或无 JSX 的 TUI 加载完整 UI 运行时。
type ServerEvent = ReturnType<Plugin.Context["event"]["subscribe"]> extends AsyncIterable<infer Event> ? Event : never
type StepStarted = Extract<ServerEvent, { type: "session.step.started" }>["data"]

export const TokenTrackerPlugin = Plugin.define({
  id: "opencode-token-tracker",
  async setup(ctx) {
    const controller = new AbortController()
    const tracker = await createTracker(async (toast) => registration.events.emit("toast", { ...toast }))
    const registration = await ctx.rpc.register(TrackerRpc, { warnings: async () => tracker.warnings() })
    const steps = new Map<string, Pick<StepStarted, "agent" | "model">>()
    const knownSessions = new Set<string>()

    function rememberSession(id: string): void {
      knownSessions.add(id)
      if (knownSessions.size > 10_000) {
        for (const key of Array.from(knownSessions).slice(0, 5_000)) knownSessions.delete(key)
      }
    }

    function rememberStep(id: string, step: Pick<StepStarted, "agent" | "model">): void {
      steps.set(id, step)
      if (steps.size > 10_000) {
        for (const key of Array.from(steps.keys()).slice(0, 5_000)) steps.delete(key)
      }
    }

    async function restoreSession(sessionID: string, visited = new Set<string>()): Promise<void> {
      if (knownSessions.has(sessionID) || visited.has(sessionID) || visited.size >= 100) return
      visited.add(sessionID)
      try {
        const session = await ctx.session.get({ sessionID }, { signal: controller.signal })
        tracker.recordSession({
          id: session.id, parentID: session.parentID, title: session.title,
          directory: session.location.directory,
        })
        rememberSession(sessionID)
        if (session.parentID) await restoreSession(session.parentID, visited)
      } catch {
        // 元数据不可用不应丢弃本次用量，后续事件会再尝试。
      }
    }

    async function stepInfo(sessionID: string, messageID: string) {
      const step = steps.get(messageID)
      if (step) return step
      // 插件可能在请求中途加载；从该消息恢复模型，不能拿当前会话模型替代。
      try {
        const messages = await ctx.session.context({ sessionID }, { signal: controller.signal })
        const message = messages.find((item) => item.id === messageID && item.type === "assistant")
        if (message?.type === "assistant") {
          rememberStep(messageID, message)
          return message
        }
      } catch {
        // 保留未知型号的记录，CLI 会提示默认计价。
      }
      return undefined
    }

    async function handle(event: ServerEvent): Promise<void> {
      // V2 订阅是整个 server 的事件流，每个位置只处理属于自己的事件。
      if (event.location?.directory !== ctx.location.directory) return
      switch (event.type) {
        case "session.created": {
          const data = event.data
          tracker.recordSession({
            id: data.sessionID, parentID: data.parentID, title: data.title,
            directory: data.location.directory,
          })
          rememberSession(data.sessionID)
          if (data.parentID) await restoreSession(data.parentID)
          return
        }
        case "session.renamed":
          await restoreSession(event.data.sessionID)
          tracker.recordSession({ id: event.data.sessionID, title: event.data.title })
          return
        case "session.step.started":
          rememberStep(event.data.assistantMessageID, event.data)
          await restoreSession(event.data.sessionID)
          return
        case "session.step.ended":
        case "session.step.failed": {
          const data = event.data
          if (!data.tokens) return
          await restoreSession(data.sessionID)
          const step = await stepInfo(data.sessionID, data.assistantMessageID)
          const tokens = data.tokens
          await tracker.recordUsage({
            sessionId: data.sessionID, messageId: data.assistantMessageID, role: "assistant",
            agent: step?.agent, model: step?.model.id ?? "unknown", provider: step?.model.providerID ?? "unknown",
            input: tokens.input, output: tokens.output + tokens.reasoning, reasoning: tokens.reasoning,
            cacheRead: tokens.cache.read, cacheWrite: tokens.cache.write,
          })
          return
        }
        case "session.compaction.ended":
        case "session.compaction.failed": {
          const data = event.data
          if (!data.tokens) return
          await restoreSession(data.sessionID)
          const model = "model" in data ? data.model : undefined
          await tracker.recordUsage({
            sessionId: data.sessionID, messageId: event.id, role: "assistant", agent: "compaction",
            model: model?.id ?? "unknown", provider: model?.providerID ?? "unknown",
            input: data.tokens.input, output: data.tokens.output + data.tokens.reasoning,
            reasoning: data.tokens.reasoning, cacheRead: data.tokens.cache.read, cacheWrite: data.tokens.cache.write,
          })
          return
        }
        case "session.execution.succeeded":
        case "session.execution.failed":
        case "session.execution.interrupted":
          await restoreSession(event.data.sessionID)
          await tracker.idle(event.data.sessionID)
          return
      }
    }

    const consume = (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (controller.signal.aborted) break
          try {
            await handle(event)
          } catch (error) {
            // 单条日志或元数据写入失败不终止后续事件采集。
            console.error("[Token Tracker] Event failed:", error)
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) console.error("[Token Tracker] Subscription failed:", error)
      }
    })()

    let cleanup: Promise<void> | undefined
    return () => cleanup ??= (async () => {
      controller.abort()
      await consume
      await registration.dispose()
      steps.clear()
      knownSessions.clear()
    })()
  },
})

export default TokenTrackerPlugin
