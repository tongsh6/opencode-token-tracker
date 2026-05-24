# Issue #60-#63 Implementation Plan — Review v3

**Review 日期**：2026-05-24
**Plan 版本**：v2（保留 `config generate` 为 `init` 的 alias 那一版）
**基线代码**：`origin/main @ a2bf6e8`（1.6.5）
**对应外部 plan**：`/Users/loong/.gemini/antigravity/brain/47c441ad-5766-41e1-9caa-30d1f103e8e5/implementation_plan.md`
**前两轮 review**：见对话历史中 v1（4 critical/important findings）与 v2（含 N1-N7）

---

## 核心结论

Plan v2 已经响应了 v1 的所有 critical/important findings（C1/C2/I3 等），但 **`config generate` 这条线在 v2 内部仍然自相矛盾**，且与当前代码事实冲突。必须三选一明确语义后才能开工。

文档头部还存在残段拼接问题，需要清理。

---

## P1.1 当前代码事实（已核实）

`bin/opencode-tokens.ts:633-650`：

```ts
console.log(JSON.stringify(exampleConfig, null, 2))   // init 和 generate 都打印 JSON

if (action === "generate") {
  writeFileSync(CONFIG_FILE, json)                     // generate 额外写文件
  console.log(`Config file created: ${CONFIG_FILE}`)
} else {
  console.log(`To create this config file, run: opencode-tokens config generate`)
}
```

**当前 `init` 与 `generate` 是不同行为，不是 alias**：

| 命令 | stdout | 副作用 |
|---|---|---|
| `config init` | JSON + "如何用 generate" 提示 | 无 |
| `config generate` | JSON + "已创建 $PATH" 提示 | `writeFileSync(CONFIG_FILE)` |

---

## P1.2 Plan v2 内部三处描述互相冲突

| 位置 | 描述 | 含义 |
|---|---|---|
| **C1 决策段**（line 16-22） | "strictly preserve `config generate` as a clean alias of `config init`"，"both will output the parsed clean example JSON strictly to `process.stdout.write()`" | generate **不**写文件 |
| **Phase 2 cmdConfig**（line 167, 175） | "init / generate alias block"，"Output ONLY the clean exampleConfig JSON string to `process.stdout.write()`" | 同上 |
| **Verification**（line 232） | "`config generate` ... writes a valid JSON file to the sandbox configuration path and **stdout is empty**" | generate **写**文件且 stdout 为空 |

三个描述无法同时成立。同时 C1 段误判 "保持现状"：当前**根本不是 alias**。

---

## P2 文档拼接损坏

文档第 5-13 行存留旧版 `## User Review Required` 段落：
- 6-step pricing 列表只到第 4 步戛然而止
- `CLI Home Directory Sandbox`、`BudgetSpentSnapshot decoupling`、`Pricing Semantics split` 三个 P1/P2 决策块的描述在旧段，结构被腰斩
- 新版 `## User Review Required & Critical Decisions` 紧跟其后（line 14+）

读者无法判断哪份权威，且旧段独有的决策细节（如 `BudgetSpentSnapshot`）没有显式承接到新结构中。

**修复**：删除 line 5-13 整段；确认 `BudgetSpentSnapshot` 设计仍保留在 Phase 1 Proposed Changes 中（v2 已保留 ✅）；`pricing` 两个日期决策仍保留在 Phase 2 中（v2 已保留 ✅）。

---

## 三个候选语义（必须三选一）

### Option A：保留当前差异，零 breaking（**推荐**）

`init` 和 `generate` 是**不同命令**，不是 alias：

| 命令 | stdout | stderr | 副作用 |
|---|---|---|---|
| `config init` | clean JSON | guide + 建议解释 + "如何运行 generate" 提示 | 无 |
| `config generate` | clean JSON | guide + 建议解释 + "已创建 $PATH" 提示 | `writeFileSync(CONFIG_FILE)` |

**优点**：
- 零 breaking change：依赖 `config generate` 自动创建文件的脚本继续工作
- stream routing 改进仍生效：`opencode-tokens config init > file.json` 重定向干净
- 测试和验证最容易写
- 符合 minor bump 的 SemVer 约束（不偷改 CLI 语义）

**Verification 改写**：
- `config init`：stdout = valid JSON，stderr 含 guide，**未写文件**
- `config generate`：stdout = valid JSON，stderr 含 guide，**写文件**到 sandbox CONFIG_FILE

### Option B：generate 真成为 init 的 alias（breaking）

按 v2 plan C1 决策段字面意思：

- `init` 和 `generate` 100% 同行为：JSON → stdout，guide → stderr，**都不写文件**
- 用户想创建文件必须手动 `opencode-tokens config generate > ~/.config/opencode/token-tracker.json`

