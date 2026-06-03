import { describe, it, before, after } from "node:test"
import { strict as assert } from "node:assert"
import { spawnSync } from "child_process"
import { fileURLToPath } from "url"
import { join, dirname } from "path"
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from "fs"
import { tmpdir } from "os"

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, "..", "bin", "opencode-tokens.js")

let tmpHome = ""

before(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "token-tracker-test-"))
})

after(() => {
  if (tmpHome && existsSync(tmpHome)) {
    rmSync(tmpHome, { recursive: true, force: true })
  }
})

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync("node", [CLI, ...args], {
    encoding: "utf-8",
    timeout: 10000,
    env: { ...process.env, ...env, HOME: tmpHome, USERPROFILE: tmpHome }
  })
}

describe("CLI help and stats", () => {
  it("should show help with disclaimer", () => {
    const res = run(["--help"])
    assert.equal(res.status, 0)
    assert.ok(res.stdout.includes("opencode-tokens - Token usage statistics CLI"))
    assert.ok(res.stdout.includes("trend"))
    assert.ok(res.stdout.includes("export"))
    assert.ok(res.stdout.includes("config set"))
    assert.ok(res.stdout.includes("Costs are estimates from local logs; budgets are warnings, not enforcement."))
  })

  it("should show stats by session", () => {
    const res = run(["--by", "session"])
    assert.equal(res.status, 0)
    assert.ok(res.stdout.includes("By Session") || res.stdout.includes("No data"))
  })

  it("should group daily breakdown by local date", () => {
    const logsDir = join(tmpHome, ".config", "opencode", "logs", "token-tracker")
    mkdirSync(logsDir, { recursive: true })
    const logsFile = join(logsDir, "tokens.jsonl")
    const entries = [
      {
        type: "tokens",
        _ts: Date.parse("2026-05-29T01:00:00.000Z"),
        input: 500,
        output: 0,
        cost: 0.5,
        provider: "openai",
        model: "gpt-4o",
      },
      {
        type: "tokens",
        _ts: Date.parse("2026-05-29T16:30:00.000Z"),
        input: 1000,
        output: 0,
        cost: 1,
        provider: "openai",
        model: "gpt-4o",
      },
      {
        type: "tokens",
        _ts: Date.parse("2026-05-30T01:00:00.000Z"),
        input: 2000,
        output: 0,
        cost: 2,
        provider: "openai",
        model: "gpt-4o",
      },
    ]
    writeFileSync(logsFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`)

    try {
      const res = run(["--by", "daily"], { TZ: "Asia/Shanghai" })
      assert.equal(res.status, 0)
      assert.match(res.stdout, /2026-05-30\s+3\.0K\s+\$3\.00\s+2/)
      assert.match(res.stdout, /2026-05-29\s+500\s+\$0\.500\s+1/)
    } finally {
      rmSync(logsFile, { force: true })
    }
  })

  it("should include cache-only entries in stats", () => {
    const logsDir = join(tmpHome, ".config", "opencode", "logs", "token-tracker")
    mkdirSync(logsDir, { recursive: true })
    const logsFile = join(logsDir, "tokens.jsonl")
    const entry = {
      type: "tokens",
      _ts: Date.now(),
      input: 0,
      output: 0,
      cacheRead: 1234,
      cacheWrite: 456,
      cost: 0.123,
      provider: "anthropic",
      model: "claude-sonnet-4",
    }
    writeFileSync(logsFile, `${JSON.stringify(entry)}\n`)

    try {
      const res = run(["today"])
      assert.equal(res.status, 0)
      assert.match(res.stdout, /Total Tokens:\s+0/)
      assert.match(res.stdout, /Cache Read:\s+1\.2K/)
      assert.match(res.stdout, /Total Cost:\s+\$0\.123/)
      assert.match(res.stdout, /Messages:\s+1/)
    } finally {
      rmSync(logsFile, { force: true })
    }
  })

  it("should reject unknown top-level commands and stats arguments", () => {
    const unknownCommand = run(["frobnicate"])
    assert.equal(unknownCommand.status, 1)
    assert.ok(unknownCommand.stderr.includes("Unknown command or stats period: frobnicate"))

    const misspelledPeriod = run(["todays"])
    assert.equal(misspelledPeriod.status, 1)
    assert.ok(misspelledPeriod.stderr.includes("Unknown command or stats period: todays"))

    const extraStatsArg = run(["today", "extra"])
    assert.equal(extraStatsArg.status, 1)
    assert.ok(extraStatsArg.stderr.includes("Unexpected argument for stats command: extra"))

    const validPeriod = run(["all", "--by", "model"])
    assert.equal(validPeriod.status, 0)
    assert.ok(validPeriod.stdout.includes("By Model") || validPeriod.stdout.includes("No data"))
  })

  it("should reject invalid stats breakdown options", () => {
    const invalidLong = run(["--by", "bananas"])
    assert.equal(invalidLong.status, 1)
    assert.ok(invalidLong.stderr.includes("Unsupported stats breakdown: bananas"))
    assert.ok(invalidLong.stderr.includes("Allowed breakdowns: model, agent, provider, daily, day, session, all"))

    const invalidPeriodLong = run(["today", "--by", "bananas"])
    assert.equal(invalidPeriodLong.status, 1)
    assert.ok(invalidPeriodLong.stderr.includes("Unsupported stats breakdown: bananas"))

    const missingLong = run(["--by"])
    assert.equal(missingLong.status, 1)
    assert.ok(missingLong.stderr.includes("Missing value for --by"))

    const invalidShort = run(["-b", "bananas"])
    assert.equal(invalidShort.status, 1)
    assert.ok(invalidShort.stderr.includes("Unsupported stats breakdown: bananas"))

    const missingShort = run(["-b"])
    assert.equal(missingShort.status, 1)
    assert.ok(missingShort.stderr.includes("Missing value for -b"))
  })

  it("should show budget with disclaimer", () => {
    // 1. Check with unconfigured budget
    const resUnconfigured = run(["budget"])
    assert.equal(resUnconfigured.status, 0)
    assert.ok(resUnconfigured.stdout.includes("No budget configured."))
    assert.ok(resUnconfigured.stdout.includes("Costs are estimates from local logs; budgets are warnings, not enforcement."))

    // 2. Check with configured budget
    run(["config", "generate"])
    const resConfigured = run(["budget"])
    assert.equal(resConfigured.status, 0)
    assert.ok(resConfigured.stdout.includes("Budget Status"))
    assert.ok(resConfigured.stdout.includes("Daily"))
    assert.ok(resConfigured.stdout.includes("Costs are estimates from local logs; budgets are warnings, not enforcement."))
  })
})

describe("CLI config", () => {
  it("should set, get, and unset config value", () => {
    run(["config", "set", "toast.duration", "5000"])
    const getRes = run(["config", "get", "toast.duration"])
    assert.ok(getRes.stdout.includes("5000"))
    
    run(["config", "unset", "toast.duration"])
    const getUnsetRes = run(["config", "get", "toast.duration"])
    assert.ok(getUnsetRes.stdout.includes("3000")) // default value
  })

  it("should reject unknown config key", () => {
    const res = run(["config", "get", "nonexistent.key"])
    assert.equal(res.status, 1)
    assert.ok(res.stderr.includes("Unknown config key: nonexistent.key"))
    assert.ok(res.stderr.includes("Available keys:"))
  })

  it("should reject invalid config command usage", () => {
    const missingGetKey = run(["config", "get"])
    assert.equal(missingGetKey.status, 1)
    assert.ok(missingGetKey.stderr.includes("Missing config key"))
    assert.ok(missingGetKey.stderr.includes("opencode-tokens config get <key>"))

    const missingSetKey = run(["config", "set"])
    assert.equal(missingSetKey.status, 1)
    assert.ok(missingSetKey.stderr.includes("Missing config key"))

    const missingSetValue = run(["config", "set", "budget.daily"])
    assert.equal(missingSetValue.status, 1)
    assert.ok(missingSetValue.stderr.includes("Missing config value"))

    const invalidType = run(["config", "set", "budget.daily", "abc"])
    assert.equal(invalidType.status, 1)
    assert.ok(invalidType.stderr.includes("Invalid type for budget.daily: expected number, got string"))

    const negativeNumber = run(["config", "set", "budget.daily", "-1"])
    assert.equal(negativeNumber.status, 1)
    assert.ok(negativeNumber.stderr.includes("Invalid value for budget.daily: must be >= 0"))

    const tooLargeNumber = run(["config", "set", "budget.warnAt", "2"])
    assert.equal(tooLargeNumber.status, 1)
    assert.ok(tooLargeNumber.stderr.includes("Invalid value for budget.warnAt: must be <= 1"))

    const missingUnsetKey = run(["config", "unset"])
    assert.equal(missingUnsetKey.status, 1)
    assert.ok(missingUnsetKey.stderr.includes("Missing config key"))
    assert.ok(missingUnsetKey.stderr.includes("opencode-tokens config unset <key>"))

    const unknownUnsetKey = run(["config", "unset", "nonexistent.key"])
    assert.equal(unknownUnsetKey.status, 1)
    assert.ok(unknownUnsetKey.stderr.includes("Unknown config key: nonexistent.key"))

    const unknownAction = run(["config", "wat"])
    assert.equal(unknownAction.status, 1)
    assert.ok(unknownAction.stderr.includes("Unknown config action: wat"))
  })
})

describe("CLI export", () => {
  it("should export as CSV", () => {
    const res = run(["export", "--format", "csv", "--period", "today"])
    assert.ok(res.stdout.includes("timestamp") || res.stdout.includes("No data"))
  })

  it("should export as JSON", () => {
    const res = run(["export", "--format", "json", "--period", "today"])
    assert.ok(res.stdout.startsWith("[") || res.stdout.includes("No data"))
  })

  it("should write export output to a file", () => {
    const logsDir = join(tmpHome, ".config", "opencode", "logs", "token-tracker")
    mkdirSync(logsDir, { recursive: true })
    const logsFile = join(logsDir, "tokens.jsonl")
    const outputFile = join(tmpHome, "usage.csv")
    const entry = {
      type: "tokens",
      _ts: Date.now(),
      input: 1000,
      output: 500,
      cost: 0.01,
      provider: "openai",
      model: "gpt-4o",
    }
    writeFileSync(logsFile, JSON.stringify(entry) + "\n")

    const res = run(["export", "--format", "csv", "--output", outputFile])
    assert.equal(res.status, 0)
    assert.ok(res.stdout.includes(`Exported 1 entries to ${outputFile}`))
    assert.equal(existsSync(outputFile), true)
    assert.ok(readFileSync(outputFile, "utf-8").includes("gpt-4o"))

    rmSync(logsFile, { force: true })
    rmSync(outputFile, { force: true })
  })

  it("should reject invalid export options", () => {
    const invalidFormat = run(["export", "--format", "xml"])
    assert.equal(invalidFormat.status, 1)
    assert.ok(invalidFormat.stderr.includes("Unsupported export format: xml"))
    assert.ok(invalidFormat.stderr.includes("Allowed formats: csv, json"))

    const invalidPeriod = run(["export", "--period", "yesterday"])
    assert.equal(invalidPeriod.status, 1)
    assert.ok(invalidPeriod.stderr.includes("Unsupported export period: yesterday"))
    assert.ok(invalidPeriod.stderr.includes("Allowed periods: today, week, month, all"))

    const missingOutput = run(["export", "--output"])
    assert.equal(missingOutput.status, 1)
    assert.ok(missingOutput.stderr.includes("Missing value for --output"))
  })
})

describe("CLI trend", () => {
  it("should show trend chart", () => {
    const res = run(["trend", "--days", "7"])
    assert.equal(res.status, 0)
    assert.ok(res.stdout.includes("┤") || res.stdout.includes("(no data"))
  })

  it("should reject invalid trend options", () => {
    const invalidMetric = run(["trend", "--metric", "bananas"])
    assert.equal(invalidMetric.status, 1)
    assert.ok(invalidMetric.stderr.includes("Unsupported trend metric: bananas"))
    assert.ok(invalidMetric.stderr.includes("Allowed metrics: cost, tokens, messages"))

    const invalidDays = run(["trend", "--days", "abc"])
    assert.equal(invalidDays.status, 1)
    assert.ok(invalidDays.stderr.includes("Invalid value for --days: abc"))

    const zeroDays = run(["trend", "--days", "0"])
    assert.equal(zeroDays.status, 1)
    assert.ok(zeroDays.stderr.includes("Invalid value for --days: 0"))

    const invalidWidth = run(["trend", "--width", "abc"])
    assert.equal(invalidWidth.status, 1)
    assert.ok(invalidWidth.stderr.includes("Invalid value for --width: abc"))

    const missingMetric = run(["trend", "--metric"])
    assert.equal(missingMetric.status, 1)
    assert.ok(missingMetric.stderr.includes("Missing value for --metric"))
  })
})

describe("CLI models", () => {
  it("should show actionable next steps for default-priced models and local providers", () => {
    const configPath = join(tmpHome, ".config", "opencode", "token-tracker.json")
    if (existsSync(configPath)) {
      rmSync(configPath, { force: true })
    }

    const logsDir = join(tmpHome, ".config", "opencode", "logs", "token-tracker")
    mkdirSync(logsDir, { recursive: true })
    const logsFile = join(logsDir, "tokens.jsonl")

    const localEntry = {
      type: "tokens",
      _ts: Date.now(),
      input: 1000,
      output: 1000,
      cost: 0.01,
      provider: "ollama",
      model: "qwen3.5:35b-a3b",
    }
    const paidEntry = {
      type: "tokens",
      _ts: Date.now(),
      input: 1000,
      output: 1000,
      cost: 0.01,
      provider: "mystery-api",
      model: "fallback-gpt-7",
    }
    writeFileSync(logsFile, JSON.stringify(localEntry) + "\n" + JSON.stringify(paidEntry) + "\n")

    const res = run(["models"])
    assert.equal(res.status, 0)
    assert.ok(res.stdout.includes("qwen3.5:35b-a3b"))
    assert.ok(res.stdout.includes("fallback-gpt-7"))
    assert.ok(res.stdout.includes("default"))
    assert.ok(res.stdout.includes("Next steps for default pricing:"))
    assert.ok(res.stdout.includes("opencode-tokens config init"))
    assert.ok(res.stdout.includes("opencode-tokens config generate"))
    assert.ok(res.stdout.includes("Likely zero-cost provider overrides to review:"))
    assert.ok(res.stdout.includes("ollama"))
    assert.ok(res.stdout.includes("{ \"input\": 0, \"output\": 0 }"))
    assert.ok(res.stdout.includes("{ \"input\": 1, \"output\": 4 }"))

    rmSync(logsFile, { force: true })
  })
})

describe("CLI doctor", () => {
  it("should diagnose missing setup and empty logs", () => {
    const configDir = join(tmpHome, ".config", "opencode")
    const trackerConfigPath = join(configDir, "token-tracker.json")
    const opencodeConfigPath = join(configDir, "opencode.jsonc")
    const logsFile = join(configDir, "logs", "token-tracker", "tokens.jsonl")

    rmSync(trackerConfigPath, { force: true })
    rmSync(opencodeConfigPath, { force: true })
    rmSync(logsFile, { force: true })

    const res = run(["doctor"])
    assert.equal(res.status, 0)
    assert.ok(res.stdout.includes("OpenCode Token Tracker Doctor"))
    assert.ok(res.stdout.includes("OpenCode plugin config"))
    assert.ok(res.stdout.includes("File: not found"))
    assert.ok(res.stdout.includes("Tracker config"))
    assert.ok(res.stdout.includes("Status: using defaults"))
    assert.ok(res.stdout.includes("Token log"))
    assert.ok(res.stdout.includes("Entries: 0"))
    assert.ok(res.stdout.includes("Next steps"))
  })

  it("should diagnose configured plugin, logs, and default pricing", () => {
    const configDir = join(tmpHome, ".config", "opencode")
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, "opencode.jsonc"), `{\n  "plugin": ["opencode-token-tracker"]\n}\n`)
    writeFileSync(join(configDir, "token-tracker.json"), JSON.stringify({ budget: { daily: 5 } }, null, 2))

    const logsDir = join(configDir, "logs", "token-tracker")
    mkdirSync(logsDir, { recursive: true })
    const logsFile = join(logsDir, "tokens.jsonl")
    const entry = {
      type: "tokens",
      _ts: Date.now(),
      input: 1000,
      output: 1000,
      cost: 0.01,
      provider: "ollama",
      model: "qwen3.5:35b-a3b",
    }
    writeFileSync(logsFile, JSON.stringify(entry) + "\n")

    const res = run(["doctor"])
    assert.equal(res.status, 0)
    assert.ok(res.stdout.includes("Plugin entry: found"))
    assert.ok(res.stdout.includes("Status: exists"))
    assert.ok(res.stdout.includes("Budget: configured"))
    assert.ok(res.stdout.includes("Entries: 1"))
    assert.ok(res.stdout.includes("Default-priced model/provider pairs: 1"))
    assert.ok(res.stdout.includes("Likely zero-cost providers:"))
    assert.ok(res.stdout.includes("qwen3.5:35b-a3b"))
    assert.ok(res.stdout.includes("ollama"))
    assert.ok(res.stdout.includes("opencode-tokens models"))

    rmSync(logsFile, { force: true })
    rmSync(join(configDir, "opencode.jsonc"), { force: true })
    rmSync(join(configDir, "token-tracker.json"), { force: true })
  })
})

describe("CLI config stream separation and suggestions", () => {
  it("should run config init with clean stdout JSON and stderr guides", () => {
    const configPath = join(tmpHome, ".config", "opencode", "token-tracker.json")
    if (existsSync(configPath)) {
      rmSync(configPath, { force: true })
    }

    const res = run(["config", "init"])
    assert.equal(res.status, 0)
    
    // Stdout must be 100% clean valid JSON
    const parsed = JSON.parse(res.stdout.trim())
    assert.ok(parsed.toast)
    assert.ok(parsed.budget)
    assert.equal(parsed.budget.daily, 5) // default limit since no entries exist

    // Stderr must contain the guide text
    assert.ok(res.stderr.includes("Configuration Guide"))
    assert.ok(res.stderr.includes("To create this config file"))

    // Side effect: File must NOT be created
    assert.equal(existsSync(configPath), false)
  })

  it("should run config generate with empty stdout, stderr guides, and create config with backup", () => {
    const configPath = join(tmpHome, ".config", "opencode", "token-tracker.json")
    const backupPath = join(tmpHome, ".config", "opencode", "token-tracker.json.bak")
    
    if (existsSync(configPath)) {
      rmSync(configPath, { force: true })
    }
    if (existsSync(backupPath)) {
      rmSync(backupPath, { force: true })
    }

    const res = run(["config", "generate"])
    assert.equal(res.status, 0)

    // Stdout must be completely empty (0 bytes) to prevent shell truncation backup failures (P1)
    assert.equal(res.stdout.trim(), "")

    // Stderr check
    assert.ok(res.stderr.includes("Configuration Guide"))
    assert.ok(res.stderr.includes("Config file created:"))

    // Side effect check: file must exist
    assert.equal(existsSync(configPath), true)
    const fileContent = JSON.parse(readFileSync(configPath, "utf-8"))
    assert.equal(fileContent.toast.enabled, true)

    // Backup Safety Validation:
    // Write pre-existing mock configuration
    const preExistingMock = { budget: { daily: 999 } }
    writeFileSync(configPath, JSON.stringify(preExistingMock, null, 2))

    // Run generate again to overwrite
    const res2 = run(["config", "generate"])
    assert.equal(res2.status, 0)
    assert.equal(res2.stdout.trim(), "")

    // Config must be overwritten
    const fileContent2 = JSON.parse(readFileSync(configPath, "utf-8"))
    assert.ok(fileContent2.toast)
    assert.notDeepEqual(fileContent2, preExistingMock)

    // Backup file must exist and contain the preExistingMock
    assert.equal(existsSync(backupPath), true)
    const backupContent = JSON.parse(readFileSync(backupPath, "utf-8"))
    assert.deepEqual(backupContent, preExistingMock)
  })

  it("should parse logs and generate dynamic suggestions with proper formulas", () => {
    const configPath = join(tmpHome, ".config", "opencode", "token-tracker.json")
    if (existsSync(configPath)) {
      rmSync(configPath, { force: true })
    }

    // 1. Create logs directory and fake log file inside sandbox tmpHome
    const logsDir = join(tmpHome, ".config", "opencode", "logs", "token-tracker")
    mkdirSync(logsDir, { recursive: true })
    const logsFile = join(logsDir, "tokens.jsonl")

    // 2. Generate 7 daily log lines with cost = $1.00 each
    const now = Date.now()
    let logLines = ""
    for (let i = 0; i < 7; i++) {
      const entry = {
        type: "tokens",
        _ts: now - i * 24 * 60 * 60 * 1000,
        input: 1000,
        output: 1000,
        cost: 1.0,
        provider: "free-copilot",
        model: "fallback-gpt-7"
      }
      logLines += JSON.stringify(entry) + "\n"
    }
    logLines += JSON.stringify({
      type: "tokens",
      _ts: now,
      input: 1000,
      output: 1000,
      cost: 0,
      provider: "ollama",
      model: "qwen3.5:35b-a3b",
    }) + "\n"
    logLines += JSON.stringify({
      type: "tokens",
      _ts: now,
      input: 1000,
      output: 1000,
      cost: 0,
      provider: "mystery-api",
      model: "paid-fallback-model",
    }) + "\n"
    writeFileSync(logsFile, logLines)

    // 3. Run config init to capture dynamic recommendation budgets
    const res = run(["config", "init"])
    assert.equal(res.status, 0)

    // Stdout JSON check: budgets must perfectly align with our exact dynamic formulas (P3)
    const parsed = JSON.parse(res.stdout.trim())
    assert.equal(parsed.budget.daily, 1.5)  // avg $1.0 * 1.5
    assert.equal(parsed.budget.weekly, 9.1) // avg $1.0 * 7 * 1.3
    assert.equal(parsed.budget.monthly, 36) // avg $1.0 * 30 * 1.2

    // Detected zero-cost provider override in example config (P2)
    assert.deepEqual(parsed.providers["free-copilot"], { input: 0, output: 0 })
    assert.deepEqual(parsed.providers["ollama"], { input: 0, output: 0 })
    // Detected fallback model override in example config (P2)
    assert.equal(parsed.models["fallback-gpt-7"], undefined)
    assert.equal(parsed.models["qwen3.5:35b-a3b"], undefined)
    assert.deepEqual(parsed.models["paid-fallback-model"], { input: 1, output: 4 })

    // Stderr output check: must print dynamic Usage-Aware Suggestions Summary (P2)
    assert.ok(res.stderr.includes("📢 Usage-Aware Suggestions Summary"))
    assert.ok(res.stderr.includes("Found 9 historical usage entries"))
    assert.ok(res.stderr.includes("Calculated 7-day average daily cost: $1.0000"))
    assert.ok(res.stderr.includes("Daily Limit   : $1.50"))
    assert.ok(res.stderr.includes("Weekly Limit  : $9.10"))
    assert.ok(res.stderr.includes("Monthly Limit : $36.00"))
    assert.ok(res.stderr.includes("Detected likely zero-cost providers:"))
    assert.ok(res.stderr.includes("free-copilot"))
    assert.ok(res.stderr.includes("ollama"))
    assert.ok(res.stderr.includes("Detected unrecognized fallback models:"))
    assert.ok(res.stderr.includes("paid-fallback-model"))

    // Clean up fake files
    rmSync(logsFile, { force: true })
  })
})

describe("CLI pricing metadata and notice", () => {
  it("should display metadata and fallback pricing notice in pricing command", () => {
    const res = run(["pricing"])
    assert.equal(res.status, 0)
    assert.ok(res.stdout.includes("Pricing last updated:"))
    assert.ok(res.stdout.includes("Metadata last updated:"))
    assert.ok(res.stdout.includes("Source:"))
    assert.ok(res.stdout.includes("Fallback Pricing Notice:"))
    assert.ok(res.stdout.includes("claude-sonnet-4.6"))
    assert.ok(res.stdout.includes("gpt-5.5"))
    assert.ok(res.stdout.includes("deepseek-v4-pro"))
    assert.ok(res.stdout.includes("gemini-3.1-pro-preview"))
  })
})

describe("CLI session breakdown", () => {
  it("should show titles, roll up child sessions into the parent, and fall back to a short code", () => {
    const logsDir = join(tmpHome, ".config", "opencode", "logs", "token-tracker")
    mkdirSync(logsDir, { recursive: true })
    const logsFile = join(logsDir, "tokens.jsonl")
    const sessionsFile = join(logsDir, "sessions.jsonl")

    const now = Date.now()
    const parentId = "ses_parentAAAAAAAAAAAA"
    const childId = "ses_childBBBBBBBBBBBB"
    const orphanId = "ses_ZZZZZZZZZZZZ1234567890"

    const tokenEntries = [
      { type: "tokens", _ts: now, sessionId: parentId, input: 1000, output: 0, cost: 1, provider: "openai", model: "gpt-4o" },
      { type: "tokens", _ts: now, sessionId: childId, input: 2000, output: 0, cost: 2, provider: "openai", model: "gpt-4o" },
      { type: "tokens", _ts: now, sessionId: orphanId, input: 500, output: 0, cost: 0.5, provider: "openai", model: "gpt-4o" },
    ]
    writeFileSync(logsFile, `${tokenEntries.map((e) => JSON.stringify(e)).join("\n")}\n`)

    const sessionRecords = [
      { type: "session", sessionId: parentId, title: "Fix login redirect bug", _ts: now },
      { type: "session", sessionId: childId, parentID: parentId, _ts: now },
    ]
    writeFileSync(sessionsFile, `${sessionRecords.map((s) => JSON.stringify(s)).join("\n")}\n`)

    try {
      const res = run(["--by", "session"])
      assert.equal(res.status, 0)
      assert.ok(res.stdout.includes("By Session"))
      // New Last Active column header
      assert.ok(res.stdout.includes("Last Active"))
      // Parent title shown, with child rolled up: 1000+2000 tokens, $1+$2, 2 msgs
      assert.match(res.stdout, /Fix login redirect bug.*3\.0K\s+\$3\.00\s+2/)
      // Orphan with no metadata falls back to a distinctive short code
      assert.ok(res.stdout.includes("…1234567890"))
      // Recent activity is shown compactly, not the verbose "less than 1m ago"
      assert.ok(res.stdout.includes("just now"))
      assert.ok(!res.stdout.includes("less than 1m ago"))
    } finally {
      rmSync(logsFile, { force: true })
      rmSync(sessionsFile, { force: true })
    }
  })
})
