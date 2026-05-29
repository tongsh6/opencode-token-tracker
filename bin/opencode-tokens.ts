#!/usr/bin/env node

import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { TrackerConfig } from "../lib/shared.js"
import { BUILTIN_PRICING, DEFAULT_CONFIG, formatCost, formatTokens, getStartOfDay, getStartOfMonth, getStartOfWeek, validateConfig, BUILTIN_PRICING_META, resolvePricingStatus, round2 } from "../lib/shared.js"

const CONFIG_DIR = join(homedir(), ".config", "opencode")
const CONFIG_FILE = join(CONFIG_DIR, "token-tracker.json")
const LOG_FILE = join(CONFIG_DIR, "logs", "token-tracker", "tokens.jsonl")

// ============================================================================
// Types
// ============================================================================

interface TokenEntry {
  type: string
  sessionId?: string
  messageId?: string
  role?: string
  agent?: string
  model?: string
  provider?: string
  input?: number
  output?: number
  reasoning?: number
  cacheRead?: number
  cacheWrite?: number
  cost?: number
  _ts: number
}

interface Stats {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cost: number
  count: number
}

// ============================================================================
// Helpers
// ============================================================================

function padRight(str: string, len: number): string {
  return str.length >= len ? str : `${str}${" ".repeat(len - str.length)}`
}

function padLeft(str: string, len: number): string {
  return str.length >= len ? str : `${" ".repeat(len - str.length)}${str}`
}

function truncateSessionId(sessionId?: string): string {
  if (!sessionId) return "unknown"
  return sessionId.length > 16 ? `${sessionId.slice(0, 14)}…` : sessionId
}

// ============================================================================
// Argument Parser
// ============================================================================

interface ParsedArgs {
  command: string
  flags: Map<string, string | boolean>
  positional: string[]
}

function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = []
  const flags = new Map<string, string | boolean>()
  let i = 0

  while (i < args.length) {
    const arg = args[i]

    if (arg === "--help" || arg === "-h") {
      flags.set("help", true)
      i++
      continue
    }

    if (arg.startsWith("--")) {
      const eqIndex = arg.indexOf("=")
      if (eqIndex !== -1) {
        flags.set(arg.slice(2, eqIndex), arg.slice(eqIndex + 1))
      } else {
        const next = args[i + 1]
        if (next && !next.startsWith("-")) {
          flags.set(arg.slice(2), next)
          i++
        } else {
          flags.set(arg.slice(2), true)
        }
      }
      i++
      continue
    }

    if (arg.startsWith("-") && arg.length === 2 && arg !== "--") {
      const next = args[i + 1]
      if (next && !next.startsWith("-")) {
        flags.set(arg.slice(1), next)
        i++
      } else {
        flags.set(arg.slice(1), true)
      }
      i++
      continue
    }

    positional.push(arg)
    i++
  }

  return { command: positional[0] || "", flags, positional }
}

function flagValue(flags: Map<string, string | boolean>, name: string): string | undefined {
  const v = flags.get(name)
  return typeof v === "string" ? v : undefined
}

// ============================================================================
// Data Loading
// ============================================================================

function loadEntries(since?: number): TokenEntry[] {
  if (!existsSync(LOG_FILE)) {
    return []
  }

  const entries: TokenEntry[] = []
  const fd = openSync(LOG_FILE, "r")
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
        const entry = JSON.parse(line) as TokenEntry
        if (entry.type !== "tokens") continue

        // Early break pruning: once we hit a record older than the threshold,
        // we can safely stop reading earlier history thanks to monotonic time progression in JSONL.
        if (since && entry._ts < since) {
          shouldStop = true
          break
        }

        if (!entry.input && !entry.output) continue
        entries.push(entry)
      } catch {
        // Skip malformed lines
      }
    }
  }

  // Include the very first line at the top
  if (!shouldStop && leftover.trim()) {
    try {
      const entry = JSON.parse(leftover.trim()) as TokenEntry
      if (entry.type === "tokens" && (!since || entry._ts >= since) && (entry.input || entry.output)) {
        entries.push(entry)
      }
    } catch {
      // Ignore
    }
  }

  closeSync(fd)

  // Re-establish original chronological order
  return entries.reverse()
}

function loadConfig(): TrackerConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      const raw = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"))
      const result = validateConfig(raw)
      if (result.warnings.length > 0) {
        for (const w of result.warnings) {
          console.error(`  [token-tracker] config warning: ${w}`)
        }
      }
      return result.config
    }
  } catch {
    console.error("  [token-tracker] config warning: Config file is not valid JSON, using defaults")
  }
  return DEFAULT_CONFIG
}

// ============================================================================
// Stats Aggregation
// ============================================================================

function createEmptyStats(): Stats {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, count: 0 }
}

function aggregateStats(entries: TokenEntry[]): Stats {
  const stats = createEmptyStats()
  for (const e of entries) {
    stats.input += e.input ?? 0
    stats.output += e.output ?? 0
    stats.reasoning += e.reasoning ?? 0
    stats.cacheRead += e.cacheRead ?? 0
    stats.cacheWrite += e.cacheWrite ?? 0
    stats.cost += e.cost ?? 0
    stats.count += 1
  }
  return stats
}

function groupBy<K extends string>(entries: TokenEntry[], keyFn: (e: TokenEntry) => K): Map<K, Stats> {
  const groups = new Map<K, Stats>()
  for (const e of entries) {
    const key = keyFn(e)
    let stats = groups.get(key)
    if (!stats) {
      stats = createEmptyStats()
      groups.set(key, stats)
    }
    stats.input += e.input ?? 0
    stats.output += e.output ?? 0
    stats.reasoning += e.reasoning ?? 0
    stats.cacheRead += e.cacheRead ?? 0
    stats.cacheWrite += e.cacheWrite ?? 0
    stats.cost += e.cost ?? 0
    stats.count += 1
  }
  return groups
}

// ============================================================================
// Display
// ============================================================================

