// ============================================================================
// Shared types, pricing data, and utilities for opencode-token-tracker
// ============================================================================

// ============================================================================
// Types
// ============================================================================

export interface ModelPricing {
  input: number       // per 1M input tokens
  output: number      // per 1M output tokens
  cacheRead?: number  // per 1M cached input tokens (usually cheaper)
  cacheWrite?: number // per 1M cache write tokens
}

export interface BillableTokenUsage {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
}

export interface ProviderModelPricingMap {
  [provider: string]: ModelPricing
}

// ============================================================================
// Built-in Pricing (USD per 1M tokens) - Updated 2026-05-29
// Sources:
// - Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
// - OpenAI: https://developers.openai.com/api/docs/pricing
// - DeepSeek: https://api-docs.deepseek.com/quick_start/pricing
// - Google: https://cloud.google.com/vertex-ai/generative-ai/pricing
// ============================================================================

export const BUILTIN_PRICING_META = {
  pricingLastUpdated: "2026-05-29",
  metadataLastUpdated: "2026-05-29",
  source: "Provider official pricing pages",
  notes: "Manually maintained. Report stale prices: https://github.com/tongsh6/opencode-token-tracker/issues/new",
} as const

export const BUILTIN_PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude (https://platform.claude.com/docs/en/about-claude/pricing)
  // Opus 4.8/4.7/4.6/4.5: $5 input, $25 output, cache write $6.25, cache read $0.50
  "claude-opus-4.8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4.7": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4.6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4.5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  // Sonnet 4.6/4.5: $3 input, $15 output, cache write $3.75, cache read $0.30
  "claude-sonnet-4.6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-sonnet-4.5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  // Sonnet 4 (deprecated): $3 input, $15 output
  "claude-sonnet-4": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  // Haiku 4.5: $1 input, $5 output, cache write $1.25, cache read $0.10
  "claude-haiku-4.5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-haiku-4": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // Legacy models
  "claude-opus-4.1": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-opus-4": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-haiku-3": { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 },

  // OpenAI GPT (https://developers.openai.com/api/docs/pricing)
  // GPT-5.5/5.4 standard short-context text pricing.
  "gpt-5.5": { input: 5, output: 30, cacheRead: 0.5 },
  "gpt-5.5-pro": { input: 30, output: 180 },
  "gpt-5.4": { input: 2.5, output: 15, cacheRead: 0.25 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5, cacheRead: 0.075 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25, cacheRead: 0.02 },
  "gpt-5.4-pro": { input: 30, output: 180 },
  "gpt-5.3-codex": { input: 1.75, output: 14, cacheRead: 0.175 },
  "gpt-5.3-chat-latest": { input: 1.75, output: 14, cacheRead: 0.175 },
  // GPT-5.2 and earlier GPT-5 family.
  "gpt-5.2": { input: 1.75, output: 14, cacheRead: 0.175 },
  "gpt-5.2-pro": { input: 21, output: 168 },
  "gpt-5-mini": { input: 0.25, output: 2, cacheRead: 0.025 },
  "gpt-5-nano": { input: 0.05, output: 0.4, cacheRead: 0.005 },
  "gpt-5.1": { input: 1.25, output: 10, cacheRead: 0.125 },
  "gpt-5.1-chat-latest": { input: 1.25, output: 10, cacheRead: 0.125 },
  "gpt-5.1-codex-max": { input: 1.25, output: 10, cacheRead: 0.125 },
  "gpt-5.1-codex": { input: 1.25, output: 10, cacheRead: 0.125 },
  "gpt-5.1-codex-mini": { input: 0.25, output: 2, cacheRead: 0.025 },
  "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
  "gpt-5-chat-latest": { input: 1.25, output: 10, cacheRead: 0.125 },
  "gpt-5-codex": { input: 1.25, output: 10, cacheRead: 0.125 },
  // GPT-4.1 series
  "gpt-4.1": { input: 2, output: 8, cacheRead: 0.5 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cacheRead: 0.1 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4, cacheRead: 0.025 },
  // GPT-4o series (may be deprecated)
  "gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075 },
  // Reasoning models
  "o3": { input: 2, output: 8, cacheRead: 0.5 },
  "o3-mini": { input: 1.1, output: 4.4, cacheRead: 0.55 },
  "o4-mini": { input: 1.1, output: 4.4, cacheRead: 0.275 },
  "o1": { input: 15, output: 60, cacheRead: 7.5 },
  "o1-mini": { input: 1.1, output: 4.4, cacheRead: 0.55 },

  // DeepSeek (https://api-docs.deepseek.com/quick_start/pricing)
  // DeepSeek-V4 Flash compatibility pricing for deepseek-chat / deepseek-reasoner.
  // $0.14 input (cache miss), $0.0028 input (cache hit), $0.28 output
  "deepseek-chat": { input: 0.14, output: 0.28, cacheRead: 0.0028 },
  "deepseek-reasoner": { input: 0.14, output: 0.28, cacheRead: 0.0028 },
  // DeepSeek-V4-Pro discounted pricing, current until 2026-05-31 15:59 UTC.
  // $0.435 input (cache miss), $0.003625 input (cache hit), $0.87 output
  "deepseek-v4-pro": { input: 0.435, output: 0.87, cacheRead: 0.003625 },

  // Google Gemini (https://cloud.google.com/vertex-ai/generative-ai/pricing)
  // Standard global text pricing at <=200K input tokens where tiered pricing applies.
  // Gemini 3.1 Pro Preview: $2 input, $12 output, cache read $0.20
  "gemini-3.1-pro-preview": { input: 2, output: 12, cacheRead: 0.2 },
  "gemini-3-pro": { input: 2, output: 12, cacheRead: 0.2 },
  "gemini-3-pro-preview": { input: 2, output: 12, cacheRead: 0.2 },
  // Gemini 3.5 Flash: $1.50 input, $9 output, cache read $0.15
  "gemini-3.5-flash": { input: 1.5, output: 9, cacheRead: 0.15 },
  // Gemini 3 Flash Preview: $0.5 input, $3 output
  "gemini-3-flash": { input: 0.5, output: 3, cacheRead: 0.05 },
  "gemini-3-flash-preview": { input: 0.5, output: 3, cacheRead: 0.05 },
  // Gemini 3.1 Flash-Lite: $0.25 input, $1.50 output, cache read $0.025
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5, cacheRead: 0.025 },
  // Gemini 2.5 Pro: $1.25 input, $10 output (≤200K)
  "gemini-2.5-pro": { input: 1.25, output: 10, cacheRead: 0.125 },
  // Gemini 2.5 Flash: $0.3 input, $2.5 output
  "gemini-2.5-flash": { input: 0.3, output: 2.5, cacheRead: 0.03 },
  // Gemini 2.5 Flash Lite: $0.1 input
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4, cacheRead: 0.01 },
  // Gemini 2.0 Flash: $0.15 input
  "gemini-2.0-flash": { input: 0.15, output: 0.6, cacheRead: 0.015 },
  // Gemini 2.0 Flash Lite: $0.075 input, $0.3 output
  "gemini-2.0-flash-lite": { input: 0.075, output: 0.3, cacheRead: 0.0075 },

  // Fallback for unknown models
  "_default": { input: 1, output: 4 },
}

