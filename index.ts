import type { Plugin } from "@opencode-ai/plugin"
import type { ModelPricing, TrackerConfig, BudgetStatus, BudgetSpentSnapshot, SessionInfoInput } from "./lib/shared.js"
import {
  BUILTIN_PRICING,
  DEFAULT_CONFIG,
  aggregateRootSession,
  buildMessageToast,
  buildSessionRecord,
  calculateCost,
  evaluateBudgetStatus,
  findModelConfigPricing,
  formatCost,
  formatTokens,
  getProviderFamily,
  getStartOfDay,
  getStartOfMonth,
  getStartOfWeek,
  hasBillableTokenUsage,
  validateConfig,
} from "./lib/shared.js"
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, openSync, readSync, closeSync } from "fs"
import { open, type FileHandle } from "fs/promises"
import { join } from "path"
import { homedir } from "os"

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

// In-memory session parent links (sessionId -> parentID) learned from
// session.created / session.updated events. Used to roll a sub-agent session's
// usage up into its top-level (parent) session when displaying toasts, so the
// `Session:` total reflects the whole task rather than one agent's slice. Grows
// one entry per session alongside sessionStats; the durable form for the CLI is
// sessions.jsonl. The persisted parentID is recorded separately by logSessionMeta.
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
  if (!info.id) return
  parentOf.set(info.id, info.parentID)
}

// ============================================================================
// Deduplication
// ============================================================================

const seen = new Set<string>()

function isDuplicate(key: string): boolean {
  if (seen.has(key)) return true
  seen.add(key)
  
  // Cleanup old entries to prevent memory leak
  if (seen.size > 10000) {
    const entries = Array.from(seen)
    entries.slice(0, 5000).forEach(k => seen.delete(k))
  }
  
  return false
}

// ============================================================================
// Logging
// ============================================================================

function ensureLogDir() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true })
  }
}