function printSummary(title: string, stats: Stats) {
  const totalTokens = stats.input + stats.output
  console.log()
  console.log(`  ${title}`)
  console.log(`  ${"─".repeat(50)}`)
  console.log(`  Total Tokens:    ${padLeft(formatTokens(totalTokens, 2), 12)}`)
  console.log(`    Input:         ${padLeft(formatTokens(stats.input, 2), 12)}`)
  console.log(`    Output:        ${padLeft(formatTokens(stats.output, 2), 12)}`)
  if (stats.reasoning > 0) {
    console.log(`    Reasoning:     ${padLeft(formatTokens(stats.reasoning, 2), 12)}`)
  }
  console.log(`  Cache Read:      ${padLeft(formatTokens(stats.cacheRead, 2), 12)}`)
  console.log(`  Total Cost:      ${padLeft(formatCost(stats.cost), 12)}`)
  console.log(`  Messages:        ${padLeft(stats.count.toString(), 12)}`)
  console.log()
}

function printTable(title: string, groups: Map<string, Stats>, labelHeader: string) {
  const sorted = Array.from(groups.entries()).sort((a, b) => b[1].cost - a[1].cost)

  if (sorted.length === 0) {
    console.log(`\n  No data for ${title}\n`)
    return
  }

  const labelWidth = Math.max(labelHeader.length, ...sorted.map(([k]) => k.length))
  const tokensWidth = 10
  const costWidth = 10
  const countWidth = 6

  console.log()
  console.log(`  ${title}`)
  console.log(`  ${"─".repeat(labelWidth + tokensWidth + costWidth + countWidth + 12)}`)
  console.log(
    `  ${padRight(labelHeader, labelWidth)}  ${padLeft("Tokens", tokensWidth)}  ${padLeft("Cost", costWidth)}  ${padLeft("Msgs", countWidth)}`
  )
  console.log(
    `  ${"-".repeat(labelWidth)}  ${"-".repeat(tokensWidth)}  ${"-".repeat(costWidth)}  ${"-".repeat(countWidth)}`
  )

  for (const [label, stats] of sorted) {
    const totalTokens = stats.input + stats.output
    console.log(
      `  ${padRight(label, labelWidth)}  ${padLeft(formatTokens(totalTokens, 2), tokensWidth)}  ${padLeft(formatCost(stats.cost), costWidth)}  ${padLeft(stats.count.toString(), countWidth)}`
    )
  }
  console.log()
}

function printDailyBreakdown(entries: TokenEntry[]) {
  const byDay = groupBy(entries, (e) => {
    const date = new Date(e._ts)
    return date.toISOString().slice(0, 10)
  })

  const sorted = Array.from(byDay.entries()).sort((a, b) => b[0].localeCompare(a[0]))

  if (sorted.length === 0) {
    console.log("\n  No data\n")
    return
  }

  const dateWidth = 12
  const tokensWidth = 10
  const costWidth = 10
  const countWidth = 6

  console.log()
  console.log(`  Daily Breakdown`)
  console.log(`  ${"─".repeat(dateWidth + tokensWidth + costWidth + countWidth + 12)}`)
  console.log(
    `  ${padRight("Date", dateWidth)}  ${padLeft("Tokens", tokensWidth)}  ${padLeft("Cost", costWidth)}  ${padLeft("Msgs", countWidth)}`
  )
  console.log(
    `  ${"-".repeat(dateWidth)}  ${"-".repeat(tokensWidth)}  ${"-".repeat(costWidth)}  ${"-".repeat(countWidth)}`
  )

  for (const [date, stats] of sorted) {
    const totalTokens = stats.input + stats.output
    console.log(
      `  ${padRight(date, dateWidth)}  ${padLeft(formatTokens(totalTokens, 2), tokensWidth)}  ${padLeft(formatCost(stats.cost), costWidth)}  ${padLeft(stats.count.toString(), countWidth)}`
    )
  }
  console.log()
}

// ============================================================================
// Commands
// ============================================================================

function cmdStats(period: string, breakdown?: string) {
  const now = new Date()
  let since: number | undefined
  let title: string

  switch (period) {
    case "today":
      since = getStartOfDay(now)
      title = "Today's Usage"
      break
    case "week":
      since = getStartOfWeek(now)
      title = "This Week's Usage"
      break
    case "month":
      since = getStartOfMonth(now)
      title = "This Month's Usage"
      break
    default:
      since = undefined
      title = "All-Time Usage"
      break
  }

  const entries = loadEntries(since)

  if (entries.length === 0) {
    console.log(`\n  No data for ${title.toLowerCase()}\n`)
    return
  }

  const total = aggregateStats(entries)
  printSummary(title, total)

  switch (breakdown) {
    case "model":
      printTable("By Model", groupBy(entries, (e) => e.model ?? "unknown"), "Model")
      break
    case "agent":
      printTable("By Agent", groupBy(entries, (e) => e.agent ?? "unknown"), "Agent")
      break
    case "provider":
      printTable("By Provider", groupBy(entries, (e) => e.provider ?? "unknown"), "Provider")
      break
    case "day":
    case "daily":
      printDailyBreakdown(entries)
      break
    case "session":
      printTable("By Session", groupBy(entries, (e) => truncateSessionId(e.sessionId)), "Session")
      break
    case "all":
      printTable("By Model", groupBy(entries, (e) => e.model ?? "unknown"), "Model")
      printTable("By Agent", groupBy(entries, (e) => e.agent ?? "unknown"), "Agent")
      printTable("By Provider", groupBy(entries, (e) => e.provider ?? "unknown"), "Provider")
      break
  }
}