**风险**：
- ⚠️ Breaking change：依赖 `config generate` 自动创建文件的用户/脚本会**静默坏掉**
- 必须 README/CHANGELOG 醒目标注 "BREAKING: `config generate` no longer writes the file"
- 1.7.0 minor 不该带 breaking change，按 SemVer 应该是 2.0.0

### Option C：generate 只写文件（不打印到 stdout）

按 v2 plan Verification 字面意思：

| 命令 | stdout | stderr | 副作用 |
|---|---|---|---|
| `config init` | clean JSON | guide | 无 |
| `config generate` | **空** | guide + "已创建 $PATH" 提示 | `writeFileSync(CONFIG_FILE)` |

**风险**：
- ⚠️ Breaking change：依赖 `config generate` stdout 输出 JSON（如管道到 jq）会坏
- 优势：piping isolation 最干净

---

## 推荐 Option A 的理由

1. **零 breaking change** —— 1.7.0 (minor) 不应改 CLI 语义
2. **plan 的产品目标（让 init 可 pipe）已通过 stream routing 实现**：guide → stderr 后 `init > file` 完全可用
3. **当前用户脚本不会破坏**
4. **测试最简单**：两个命令各自有明确的可断言行为

---

## 给 plan 作者的具体修改清单

| 位置 | 修改 |
|---|---|
| Line 5-13 残段 | 删除 |
| C1 决策段（line 16-22） | 重写：明确区分 `init` vs `generate`，说明"为什么保留两个命令" |
| Phase 2 cmdConfig stream routing（line 167-178） | 改为：两者都 JSON → stdout，guide/suggestion → stderr；`generate` **额外** `writeFileSync(CONFIG_FILE, json)` 并把"已创建 $PATH" 提示走 stderr |
| Verification CLI Stream Assertions（line 231-233） | `config init`：stdout 是 valid JSON，stderr 含 guide，未写文件；`config generate`：stdout 是 valid JSON，stderr 含 guide，写文件到 sandbox CONFIG_FILE |
| README / CHANGELOG | 说明 `init` = preview，`generate` = preview + write file。无 breaking change 字样。 |

---

## v2 Review 的复盘

v2 review 抓到了 `cmdPricing` 输出 vs 测试的内部矛盾（N2），但**没抓到 `config generate` 这个更严重的矛盾**。

**根因**：v2 review 只读了 plan，没对照当前 `bin/opencode-tokens.ts` 里 `generate` 的实际行为；把 C1 决策段"保持现状"字面接受了。

**教训**：下次 review plan 时，对凡是宣称"保持现状 / 兼容现有行为"的决策，必须**先核对当前代码事实**再判断是否成立。

**未来 review checklist 加一条**：
- [ ] 凡涉及现有 CLI/API 行为的决策，先 grep 当前实现，对照"plan 描述的现状"是否一致

---

## v2 中其他未解决项（提醒，不阻塞 plan approval）

来自 v2 review 的 N4-N7，仍待 plan 作者补全：

- **N4**：现有 `findModelConfigPricing(..., true)` 是否真的按 key length desc 排序？plan 在 helper 里假设是，需要验证 + 必要时顺手修
- **N5**：Phase 1 → Phase 2 是否要先发布 1.6.6 再开 Phase 2 PR？建议明确为是
- **N6**：Phase 1 plugin 端 import `evaluateBudgetStatus` 后，原 `BudgetStatus` interface 在 `index.ts` 里是否有 local 定义需要清理？
- **N7**：`package.json` test script `node --test dist/test/shared.test.js` 写死了文件名，新加的 `dist/test/cli.test.js` **不会被跑**。必须改成 `node --test dist/test/*.test.js` 否则集成测试形同虚设

最后一条（N7）**会真实漏跑测试**，应该列入 Phase 2 的必做项。

---

## 评分（相比 v2）

| 维度 | v2 我打的分 | v3 实际应得 |
|---|---|---|
| 技术决策 | ⭐⭐⭐⭐½ | ⭐⭐⭐⭐ — `generate` 决策内部矛盾扣分 |
| 完整度 | ⭐⭐⭐⭐½ | ⭐⭐⭐⭐ — 残段未清扣分 |
| 风险识别 | ⭐⭐⭐⭐ | ⭐⭐⭐½ — `generate` 行为变更未明确为 breaking 扣分 |
| 测试覆盖 | ⭐⭐⭐⭐½ | ⭐⭐⭐⭐½（无变化） |
| 可执行性 | ⭐⭐⭐⭐½ | ⭐⭐⭐ — 三处矛盾让实施者无所适从 |

---

## 结论

修掉 P1（三选一拍板 + 同步三段描述）和 P2（删残段）后，plan 才真正具备开工条件。N4-N7 的小修可以在实施时顺手处理。
