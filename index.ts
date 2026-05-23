import type { Plugin } from "@opencode-ai/plugin"
import type { ModelPricing, TrackerConfig } from "./lib/shared.js"
import { BUILTIN_PRICING, DEFAULT_CONFIG, findModelConfigPricing, formatCost, formatTokens, getStartOfDay, getStartOfWeek, getStartOfMonth, validateConfig } from "./lib/shared.js"
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, openSync, readSync, closeSync } from "fs"
import { open, type FileHandle } from "fs/promises"
import { join } from "path"
import { homedir } from "os"

const CONFIG_DIR = join(homedir(), ".config", "opencode")
const CONFIG_FILE = join(CONFIG_DIR, "token-tracker.json")
const LOG_DIR = join(CONFIG_DIR, "logs", "token-tracker")
const LOG_FILE = join(LOG_DIR, "tokens.jsonl")

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
// Pricing
// ============================================================================

function getModelPricing(model: string, provider: string): ModelPricing {
  // 1. Check provider-level override first (highest priority)
  if (config.providers[provider]) {
    return config.providers[provider]
  }
  
  // 2. Check user-defined model pricing
  const configuredPricing = findModelConfigPricing(config.models, model, provider)
  if (configuredPricing) {
    return configuredPricing
  }
  
  // 3. Check built-in exact match
  if (BUILTIN_PRICING[model]) {
    return BUILTIN_PRICING[model]
  }
  
  // 4. Try partial match in built-in pricing
  const modelLower = model.toLowerCase()
  for (const [key, pricing] of Object.entries(BUILTIN_PRICING)) {
    if (key !== "_default" && modelLower.includes(key.toLowerCase())) {
      return pricing
    }
  }
  
  // 5. Fallback to default
  return BUILTIN_PRICING["_default"]
}

type ProviderFamily = "anthropic" | "openai" | "deepseek" | "google" | "other"

export function getProviderFamily(model: string, provider: string): ProviderFamily {
  const p = provider.toLowerCase()
  const m = model.toLowerCase()
  
  if (p.includes("anthropic") || m.startsWith("claude-")) {
    return "anthropic"
  }
  if (
    p.includes("openai") ||
    m.startsWith("gpt-") ||
    m.startsWith("o1-") ||
    m.startsWith("o3-") ||
    m.startsWith("o4-") ||
    m === "o3" ||
    m === "o1"
  ) {
    return "openai"
  }
  if (p.includes("deepseek") || m.includes("deepseek")) {
    return "deepseek"
  }
  if (p.includes("google") || p.includes("vertex") || m.startsWith("gemini-")) {
    return "google"
  }
  
  return "other"
}