function cmdPricing() {
  const config = loadConfig()
  
  console.log(`
  Built-in Pricing Table (USD per 1M tokens)
  ══════════════════════════════════════════════════════════════════
  Pricing last updated:  ${BUILTIN_PRICING_META.pricingLastUpdated}
  Metadata last updated: ${BUILTIN_PRICING_META.metadataLastUpdated}
  Source:                ${BUILTIN_PRICING_META.source}
`)
  
  // Group by provider
  const groups: Record<string, string[]> = {
    "Anthropic Claude": ["claude-opus-4.8", "claude-opus-4.7", "claude-opus-4.6", "claude-opus-4.5", "claude-sonnet-4.6", "claude-sonnet-4.5", "claude-sonnet-4", "claude-haiku-4.5", "claude-haiku-4", "claude-opus-4.1", "claude-opus-4", "claude-haiku-3"],
    "OpenAI": ["gpt-5.5", "gpt-5.5-pro", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.4-pro", "gpt-5.3-codex", "gpt-5.3-chat-latest", "gpt-5.2", "gpt-5.2-pro", "gpt-5-mini", "gpt-5-nano", "gpt-5.1", "gpt-5.1-chat-latest", "gpt-5.1-codex-max", "gpt-5.1-codex", "gpt-5.1-codex-mini", "gpt-5", "gpt-5-chat-latest", "gpt-5-codex", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "o3", "o3-mini", "o4-mini", "o1", "o1-mini"],
    "DeepSeek": ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-pro"],
    "Google Gemini": ["gemini-3.1-pro-preview", "gemini-3-pro", "gemini-3-pro-preview", "gemini-3.5-flash", "gemini-3-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-2.0-flash-lite"],
  }
  
  const modelWidth = 24
  const priceWidth = 10
  
  for (const [group, models] of Object.entries(groups)) {
    console.log(`  ${group}`)
    console.log(`  ${"-".repeat(modelWidth + priceWidth * 4 + 12)}`)
    console.log(`  ${padRight("Model", modelWidth)}  ${padLeft("Input", priceWidth)}  ${padLeft("Output", priceWidth)}  ${padLeft("CacheRd", priceWidth)}  ${padLeft("CacheWr", priceWidth)}`)
    
    for (const model of models) {
      const p = BUILTIN_PRICING[model]
      if (!p) continue
      const overridden = config.models[model] ? " *" : ""
      console.log(
        `  ${padRight(`${model}${overridden}`, modelWidth)}  ${padLeft(`$${p.input.toString()}`, priceWidth)}  ${padLeft(`$${p.output.toString()}`, priceWidth)}  ${padLeft(p.cacheRead ? `$${p.cacheRead.toString()}` : "-", priceWidth)}  ${padLeft(p.cacheWrite ? `$${p.cacheWrite.toString()}` : "-", priceWidth)}`
      )
    }
    console.log()
  }
  
  console.log(`  Default (unknown models)`)
  console.log(`  ${"-".repeat(modelWidth + priceWidth * 4 + 12)}`)
  const def = BUILTIN_PRICING._default
  console.log(`  ${padRight("_default", modelWidth)}  ${padLeft(`$${def.input.toString()}`, priceWidth)}  ${padLeft(`$${def.output.toString()}`, priceWidth)}  ${padLeft("-", priceWidth)}  ${padLeft("-", priceWidth)}`)
  console.log()
  
  if (Object.keys(config.models || {}).length > 0) {
    console.log(`  * = overridden in config`)
  }

  console.log(`  Fallback Pricing Notice:`)
  console.log(`    When a model is not matched in the built-in pricing table or user configuration,`)
  console.log(`    it falls back to the default rate ($1.0 / $4.0 per 1M tokens).`)
  console.log(`    You can easily override it in your configuration.`)
  console.log(`    ${BUILTIN_PRICING_META.notes}`)
  console.log()
}

function cmdModels() {
  const entries = loadEntries()
  
  if (entries.length === 0) {
    console.log(`\n  No usage data found. Start using OpenCode to collect data.\n`)
    return
  }
  
  // Get unique model+provider combinations
  const modelProviders = new Map<string, { provider: string; count: number; lastUsed: number }>()
  
  for (const e of entries) {
    const model = e.model ?? "unknown"
    const provider = e.provider ?? "unknown"
    const key = `${model}|${provider}`
    
    let info = modelProviders.get(key)
    if (!info) {
      info = { provider, count: 0, lastUsed: 0 }
      modelProviders.set(key, info)
    }
    info.count++
    info.lastUsed = Math.max(info.lastUsed, e._ts)
  }
  
  // Sort by last used
  const sorted = Array.from(modelProviders.entries())
    .map(([key, info]) => ({ model: key.split("|")[0], ...info }))
    .sort((a, b) => b.lastUsed - a.lastUsed)
  
  const config = loadConfig()
  
  console.log(`
  Your Used Models
  ══════════════════════════════════════════════════════════════════
`)
  
  const modelWidth = 24
  const providerWidth = 16
  const countWidth = 8
  const statusWidth = 12
  
  console.log(`  ${padRight("Model", modelWidth)}  ${padRight("Provider", providerWidth)}  ${padLeft("Msgs", countWidth)}  ${padRight("Pricing", statusWidth)}`)
  console.log(`  ${"-".repeat(modelWidth)}  ${"-".repeat(providerWidth)}  ${"-".repeat(countWidth)}  ${"-".repeat(statusWidth)}`)
  
  for (const { model, provider, count } of sorted) {
    const status = resolvePricingStatus(config, model, provider)
    console.log(`  ${padRight(model, modelWidth)}  ${padRight(provider, providerWidth)}  ${padLeft(count.toString(), countWidth)}  ${padRight(status, statusWidth)}`)
  }
  
  console.log()
  console.log(`  Pricing status:`)
  console.log(`    built-in     = using built-in pricing table`)
  console.log(`    provider cfg = overridden by providers config`)
  console.log(`    model cfg    = overridden by models config`)
  console.log(`    default      = unknown model, using $1/$4 per 1M tokens`)
  console.log()
}

function cmdConfig(positional: string[]) {
  const action = positional[1]
  const config = loadConfig()
  const entries = loadEntries()
  
  if (action === "init" || action === "generate") {
    // Get unique providers and model+provider combinations from logs
    const providers = new Set<string>()
    const modelProviders = new Set<string>()
    
    for (const e of entries) {
      if (e.provider) providers.add(e.provider)
      const model = e.model ?? "unknown"
      const provider = e.provider ?? "unknown"
      modelProviders.add(`${model}|${provider}`)
    }
    
    // Estimate daily avg from last 7 days
    const now = Date.now()
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000
    const recentEntries = entries.filter(e => e._ts >= sevenDaysAgo)
    const totalSpent = recentEntries.reduce((sum, e) => sum + (e.cost ?? 0), 0)
    const dailyAvg = totalSpent / 7

    const dailyLimit = dailyAvg > 0 ? Math.max(0.5, round2(dailyAvg * 1.5)) : 5
    const weeklyLimit = dailyAvg > 0 ? Math.max(0.5, round2(dailyAvg * 7 * 1.3)) : 25
    const monthlyLimit = dailyAvg > 0 ? Math.max(0.5, round2(dailyAvg * 30 * 1.2)) : 100

    const exampleConfig: TrackerConfig = {
      providers: {},
      models: {},
      toast: {
        enabled: true,
        duration: 3000,
        showOnIdle: true,
      },
      budget: {
        daily: dailyLimit,
        weekly: weeklyLimit,
        monthly: monthlyLimit,
        warnAt: 0.8,
      },
    }
    
    const suggestedProviders: string[] = []
    // Add providers as comments/examples (Common free providers)
    for (const provider of providers) {
      const pLower = provider.toLowerCase()
      if (pLower.includes("copilot") || pLower.includes("cursor") || pLower.includes("free")) {
        exampleConfig.providers[provider] = { input: 0, output: 0 }
        suggestedProviders.push(provider)
      }
    }
    
    const suggestedModels: string[] = []
    // Add unknown/fallback models where status is "default"
    for (const mp of modelProviders) {
      const [model, provider] = mp.split("|")
      if (model === "unknown" || provider === "unknown") continue
      const status = resolvePricingStatus(config, model, provider)
      if (status === "default") {
        exampleConfig.models[model] = { input: 1, output: 4 }
        suggestedModels.push(`${model} (${provider})`)
      }
    }
    
    // Construct Dynamic Usage-Aware Suggestions Summary
    let suggestionsSummary = `
  📢 Usage-Aware Suggestions Summary
  ══════════════════════════════════════════════════════════════════
  - Analyzed timeframe: Last 7 days
  - Found ${entries.length} historical usage entries in total.
  - Calculated 7-day average daily cost: $${round2(dailyAvg).toFixed(4)}
`

    if (dailyAvg > 0) {
      suggestionsSummary += `
  Recommended Budget Limits (derived from daily avg $${round2(dailyAvg).toFixed(4)}):
    - Daily Limit   : $${dailyLimit.toFixed(2)} (Avg * 1.5 buffer, clamped min $0.50)
    - Weekly Limit  : $${weeklyLimit.toFixed(2)} (Avg * 7 * 1.3 buffer, clamped min $0.50)
    - Monthly Limit : $${monthlyLimit.toFixed(2)} (Avg * 30 * 1.2 buffer, clamped min $0.50)
`
    } else {
      suggestionsSummary += `
  No active usage logs detected in the last 7 days.
  - Applying fallback default budgets: Daily $5.00, Weekly $25.00, Monthly $100.00.
`
    }

    if (suggestedProviders.length > 0) {
      suggestionsSummary += `
  Detected zero-cost/subscription providers:
`
      for (const p of suggestedProviders) {
        suggestionsSummary += `    • ${p} (automatically pre-configured to $0.00)\n`
      }
    }

    if (suggestedModels.length > 0) {
      suggestionsSummary += `
  Detected unrecognized fallback models:
`
      for (const m of suggestedModels) {
        suggestionsSummary += `    • ${m} (automatically pre-configured with fallback $1/$4 rate)\n`
      }
    }
    
    suggestionsSummary += `  ────────────────────────────────────────────────────────────────\n`

    // Print explanation first to stderr
    const guideText = `
  Configuration Guide
  ══════════════════════════════════════════════════════════════════

  PRICING (prices in USD per 1 MILLION tokens)
  ────────────────────────────────────────────────────────────────
  Fields:
    input      Cost for input/prompt tokens sent to the model
    output     Cost for output/completion tokens from the model
    cacheRead  Cost for cached input tokens (optional, usually cheaper)
    cacheWrite Cost for cache write tokens (optional)

  Examples:
    { "input": 15, "output": 75 }     = $15 per 1M input, $75 per 1M output
    { "input": 0, "output": 0 }       = Free (subscription or local model)

  Common scenarios:
    - GitHub Copilot, Cursor, etc.   → Set provider to { input: 0, output: 0 }
    - Local/self-hosted models       → Set to 0
    - Direct API usage               → Look up provider's pricing page

  Where to find pricing:
    - Anthropic: https://www.anthropic.com/pricing
    - OpenAI:    https://openai.com/pricing
    - DeepSeek:  https://platform.deepseek.com/api-docs/pricing
    - Google:    https://ai.google.dev/pricing
    - Or run:    opencode-tokens pricing

  BUDGET CONTROL
  ────────────────────────────────────────────────────────────────
  Set spending limits to avoid unexpected costs:
    daily      Maximum spend per day (USD)
    weekly     Maximum spend per week (USD)
    monthly    Maximum spend per month (USD)
    warnAt     Warning threshold (0-1), default 0.8 = 80%

  When budget is exceeded, you'll see a warning toast.
  Check status anytime with: opencode-tokens budget

  ────────────────────────────────────────────────────────────────
  Example config based on your usage:
`
    process.stderr.write(suggestionsSummary + "\n")
    process.stderr.write(guideText + "\n")
    
    if (action === "init") {
      // Print clean config to stdout ONLY on init
      process.stdout.write(JSON.stringify(exampleConfig, null, 2) + "\n")
      process.stderr.write(`
  To create this config file, run:
    opencode-tokens config generate
  
  Or manually create: ${CONFIG_FILE}
\n`)
    } else if (action === "generate") {
      // Generate has completely empty stdout! Writes to config file, alerts to stderr
      saveConfig(exampleConfig)
      process.stderr.write(`
  Config file created: ${CONFIG_FILE}
\n`)
    }
    return
  }

  if (action === "get") {
    const key = positional[2]
    if (!key) { console.log("\n  Usage: opencode-tokens config get <key>\n"); return }
    if (!SETTABLE_KEYS[key]) {
      console.log(`\n  Unknown key: ${key}\n  Available: ${Object.keys(SETTABLE_KEYS).join(", ")}\n`)
      return
    }
    const value = resolveConfigKey(config, key)
    console.log(`\n  ${key} = ${JSON.stringify(value)} (default: ${JSON.stringify(SETTABLE_KEYS[key].default)})\n`)
    return
  }

  if (action === "set") {
    const key = positional[2]
    const rawValue = positional[3]
    if (!key || !rawValue) { console.log("\n  Usage: opencode-tokens config set <key> <value>\n"); return }
    const spec = SETTABLE_KEYS[key]
    if (!spec) { console.log(`\n  Unknown key: ${key}\n  Available: ${Object.keys(SETTABLE_KEYS).join(", ")}\n`); return }
    const value = parseConfigValue(rawValue)
    if (typeof value !== spec.type) {
      console.log(`\n  Invalid type: expected ${spec.type}, got ${typeof value}\n`)
      return
    }
    if (typeof value === "number") {
      if (value < 0) { console.log(`\n  Value must be >= 0\n`); return }
      if (spec.max !== undefined && value > spec.max) { console.log(`\n  Value must be <= ${spec.max}\n`); return }
    }
    applyConfigSet(key, value)
    console.log(`\n  Set ${key} = ${JSON.stringify(value)}\n`)
    return
  }

  if (action === "unset") {
    const key = positional[2]
    if (!key) { console.log("\n  Usage: opencode-tokens config unset <key>\n"); return }
    const spec = SETTABLE_KEYS[key]
    if (!spec) { console.log(`\n  Unknown key: ${key}\n  Available: ${Object.keys(SETTABLE_KEYS).join(", ")}\n`); return }
    applyConfigUnset(key)
    console.log(`\n  Unset ${key} (reverted to default)\n`)
    return
  }

  if (action && action !== "show") {
    console.log(`\n  Unknown config action: ${action}`)
    console.log(`  Usage: opencode-tokens config [show|init|generate|get|set|unset]\n`)
    return
  }

  // Show current config
  console.log(`
  Current Configuration
  ══════════════════════════════════════════════════════════════════
  
  Config file: ${CONFIG_FILE}
  Status: ${existsSync(CONFIG_FILE) ? "exists" : "not found (using defaults)"}
`)

  if (existsSync(CONFIG_FILE)) {
    console.log(`  Contents:`)
    console.log(`  ${"-".repeat(60)}`)
    console.log(JSON.stringify(config, null, 2).split("\n").map(l => `  ${l}`).join("\n"))
    console.log()
  }

  console.log(`  Commands:`)
  console.log(`    opencode-tokens config show              Show current config`)
  console.log(`    opencode-tokens config init              Show example config with explanation`)
  console.log(`    opencode-tokens config generate          Create config file`)
  console.log(`    opencode-tokens config get <key>         Get a config value`)
  console.log(`    opencode-tokens config set <key> <value> Set a config value`)
  console.log(`    opencode-tokens config unset <key>       Reset a config value to default`)
  console.log()
}

// ============================================================================
// Config Helpers
// ============================================================================

interface SettableKeySpec {
  type: "number" | "boolean"
  path: string[]
  default: unknown
  max?: number
}

const SETTABLE_KEYS: Record<string, SettableKeySpec> = {
  "budget.daily":     { type: "number",  path: ["budget", "daily"],     default: undefined },
  "budget.weekly":    { type: "number",  path: ["budget", "weekly"],    default: undefined },
  "budget.monthly":   { type: "number",  path: ["budget", "monthly"],   default: undefined },
  "budget.warnAt":    { type: "number",  path: ["budget", "warnAt"],    default: 0.8, max: 1 },
  "toast.enabled":    { type: "boolean", path: ["toast", "enabled"],    default: true },
  "toast.duration":   { type: "number",  path: ["toast", "duration"],   default: 3000 },
  "toast.showOnIdle": { type: "boolean", path: ["toast", "showOnIdle"], default: true },
}

function parseConfigValue(s: string): unknown {
  if (s === "true") return true
  if (s === "false") return false
  if (s === "null") return null
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  return s
}

function resolveConfigKey(config: TrackerConfig, key: string): unknown {
  const spec = SETTABLE_KEYS[key]
  if (!spec) return undefined
  let obj: Record<string, unknown> = config as unknown as Record<string, unknown>
  for (let i = 0; i < spec.path.length - 1; i++) {
    obj = obj[spec.path[i]] as Record<string, unknown>
    if (!obj) return spec.default
  }
  return obj[spec.path[spec.path.length - 1]] ?? spec.default
}

function applyConfigSet(key: string, value: unknown): void {
  const spec = SETTABLE_KEYS[key]
  const fullConfig = loadOrInitConfig()
  let obj: Record<string, unknown> = fullConfig as unknown as Record<string, unknown>
  for (let i = 0; i < spec.path.length - 1; i++) {
    if (!obj[spec.path[i]]) obj[spec.path[i]] = {}
    obj = obj[spec.path[i]] as Record<string, unknown>
  }
  obj[spec.path[spec.path.length - 1]] = value
  saveConfig(fullConfig)
}

function applyConfigUnset(key: string): void {
  const spec = SETTABLE_KEYS[key]
  const fullConfig = loadOrInitConfig()
  let obj: Record<string, unknown> = fullConfig as unknown as Record<string, unknown>
  for (let i = 0; i < spec.path.length - 1; i++) {
    if (!obj[spec.path[i]]) return
    obj = obj[spec.path[i]] as Record<string, unknown>
  }
  delete obj[spec.path[spec.path.length - 1]]
  saveConfig(fullConfig)
}

function loadOrInitConfig(): Record<string, unknown> {
  if (existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"))
    } catch {}
  }
  return {}
}

