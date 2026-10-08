#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, "..")
const PACKAGE_JSON = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8"))
const PACKAGE_NAME = PACKAGE_JSON.name
const TOKEN_LOG = join(homedir(), ".config", "opencode", "logs", "token-tracker", "tokens.jsonl")
const DEFAULT_ARTIFACT_ROOT = join(REPO_ROOT, "dogfood-artifacts")

function parseArgs(argv) {
  const opts = {
    opencode: process.env.OPENCODE_CLI || "",
    model: process.env.OPENCODE_DOGFOOD_MODEL || "",
    prompt: process.env.OPENCODE_DOGFOOD_PROMPT || "Reply with OK only.",
    timeoutMs: Number(process.env.OPENCODE_DOGFOOD_TIMEOUT_MS || "120000"),
    artifactsDir: process.env.OPENCODE_DOGFOOD_ARTIFACTS || DEFAULT_ARTIFACT_ROOT,
    failOnOpencodeCostDrift: process.env.OPENCODE_DOGFOOD_FAIL_ON_OPENCODE_COST_DRIFT === "1",
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      i += 1
      if (i >= argv.length) {
        throw new Error(`Missing value for ${arg}`)
      }
      return argv[i]
    }

    if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    } else if (arg === "--opencode") {
      opts.opencode = next()
    } else if (arg === "--model") {
      opts.model = next()
    } else if (arg === "--prompt") {
      opts.prompt = next()
    } else if (arg === "--timeout-ms") {
      opts.timeoutMs = Number(next())
    } else if (arg === "--artifacts-dir") {
      opts.artifactsDir = resolve(next())
    } else if (arg === "--allow-cost-drift") {
      opts.failOnOpencodeCostDrift = false
    } else if (arg === "--fail-on-opencode-cost-drift") {
      opts.failOnOpencodeCostDrift = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number")
  }

  return opts
}

function printHelp() {
  console.log(`real-opencode-cli-smoke

Runs a real local opencode CLI request and verifies that ${PACKAGE_NAME} works
as the installed OpenCode plugin.

Usage:
  node scripts/real-opencode-cli-smoke.mjs [options]

Options:
  --opencode PATH          Use a specific opencode CLI binary
  --model PROVIDER/MODEL   Pass --model to opencode run
  --prompt TEXT            Prompt passed to opencode run
  --timeout-ms NUMBER      Child process timeout, default 120000
  --artifacts-dir DIR      Directory for stdout/stderr/summary artifacts
  --allow-cost-drift       Keep OpenCode reported cost drift informational (default)
  --fail-on-opencode-cost-drift
                           Treat OpenCode reported cost drift as a failure
  --help                   Show this help

Environment:
  OPENCODE_CLI
  OPENCODE_DOGFOOD_MODEL
  OPENCODE_DOGFOOD_PROMPT
  OPENCODE_DOGFOOD_TIMEOUT_MS
  OPENCODE_DOGFOOD_ARTIFACTS
  OPENCODE_DOGFOOD_FAIL_ON_OPENCODE_COST_DRIFT`)
}

function findOpencode(explicit) {
  if (explicit) return explicit

  const fromPath = spawnSync("which", ["opencode"], { encoding: "utf-8" })
  if (fromPath.status === 0 && fromPath.stdout.trim()) {
    return fromPath.stdout.trim()
  }

  const fallback = join(homedir(), ".opencode", "bin", "opencode")
  if (existsSync(fallback)) {
    return fallback
  }

  throw new Error("Unable to locate opencode. Set OPENCODE_CLI or pass --opencode.")
}

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
    ...options,
  })
}

function makeArtifactDir(root) {
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")
  const dir = join(root, stamp)
  mkdirSync(dir, { recursive: true })
  return dir
}

function getFileSize(path) {
  if (!existsSync(path)) return 0
  return statSync(path).size
}

function readAppended(path, beforeSize) {
  if (!existsSync(path)) return ""
  const stat = statSync(path)
  if (stat.size < beforeSize) {
    return readFileSync(path, "utf-8")
  }
  const content = readFileSync(path)
  return content.subarray(beforeSize).toString("utf-8")
}

function parseJsonLines(text) {
  const records = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      records.push(JSON.parse(trimmed))
    } catch {}
  }
  return records
}

function getLastStepFinish(records) {
  return records.filter((record) => record?.type === "step_finish").at(-1)
}

function findMatchingTokenRecord(records, stepFinish) {
  const tokenRecords = records.filter((record) => record?.type === "tokens")
  const sessionID = stepFinish?.sessionID || stepFinish?.part?.sessionID
  const messageID = stepFinish?.part?.messageID

  if (sessionID && messageID) {
    const exact = tokenRecords.find((record) => record.sessionId === sessionID && record.messageId === messageID)
    if (exact) return exact
  }

  return undefined
}

function hasPluginLoadError(stderr) {
  return /failed to load plugin[^\n]*opencode-token-tracker|opencode-token-tracker[^\n]*failed to load plugin/i.test(stderr)
}

function compareCosts(opencodeCost, pluginCost) {
  if (typeof opencodeCost !== "number" || typeof pluginCost !== "number") {
    return { comparable: false, ok: true, drift: 0, tolerance: 0 }
  }

  const drift = Math.abs(opencodeCost - pluginCost)
  const tolerance = Math.max(0.000001, Math.abs(opencodeCost) * 0.01)
  return { comparable: true, ok: drift <= tolerance, drift, tolerance }
}