function logJson(data: Record<string, unknown>) {
  ensureLogDir()
  const entry = JSON.stringify({ ...data, _ts: Date.now() }) + "\n"
  appendFileSync(LOG_FILE, entry)
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
  seenSessions.set(record.sessionId, signature)

  // Bound memory the same way the message dedup set does.
  if (seenSessions.size > 10000) {
    const stale = Array.from(seenSessions.keys()).slice(0, 5000)
    for (const key of stale) seenSessions.delete(key)
  }

  ensureLogDir()
  appendFileSync(SESSIONS_LOG_FILE, JSON.stringify({ type: "session", ...record, _ts: Date.now() }) + "\n")
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

/**
 * Accumulate cost into budgetTracker after a new token entry is logged.
 */
function accumulateBudget(cost: number): void {
  if (!budgetTracker.initialized) return

  const now = new Date()
  const currentDayStart = getStartOfDay(now)
  const currentWeekStart = getStartOfWeek(now)
  const currentMonthStart = getStartOfMonth(now)

  // Period rollover detection — reset and reload from file for accuracy
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

// ============================================================================
// Plugin
// ============================================================================

interface MessageInfo {
  id?: string
  sessionID?: string
  role?: string
  agent?: string
  model?: { providerID?: string; modelID?: string }
  modelID?: string
  providerID?: string
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
  }
  cost?: number
  time?: {
    created?: number
    completed?: number
  }
  finish?: string
}

export const TokenTrackerPlugin: Plugin = async ({ directory, client }) => {
  try {
    // Load config on plugin init (with validation)
    config = loadConfig()
    lastConfigLoadTime = Date.now()
    if (existsSync(CONFIG_FILE)) {
      lastConfigMtime = statSync(CONFIG_FILE).mtimeMs
    }
    
    // Initialize in-memory budget tracker (reads JSONL once)
    await initBudgetTracker()

    // 不再写 type:"init" 标记：OpenCode 会在多个子进程（LSP、工具 runner 等）独立加载
    // plugin，每次启动会向 JSONL 写多份重复的 init 行，污染日志且无计费价值。
    // 跨进程去重的根因修复留待后续版本。

    // Show config validation warnings via Toast
    if (configWarnings.length > 0) {
      try {
        await client.tui.showToast({
          body: {
            title: "Token Tracker: config warning",
            message: configWarnings.join("; "),
            variant: "warning",
            duration: 5000,
          },
        })
      } catch {}
    }

    return {
      event: async ({ event }) => {
        try {
          // Handle message updates (token tracking)
          if (event.type === "message.updated") {
            ensureLatestConfig()
            const props = event.properties as { info?: MessageInfo } | undefined
            const info = props?.info
            if (!info?.tokens) return

            // 流式中间态保护：仅在消息真正完结时记账，避免对同一条消息重复计费。
            // 完结信号优先用 time.completed；实证发现 provider 的 finish reason
            // 会在 time.completed 之前一帧出现且此时 tokens 已完整，因此把 finish
            // 也作为有效的完结信号，避免极端断流时漏掉最后一帧。
            // 通过 modelID 识别 AI 生成消息（user 消息无此字段），不再硬编码 role。
            if (info.modelID && !info.time?.completed && !info.finish) {
              return
            }

            const messageId = info.id
            const sessionId = info.sessionID
            if (!messageId || !sessionId) return

            const input = info.tokens.input ?? 0
            const output = info.tokens.output ?? 0
            const reasoning = info.tokens.reasoning ?? 0
            const cacheRead = info.tokens.cache?.read ?? 0
            const cacheWrite = info.tokens.cache?.write ?? 0

            if (!hasBillableTokenUsage({ input, output, cacheRead, cacheWrite })) return

            const dedupeKey = `${messageId}-${input}-${output}-${cacheRead}-${cacheWrite}`
            if (isDuplicate(dedupeKey)) return

            const model = info.model?.modelID ?? info.modelID ?? "unknown"
            const provider = info.model?.providerID ?? info.providerID ?? "unknown"
            const cost = calculateCost(model, provider, input, output, cacheRead, cacheWrite, config)

            // Update session stats
            const stats = getOrCreateSessionStats(sessionId)
            stats.totalInput += input
            stats.totalOutput += output
            stats.totalReasoning += reasoning
            stats.totalCacheRead += cacheRead
            stats.totalCacheWrite += cacheWrite
            stats.totalCost += cost
            stats.messageCount += 1

            // Log to file
            logJson({
              type: "tokens",
              sessionId,
              messageId,
              role: info.role,
              agent: info.agent,
              model,
              provider,
              input,
              output,
              reasoning,
              cacheRead,
              cacheWrite,
              cost,
            })

            // Accumulate cost into in-memory budget tracker
            accumulateBudget(cost)

            // Show toast for this message
            if (config.toast.enabled) {
              const totalTokens = input + output

              // Roll sub-agent sessions up to their top-level session so
              // `Session:` reflects the whole task, not just this agent's slice.
              const rootStats = aggregateRootSession(sessionStats, parentOf, sessionId)

              // Check budget status
              const budgetStatus = checkBudgetStatus()
              const toast = buildMessageToast({
                messageTokens: totalTokens,
                messageCost: cost,
                sessionTokens: rootStats.totalInput + rootStats.totalOutput,
                sessionCost: rootStats.totalCost,
                budget: budgetStatus,
              })
              
              try {
                await client.tui.showToast({
                  body: {
                    ...toast,
                    duration: budgetStatus?.exceeded ? 5000 : config.toast.duration,
                  },
                })
              } catch {}
            }
          }

          // Handle session idle (show summary)
          if (event.type === "session.idle") {
            ensureLatestConfig()
            if (!config.toast.enabled || !config.toast.showOnIdle) return
            
            const props = event.properties as { sessionID?: string } | undefined
            const sessionId = props?.sessionID
            if (!sessionId) return

            const stats = sessionStats.get(sessionId)
            if (!stats || stats.messageCount === 0) return

            // Summarize the whole task: roll child sessions up to the root and
            // measure duration from the earliest session in the group.
            const rootStats = aggregateRootSession(sessionStats, parentOf, sessionId)
            const duration = Math.round((Date.now() - rootStats.startTime) / 1000 / 60)
            const totalTokens = rootStats.totalInput + rootStats.totalOutput

            try {
              await client.tui.showToast({
                body: {
                  title: `Session: ${formatTokens(totalTokens)} tokens`,
                  message: `${formatCost(rootStats.totalCost)} | ${rootStats.messageCount} msgs | ${duration}min`,
                  variant: "info",
                  duration: 5000,
                },
              })
            } catch {}
          }

          // Capture session metadata (title/parentID) for the CLI session view
          // and the in-memory parent map used to roll sub-agent usage up to the
          // top-level session in toasts.
          if (event.type === "session.created" || event.type === "session.updated") {
            const props = event.properties as { info?: SessionInfoInput } | undefined
            if (props?.info) {
              rememberSessionParent(props.info)
              logSessionMeta(props.info)
            }
          }
        } catch {}
      },
    }
  } catch (err) {
    console.error("[Token Tracker] Initialization failed:", err)
    return {
      event: async () => {},
    }
  }
}

export default TokenTrackerPlugin