function saveConfig(raw: TrackerConfig | Record<string, unknown>): void {
  const dir = join(homedir(), ".config", "opencode")
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  if (existsSync(CONFIG_FILE)) {
    copyFileSync(CONFIG_FILE, `${CONFIG_FILE}.bak`)
  }
  writeFileSync(CONFIG_FILE, `${JSON.stringify(raw, null, 2)}\n`)
}

// ============================================================================
// Export
// ============================================================================

function cmdExport(flags: Map<string, string | boolean>) {
  const format = flagValue(flags, "format") || "csv"
  const period = flagValue(flags, "period") || "all"
  const outputFile = flagValue(flags, "output")

  const now = new Date()
  let since: number | undefined
  switch (period) {
    case "today": since = getStartOfDay(now); break
    case "week":  since = getStartOfWeek(now); break
    case "month": since = getStartOfMonth(now); break
  }

  const entries = loadEntries(since)

  if (entries.length === 0) {
    console.log(`\n  No data to export for ${period}\n`)
    return
  }

  let output: string
  if (format === "json") {
    output = JSON.stringify(entries, null, 2)
  } else {
    const headers = ["timestamp", "date", "session_id", "message_id", "role", "agent", "model", "provider", "input", "output", "reasoning", "cache_read", "cache_write", "cost"]
    const rows = entries.map(e => [
      e._ts,
      new Date(e._ts).toISOString().slice(0, 10),
      e.sessionId ?? "",
      e.messageId ?? "",
      e.role ?? "",
      e.agent ?? "",
      e.model ?? "",
      e.provider ?? "",
      e.input ?? 0,
      e.output ?? 0,
      e.reasoning ?? 0,
      e.cacheRead ?? 0,
      e.cacheWrite ?? 0,
      e.cost ?? 0,
    ].map(csvEscape).join(","))
    output = `${[headers.join(","), ...rows].join("\n")}\n`
  }

  if (outputFile) {
    writeFileSync(outputFile, output)
    console.log(`\n  Exported ${entries.length} entries to ${outputFile}\n`)
  } else {
    process.stdout.write(output)
  }
}