// ============================================================================
// Formatting Utilities
// ============================================================================

export function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

/**
 * Format token count for display.
 * @param tokens - raw token count
 * @param millionDecimals - decimal places for M-level values (default 1)
 */
export function formatTokens(tokens: number, millionDecimals: number = 1): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(millionDecimals)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return tokens.toString()
}

export function hasBillableTokenUsage(usage: BillableTokenUsage): boolean {
  return (usage.input ?? 0) > 0
    || (usage.output ?? 0) > 0
    || (usage.cacheRead ?? 0) > 0
    || (usage.cacheWrite ?? 0) > 0
}

// ============================================================================
// Time Utilities
// ============================================================================

export function getStartOfDay(date: Date = new Date()): number {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function formatLocalDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function getStartOfWeek(date: Date = new Date()): number {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday as first day
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function getStartOfMonth(date: Date = new Date()): number {
  const d = new Date(date)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// ============================================================================
// Configuration Types & Validation
// ============================================================================

export interface ToastConfig {
  enabled: boolean
  duration: number
  showOnIdle: boolean
}

export interface BudgetConfig {
  daily?: number
  weekly?: number
  monthly?: number
  warnAt: number
}

export interface TrackerConfig {
  providers: Record<string, ModelPricing>
  models: Record<string, ModelPricing | ProviderModelPricingMap>
  toast: ToastConfig
  budget: BudgetConfig
}

export const DEFAULT_CONFIG: TrackerConfig = {
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

export interface ConfigValidationResult {
  config: TrackerConfig
  warnings: string[]
}

/**
 * Validate and normalize raw config (from JSON.parse).
 * Invalid fields are silently corrected to defaults with warnings.
 */
export function validateConfig(raw: unknown): ConfigValidationResult {
  const warnings: string[] = []

  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push("Config is not a valid object, using defaults")
    return { config: DEFAULT_CONFIG, warnings }
  }

  const obj = raw as Record<string, unknown>

  const providers = validatePricingMap(obj["providers"], "providers", warnings)
  const models = validatePricingMap(obj["models"], "models", warnings, true)
  const toast = validateToast(obj["toast"], warnings)
  const budget = validateBudget(obj["budget"], warnings)

  return {
    config: { providers, models, toast, budget },
    warnings,
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

function validatePricingMap(
  raw: unknown,
  section: string,
  warnings: string[],
  allowProviderModels: true,
): Record<string, ModelPricing | ProviderModelPricingMap>
function validatePricingMap(
  raw: unknown,
  section: string,
  warnings: string[],
  allowProviderModels?: false,
): Record<string, ModelPricing>
function validatePricingMap(
  raw: unknown,
  section: string,
  warnings: string[],
  allowProviderModels: boolean = false,
): Record<string, ModelPricing | ProviderModelPricingMap> {
  if (raw === undefined || raw === null) return {}

  if (typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push(`${section} should be an object, ignoring`)
    return {}
  }

  const result: Record<string, ModelPricing | ProviderModelPricingMap> = {}
  const entries = raw as Record<string, unknown>

  for (const [key, value] of Object.entries(entries)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      warnings.push(`${section}.${key} should be a pricing object, ignoring`)
      continue
    }

    const entryPath = `${section}.${key}`
    const parsedPricing = validatePricingObject(value as Record<string, unknown>, entryPath, warnings)
    if (parsedPricing) {
      result[key] = parsedPricing
      continue
    }

    if (!allowProviderModels) {
      warnings.push(`${entryPath} should be a pricing object, ignoring`)
      continue
    }

    // If the structure looks like flat pricing (has pricing field keys),
    // don't fall through to nested provider pricing — validatePricingObject
    // already issued the relevant warning for malformed flat pricing.
    if (hasFlatPricingStructure(value as Record<string, unknown>)) {
      continue
    }

    const providerPricing = validateNestedPricingMap(value as Record<string, unknown>, entryPath, warnings)
    if (Object.keys(providerPricing).length > 0) {
      result[key] = providerPricing
    } else {
      warnings.push(`${entryPath} should define at least one valid provider pricing, ignoring entry`)
    }
  }

  return result
}

function validateNestedPricingMap(
  raw: Record<string, unknown>,
  path: string,
  warnings: string[],
): ProviderModelPricingMap {
  const result: ProviderModelPricingMap = {}

  for (const [provider, value] of Object.entries(raw)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      warnings.push(`${path}.${provider} should be a pricing object, ignoring`)
      continue
    }

    const pricing = validatePricingObject(value as Record<string, unknown>, `${path}.${provider}`, warnings)
    if (pricing) {
      result[provider] = pricing
    }
  }

  return result
}

function validatePricingObject(
  raw: Record<string, unknown>,
  path: string,
  warnings: string[],
): ModelPricing | undefined {
  if (!hasFlatPricingStructure(raw)) {
    return undefined
  }

  if (!isFiniteNumber(raw["input"]) || raw["input"] < 0) {
    warnings.push(`${path}.input should be a non-negative number, ignoring entry`)
    return undefined
  }
  if (!isFiniteNumber(raw["output"]) || raw["output"] < 0) {
    warnings.push(`${path}.output should be a non-negative number, ignoring entry`)
    return undefined
  }

  const pricing: ModelPricing = {
    input: raw["input"],
    output: raw["output"],
  }

  if (raw["cacheRead"] !== undefined) {
    if (isFiniteNumber(raw["cacheRead"]) && raw["cacheRead"] >= 0) {
      pricing.cacheRead = raw["cacheRead"]
    } else {
      warnings.push(`${path}.cacheRead should be a non-negative number, ignoring field`)
    }
  }

  if (raw["cacheWrite"] !== undefined) {
    if (isFiniteNumber(raw["cacheWrite"]) && raw["cacheWrite"] >= 0) {
      pricing.cacheWrite = raw["cacheWrite"]
    } else {
      warnings.push(`${path}.cacheWrite should be a non-negative number, ignoring field`)
    }
  }

  return pricing
}

function hasFlatPricingStructure(raw: Record<string, unknown> | ModelPricing | ProviderModelPricingMap): boolean {
  const hasPricingField = "input" in raw || "output" in raw || "cacheRead" in raw || "cacheWrite" in raw
  if (!hasPricingField) {
    return false
  }

  return !isPlainObject(raw["input"])
    && !isPlainObject(raw["output"])
    && !isPlainObject(raw["cacheRead"])
    && !isPlainObject(raw["cacheWrite"])
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isDirectModelPricing(value: ModelPricing | ProviderModelPricingMap): value is ModelPricing {
  return hasFlatPricingStructure(value)
}

function resolveModelConfigEntry(
  entry: ModelPricing | ProviderModelPricingMap | undefined,
  provider: string,
): ModelPricing | undefined {
  if (!entry) return undefined
  if (isDirectModelPricing(entry)) return entry
  return entry[provider]
}

export function findModelConfigPricing(
  models: TrackerConfig["models"],
  model: string,
  provider: string,
  partial: boolean = true,
): ModelPricing | undefined {
  const exactMatch = resolveModelConfigEntry(models[model], provider)
  if (exactMatch) {
    return exactMatch
  }

  if (!partial) return undefined

  const modelLower = model.toLowerCase()
  // Sort by key length descending so longer (more specific) keys are checked first
  const sorted = Object.entries(models).sort(([a], [b]) => b.length - a.length)
  for (const [key, entry] of sorted) {
    if (modelLower.includes(key.toLowerCase())) {
      const partialMatch = resolveModelConfigEntry(entry, provider)
      if (partialMatch) {
        return partialMatch
      }
    }
  }

  return undefined
}

function validateToast(raw: unknown, warnings: string[]): ToastConfig {
  const defaults = DEFAULT_CONFIG.toast

  if (raw === undefined || raw === null) return { ...defaults }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push("toast should be an object, using defaults")
    return { ...defaults }
  }

  const obj = raw as Record<string, unknown>
  const result = { ...defaults }

  if (obj["enabled"] !== undefined) {
    if (typeof obj["enabled"] === "boolean") {
      result.enabled = obj["enabled"]
    } else {
      warnings.push("toast.enabled should be a boolean, using default")
    }
  }

  if (obj["duration"] !== undefined) {
    if (isFiniteNumber(obj["duration"]) && obj["duration"] > 0) {
      result.duration = obj["duration"]
    } else {
      warnings.push("toast.duration should be a positive number, using default")
    }
  }

  if (obj["showOnIdle"] !== undefined) {
    if (typeof obj["showOnIdle"] === "boolean") {
      result.showOnIdle = obj["showOnIdle"]
    } else {
      warnings.push("toast.showOnIdle should be a boolean, using default")
    }
  }

  return result
}

function validateBudget(raw: unknown, warnings: string[]): BudgetConfig {
  const defaults = DEFAULT_CONFIG.budget

  if (raw === undefined || raw === null) return { ...defaults }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push("budget should be an object, using defaults")
    return { ...defaults }
  }

  const obj = raw as Record<string, unknown>
  const result: BudgetConfig = { warnAt: defaults.warnAt }

  if (obj["daily"] !== undefined) {
    if (isFiniteNumber(obj["daily"]) && obj["daily"] > 0) {
      result.daily = obj["daily"]
    } else {
      warnings.push("budget.daily should be a positive number, ignoring")
    }
  }

  if (obj["weekly"] !== undefined) {
    if (isFiniteNumber(obj["weekly"]) && obj["weekly"] > 0) {
      result.weekly = obj["weekly"]
    } else {
      warnings.push("budget.weekly should be a positive number, ignoring")
    }
  }

  if (obj["monthly"] !== undefined) {
    if (isFiniteNumber(obj["monthly"]) && obj["monthly"] > 0) {
      result.monthly = obj["monthly"]
    } else {
      warnings.push("budget.monthly should be a positive number, ignoring")
    }
  }

  if (obj["warnAt"] !== undefined) {
    if (isFiniteNumber(obj["warnAt"]) && obj["warnAt"] > 0 && obj["warnAt"] <= 1) {
      result.warnAt = obj["warnAt"]
    } else {
      warnings.push("budget.warnAt should be a number between 0 and 1 (exclusive-inclusive), using default")
    }
  }

  return result
}

// ============================================================================
// Budget Severity Evaluation
// ============================================================================

export interface BudgetStatus {
  period: "daily" | "weekly" | "monthly"
  spent: number
  limit: number
  percentage: number
  exceeded: boolean
  warning: boolean
}

export interface BudgetSpentSnapshot {
  dailySpent: number
  weeklySpent: number
  monthlySpent: number
}

export function evaluateBudgetStatus(
  budget: BudgetConfig,
  spent: BudgetSpentSnapshot,
  initialized: boolean
): BudgetStatus | null {
  if (!initialized) return null
  if (!budget.daily && !budget.weekly && !budget.monthly) return null
  const warnAt = budget.warnAt ?? 0.8

  const candidates: BudgetStatus[] = []
  const evaluate = (period: "daily" | "weekly" | "monthly", limit: number | undefined, spentAmount: number) => {
    if (!limit) return
    const percentage = spentAmount / limit
    candidates.push({
      period,
      spent: spentAmount,
      limit,
      percentage,
      exceeded: percentage >= 1,
      warning: percentage >= warnAt && percentage < 1,
    })
  }

  evaluate("daily",   budget.daily,   spent.dailySpent)
  evaluate("weekly",  budget.weekly,  spent.weeklySpent)
  evaluate("monthly", budget.monthly, spent.monthlySpent)

  // Severity sort priority: exceeded (2) > warning (1) > ok (0); tie-breaker: percentage desc
  const severity = (s: BudgetStatus) => s.exceeded ? 2 : s.warning ? 1 : 0
  candidates.sort((a, b) => severity(b) - severity(a) || b.percentage - a.percentage)

  return candidates[0] ?? null
}

export function resolvePricingStatus(
  config: TrackerConfig,
  model: string,
  provider: string
): "provider cfg" | "model cfg" | "built-in" | "default" {
  // Step 1: config.providers[provider] -> "provider cfg"
  if (config.providers && config.providers[provider]) {
    return "provider cfg"
  }

  // Step 2: Exact-match in config.models (partial=false) -> "model cfg"
  if (findModelConfigPricing(config.models, model, provider, false)) {
    return "model cfg"
  }

  // Step 3: Exact-match in BUILTIN_PRICING -> "built-in"
  if (BUILTIN_PRICING[model]) {
    return "built-in"
  }

  // Step 4: Partial-match in BUILTIN_PRICING (sorted by key length desc) -> "built-in"
  const modelLower = model.toLowerCase()
  const sortedBuiltin = Object.keys(BUILTIN_PRICING)
    .filter(k => k !== "_default")
    .sort((a, b) => b.length - a.length)
  for (const key of sortedBuiltin) {
    if (modelLower.includes(key.toLowerCase())) {
      return "built-in"
    }
  }

  // Step 5: Partial-match in config.models (sorted by key length desc) -> "model cfg"
  if (findModelConfigPricing(config.models, model, provider, true)) {
    return "model cfg"
  }

  // Step 6: Default fallback -> "default"
  return "default"
}

export function round2(val: number): number {
  return Math.round(val * 100) / 100
}

// ============================================================================
// Provider Families & Cost Calculation
// ============================================================================

export type ProviderFamily = "anthropic" | "openai" | "deepseek" | "google" | "other"

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
    m.startsWith("chatgpt-") ||
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

function getModelPricing(model: string, provider: string, config?: TrackerConfig): ModelPricing {
  if (config && config.providers && config.providers[provider]) {
    return config.providers[provider]
  }
  if (config && config.models) {
    const configuredPricing = findModelConfigPricing(config.models, model, provider, false)
    if (configuredPricing) {
      return configuredPricing
    }
  }
  if (BUILTIN_PRICING[model]) {
    return BUILTIN_PRICING[model]
  }
  const modelLower = model.toLowerCase()
  const sortedKeys = Object.keys(BUILTIN_PRICING)
    .filter(k => k !== "_default")
    .sort((a, b) => b.length - a.length)
  for (const key of sortedKeys) {
    if (modelLower.includes(key.toLowerCase())) {
      return BUILTIN_PRICING[key]
    }
  }
  if (config && config.models) {
    const partialUserPricing = findModelConfigPricing(config.models, model, provider, true)
    if (partialUserPricing) {
      return partialUserPricing
    }
  }
  return BUILTIN_PRICING["_default"]
}

export function calculateCost(
  model: string,
  provider: string,
  input: number,
  output: number,
  cacheRead: number = 0,
  cacheWrite: number = 0,
  config?: TrackerConfig
): number {
  const pricing = getModelPricing(model, provider, config)
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
    defaultCacheReadRate = 0.5
    defaultCacheWriteRate = 0
  }
  
  const finalCacheReadPrice = pricing.cacheRead ?? (pricing.input * defaultCacheReadRate)
  const finalCacheWritePrice = pricing.cacheWrite ?? (pricing.input * defaultCacheWriteRate)
  
  // OpenCode exposes net-new input tokens separately from cacheRead tokens.
  // Charge both fields independently instead of subtracting cacheRead from input.
  const inputCost = (input / 1_000_000) * pricing.input
  const outputCost = (output / 1_000_000) * pricing.output
  const cacheReadCost = (cacheRead / 1_000_000) * finalCacheReadPrice
  const cacheWriteCost = (cacheWrite / 1_000_000) * finalCacheWritePrice
  
  return inputCost + outputCost + cacheReadCost + cacheWriteCost
}