function summarizeFailure(result) {
  const failures = []
  if (result.status !== 0) failures.push(`opencode exited with status ${result.status}`)
  if (result.signal) failures.push(`opencode terminated with signal ${result.signal}`)
  if (result.error) failures.push(`opencode process error: ${result.error.message}`)
  if (result.timedOut) failures.push("opencode process timed out")
  return failures
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const opencode = findOpencode(opts.opencode)
  const artifactDir = makeArtifactDir(opts.artifactsDir)

  const summary = {
    packageName: PACKAGE_NAME,
    packageVersion: PACKAGE_JSON.version,
    repoRoot: REPO_ROOT,
    opencode,
    command: [],
    artifactDir,
    tokenLog: TOKEN_LOG,
    assertions: [],
  }

  try {
    const version = runCommand(opencode, ["--version"])
    summary.opencodeVersion = version.stdout.trim() || version.stderr.trim()

    const match = summary.opencodeVersion.match(/(?:^|\s)v?(\d+)\.(\d+)\.(\d+)/)
    if (version.status !== 0 || !match || Number(match[1]) !== 2 || (Number(match[2]) === 0 && Number(match[3]) < 25)) {
      throw new Error("此验收需要 OpenCode >= 2.0.25 且 < 3；请先准备好 V2 并配置本地插件。脚本不会安装或升级 OpenCode。")
    }

    const beforeSize = getFileSize(TOKEN_LOG)
    const args = ["run", "--standalone", "--print-logs", "--format", "json"]
    if (opts.model) {
      args.push("--model", opts.model)
    }
    args.push(opts.prompt)
    summary.command = [opencode, ...args]

    const run = runCommand(opencode, args, { timeout: opts.timeoutMs, env: { ...process.env, OPENCODE_LOG_LEVEL: "debug" } })
    const stdout = run.stdout || ""
    const stderr = run.stderr || ""
    const appendedLog = readAppended(TOKEN_LOG, beforeSize)

    writeFileSync(join(artifactDir, "stdout.jsonl"), stdout)
    writeFileSync(join(artifactDir, "stderr.log"), stderr)
    writeFileSync(join(artifactDir, "token-log-delta.jsonl"), appendedLog)

    const stdoutRecords = parseJsonLines(stdout)
    const tokenRecords = parseJsonLines(appendedLog)
    const stepFinish = getLastStepFinish(stdoutRecords)
    const tokenRecord = findMatchingTokenRecord(tokenRecords, stepFinish)
    const costCheck = compareCosts(stepFinish?.part?.cost, tokenRecord?.cost)
    const failures = summarizeFailure(run)

    if (hasPluginLoadError(stderr)) failures.push("plugin load error was reported for opencode-token-tracker")
    if (!stepFinish) failures.push("stdout did not contain a step_finish event")
    if (!tokenRecord) failures.push("token log delta did not contain a matching tokens record")
    for (const step of stdoutRecords.filter(record => record?.type === "step_finish")) {
      const record = findMatchingTokenRecord(tokenRecords, step)
      const expected = step.part?.tokens
      if (!record) {
        failures.push(`没有精确匹配 ${step.sessionID}/${step.part?.messageID} 的 token 记录`)
        continue
      }
      const copies = tokenRecords.filter(item => item.type === "tokens" && item.sessionId === record.sessionId && item.messageId === record.messageId)
      if (copies.length !== 1) failures.push(`消息 ${record.messageId} 重复记账`)
      if (expected && (record.input !== expected.input || record.output !== expected.output + expected.reasoning
        || record.reasoning !== expected.reasoning || record.cacheRead !== expected.cache.read || record.cacheWrite !== expected.cache.write)) {
        failures.push(`消息 ${record.messageId} 的 V2 token 映射不一致`)
      }
    }
    summary.toastVerification = "not-applicable: opencode run 不启动 TUI；Toast 由 TUI/RPC 回归和交互验收验证"
    if (costCheck.comparable && !costCheck.ok) {
      const driftMessage = `plugin cost ${tokenRecord.cost} differs from OpenCode cost ${stepFinish.part.cost}; drift ${costCheck.drift} > tolerance ${costCheck.tolerance}`
      if (opts.failOnOpencodeCostDrift) {
        failures.push(driftMessage)
      } else {
        console.error(
          `WARNING: ${driftMessage}. Plugin pricing follows provider official pricing; OpenCode may use stale or different rates.`,
        )
      }
    }

    summary.exitStatus = run.status
    summary.signal = run.signal
    summary.timedOut = Boolean(run.error && run.error.code === "ETIMEDOUT")
    summary.stepFinish = stepFinish
    summary.tokenRecord = tokenRecord
    summary.costCheck = costCheck
    summary.assertions = failures.length === 0 ? ["pass"] : failures
    summary.result = failures.length === 0 ? "pass" : "fail"

    writeFileSync(join(artifactDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)

    console.log(`Real OpenCode CLI dogfood: ${summary.result.toUpperCase()}`)
    console.log(`OpenCode: ${summary.opencodeVersion || "unknown"} (${opencode})`)
    console.log(`Package: ${PACKAGE_NAME}@${PACKAGE_JSON.version}`)
    console.log(`Artifacts: ${artifactDir}`)
    if (failures.length > 0) {
      console.error("Failures:")
      for (const failure of failures) {
        console.error(`- ${failure}`)
      }
      process.exitCode = 1
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    summary.result = "fail"
    summary.assertions = [message]
    writeFileSync(join(artifactDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)
    console.error(message)
    console.error(`Artifacts: ${artifactDir}`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
