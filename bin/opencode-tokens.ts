#!/usr/bin/env node

import type { ModelPricing, TrackerConfig } from "../lib/shared.js"
import { BUILTIN_PRICING, DEFAULT_CONFIG, findModelConfigPricing, formatCost, formatTokens, getStartOfDay, getStartOfWeek, getStartOfMonth, validateConfig } from "../lib/shared.js"
import { readFileSync, existsSync, writeFileSync, copyFileSync, mkdirSync, openSync, readSync, closeSync, statSync } from "fs"
import { join } from "path"
import { homedir } from "os"

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
  return str.length >= len ? str : str + " ".repeat(len - str.length)
}

function padLeft(str: string, len: number): string {
  return str.length >= len ? str : " ".repeat(len - str.length) + str
}

function truncateSessionId(sessionId?: string): string {
  if (!sessionId) return "unknown"
  return sessionId.length > 16 ? sessionId.slice(0, 14) + "…" : sessionId
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

function flagBool(flags: Map<string, string | boolean>, name: string): boolean {
  return flags.has(name)
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
    if (!groups.has(key)) {
      groups.set(key, createEmptyStats())
    }
    const stats = groups.get(key)!
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
    case "all":
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
  Built-in Pricing Table (USD per 1M tokens) - Updated 2026-02-11
  ══════════════════════════════════════════════════════════════════
`)
  
  // Group by provider
  const groups: Record<string, string[]> = {
    "Anthropic Claude": ["claude-opus-4.6", "claude-opus-4.5", "claude-sonnet-4.5", "claude-sonnet-4", "claude-haiku-4.5", "claude-haiku-4", "claude-opus-4.1", "claude-opus-4", "claude-haiku-3"],
    "OpenAI": ["gpt-5.2", "gpt-5.2-pro", "gpt-5-mini", "gpt-5.1", "gpt-5", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "o3", "o3-mini", "o4-mini", "o1", "o1-mini"],
    "DeepSeek": ["deepseek-chat", "deepseek-reasoner"],
    "Google Gemini": ["gemini-3-pro", "gemini-3-pro-preview", "gemini-3-flash", "gemini-3-flash-preview", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-2.0-flash-lite"],
  }
  
  const modelWidth = 20
  const priceWidth = 10
  
  for (const [group, models] of Object.entries(groups)) {
    console.log(`  ${group}`)
    console.log(`  ${"-".repeat(modelWidth + priceWidth * 4 + 12)}`)
    console.log(`  ${padRight("Model", modelWidth)}  ${padLeft("Input", priceWidth)}  ${padLeft("Output", priceWidth)}  ${padLeft("CacheRd", priceWidth)}  ${padLeft("CacheWr", priceWidth)}`)
    
    for (const model of models) {
      const p = BUILTIN_PRICING[model]
      if (!p) continue
      const overridden = config.models?.[model] ? " *" : ""
      console.log(
        `  ${padRight(model + overridden, modelWidth)}  ${padLeft("$" + p.input.toString(), priceWidth)}  ${padLeft("$" + p.output.toString(), priceWidth)}  ${padLeft(p.cacheRead ? "$" + p.cacheRead.toString() : "-", priceWidth)}  ${padLeft(p.cacheWrite ? "$" + p.cacheWrite.toString() : "-", priceWidth)}`
      )
    }
    console.log()
  }
  
  console.log(`  Default (unknown models)`)
  console.log(`  ${"-".repeat(modelWidth + priceWidth * 4 + 12)}`)
  const def = BUILTIN_PRICING["_default"]
  console.log(`  ${padRight("_default", modelWidth)}  ${padLeft("$" + def.input.toString(), priceWidth)}  ${padLeft("$" + def.output.toString(), priceWidth)}  ${padLeft("-", priceWidth)}  ${padLeft("-", priceWidth)}`)
  console.log()
  
  if (Object.keys(config.models || {}).length > 0) {
    console.log(`  * = overridden in config`)
  }
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
    
    if (!modelProviders.has(key)) {
      modelProviders.set(key, { provider, count: 0, lastUsed: 0 })
    }
    const info = modelProviders.get(key)!
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
    let status: string

    // Mirror the runtime pricing resolution order (getModelPricing in index.ts)
    if (config.providers?.[provider]) {
      status = "provider cfg"
    } else if (findModelConfigPricing(config.models, model, provider, false)) {
      status = "model cfg"
    } else if (BUILTIN_PRICING[model]) {
      status = "built-in"
    } else {
      const modelLower = model.toLowerCase()
      const hasBuiltinPartial = Object.keys(BUILTIN_PRICING).some(
        k => k !== "_default" && modelLower.includes(k.toLowerCase())
      )
      if (hasBuiltinPartial) {
        status = "built-in"
      } else if (findModelConfigPricing(config.models, model, provider, true)) {
        status = "model cfg"
      } else {
        status = "default"
      }
    }
    
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
    // Get unique providers from logs
    const providers = new Set<string>()
    const models = new Set<string>()
    
    for (const e of entries) {
      if (e.provider) providers.add(e.provider)
      if (e.model) models.add(e.model)
    }
    
    // Find providers/models without built-in pricing
    const unknownModels = Array.from(models).filter(m => {
      if (BUILTIN_PRICING[m]) return false
      const hasMatch = Object.keys(BUILTIN_PRICING).some(k => k !== "_default" && m.toLowerCase().includes(k.toLowerCase()))
      return !hasMatch
    })
    
    const exampleConfig: TrackerConfig = {
      providers: {},
      models: {},
      toast: {
        enabled: true,
        duration: 3000,
        showOnIdle: true,
      },
      budget: {
        daily: 5,
        weekly: 25,
        monthly: 100,
        warnAt: 0.8,
      },
    }
    
    // Add providers as comments/examples
    for (const provider of providers) {
      // Common free providers
      if (provider.includes("copilot") || provider.includes("cursor") || provider.includes("free")) {
        exampleConfig.providers![provider] = { input: 0, output: 0 }
      }
    }
    
    // Add unknown models
    for (const model of unknownModels) {
      exampleConfig.models![model] = { input: 1, output: 4 }
    }
    
    // Print explanation first
    console.log(`
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
`)
    console.log(JSON.stringify(exampleConfig, null, 2))
    
    if (action === "generate") {
      const json = JSON.stringify(exampleConfig, null, 2)
      writeFileSync(CONFIG_FILE, json)
      console.log(`
  Config file created: ${CONFIG_FILE}
`)
    } else {
      console.log(`
  To create this config file, run:
    opencode-tokens config generate
  
  Or manually create: ${CONFIG_FILE}
`)
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
    applyConfigSet(key, value, config)
    console.log(`\n  Set ${key} = ${JSON.stringify(value)}\n`)
    return
  }

  if (action === "unset") {
    const key = positional[2]
    if (!key) { console.log("\n  Usage: opencode-tokens config unset <key>\n"); return }
    const spec = SETTABLE_KEYS[key]
    if (!spec) { console.log(`\n  Unknown key: ${key}\n  Available: ${Object.keys(SETTABLE_KEYS).join(", ")}\n`); return }
    applyConfigUnset(key, config)
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
    console.log(JSON.stringify(config, null, 2).split("\n").map(l => "  " + l).join("\n"))
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

function applyConfigSet(key: string, value: unknown, config: TrackerConfig): void {
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

function applyConfigUnset(key: string, config: TrackerConfig): void {
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

function saveConfig(raw: Record<string, unknown>): void {
  const dir = join(homedir(), ".config", "opencode")
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  if (existsSync(CONFIG_FILE)) {
    copyFileSync(CONFIG_FILE, CONFIG_FILE + ".bak")
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(raw, null, 2) + "\n")
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
    output = [headers.join(","), ...rows].join("\n") + "\n"
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
`)
}