function csvEscape(v: unknown): string {
  if (v == null) return ""
  const s = String(v)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function cmdBudget() {
  const config = loadConfig()
  const budget = config.budget
  
  if (!budget?.daily && !budget?.weekly && !budget?.monthly) {
    console.log(`
  Budget Status
  ══════════════════════════════════════════════════════════════════

  No budget configured.

  To set a budget, add to your config file (${CONFIG_FILE}):

  {
    "budget": {
      "daily": 5,       // $5 per day
      "weekly": 25,     // $25 per week (optional)
      "monthly": 100,   // $100 per month (optional)
      "warnAt": 0.8     // Warn at 80% usage
    }
  }

  Run: opencode-tokens config init  for more details.

  Costs are estimates from local logs; budgets are warnings, not enforcement.
`)
    return
  }
  
  const now = new Date()
  const warnAt = budget.warnAt ?? 0.8
  
  console.log(`
  Budget Status
  ══════════════════════════════════════════════════════════════════
`)
  
  // Helper to create progress bar
  const progressBar = (pct: number, width: number = 20): string => {
    const filled = Math.min(Math.round(pct * width), width)
    const empty = width - filled
    const bar = "█".repeat(filled) + "░".repeat(empty)
    return bar
  }
  
  // Helper to get color indicator
  const statusIndicator = (pct: number): string => {
    if (pct >= 1) return "🔴"
    if (pct >= warnAt) return "🟡"
    return "🟢"
  }
  
  // Calculate the earliest period start to minimize data loaded
  const dayStart = getStartOfDay(now)
  const weekStart = getStartOfWeek(now)
  const monthStart = getStartOfMonth(now)
  const earliestSince = Math.min(
    budget.daily ? dayStart : Infinity,
    budget.weekly ? weekStart : Infinity,
    budget.monthly ? monthStart : Infinity,
  )
  const entries = loadEntries(earliestSince)
  
  // Daily budget
  if (budget.daily) {
    const dayEntries = entries.filter(e => e._ts >= dayStart)
    const spent = dayEntries.reduce((sum, e) => sum + (e.cost ?? 0), 0)
    const pct = spent / budget.daily
    const pctDisplay = Math.round(pct * 100)
    
    console.log(`  ${statusIndicator(pct)} Daily`)
    console.log(`    ${formatCost(spent)} / ${formatCost(budget.daily)}  [${progressBar(pct)}] ${pctDisplay}%`)
    console.log(`    Remaining: ${formatCost(Math.max(0, budget.daily - spent))}`)
    console.log()
  }
  
  // Weekly budget
  if (budget.weekly) {
    const weekEntries = entries.filter(e => e._ts >= weekStart)
    const spent = weekEntries.reduce((sum, e) => sum + (e.cost ?? 0), 0)
    const pct = spent / budget.weekly
    const pctDisplay = Math.round(pct * 100)
    
    console.log(`  ${statusIndicator(pct)} Weekly`)
    console.log(`    ${formatCost(spent)} / ${formatCost(budget.weekly)}  [${progressBar(pct)}] ${pctDisplay}%`)
    console.log(`    Remaining: ${formatCost(Math.max(0, budget.weekly - spent))}`)
    console.log()
  }
  
  // Monthly budget
  if (budget.monthly) {
    const monthEntries = entries.filter(e => e._ts >= monthStart)
    const spent = monthEntries.reduce((sum, e) => sum + (e.cost ?? 0), 0)
    const pct = spent / budget.monthly
    const pctDisplay = Math.round(pct * 100)
    
    console.log(`  ${statusIndicator(pct)} Monthly`)
    console.log(`    ${formatCost(spent)} / ${formatCost(budget.monthly)}  [${progressBar(pct)}] ${pctDisplay}%`)
    console.log(`    Remaining: ${formatCost(Math.max(0, budget.monthly - spent))}`)
    console.log()
  }
  
  console.log(`  Legend: 🟢 OK  🟡 Warning (>${Math.round(warnAt * 100)}%)  🔴 Exceeded`)
  console.log(`  Costs are estimates from local logs; budgets are warnings, not enforcement.`)
  console.log()
}

function cmdHelp() {
  console.log(`
  opencode-tokens - Token usage statistics CLI

  Usage:
    opencode-tokens [command] [options]

  Commands:
    (default)     Show usage statistics
    budget        Show budget status (daily/weekly/monthly)
    pricing       Show built-in pricing table
    models        Show your used models and their pricing status
    config        Show/generate/modify configuration
    export        Export token data to CSV/JSON
    trend         Show daily cost/tokens trend chart

  Statistics Options:
    today         Show today's usage
    week          Show this week's usage
    month         Show this month's usage
    all           Show all-time usage (default)

    --by <type>   Group by: model, agent, provider, session, daily, all

  Export Options:
    --format      csv (default) or json
    --period      today, week, month, all (default)
    --output      Write to file instead of stdout

  Trend Options:
    --days N      Number of days to chart (default 30)
    --metric      cost (default), tokens, or messages
    --width W     Chart width in characters (default 60)

  Config Sub-commands:
    config show                  Show current config
    config init                  Show example config with explanation
    config generate              Create config file
    config get <key>             Get a config value
    config set <key> <value>     Set a config value
    config unset <key>           Reset a config value to default

  Settable config keys:
    budget.daily, budget.weekly, budget.monthly, budget.warnAt
    toast.enabled, toast.duration, toast.showOnIdle

  Examples:
    opencode-tokens                       # All-time summary
    opencode-tokens today --by model      # Today by model
    opencode-tokens week --by session     # This week by session
    opencode-tokens trend --days 7        # 7-day cost trend
    opencode-tokens export --format csv   # Export all data as CSV
    opencode-tokens config set budget.daily 10  # Set daily budget to $10
    opencode-tokens config get toast.enabled   # Check if toast is enabled

  Costs are estimates from local logs; budgets are warnings, not enforcement.
`)
}

// ============================================================================
// Trend
// ============================================================================

interface TrendPoint {
  cost: number
  tokens: number
  messages: number
}

interface ChartPoint {
  x: number
  y: number
}

function getTrendValue(point: TrendPoint, metric: string): number {
  return metric === "tokens" ? point.tokens : metric === "messages" ? point.messages : point.cost
}

function formatTrendValue(value: number, metric: string): string {
  return metric === "tokens" ? formatTokens(value) : metric === "messages" ? String(Math.round(value)) : formatCost(value)
}

function formatSignedTrendValue(value: number, metric: string): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : ""
  return `${sign}${formatTrendValue(Math.abs(value), metric)}`
}

