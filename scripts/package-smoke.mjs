import { strict as assert } from "node:assert"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"

const root = fileURLToPath(new URL("../", import.meta.url))
const expectedVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version
const fixture = mkdtempSync(join(tmpdir(), "token-tracker-package-"))

try {
  // 不执行生命周期脚本或安装依赖，使用构建产物与工作区已有 SDK。
  const packed = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", fixture,
    "--cache", join(fixture, "cache")], { cwd: root, encoding: "utf8" }))[0]
  const files = new Set(packed.files.map(file => file.path))
  for (const path of ["dist/index.js", "dist/index.d.ts", "dist/tui.js", "dist/tui.d.ts",
    "dist/lib/tracker.js", "dist/lib/rpc.js", "dist/lib/shared.js", "dist/bin/opencode-tokens.js"]) {
    assert.ok(files.has(path), `npm 包缺少 ${path}`)
  }
  assert.ok(![...files].some(path => path.startsWith("dist/test/")), "测试文件不应进入发布包")
  const installed = join(fixture, "node_modules", packed.name)
  mkdirSync(installed, { recursive: true })
  execFileSync("tar", ["-xzf", join(fixture, packed.filename), "--strip-components=1", "-C", installed])
  symlinkSync(join(root, "node_modules"), join(installed, "node_modules"), "dir")
  const entries = Host.resolve({ directory: fixture, name: packed.name })
  assert.ok(entries.server?.includes("/dist/index.js"), "发布包未解析到服务端构建入口")
  assert.ok(entries.tui?.includes("/dist/tui.js"), "发布包未解析到 TUI 构建入口")
  const server = await Host.load(entries.server)
  const tui = await Host.load(entries.tui)
  assert.equal(server.default.id, "opencode-token-tracker")
  assert.equal(typeof server.default.setup, "function")
  assert.equal(tui.default.id, "opencode-token-tracker.tui")
  assert.equal(typeof tui.default.setup, "function")
  const pkg = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"))
  assert.equal(pkg.version, expectedVersion)
  const help = execFileSync(process.execPath, [join(installed, pkg.bin["opencode-tokens"]), "--help"], { encoding: "utf8" })
  assert.match(help, /opencode-tokens/)
  console.log(`发布包验证通过：${packed.name}@${pkg.version}，服务端 / TUI / CLI 均可加载。`)
} finally {
  rmSync(fixture, { recursive: true, force: true })
}
