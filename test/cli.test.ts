import { describe, it } from "node:test"
import { strict as assert } from "node:assert"
import { execSync } from "child_process"
import { fileURLToPath } from "url"
import { join, dirname } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, "..", "bin", "opencode-tokens.js")

function run(args: string): string {
  return execSync(`node ${CLI} ${args}`, { encoding: "utf-8", timeout: 10000 })
}

describe("CLI help and stats", () => {
  it("should show help", () => {
    const out = run("--help")
    assert.ok(out.includes("opencode-tokens - Token usage statistics CLI"))
    assert.ok(out.includes("trend"))
    assert.ok(out.includes("export"))
    assert.ok(out.includes("config set"))
  })

  it("should show stats by session", () => {
    const out = run("--by session")
    assert.ok(out.includes("By Session") || out.includes("No data"))
  })

  it("should show budget", () => {
    const out = run("budget")
    assert.ok(out.includes("Budget Status"))
  })
})

describe("CLI config", () => {
  it("should set, get, and unset config value", () => {
    run("config set toast.duration 5000")
    const out = run("config get toast.duration")
    assert.ok(out.includes("5000"))
    run("config unset toast.duration")
  })

  it("should reject unknown config key", () => {
    const out = run("config get nonexistent.key")
    assert.ok(out.includes("Unknown key"))
  })
})

describe("CLI export", () => {
  it("should export as CSV", () => {
    const out = run("export --format csv --period today")
    assert.ok(out.includes("timestamp") || out.includes("No data"))
  })

  it("should export as JSON", () => {
    const out = run("export --format json --period today")
    assert.ok(out.startsWith("[") || out.includes("No data"))
  })
})

describe("CLI trend", () => {
  it("should show trend chart", () => {
    const out = run("trend --days 7")
    assert.ok(out.includes("┤") || out.includes("(no data"))
  })
})