function metricLabel(metric: string): string {
  return metric === "tokens" ? "Token Trend" : metric === "messages" ? "Message Trend" : "Cost Trend"
}

function buildLineRows(points: ChartPoint[], width: number, height: number): string[][] {
  const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => " "))

  // 1. Calculate the exact integer row r[x] for every column x from 0 to width - 1
  const r = Array.from({ length: width }, () => 0)
  
  for (let x = 0; x < width; x++) {
    // Find which segment p[i] -> p[i+1] contains x
    let i = 0
    for (; i < points.length - 1; i++) {
      if (x >= points[i].x && x <= points[i + 1].x) {
        break
      }
    }
    // Clamp to valid index
    if (i >= points.length - 1) {
      i = points.length - 2
    }
    
    const p1 = points[i]
    const p2 = points[i + 1]
    
    if (p1.x === p2.x) {
      r[x] = p1.y
    } else {
      const t = (x - p1.x) / (p2.x - p1.x)
      const y = p1.y + (p2.y - p1.y) * t
      r[x] = Math.round(y)
    }
  }

  // 2. Plot the line characters based on r[x] and r[x+1]
  for (let x = 0; x < width; x++) {
    const rCurr = r[x]
    
    if (x === width - 1) {
      // Last column has no next column, draw horizontal line
      if (grid[rCurr][x] === " ") {
        grid[rCurr][x] = "─"
      }
      break
    }
    
    const rNext = r[x + 1]
    
    if (rCurr === rNext) {
      if (grid[rCurr][x] === " ") {
        grid[rCurr][x] = "─"
      }
    } else if (rCurr < rNext) {
      // Going down (larger row index)
      if (grid[rCurr][x] === " ") {
        grid[rCurr][x] = "┐"
      }
      for (let y = rCurr + 1; y < rNext; y++) {
        if (grid[y][x] === " ") {
          grid[y][x] = "│"
        }
      }
      if (grid[rNext][x] === " ") {
        grid[rNext][x] = "└"
      }
    } else {
      // Going up (smaller row index)
      if (grid[rCurr][x] === " ") {
        grid[rCurr][x] = "┘"
      }
      for (let y = rNext + 1; y < rCurr; y++) {
        if (grid[y][x] === " ") {
          grid[y][x] = "│"
        }
      }
      if (grid[rNext][x] === " ") {
        grid[rNext][x] = "┌"
      }
    }
  }

  return grid
}

