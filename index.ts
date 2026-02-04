import type { Plugin } from "@opencode-ai/plugin"
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const CONFIG_DIR = join(homedir(), ".config", "opencode")
const CONFIG_FILE = join(CONFIG_DIR, "token-tracker.json")
const LOG_DIR = join(CONFIG_DIR, "logs", "token-tracker")
const LOG_FILE = join(LOG_DIR, "tokens.jsonl")

// ============================================================================
// Configuration
// ============================================================================

interface ModelPricing {
  input: number       // per 1M input tokens
  output: number      // per 1M output tokens
  cacheRead?: number  // per 1M cached input tokens (usually cheaper)
  cacheWrite?: number // per 1M cache write tokens
}

interface ToastConfig {
  enabled: boolean
  duration: number
  showOnIdle: boolean
}

interface BudgetConfig {
  daily?: number      // Daily budget in USD
  weekly?: number     // Weekly budget in USD
  monthly?: number    // Monthly budget in USD
  warnAt: number      // Percentage (0-1) at which to start warning (default: 0.8)
}

interface Config {
  providers: Record<string, ModelPricing>
  models: Record<string, ModelPricing>
  toast: ToastConfig
  budget: BudgetConfig
}

const DEFAULT_CONFIG: Config = {
  providers: {},
  models: {},
  toast: {
    enabled: true,
    duration: 3000,
    showOnIdle: true,
  },
  budget: {
    warnAt: 0.8,
  },
}

// Built-in pricing table (USD per 1M tokens) - Updated 2026-02-05
// Sources:
// - Anthropic: https://www.anthropic.com/pricing#api
// - OpenAI: https://openai.com/api/pricing/
// - DeepSeek: https://api-docs.deepseek.com/quick_start/pricing
// - Google: https://cloud.google.com/vertex-ai/generative-ai/pricing
const BUILTIN_PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude (https://www.anthropic.com/pricing#api)
  // Opus 4.5: $5 input, $25 output, cache write $6.25, cache read $0.50
  "claude-opus-4.5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  // Sonnet 4.5: $3 input, $15 output (≤200K), cache write $3.75, cache read $0.30
  "claude-sonnet-4.5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  // Sonnet 4: $3 input, $15 output
  "claude-sonnet-4": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  // Haiku 4.5: $1 input, $5 output, cache write $1.25, cache read $0.10
  "claude-haiku-4.5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-haiku-4": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // Legacy models
  "claude-opus-4.1": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-opus-4": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-haiku-3": { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 },
  
  // OpenAI GPT (https://openai.com/api/pricing/)
  // GPT-5.2: $1.75 input, $14 output (flagship)
  "gpt-5.2": { input: 1.75, output: 14, cacheRead: 0.175 },
  "gpt-5.2-pro": { input: 21, output: 168 },
  "gpt-5-mini": { input: 0.25, output: 2, cacheRead: 0.025 },
  "gpt-5.1": { input: 2, output: 8 },
  "gpt-5": { input: 5, output: 15 },
  // GPT-4.1 series (fine-tuning prices, base may differ)
  "gpt-4.1": { input: 3, output: 12, cacheRead: 0.75 },
  "gpt-4.1-mini": { input: 0.8, output: 3.2, cacheRead: 0.2 },
  "gpt-4.1-nano": { input: 0.2, output: 0.8, cacheRead: 0.05 },
  // GPT-4o series (may be deprecated)
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  // Reasoning models
  "o3": { input: 10, output: 40 },
  "o3-mini": { input: 1.1, output: 4.4 },
  "o4-mini": { input: 4, output: 16, cacheRead: 1 },
  "o1": { input: 15, output: 60 },
  "o1-mini": { input: 1.1, output: 4.4 },
  
  // DeepSeek (https://api-docs.deepseek.com/quick_start/pricing)
  // DeepSeek-V3.2: unified pricing for both chat and reasoner
  // $0.28 input (cache miss), $0.028 input (cache hit), $0.42 output
  "deepseek-chat": { input: 0.28, output: 0.42, cacheRead: 0.028 },
  "deepseek-reasoner": { input: 0.28, output: 0.42, cacheRead: 0.028 },
  
  // Google Gemini (https://cloud.google.com/vertex-ai/generative-ai/pricing)
  // Gemini 3 Pro Preview: $2 input, $12 output (≤200K)
  "gemini-3-pro": { input: 2, output: 12, cacheRead: 0.2 },
  "gemini-3-pro-preview": { input: 2, output: 12, cacheRead: 0.2 },
  // Gemini 3 Flash Preview: $0.5 input
  "gemini-3-flash": { input: 0.5, output: 2, cacheRead: 0.05 },
  "gemini-3-flash-preview": { input: 0.5, output: 2, cacheRead: 0.05 },
  // Gemini 2.5 Pro: $1.25 input, $10 output (≤200K)
  "gemini-2.5-pro": { input: 1.25, output: 10, cacheRead: 0.125 },
  // Gemini 2.5 Flash Lite: $0.1 input
  "gemini-2.5-flash": { input: 0.1, output: 0.4, cacheRead: 0.01 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4, cacheRead: 0.01 },
  // Gemini 2.0 Flash: $0.15 input
  "gemini-2.0-flash": { input: 0.15, output: 0.6, cacheRead: 0.015 },
  
  // Fallback for unknown models
  "_default": { input: 1, output: 4 },
}

let config: Config = DEFAULT_CONFIG

