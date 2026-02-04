#!/usr/bin/env node

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const LOG_FILE = join(homedir(), ".config", "opencode", "logs", "token-tracker", "tokens.jsonl")

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

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return tokens.toString()
}

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length)
}

function padLeft(str: string, len: number): string {
  return str.length >= len ? str : " ".repeat(len - str.length) + str
}

function getStartOfDay(date: Date): number {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function getStartOfWeek(date: Date): number {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday as start
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function getStartOfMonth(date: Date): number {
  const d = new Date(date)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
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
      if (!entry.input && !entry.output) continue // Skip empty entries
      entries.push(entry)
    } catch {
      // Skip malformed lines
    }
  }

  return entries
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
  console.log(`  Total Tokens:    ${padLeft(formatTokens(totalTokens), 12)}`)
  console.log(`    Input:         ${padLeft(formatTokens(stats.input), 12)}`)
  console.log(`    Output:        ${padLeft(formatTokens(stats.output), 12)}`)
  if (stats.reasoning > 0) {
    console.log(`    Reasoning:     ${padLeft(formatTokens(stats.reasoning), 12)}`)
  }
  console.log(`  Cache Read:      ${padLeft(formatTokens(stats.cacheRead), 12)}`)
  console.log(`  Total Cost:      ${padLeft(formatCost(stats.cost), 12)}`)
  console.log(`  Messages:        ${padLeft(stats.count.toString(), 12)}`)
  console.log()
}

function printTable(title: string, groups: Map<string, Stats>, labelHeader: string) {
  // Sort by cost descending
  const sorted = Array.from(groups.entries()).sort((a, b) => b[1].cost - a[1].cost)

  if (sorted.length === 0) {
    console.log(`\n  No data for ${title}\n`)
    return
  }

  // Calculate column widths
  const labelWidth = Math.max(labelHeader.length, ...sorted.map(([k]) => k.length))
  const tokensWidth = 10
  const costWidth = 10
  const countWidth = 6

  console.log()
  console.log(`  ${title}`)
  console.log(`  ${"─".repeat(labelWidth + tokensWidth + costWidth + countWidth + 12)}`)

  // Header
  console.log(
    `  ${padRight(labelHeader, labelWidth)}  ${padLeft("Tokens", tokensWidth)}  ${padLeft("Cost", costWidth)}  ${padLeft("Msgs", countWidth)}`
  )
  console.log(
    `  ${"-".repeat(labelWidth)}  ${"-".repeat(tokensWidth)}  ${"-".repeat(costWidth)}  ${"-".repeat(countWidth)}`
  )

  // Rows
  for (const [label, stats] of sorted) {
    const totalTokens = stats.input + stats.output
    console.log(
      `  ${padRight(label, labelWidth)}  ${padLeft(formatTokens(totalTokens), tokensWidth)}  ${padLeft(formatCost(stats.cost), costWidth)}  ${padLeft(stats.count.toString(), countWidth)}`
    )
  }
  console.log()
}

function printDailyBreakdown(entries: TokenEntry[]) {
  const byDay = groupBy(entries, (e) => {
    const date = new Date(e._ts)
    return date.toISOString().slice(0, 10) // YYYY-MM-DD
  })

  // Sort by date descending
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
      `  ${padRight(date, dateWidth)}  ${padLeft(formatTokens(totalTokens), tokensWidth)}  ${padLeft(formatCost(stats.cost), costWidth)}  ${padLeft(stats.count.toString(), countWidth)}`
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

  // Overall summary
  const total = aggregateStats(entries)
  printSummary(title, total)

  // Breakdown
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

function cmdHelp() {
  console.log(`
  opencode-tokens - Token usage statistics CLI

  Usage:
    opencode-tokens [period] [--by <breakdown>]

  Period:
    today       Show today's usage
    week        Show this week's usage  
    month       Show this month's usage
    all         Show all-time usage (default)

  Breakdown (--by):
    model       Group by model (e.g., claude-opus-4.5)
    agent       Group by agent (e.g., sisyphus, coder)
    provider    Group by provider (e.g., anthropic, openai)
    daily       Show day-by-day breakdown
    all         Show all breakdowns

  Examples:
    opencode-tokens                  # All-time summary
    opencode-tokens today            # Today's summary
    opencode-tokens week --by model  # This week, grouped by model
    opencode-tokens month --by all   # This month, all breakdowns
    opencode-tokens --by daily       # All-time, day by day
`)
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const args = process.argv.slice(2)

  if (args.includes("--help") || args.includes("-h")) {
    cmdHelp()
    return
  }

  // Parse arguments
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