// ============================================================================
// Trend
// ============================================================================

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

  // Aggregate by day
  const dayMap = new Map<number, { cost: number; tokens: number; messages: number }>()
  for (const e of entries) {
    const dayStart = getStartOfDay(new Date(e._ts))
    if (!dayMap.has(dayStart)) {
      dayMap.set(dayStart, { cost: 0, tokens: 0, messages: 0 })
    }
    const d = dayMap.get(dayStart)!
    d.cost += e.cost ?? 0
    d.tokens += (e.input ?? 0) + (e.output ?? 0) + (e.reasoning ?? 0)
    d.messages += 1
  }

  const sorted = Array.from(dayMap.entries()).sort(([a], [b]) => a - b)

  if (sorted.length < 2) {
    const only = sorted[0]
    if (only) {
      const v = metric === "tokens" ? formatTokens(only[1].tokens) : metric === "messages" ? String(only[1].messages) : formatCost(only[1].cost)
      console.log(`\n  ${new Date(only[0]).toISOString().slice(0, 10)}: ${v}\n`)
    }
    return
  }

  const values = sorted.map(([, d]) =>
    metric === "tokens" ? d.tokens : metric === "messages" ? d.messages : d.cost
  )
  const maxVal = Math.max(...values, 1)
  const H = Math.max(5, Math.min(Math.floor(width / 3), 20))

  if (width < 35) {
    // Fallback: simple sparkline
    const chars = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]
    const spark = values.map(v => chars[Math.min(Math.floor((v / maxVal) * 7), 7)]).join("")
    console.log(`\n  ${spark}\n`)
    return
  }

  // Build chart
  const cols = values.map((v) => ({ value: v, y: Math.round((v / maxVal) * (H - 1)) }))
  const chartWidth = Math.max(width - 12, 20)
  const xStep = Math.max(2, Math.floor(chartWidth / sorted.length))

  const yLabelStep = Math.max(1, Math.floor(H / 5))
  const lines: string[] = []

  for (let row = H - 1; row >= 0; row--) {
    let line = ""
    const valAtRow = (row / (H - 1)) * maxVal
    const label = row === H - 1 || row === 0 || (H - 1 - row) % yLabelStep === 0
      ? metric === "tokens" ? formatTokens(valAtRow) : metric === "messages" ? String(Math.round(valAtRow)) : formatCost(valAtRow)
      : ""
    line += padLeft(label, 9)

    line += row === 0 ? " ┼" : " ┤"

    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci]
      const nextY = ci < cols.length - 1 ? cols[ci + 1].y : col.y

      if (col.y === row) {
        if (ci > 0) {
          const prevY = cols[ci - 1].y
          if (prevY < col.y && nextY <= col.y) line += "╭"
          else if (prevY > col.y && nextY >= col.y) line += "╰"
          else if (prevY < col.y || nextY < col.y) line += "╭"
          else if (prevY > col.y || nextY > col.y) line += "╰"
          else line += "─"
        } else {
          line += nextY > col.y ? "╭" : nextY < col.y ? "╰" : "─"
        }
        if (xStep > 1 && ci < cols.length - 1 && nextY === row) {
          line += "─".repeat(xStep - 1)
        }
      } else if (ci > 0 && ci < cols.length) {
        const prevY = cols[ci - 1].y
        if ((prevY < row && col.y > row) || (prevY > row && col.y < row)) {
          line += prevY < col.y ? "╱" : "╲"
        } else {
          line += " ".repeat(xStep > 1 && nextY !== row ? 1 : Math.min(xStep, 1))
        }
      }
    }

    lines.push(line)
  }

  // Bottom axis
  let axis = " ".repeat(9) + " └"
  axis += "─".repeat(xStep * cols.length)
  lines.push(axis)

  // X axis labels
  const labelStep = Math.max(1, Math.ceil(sorted.length / 6))
  let xLabels = " ".repeat(11)
  for (let i = 0; i < cols.length; i++) {
    if (i % labelStep === 0 || i === cols.length - 1) {
      const d = new Date(sorted[i][0])
      const ds = `${d.getMonth() + 1}/${d.getDate()}`
      xLabels += ds
      if (i < cols.length - 1) xLabels += " ".repeat(Math.max(1, xStep - ds.length + 1))
    }
  }
  lines.push(xLabels)

  console.log()
  for (const l of lines) console.log("  " + l)
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
  let breakdown: string | undefined

  breakdown = flagValue(parsed.flags, "by") || (parsed.flags.has("b") ? String(parsed.flags.get("b")) : undefined)
  for (const p of ["today", "week", "month", "all"]) {
    if (parsed.positional.includes(p)) {
      period = p
      break
    }
  }

  cmdStats(period, breakdown)
}

main()