function loadConfig(): Config {
  try {
    if (existsSync(CONFIG_FILE)) {
      const content = readFileSync(CONFIG_FILE, "utf-8")
      const userConfig = JSON.parse(content) as Partial<Config>
      return {
        providers: { ...DEFAULT_CONFIG.providers, ...userConfig.providers },
        models: { ...DEFAULT_CONFIG.models, ...userConfig.models },
        toast: { ...DEFAULT_CONFIG.toast, ...userConfig.toast },
        budget: { ...DEFAULT_CONFIG.budget, ...userConfig.budget },
      }
    }
  } catch (e) {
    // Config parse error - use defaults
  }
  return DEFAULT_CONFIG
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
  if (config.models[model]) {
    return config.models[model]
  }
  
  // 3. Check built-in exact match
  if (BUILTIN_PRICING[model]) {
    return BUILTIN_PRICING[model]
  }
  
  // 4. Try partial match in user config
  const modelLower = model.toLowerCase()
  for (const [key, pricing] of Object.entries(config.models)) {
    if (modelLower.includes(key.toLowerCase())) {
      return pricing
    }
  }
  
  // 5. Try partial match in built-in pricing
  for (const [key, pricing] of Object.entries(BUILTIN_PRICING)) {
    if (key !== "_default" && modelLower.includes(key.toLowerCase())) {
      return pricing
    }
  }
  
  // 6. Fallback to default
  return BUILTIN_PRICING["_default"]
}

function calculateCost(
  model: string,
  provider: string,
  input: number,
  output: number,
  cacheRead: number = 0,
  cacheWrite: number = 0
): number {
  const pricing = getModelPricing(model, provider)
  
  // Billable input = total input - cache read (cached tokens are charged at cache rate)
  const billableInput = Math.max(0, input - cacheRead)
  
  const inputCost = (billableInput / 1_000_000) * pricing.input
  const outputCost = (output / 1_000_000) * pricing.output
  const cacheReadCost = (cacheRead / 1_000_000) * (pricing.cacheRead ?? pricing.input * 0.1)
  const cacheWriteCost = (cacheWrite / 1_000_000) * (pricing.cacheWrite ?? pricing.input * 1.25)
  
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

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return tokens.toString()
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
// Budget Tracking
// ============================================================================

interface BudgetStatus {
  period: "daily" | "weekly" | "monthly"
  spent: number
  limit: number
  percentage: number
  exceeded: boolean
  warning: boolean
}

function getStartOfDay(date: Date = new Date()): number {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function getStartOfWeek(date: Date = new Date()): number {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday as first day
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function getStartOfMonth(date: Date = new Date()): number {
  const d = new Date(date)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function loadEntriesSince(since: number): Array<{ cost?: number; _ts: number }> {
  if (!existsSync(LOG_FILE)) return []
  
  try {
    const content = readFileSync(LOG_FILE, "utf-8")
    const lines = content.trim().split("\n").filter(Boolean)
    const entries: Array<{ cost?: number; _ts: number }> = []
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        if (entry.type === "tokens" && entry._ts >= since && entry.cost) {
          entries.push(entry)
        }
      } catch {}
    }
    return entries
  } catch {
    return []
  }
}

function calculateSpentSince(since: number): number {
  const entries = loadEntriesSince(since)
  return entries.reduce((sum, e) => sum + (e.cost ?? 0), 0)
}

function checkBudgetStatus(): BudgetStatus | null {
  const budget = config.budget
  if (!budget.daily && !budget.weekly && !budget.monthly) {
    return null
  }
  
  const warnAt = budget.warnAt ?? 0.8
  const now = new Date()
  
  // Check in order: daily -> weekly -> monthly (most restrictive first)
  if (budget.daily) {
    const spent = calculateSpentSince(getStartOfDay(now))
    const percentage = spent / budget.daily
    return {
      period: "daily",
      spent,
      limit: budget.daily,
      percentage,
      exceeded: percentage >= 1,
      warning: percentage >= warnAt && percentage < 1,
    }
  }
  
  if (budget.weekly) {
    const spent = calculateSpentSince(getStartOfWeek(now))
    const percentage = spent / budget.weekly
    return {
      period: "weekly",
      spent,
      limit: budget.weekly,
      percentage,
      exceeded: percentage >= 1,
      warning: percentage >= warnAt && percentage < 1,
    }
  }
  
  if (budget.monthly) {
    const spent = calculateSpentSince(getStartOfMonth(now))
    const percentage = spent / budget.monthly
    return {
      period: "monthly",
      spent,
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
}

export const TokenTrackerPlugin: Plugin = async ({ directory, client }) => {
  // Load config on plugin init
  config = loadConfig()
  
  logJson({ type: "init", directory, configLoaded: existsSync(CONFIG_FILE) })

  return {
    event: async ({ event }) => {
      try {
        // Handle message updates (token tracking)
        if (event.type === "message.updated") {
          const props = event.properties as { info?: MessageInfo } | undefined
          const info = props?.info
          if (!info?.tokens) return

          const messageId = info.id
          const sessionId = info.sessionID
          if (!messageId || !sessionId) return

          const input = info.tokens.input ?? 0
          const output = info.tokens.output ?? 0
          const reasoning = info.tokens.reasoning ?? 0
          const cacheRead = info.tokens.cache?.read ?? 0
          const cacheWrite = info.tokens.cache?.write ?? 0

          const hasTokens = input > 0 || output > 0
          if (!hasTokens) return

          const dedupeKey = `${messageId}-${input}-${output}`
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
}

export default TokenTrackerPlugin