const ESC = "\x1b"
const RESET = `${ESC}[0m`
const BOLD = `${ESC}[1m`
const DIM = `${ESC}[2m`
const GRAY = `${ESC}[90m`

interface AxisInfo {
  axisTicks: string
  axisLabels: string
}

function buildTrendXAxis(points: Array<[number, TrendPoint]>, chartPoints: ChartPoint[], chartWidth: number): AxisInfo {
  const labelChars = Array.from({ length: chartWidth }, () => " ")
  const tickChars = Array.from({ length: chartWidth }, () => "─")
  const labelStep = Math.max(1, Math.ceil(points.length / 6))

  for (let i = 0; i < chartPoints.length; i++) {
    if (i % labelStep !== 0 && i !== chartPoints.length - 1) continue

    const date = new Date(points[i][0])
    const label = `${date.getMonth() + 1}/${date.getDate()}`
    const centerOfLabel = chartPoints[i].x
    const start = Math.min(Math.max(0, centerOfLabel - Math.floor(label.length / 2)), Math.max(0, chartWidth - label.length))
    const hasSpace = labelChars.slice(Math.max(0, start - 1), Math.min(chartWidth, start + label.length + 1)).every((c) => c === " ")

    if (!hasSpace) continue
    for (let j = 0; j < label.length; j++) {
      labelChars[start + j] = label[j]
    }
    if (centerOfLabel < chartWidth) {
      tickChars[centerOfLabel] = "┬"
    }
  }

  return {
    axisTicks: tickChars.join(""),
    axisLabels: labelChars.join("")
  }
}

