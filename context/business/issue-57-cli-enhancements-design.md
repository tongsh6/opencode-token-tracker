# Issue #57 — CLI 功能增强设计

**对应 issue**：[#57 [Feat] 支持 CLI 终端 ASCII 折线趋势图、按 Session 会话分组统计与快捷配置修改](https://github.com/tongsh6/opencode-token-tracker/issues/57)
**目标版本**：1.6.0（minor — 新增功能）
**设计日期**：2026-05-23
**状态**：设计完成，未实施

---

## 范围

4 个独立 CLI 功能，**一起作为 1.6.0 单 PR 发布**：

| # | 功能 | 子命令 | 预估行数 | 复杂度 |
|---|---|---|---|---|
| 1 | ASCII 折线趋势图 | `trend` | ~150 | ⭐⭐⭐ 中-高 |
| 2 | 按 session 分组 | `--by session` | ~15 | ⭐ 极简 |
| 3 | 多格式导出 | `export --format csv\|json` | ~80 | ⭐⭐ 中 |
| 4 | CLI 配置修改 | `config set/get/unset` | ~100 | ⭐⭐ 中 |
| | CLI argparse helper | — | ~50 | — |
| | 测试 | — | ~80 | — |
| | README + CHANGELOG | — | ~50 | — |
| **总计** | | | **~525** | |

---

## 关键决策

| 决策点 | 选定方案 | 备选 |
|---|---|---|
| `trend` 渲染方式 | **B 多行 ASCII 折线**（box-drawing 字符自实现，零依赖） | A sparkline 单行 / C 引入 asciichart |
| `config set` 路径深度 | **仅顶层 + 白名单**（避免模型 ID 含点号冲突） | 全 JSON path |
| `trend` 默认 metric | **cost** | tokens / messages |
| `export` 默认 format | **csv** | json |
| 是否引入 argparse helper | **是**（抽 ~50 行） | 沿用手工 for-loop |
| 是否引入第三方依赖 | **不引入**（项目零依赖偏好） | — |

---

## 功能 1：ASCII 折线趋势图

### CLI 接口

```bash
opencode-tokens trend [--days N] [--metric cost|tokens|messages] [--width W]
```

- `--days`：默认 30
- `--metric`：默认 `cost`
- `--width`:：默认 60 字符

### 数据准备

```
loadEntries(now - daysMs)
  → 按天聚合 (getStartOfDay 为 key)
  → Array<{ date: string, cost: number, tokens: number, messages: number }>
```

### 渲染算法（方案 B：多行 ASCII 折线）

样式示例：
```
$ 5.20 ┤             ╭╮
$ 3.90 ┤            ╭╯╰╮
$ 2.60 ┤        ╭───╯  ╰╮
$ 1.30 ┤  ╭╮╭───╯       ╰────╮
$ 0.00 ┼──╯╰╯                 ╰─
       └────────────────────────
        4/23  4/30  5/7   5/14  5/22
```

算法步骤：
1. 聚合数据按天 → `Array<{day, value}>`
2. 计算 Y 轴 max/min，划分 H 个高度
3. 计算 X 轴间距：宽度 W / N 天
4. 对每列计算"垂直跨度"（从上一天 Y 到本天 Y），中间用 `╱` `╲` `─` 填充
5. 按行从顶到底扫描，每个格子打印对应字符
6. 使用 box-drawing 字符：`─ │ ╭ ╮ ╯ ╰ ╱ ╲ ┤ ┼ └`

### 边界情况

- N < 2 → 退化为打印数值
- 终端宽度 < 30 → 警告，降级到 sparkline
- 数据全 0 → 显示 `(no data in period)`
- 缺失天 → 填 0（保持时间轴连续）

### 测试

- 测算法函数 `computeChart(data, h, w)` 输出 `string[]` 行列表
- 不测视觉，测：行数 = H、每行长度 = W、max 值出现在最高行
- ~30 行测试

---

## 功能 2：按 Session 分组

### CLI 接口

```bash
opencode-tokens [today|week|month|all] --by session
```

### 实现

`cmdStats` 的 switch 加 case：

```ts
case "session":
  groups = groupBy(entries, e => e.sessionId || "unknown")
  // 截断 session ID 显示，避免撑爆表格
  printTable("Session breakdown", truncateKeys(groups, 16), "Session")
  break
```

### 边界

- session ID 长 = 31 字符（如 `ses_1aafa550affejIdtn55dpbirs8`）→ 截断至 12-16 + `…` 暗示截断
- 默认按 cost 降序（需确认 `printTable` 已有此行为）
- 截断后理论存在 ID 不唯一风险，但碰撞概率极小

### 测试

- mock entries，确认 session 聚合数 + cost 求和正确

---

## 功能 3：多格式导出

### CLI 接口

```bash
opencode-tokens export [--format csv|json] [--period today|week|month|all] [--output FILE]
```

默认：`--format csv --period all --output stdout`

### CSV 字段

```
timestamp,date,session_id,message_id,role,agent,model,provider,input,output,reasoning,cache_read,cache_write,cost
```

### CSV 转义实现

```ts
function csvEscape(v: unknown): string {
  if (v == null) return ""
  const s = String(v)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}
```

### JSON 格式

```ts
JSON.stringify(entries, null, 2)
```

直接 dump，entries 已经是 JSON 对象，简单。

### 输出目的地

- 无 `--output`：写 stdout（可 `> file.csv` 重定向）
- 有 `--output`：用 `writeFileSync` 写文件

### 边界

- agent 名可能含特殊字符（中文、空格）→ CSV 转义已覆盖
- 大日志 → `loadEntries` 已按时间窗截断（反向块解析），不爆内存

### 测试

- mock entries 含特殊字符，断言 CSV 字符串正确

---

## 功能 4：CLI 配置修改

### CLI 接口

```bash
opencode-tokens config show              # 已有
opencode-tokens config init              # 已有，从日志推导
opencode-tokens config get <key>         # 新增
opencode-tokens config set <key> <value> # 新增
opencode-tokens config unset <key>       # 新增
```

### Key 路径策略：**仅顶层 + 白名单**

理由：模型 ID 含点号（如 `claude-opus-4.6`、`gemini-2.5-flash`），与点号分隔符冲突。深路径不支持，引导用户直接编辑 JSON。

### 白名单

```ts
const SETTABLE_KEYS = {
  "budget.daily":     { type: "number", min: 0 },
  "budget.weekly":    { type: "number", min: 0 },
  "budget.monthly":   { type: "number", min: 0 },
  "budget.warnAt":    { type: "number", min: 0, max: 1 },
  "toast.enabled":    { type: "boolean" },
  "toast.duration":   { type: "number", min: 0 },
  "toast.showOnIdle": { type: "boolean" },
}
```

`config set <key> <value>` 检查白名单 + 类型 + 范围。

### Value 类型转换

```ts
function parseValue(s: string): unknown {
  if (s === "true") return true
  if (s === "false") return false
  if (s === "null") return null
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  return s
}
```

### 文件写入

- `JSON.stringify(config, null, 2)` 保留 2 空格缩进
- 写之前先备份（`token-tracker.json.bak`）—— **必做**
- 文件不存在 → 用 `DEFAULT_CONFIG` 作基础

### 边界

- key 不在白名单 → 报错并提示可用列表
- value 解析失败 → 报错
- `budget.warnAt` 不在 [0,1] → 拒绝
- 文件正被插件读取 → 1.5.4 的 mtime hot-reload 会自动捕获新值 ✓

### 测试

- mock 配置文件，测 get/set/unset 正确性
- 测白名单边界（key 不存在、value 越界）

---

## 跨功能基础设施

### CLI argparse helper

当前 `main()`（`bin/opencode-tokens.ts:730`）是手工 for-loop，4 个新子命令会让代码混乱。抽出：

```ts
interface ParsedArgs {
  command: string
  flags: Map<string, string | boolean>
  positional: string[]
}

function parseArgs(args: string[]): ParsedArgs {
  // 统一 --flag value / --flag=value / --flag 解析
  // 子命令分发用 switch
}
```

- 零依赖
- ~50 行额外代码
- 4 个新功能干净落地

---

## README 更新

每个新子命令在 README 加：
- 用法示例（含 ASCII 输出截图）
- 配置项说明（`config set` 白名单）

## CHANGELOG（1.6.0 段落）

```markdown
## [1.6.0] - YYYY-MM-DD

### Added
- `opencode-tokens trend` — ASCII line chart of daily cost/tokens/messages
- `opencode-tokens --by session` — group stats by session ID
- `opencode-tokens export --format csv|json` — export entries
- `opencode-tokens config set/get/unset <key> [value]` — manage budget/toast settings from CLI
- Internal CLI argparse helper for consistent flag handling

Closes #57
```

---

## 实施顺序（"先稳后险"）

1. **抽 argparse helper**（独立 commit，不引入功能）
2. **功能 2（--by session）** — 顺手做了
3. **功能 4（config set/get/unset）** — 对用户最实用
4. **功能 3（export）** — 中等工作量
5. **功能 1（trend）** — 最大、最有视觉影响
6. **测试 + README + CHANGELOG**
7. **PR → CI → merge → tag `v1.6.0` → 自动发布（依赖已落地的 release.yml）**

---

## 风险与遗留事项

| 风险 | 缓解 |
|---|---|
| `trend` 字体宽度问题（非等宽字体会错位） | 文档说明即可，无法解决 |
| `session` ID 截断后理论可能不唯一 | 截断 + `…` 暗示 |
| `config set` 不支持模型/provider 细粒度配置 | 错误信息明确指引"请直接编辑 JSON" |
| 引入新依赖的诱惑（如 asciichart） | 决策：**零依赖原则**，自实现 |

---

## 发布流程（依赖已落地的基础设施）

1.6.0 发布时按 `release.yml` 自动流程：
1. `git tag v1.6.0 && git push origin v1.6.0`
2. GitHub Actions 自动：build + test + npm publish + GitHub Release

注意：`v1.6.0` **不含 `-`**，所以即使在严格的 `v*` deployment policy 下也能通过（虽然当前 policy 已放宽为 All branches/tags）。

---

## 与 1.5.6 的兼容性

- 不改动现有 plugin 端（`index.ts`）— 仅扩展 CLI（`bin/opencode-tokens.ts`）
- 不引入 breaking change
- 老版本配置文件 100% 兼容