export function calculateCost(
  model: string,
  provider: string,
  input: number,
  output: number,
  cacheRead: number = 0,
  cacheWrite: number = 0
): number {
  const pricing = getModelPricing(model, provider)
  const family = getProviderFamily(model, provider)
  
  let defaultCacheReadRate = 0.5 // Default 50% discount (OpenAI style)
  let defaultCacheWriteRate = 0   // Default free cache writing
  
  if (family === "anthropic") {
    defaultCacheReadRate = 0.1
    defaultCacheWriteRate = 1.25
  } else if (family === "deepseek" || family === "google") {
    defaultCacheReadRate = 0.1
    defaultCacheWriteRate = 0
  } else if (family === "openai") {
    defaultCacheReadRate = 0.5
    defaultCacheWriteRate = 0
  } else {
    // "other" / general default
    defaultCacheReadRate = 0.5
    defaultCacheWriteRate = 0
  }
  
  const finalCacheReadPrice = pricing.cacheRead ?? (pricing.input * defaultCacheReadRate)
  const finalCacheWritePrice = pricing.cacheWrite ?? (pricing.input * defaultCacheWriteRate)
  
  // Billable input = total input - cache read (cached tokens are charged at cache rate)
  const billableInput = Math.max(0, input - cacheRead)
  
  const inputCost = (billableInput / 1_000_000) * pricing.input
  const outputCost = (output / 1_000_000) * pricing.output
  const cacheReadCost = (cacheRead / 1_000_000) * finalCacheReadPrice
  const cacheWriteCost = (cacheWrite / 1_000_000) * finalCacheWritePrice
  
  return inputCost + outputCost + cacheReadCost + cacheWriteCost
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

// ============================================================================
// Budget Tracking (in-memory accumulator, avoids per-message JSONL reads)
// ============================================================================

interface BudgetStatus {
  period: "daily" | "weekly" | "monthly"
  spent: number
  limit: number
  percentage: number
  exceeded: boolean
  warning: boolean
}

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
  const budget = config.budget
  if (!budget.daily && !budget.weekly && !budget.monthly) {
    return null
  }

  if (!budgetTracker.initialized) return null

  const warnAt = budget.warnAt ?? 0.8

  // Check in order: daily -> weekly -> monthly (most restrictive first)
  if (budget.daily) {
    const percentage = budgetTracker.dailySpent / budget.daily
    return {
      period: "daily",
      spent: budgetTracker.dailySpent,
      limit: budget.daily,
      percentage,
      exceeded: percentage >= 1,
      warning: percentage >= warnAt && percentage < 1,
    }
  }

  if (budget.weekly) {
    const percentage = budgetTracker.weeklySpent / budget.weekly
    return {
      period: "weekly",
      spent: budgetTracker.weeklySpent,
      limit: budget.weekly,
      percentage,
      exceeded: percentage >= 1,
      warning: percentage >= warnAt && percentage < 1,
    }
  }

  if (budget.monthly) {
    const percentage = budgetTracker.monthlySpent / budget.monthly
    return {
      period: "monthly",
      spent: budgetTracker.monthlySpent,
      limit: budget.monthly,
      percentage,
      exceeded: percentage >= 1,
      warning: percentage >= warnAt && percentage < 1,
    }
  }

  return null
}

function formatBudgetMessage(status: BudgetStatus): string {
  const pct = Math.round(status.percentage * 100)
  const periodLabel = status.period.charAt(0).toUpperCase() + status.period.slice(1)
  return `${periodLabel}: ${formatCost(status.spent)}/${formatCost(status.limit)} (${pct}%)`
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

            const hasTokens = input > 0 || output > 0 || cacheRead > 0 || cacheWrite > 0
            if (!hasTokens) return

            const dedupeKey = `${messageId}-${input}-${output}-${cacheRead}-${cacheWrite}`
            if (isDuplicate(dedupeKey)) return

            const model = info.model?.modelID ?? info.modelID ?? "unknown"
            const provider = info.model?.providerID ?? info.providerID ?? "unknown"
            const cost = calculateCost(model, provider, input, output, cacheRead, cacheWrite)

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
              
              // Check budget status
              const budgetStatus = checkBudgetStatus()
              
              let title = `${formatTokens(totalTokens)} tokens`
              let message = `${formatCost(cost)} | Session: ${formatCost(stats.totalCost)}`
              let variant: "info" | "warning" | "error" = "info"
              
              // Add budget warning/alert if applicable
              if (budgetStatus) {
                if (budgetStatus.exceeded) {
                  title = `⚠️ Budget exceeded!`
                  message = formatBudgetMessage(budgetStatus)
                  variant = "error"
                } else if (budgetStatus.warning) {
                  message = `${formatCost(cost)} | ${formatBudgetMessage(budgetStatus)}`
                  variant = "warning"
                }
              }
              
              try {
                await client.tui.showToast({
                  body: {
                    title,
                    message,
                    variant,
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

            const duration = Math.round((Date.now() - stats.startTime) / 1000 / 60)
            const totalTokens = stats.totalInput + stats.totalOutput

            try {
              await client.tui.showToast({
                body: {
                  title: `Session: ${formatTokens(totalTokens)} tokens`,
                  message: `${formatCost(stats.totalCost)} | ${stats.messageCount} msgs | ${duration}min`,
                  variant: "info",
                  duration: 5000,
                },
              })
            } catch {}
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
