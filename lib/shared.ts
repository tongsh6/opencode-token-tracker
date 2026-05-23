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

export interface ProviderModelPricingMap {
  [provider: string]: ModelPricing
}

// ============================================================================
// Built-in Pricing (USD per 1M tokens) - Updated 2026-02-11
// Sources:
// - Anthropic: https://www.anthropic.com/pricing#api
// - OpenAI: https://openai.com/api/pricing/
// - DeepSeek: https://api-docs.deepseek.com/quick_start/pricing
// - Google: https://cloud.google.com/vertex-ai/generative-ai/pricing
// ============================================================================

export const BUILTIN_PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude (https://www.anthropic.com/pricing#api)
  // Opus 4.6: $5 input, $25 output (≤200K), cache write $6.25, cache read $0.50
  "claude-opus-4.6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  // Opus 4.5 (legacy): same pricing as Opus 4.6
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
  // Gemini 3 Flash Preview: $0.5 input, $3 output
  "gemini-3-flash": { input: 0.5, output: 3, cacheRead: 0.05 },
  "gemini-3-flash-preview": { input: 0.5, output: 3, cacheRead: 0.05 },
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

// ============================================================================
// Time Utilities
// ============================================================================

export function getStartOfDay(date: Date = new Date()): number {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
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
