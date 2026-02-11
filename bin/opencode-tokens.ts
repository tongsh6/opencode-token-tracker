#!/usr/bin/env node

import type { ModelPricing } from "../lib/shared.js"
import { BUILTIN_PRICING, formatCost, formatTokens, getStartOfDay, getStartOfWeek, getStartOfMonth } from "../lib/shared.js"
import { readFileSync, existsSync, writeFileSync } from "fs"
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

interface Config {
  providers?: Record<string, ModelPricing>
  models?: Record<string, ModelPricing>
  toast?: {
    enabled?: boolean
    duration?: number
    showOnIdle?: boolean
  }
  budget?: {
    daily?: number
    weekly?: number
    monthly?: number
    warnAt?: number
  }
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

// ============================================================================
// Data Loading
// ============================================================================

function loadEntries(since?: number): TokenEntry[] {
  if (!existsSync(LOG_FILE)) {
    return []
  }

  const content = readFileSync(LOG_FILE, "utf-8")
  const lines = content.trim().split("\n").filter(Boolean)

  const entries: TokenEntry[] = []
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as TokenEntry
      if (entry.type !== "tokens") continue
      if (since && entry._ts < since) continue
      if (!entry.input && !entry.output) continue
      entries.push(entry)
    } catch {
      // Skip malformed lines
    }
  }

  return entries
}

function loadConfig(): Config {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"))
    }
  } catch {}
  return {}
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
    let status = "built-in"
    if (config.providers?.[provider]) {
      status = "provider cfg"
    } else if (config.models?.[model]) {
      status = "model cfg"
    } else if (!BUILTIN_PRICING[model]) {
      // Check partial match
      const hasMatch = Object.keys(BUILTIN_PRICING).some(k => k !== "_default" && model.toLowerCase().includes(k.toLowerCase()))
      status = hasMatch ? "built-in" : "default"
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

function cmdConfig(action?: string) {
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
    
    const exampleConfig: Config = {
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
  console.log(`    opencode-tokens config init      Show example config with explanation`)
  console.log(`    opencode-tokens config generate  Create config file`)
  console.log()
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
  
  const entries = loadEntries()
  
  // Daily budget
  if (budget.daily) {
    const dayStart = getStartOfDay(now)
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
    const weekStart = getStartOfWeek(now)
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
    const monthStart = getStartOfMonth(now)
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
    config        Show/generate configuration

  Statistics Options:
    today         Show today's usage
    week          Show this week's usage  
    month         Show this month's usage
    all           Show all-time usage (default)
    
    --by <type>   Group by: model, agent, provider, daily, all

  Examples:
    opencode-tokens                  # All-time summary
    opencode-tokens budget           # Check budget status
    opencode-tokens today            # Today's summary
    opencode-tokens week --by model  # This week, by model
    opencode-tokens pricing          # Show pricing table
    opencode-tokens models           # Show your models
    opencode-tokens config init      # Generate example config
`)
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  if (args.includes("--help") || args.includes("-h")) {
    cmdHelp()
    return
  }

  // Handle subcommands
  if (command === "budget") {
    cmdBudget()
    return
  }
  
  if (command === "pricing") {
    cmdPricing()
    return
  }
  
  if (command === "models") {
    cmdModels()
    return
  }
  
  if (command === "config") {
    cmdConfig(args[1])
    return
  }

  // Parse stats arguments
  let period = "all"
  let breakdown: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--by" || arg === "-b") {
      breakdown = args[++i]
    } else if (["today", "week", "month", "all"].includes(arg)) {
      period = arg
    }
  }

  cmdStats(period, breakdown)
}

main()
