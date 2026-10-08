import type { TrackerToast } from "./rpc.js"
import type { TrackerConfig, BudgetStatus, BudgetSpentSnapshot, SessionInfoInput } from "./shared.js"
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync, openSync, readSync, closeSync } from "node:fs"
import { open, type FileHandle } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { createInterface } from "node:readline"
import {
  DEFAULT_CONFIG,
  aggregateRootSession,
  buildMessageToast,
  buildSessionRecord,
  calculateCost,
  evaluateBudgetStatus,
  formatCost,
  formatTokens,
  getStartOfDay,
  getStartOfMonth,
  getStartOfWeek,
  hasBillableTokenUsage,
  validateConfig,
} from "./shared.js"


export interface UsageRecord {
  sessionId: string
  messageId: string
  model: string
  provider: string
  agent?: string
  role?: string
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

// 每个加载位置拥有独立状态；TUI 只展示提示，不实例化记账器。
export async function createTracker(notify: (toast: TrackerToast) => Promise<void>) {
  const CONFIG_DIR = join(homedir(), ".config", "opencode")
  const CONFIG_FILE = join(CONFIG_DIR, "token-tracker.json")
  const LOG_DIR = join(CONFIG_DIR, "logs", "token-tracker")
  const LOG_FILE = join(LOG_DIR, "tokens.jsonl")
  const SESSIONS_LOG_FILE = join(LOG_DIR, "sessions.jsonl")

  // ============================================================================
  // Configuration
  // ============================================================================

  let config: TrackerConfig = DEFAULT_CONFIG
  let configWarnings: string[] = []
  let lastConfigLoadTime = 0
  let lastConfigMtime = 0

  function loadConfig(): TrackerConfig {
    try {
      if (existsSync(CONFIG_FILE)) {
        const content = readFileSync(CONFIG_FILE, "utf-8")
        const raw = JSON.parse(content)
        const result = validateConfig(raw)
        configWarnings = result.warnings
        return result.config
      }
    } catch {
      // JSON parse error - use defaults
      configWarnings = ["Config file is not valid JSON, using defaults"]
    }
    return DEFAULT_CONFIG
  }

  function ensureLatestConfig(): void {
    const now = Date.now()
    if (now - lastConfigLoadTime < 2000) {
      return
    }

    lastConfigLoadTime = now

    try {
      if (existsSync(CONFIG_FILE)) {
        const stat = statSync(CONFIG_FILE)
        const mtime = stat.mtimeMs
        if (mtime !== lastConfigMtime) {
          config = loadConfig()
          lastConfigMtime = mtime
        }
      }
    } catch {
      // Keep current config on error
    }
  }

  // ============================================================================
  // Session Statistics
  // ============================================================================

  interface SessionStats {
    totalInput: number
    totalOutput: number
    totalReasoning: number
    totalCacheRead: number
    totalCacheWrite: number
    totalCost: number
    messageCount: number
    startTime: number
  }

  const sessionStats = new Map<string, SessionStats>()

  // 从侧车日志和实时会话事件学习父子关系，展示时归并至顶层任务。
  const parentOf = new Map<string, string | undefined>()

  function getOrCreateSessionStats(sessionId: string): SessionStats {
    if (!sessionStats.has(sessionId)) {
      sessionStats.set(sessionId, {
        totalInput: 0,
        totalOutput: 0,
        totalReasoning: 0,
        totalCacheRead: 0,
        totalCacheWrite: 0,
        totalCost: 0,
        messageCount: 0,
        startTime: Date.now(),
      })
    }
    return sessionStats.get(sessionId)!
  }

  function rememberSessionParent(info: SessionInfoInput): void {
    // 仅标题更新不应抹去已有关系，与 CLI 的元数据合并口径一致。
    if (!info.id || !info.parentID) return
    parentOf.set(info.id, info.parentID)
  }

  async function restoreSessionParents(): Promise<void> {
    try {
      const lines = createInterface({ input: createReadStream(SESSIONS_LOG_FILE), crlfDelay: Infinity })
      for await (const line of lines) {
        try {
          const record = JSON.parse(line)
          if (record?.type !== "session" || typeof record.sessionId !== "string" || typeof record.parentID !== "string") continue
          rememberSessionParent({ id: record.sessionId, parentID: record.parentID })
        } catch {
          // 跳过损坏行，后续有效记录仍可恢复关系。
        }
      }
    } catch {
      // 无历史元数据或读取失败时，继续通过实时会话事件学习关系。
    }
  }

  // ============================================================================
  // Deduplication
  // ============================================================================

  const seen = new Set<string>()

  function rememberUsage(key: string): void {
    seen.add(key)

    // Cleanup old entries to prevent memory leak
    if (seen.size > 10_000) {
      const entries = Array.from(seen)
      entries.slice(0, 5_000).forEach(k => seen.delete(k))
    }

  }

  // ============================================================================
  // Logging
  // ============================================================================

  function ensureLogDir() {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true })
    }
  }

  function logJson(data: Record<string, unknown>, recordedAt: number) {
    ensureLogDir()
    const entry = JSON.stringify({ ...data, _ts: recordedAt }) + "\n"
    appendFileSync(LOG_FILE, entry)
    return Buffer.byteLength(entry)
  }

  // Append-only sidecar of session metadata (id/title/parentID/directory) used
  // by the CLI to label `--by session` rows and roll child sessions up to their
  // parent. Per-process dedup keeps writes to actual title/parent changes only.
  const seenSessions = new Map<string, string>()

  function logSessionMeta(info: SessionInfoInput): void {
    const record = buildSessionRecord(info)
    if (!record) return

    const signature = `${record.title ?? ""}|${record.parentID ?? ""}|${record.directory ?? ""}`
    if (seenSessions.get(record.sessionId) === signature) return

    // Bound memory the same way the message dedup set does.
    if (seenSessions.size > 10_000) {
      const stale = Array.from(seenSessions.keys()).slice(0, 5_000)
      for (const key of stale) seenSessions.delete(key)
    }

    ensureLogDir()
    appendFileSync(SESSIONS_LOG_FILE, JSON.stringify({ type: "session", ...record, _ts: Date.now() }) + "\n")
    seenSessions.set(record.sessionId, signature)
  }

  // ============================================================================
  // Budget Tracking (in-memory accumulator, avoids per-message JSONL reads)
  // ============================================================================

  interface BudgetTracker {
    dailySpent: number
    weeklySpent: number
    monthlySpent: number
    dayStart: number    // timestamp of current day start
    weekStart: number   // timestamp of current week start
    monthStart: number  // timestamp of current month start
    initialized: boolean
  }

  const budgetTracker: BudgetTracker = {
    dailySpent: 0,
    weeklySpent: 0,
    monthlySpent: 0,
    dayStart: 0,
    weekStart: 0,
    monthStart: 0,
    initialized: false,
  }

  /**
   * Load cost entries from JSONL since a given timestamp.
   * Used only during initialization and period rollovers.
   */
  function loadCostsSince(since: number): number {
    if (!existsSync(LOG_FILE)) return 0

    let total = 0
    let fd: number | null = null
    try {
      fd = openSync(LOG_FILE, "r")
      const stat = statSync(LOG_FILE)
      const fileSize = stat.size

      const CHUNK_SIZE = 64 * 1024 // 64KB chunks
      const buffer = Buffer.alloc(CHUNK_SIZE)

      let filePos = fileSize
      let leftover = ""
      let shouldStop = false

      while (filePos > 0 && !shouldStop) {
        const readLength = Math.min(CHUNK_SIZE, filePos)
        filePos -= readLength

        readSync(fd, buffer, 0, readLength, filePos)

        const chunkStr = buffer.toString("utf8", 0, readLength) + leftover
        const lines = chunkStr.split("\n")

        // The leftmost line could be cut off, save it for the next chunk read to the left
        leftover = lines[0]

        // Iterate lines in reverse order (from end to start)
        for (let i = lines.length - 1; i >= 1; i--) {
          const line = lines[i].trim()
          if (!line) continue

          try {
            const entry = JSON.parse(line)
            if (entry.type !== "tokens" || !entry.cost) continue

            if (entry._ts < since) {
              shouldStop = true
              break
            }

            total += entry.cost
          } catch {
            // Skip malformed lines
          }
        }
      }

      // Include the very first line at the top
      if (!shouldStop && leftover.trim()) {
        try {
          const entry = JSON.parse(leftover.trim())
          if (entry.type === "tokens" && entry.cost && entry._ts >= since) {
            total += entry.cost
          }
        } catch {}
      }
    } catch {
      // 异常路径下放弃部分累加结果，与 1.5.5 之前的语义保持一致，避免下游基于偏小值做预算判断
      total = 0
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd)
        } catch {}
      }
    }

    return total
  }

  /**
   * Initialize budgetTracker from JSONL file (called once at plugin init).
   */
  async function initBudgetTracker(): Promise<void> {
    const now = new Date()
    budgetTracker.dayStart = getStartOfDay(now)
    budgetTracker.weekStart = getStartOfWeek(now)
    budgetTracker.monthStart = getStartOfMonth(now)

    // Only load from file if budget is configured
    const budget = config.budget
    if (!budget.daily && !budget.weekly && !budget.monthly) {
      budgetTracker.initialized = true
      return
    }

    // Load once using the earliest period boundary
    const earliest = Math.min(
      budget.daily ? budgetTracker.dayStart : Infinity,
      budget.weekly ? budgetTracker.weekStart : Infinity,
      budget.monthly ? budgetTracker.monthStart : Infinity
    )

    if (!existsSync(LOG_FILE)) {
      budgetTracker.initialized = true
      return
    }

    let fileHandle: FileHandle | null = null
    try {
      const stat = statSync(LOG_FILE)
      const fileSize = stat.size

      fileHandle = await open(LOG_FILE, "r")

      const CHUNK_SIZE = 64 * 1024 // 64KB chunks
      const buffer = Buffer.alloc(CHUNK_SIZE)

      let filePos = fileSize
      let leftover = ""
      let shouldStop = false

      let daily = 0
      let weekly = 0
      let monthly = 0

      while (filePos > 0 && !shouldStop) {
        const readLength = Math.min(CHUNK_SIZE, filePos)
        filePos -= readLength

        const { bytesRead } = await fileHandle.read(buffer, 0, readLength, filePos)

        const chunkStr = buffer.toString("utf8", 0, bytesRead) + leftover
        const lines = chunkStr.split("\n")

        // The leftmost line could be cut off, save it for the next chunk read to the left
        leftover = lines[0]

        // Iterate lines in reverse order (from end to start)
        for (let i = lines.length - 1; i >= 1; i--) {
          const line = lines[i].trim()
          if (!line) continue

          try {
            const entry = JSON.parse(line)
            if (entry.type !== "tokens" || !entry.cost) continue

            if (entry._ts < earliest) {
              shouldStop = true
              break
            }

            if (entry._ts >= budgetTracker.dayStart) daily += entry.cost
            if (entry._ts >= budgetTracker.weekStart) weekly += entry.cost
            if (entry._ts >= budgetTracker.monthStart) monthly += entry.cost
          } catch {
            // Skip malformed lines
          }
        }
      }

      // Include the very first line at the top
      if (!shouldStop && leftover.trim()) {
        try {
          const entry = JSON.parse(leftover.trim())
          if (entry.type === "tokens" && entry.cost && entry._ts >= earliest) {
            if (entry._ts >= budgetTracker.dayStart) daily += entry.cost
            if (entry._ts >= budgetTracker.weekStart) weekly += entry.cost
            if (entry._ts >= budgetTracker.monthStart) monthly += entry.cost
          }
        } catch {}
      }

      budgetTracker.dailySpent = daily
      budgetTracker.weeklySpent = weekly
      budgetTracker.monthlySpent = monthly
    } catch (err) {
      // Keep budgetTracker at 0 on error
    } finally {
      if (fileHandle) {
        try {
          await fileHandle.close()
        } catch {}
      }
    }

    budgetTracker.initialized = true
  }

  // 在写入当前消息之前切换周期，避免重载结果已经包含当前消耗。
  function refreshBudgetPeriods(recordedAt: number): void {
    if (!budgetTracker.initialized) return

    const now = new Date(recordedAt)
    const currentDayStart = getStartOfDay(now)
    const currentWeekStart = getStartOfWeek(now)
    const currentMonthStart = getStartOfMonth(now)

    if (currentDayStart !== budgetTracker.dayStart) {
      budgetTracker.dayStart = currentDayStart
      budgetTracker.dailySpent = loadCostsSince(currentDayStart)
    }
    if (currentWeekStart !== budgetTracker.weekStart) {
      budgetTracker.weekStart = currentWeekStart
      budgetTracker.weeklySpent = loadCostsSince(currentWeekStart)
    }
    if (currentMonthStart !== budgetTracker.monthStart) {
      budgetTracker.monthStart = currentMonthStart
      budgetTracker.monthlySpent = loadCostsSince(currentMonthStart)
    }
  }

  // 只在日志成功写入后累计；周期判断和日志使用同一个 recordedAt。
  function accumulateBudget(cost: number): void {
    if (!budgetTracker.initialized) return

    budgetTracker.dailySpent += cost
    budgetTracker.weeklySpent += cost
    budgetTracker.monthlySpent += cost
  }

  function checkBudgetStatus(): BudgetStatus | null {
    const snapshot: BudgetSpentSnapshot = {
      dailySpent: budgetTracker.dailySpent,
      weeklySpent: budgetTracker.weeklySpent,
      monthlySpent: budgetTracker.monthlySpent,
    }
    return evaluateBudgetStatus(config.budget, snapshot, budgetTracker.initialized)
  }

  async function showToast(toast: TrackerToast): Promise<void> {
    try {
      await notify(toast)
    } catch {
      // 展示失败不影响已落盘的记录和预算。
    }
  }

  config = loadConfig()
  lastConfigLoadTime = Date.now()
  if (existsSync(CONFIG_FILE)) lastConfigMtime = statSync(CONFIG_FILE).mtimeMs
  // 在异步初始化前取快照；初始化期间的外部追加仍能在首条事件前被发现。
  let lastLogSize = existsSync(LOG_FILE) ? statSync(LOG_FILE).size : 0
  await initBudgetTracker()
  await restoreSessionParents()

  const warnings = (): string[] => configWarnings.slice()

  async function recordUsage(usage: UsageRecord): Promise<void> {
    ensureLatestConfig()
    if (!hasBillableTokenUsage(usage)) return
    // V2 每个 assistant message 的终态只记一次；失败的文件写入允许重试。
    const key = `${usage.sessionId}:${usage.messageId}`
    if (seen.has(key)) return
    const cost = calculateCost(usage.model, usage.provider, usage.input, usage.output,
      usage.cacheRead, usage.cacheWrite, config)
    const recordedAt = Date.now()
    refreshBudgetPeriods(recordedAt)
    const size = existsSync(LOG_FILE) ? statSync(LOG_FILE).size : 0
    // V2 同一服务可同时加载多个项目；其他记账器追加后刷新共享预算。
    if (size !== lastLogSize) {
      budgetTracker.dailySpent = loadCostsSince(budgetTracker.dayStart)
      budgetTracker.weeklySpent = loadCostsSince(budgetTracker.weekStart)
      budgetTracker.monthlySpent = loadCostsSince(budgetTracker.monthStart)
    }
    lastLogSize = size + logJson({ type: "tokens", ...usage, cost }, recordedAt)
    rememberUsage(key)
    accumulateBudget(cost)

    const stats = getOrCreateSessionStats(usage.sessionId)
    stats.totalInput += usage.input
    stats.totalOutput += usage.output
    stats.totalReasoning += usage.reasoning
    stats.totalCacheRead += usage.cacheRead
    stats.totalCacheWrite += usage.cacheWrite
    stats.totalCost += cost
    stats.messageCount += 1

    if (!config.toast.enabled) return
    const rootStats = aggregateRootSession(sessionStats, parentOf, usage.sessionId)
    const budgetStatus = checkBudgetStatus()
    await showToast({
      ...buildMessageToast({
        messageTokens: usage.input + usage.output,
        messageCost: cost,
        sessionTokens: rootStats.totalInput + rootStats.totalOutput,
        sessionCost: rootStats.totalCost,
        budget: budgetStatus,
      }),
      sessionID: usage.sessionId,
      duration: budgetStatus?.exceeded ? 5000 : config.toast.duration,
    })
  }

  function recordSession(info: SessionInfoInput): void {
    rememberSessionParent(info)
    logSessionMeta(info)
  }

  async function idle(sessionId: string): Promise<void> {
    ensureLatestConfig()
    if (!config.toast.enabled || !config.toast.showOnIdle) return
    const rootStats = aggregateRootSession(sessionStats, parentOf, sessionId)
    if (rootStats.messageCount === 0) return
    const duration = Math.round((Date.now() - rootStats.startTime) / 1000 / 60)
    await showToast({
      title: `Session: ${formatTokens(rootStats.totalInput + rootStats.totalOutput)} tokens`,
      message: `${formatCost(rootStats.totalCost)} | ${rootStats.messageCount} msgs | ${duration}min`,
      variant: "info",
      sessionID: sessionId,
      duration: 5000,
    })
  }

  return { recordUsage, recordSession, idle, warnings }
}