function cmdTrend(flags: Map<string, string | boolean>) {
  const days = parseInt(String(flagValue(flags, "days") ?? "30"), 10)
  const metric = flagValue(flags, "metric") ?? "cost"
  const width = parseInt(String(flagValue(flags, "width") ?? "60"), 10)

  const since = getStartOfDay(new Date(Date.now() - days * 86400000))
  const entries = loadEntries(since)

  if (entries.length === 0) {
    console.log(`\n  (no data in period)\n`)
    return
  }

  const dayMap = new Map<number, TrendPoint>()
  for (const e of entries) {
    const dayStart = getStartOfDay(new Date(e._ts))
    let d = dayMap.get(dayStart)
    if (!d) {
      d = { cost: 0, tokens: 0, messages: 0 }
      dayMap.set(dayStart, d)
    }
    d.cost += e.cost ?? 0
    d.tokens += (e.input ?? 0) + (e.output ?? 0) + (e.reasoning ?? 0)
    d.messages += 1
  }

  const sorted = Array.from(dayMap.entries()).sort(([a], [b]) => a - b)

  if (sorted.length < 2) {
    const only = sorted[0]
    if (only) {
      const v = formatTrendValue(getTrendValue(only[1], metric), metric)
      console.log(`\n  ${new Date(only[0]).toISOString().slice(0, 10)}: ${v}\n`)
    }
    return
  }

  const values = sorted.map(([, d]) => getTrendValue(d, metric))
  const maxVal = Math.max(...values, 1)
  const minVal = Math.min(...values)
  const valRange = maxVal - minVal
  
  // Adaptive scaling padding (e.g. 5% of range) to show beautiful ups & downs
  const pad = valRange === 0 ? maxVal * 0.1 : valRange * 0.05
  const chartMax = maxVal + pad
  const chartMin = Math.max(0, minVal - pad)
  const chartRange = chartMax - chartMin || 1

  const totalVal = values.reduce((sum, value) => sum + value, 0)
  const avgVal = totalVal / values.length
  const deltaVal = values[values.length - 1] - values[0]
  const chartHeight = sorted.length <= 3 ? 6 : Math.max(6, Math.min(Math.floor(width / 4), 12))

  if (width < 35) {
    // Fallback: simple sparkline
    const chars = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]
    const spark = values.map(v => chars[Math.min(Math.floor((v / maxVal) * 7), 7)]).join("")
    console.log(`\n  ${metricLabel(metric)}  ${spark}\n`)
    return
  }

  const chartWidth = Math.max(width - 12, 20)
  const yLabelStep = Math.max(1, Math.floor(chartHeight / 4))

  const chartPoints = values.map((value, i) => ({
    x: values.length === 1 ? Math.floor(chartWidth / 2) : Math.round((i / (values.length - 1)) * (chartWidth - 1)),
    y: Math.max(0, chartHeight - 1 - Math.round(((value - chartMin) / chartRange) * (chartHeight - 1))),
  }))

  const grid = buildLineRows(chartPoints, chartWidth, chartHeight)

  // Metric premium color themes
  let metricColor = "\x1b[36m" // default Cyan
  if (metric === "cost") {
    metricColor = "\x1b[32m" // Green
  } else if (metric === "messages") {
    metricColor = "\x1b[33m" // Yellow
  }

  const peakStr = `${metricColor}${BOLD}${formatTrendValue(maxVal, metric)}${RESET}`
  const avgStr = `${metricColor}${BOLD}${formatTrendValue(avgVal, metric)}${RESET}`

  let deltaColor = "\x1b[32m" // Green
  if (metric === "cost") {
    deltaColor = deltaVal > 0 ? "\x1b[31m" : "\x1b[32m" // Red for cost increase, Green for decrease
  } else {
    deltaColor = deltaVal > 0 ? "\x1b[32m" : "\x1b[31m" // Green for token/msg increase, Red for decrease
  }
  const deltaStr = `${deltaColor}${BOLD}${formatSignedTrendValue(deltaVal, metric)}${RESET}`

  const lines: string[] = []

  lines.push(`${metricColor}${BOLD}${metricLabel(metric)}${RESET} · ${sorted.length} days · peak ${peakStr} · avg ${avgStr} · Δ ${deltaStr}`)
  lines.push(`${GRAY}range ${formatTrendValue(minVal, metric)} → ${formatTrendValue(maxVal, metric)}${RESET}`)

  // Colorize the line chart points and connection characters
  const colorRows = grid.map(row => 
    row.map(char => char === " " ? " " : `${metricColor}${char}${RESET}`).join("")
  )

  const { axisTicks, axisLabels } = buildTrendXAxis(sorted, chartPoints, chartWidth)

  for (let row = 0; row < chartHeight; row++) {
    const valueRatio = 1 - row / (chartHeight - 1)
    const valAtRow = chartMin + valueRatio * chartRange
    const hasLabel = row === 0 || row === chartHeight - 1 || row % yLabelStep === 0
    const label = hasLabel ? formatTrendValue(valAtRow, metric) : ""
    const tick = hasLabel ? "┤" : "│"
    const line = `${padLeft(label, 9)} ${GRAY}${tick}${RESET}${colorRows[row]}`
    lines.push(line)
  }

  const axis = `${" ".repeat(9)} ${GRAY}└${axisTicks}${RESET}`
  lines.push(axis)

  lines.push(`${" ".repeat(11)}${GRAY}${axisLabels}${RESET}`)

  console.log()
  for (const l of lines) console.log(`  ${l}`)
  console.log()
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const args = process.argv.slice(2)
  const parsed = parseArgs(args)

  if (parsed.flags.has("help")) {
    cmdHelp()
    return
  }

  const { command } = parsed

  switch (command) {
    case "budget":
      cmdBudget()
      return
    case "pricing":
      cmdPricing()
      return
    case "models":
      cmdModels()
      return
    case "config":
      cmdConfig(parsed.positional)
      return
    case "export":
      cmdExport(parsed.flags)
      return
    case "trend":
      cmdTrend(parsed.flags)
      return
  }

  // Default: stats
  let period = "all"
  const breakdown = flagValue(parsed.flags, "by") || (parsed.flags.has("b") ? String(parsed.flags.get("b")) : undefined)
  for (const p of ["today", "week", "month", "all"]) {
    if (parsed.positional.includes(p)) {
      period = p
      break
    }
  }

  cmdStats(period, breakdown)
}

main()
