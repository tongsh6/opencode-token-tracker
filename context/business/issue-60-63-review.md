# Issue #60-#63 Review

**Review 日期**：2026-05-24
**当前版本**：1.6.5
**基线代码**：`origin/main @ a2bf6e8`
**作者**：[tongsh6 (Loong)](https://github.com/tongsh6)

---

## 概览

| Issue | 主题 | 严重程度 | 建议版本 |
|---|---|---|---|
| #63 | Budget Toast 应显示最严重的预算周期 | 🔴 真 bug | **1.6.6 (patch)** |
| #60 | Pricing 数据新鲜度 + fallback 可见性 | 🟡 改进（freshness 已严重过期） | 1.6.6 + 1.7.0 |
| #61 | 澄清估算成本语义 + 预算提醒非强制 | 🟢 文档 | 1.6.6 (patch) |
| #62 | `config init` 基于真实使用生成建议 | 🟡 改进（已部分实现） | 1.7.0 (minor) |

---

## #63 — Budget Toast should surface the most severe budget period

### 严重程度
🔴 **真 bug** — 用户可能错过严重的预算告警

### 代码现状
`index.ts:491-537` 的 `checkBudgetStatus` 是 **first-match** 策略：

```ts
if (budget.daily)   { return { period: "daily",   ... } }   // ← daily 一旦配置就独占返回
if (budget.weekly)  { return { period: "weekly",  ... } }
if (budget.monthly) { return { period: "monthly", ... } }
```

注释自称 "most restrictive first"，但 daily 在金额上不必然最严重。

### 故障场景
```json
{ "budget": { "daily": 10, "weekly": 50, "monthly": 200, "warnAt": 0.8 } }
```

- `dailySpent = 1` → 10% → status: ok
- `weeklySpent = 45` → 90% → status: warning ⚠️ **被吞掉**
- `monthlySpent = 195` → 97.5% → status: warning ⚠️ **被吞掉**

用户看到 "ok"，**实际已经接近周/月预算超限**。

### 修复方案

把 first-match 改成 evaluate all + 取最严重：

```ts
function checkBudgetStatus(): BudgetStatus | null {
  const budget = config.budget
  if (!budget.daily && !budget.weekly && !budget.monthly) return null
  if (!budgetTracker.initialized) return null
  const warnAt = budget.warnAt ?? 0.8

  const candidates: BudgetStatus[] = []
  const evaluate = (period: "daily" | "weekly" | "monthly", limit: number | undefined, spent: number) => {
    if (!limit) return
    const percentage = spent / limit
    candidates.push({
      period,
      spent,
      limit,
      percentage,
      exceeded: percentage >= 1,
      warning: percentage >= warnAt && percentage < 1,
    })
  }
  evaluate("daily",   budget.daily,   budgetTracker.dailySpent)
  evaluate("weekly",  budget.weekly,  budgetTracker.weeklySpent)
  evaluate("monthly", budget.monthly, budgetTracker.monthlySpent)

  // 优先级：exceeded > warning > ok；同级取 percentage 最高
  const severity = (s: BudgetStatus) => s.exceeded ? 2 : s.warning ? 1 : 0
  candidates.sort((a, b) => severity(b) - severity(a) || b.percentage - a.percentage)
  return candidates[0] ?? null
}
```

### 测试用例
- 三个 period 都 ok → 返回 ok 中 percentage 最高
- daily ok / weekly warning / monthly ok → 返回 weekly warning
- daily warning / weekly exceeded → 返回 weekly exceeded
- 只配 monthly → 返回 monthly
- 三个都未配 → 返回 null

### 工作量 / 风险
- ~25 行代码 + 4-6 个单测
- 风险低，纯逻辑改动，无 API/配置变化

---

## #60 — Improve pricing freshness and fallback visibility

### 严重程度
🟡 **改进**（已部分实现 + freshness 是真问题）

### 代码现状

| 期望 | 现状 |
|---|---|
| Pricing 数据日期可见 | ⚠️ 有，但**严重过期**（`Updated 2026-02-11`，距今 ~3 个月） |
| CLI 显示 fallback 使用 | ✅ **`cmdModels` 已做**（4 类状态：built-in / provider cfg / model cfg / default） |
| 鼓励配 override | ⚠️ `cmdModels` 输出底部有说明，但没强提示 |
| 不引入网络更新 | ✅ 符合（项目零依赖原则） |

### 真正的问题点

#### 1. Pricing 表 3 个月没更新（最紧急）
- `lib/shared.ts:21` 注释 `Updated 2026-02-11`
- `bin/opencode-tokens.ts:418` 也显示这个日期
- AI 模型定价 3 个月里很可能已变（claude-opus-4.6 / gpt-5.2 等相对新的模型）
- **建议**：建立**定期更新机制**（例如每月跑一次 issue 提醒手动核对），pricing 文件里加 `_meta` 字段

#### 2. `cmdPricing` 没标识 fallback
- 当前只列出 BUILTIN_PRICING 里有的 model
- 用户实际用的 model 如果不在表里（"default"），`cmdPricing` 里看不到
- 应该和 `cmdModels` 一样区分四类

#### 3. README 没说明 pricing 来源 / 更新策略
- 用户不知道 pricing 表是手动维护的
- 也不知道如果发现 pricing 错误怎么报告

### 修复建议

| 子项 | 工作量 | 版本 |
|---|---|---|
| 在 `lib/shared.ts` 加 `BUILTIN_PRICING_METADATA = { lastVerified: "...", source: "..." }` | 5 行 | 1.7.0 |
| `cmdPricing` 显示 metadata + fallback 提示 | 20 行 | 1.7.0 |
| README 加 "Pricing freshness" 段落 | 30 行文档 | 1.6.6 |
| **最重要**：现在更新一次 pricing 表到 2026-05-24 | 取决于市场调研 | 1.6.6 |

### 数据结构示例
```ts
// lib/shared.ts
export const BUILTIN_PRICING_META = {
  lastVerified: "2026-05-24",
  source: "Provider official pricing pages",
  notes: "Manually maintained. Report stale prices: https://.../issues/new",
} as const
```

### 风险
- pricing 错误会直接影响用户成本估算 → freshness 是高优先级

---

## #61 — Clarify estimated-cost semantics and budget reminder limitations

### 严重程度
🟢 **纯文档**（无代码改动）

### 代码现状

README 现有措辞：
- ✅ "Automatic cost estimation based on model pricing"（README.md:13）
- ✅ 中文版 "成本估算"（README.zh-CN.md:13）

### 仍缺的（issue 提到的）

| 期望 | 现状 |
|---|---|
| 显式声明 "may differ from official bills" | ❌ |
| 显式声明 "budget reminders are warnings, not enforcement" | ❌ |
| 订阅 provider 配 zero-cost 的指引 | ⚠️ 配置示例里没强调这个用途 |

### 建议改动

README 头部加一个 **"Accuracy & Limitations"** 章节：

```markdown
## Accuracy & Limitations

- **Costs are estimates**, computed locally from your token logs and the
  built-in (or user-configured) pricing table. They may differ from your
  provider's official invoice — for example, when promo/credit/enterprise
  pricing applies.
- **Budgets are warnings, not enforcement.** This plugin does not block
  API calls or interrupt sessions. Use it as observability.
- **Subscription / bundled providers** (Copilot, Cursor, etc.) should be
  configured with zero-cost provider overrides — see
  [Configuration](#configuration).
- **Pricing freshness**: the built-in table is manually maintained and
  may lag market changes. Run `opencode-tokens models` to see which of
  your models use built-in vs. configured pricing.
```

中文版（`README.zh-CN.md`）做对应章节："准确性与限制"。

CLI help 文本（`cmdHelp` 和 `cmdBudget`）末尾加一句：
```
Costs are estimates from local logs; budgets are warnings, not enforcement.
```

### 工作量 / 风险
- ~80 行 markdown 改动 + ~3 行 CLI 文本
- 风险零

---

## #62 — Make config init generate usage-aware suggestions

### 严重程度
🟡 **改进**（已部分实现）

### 代码现状

`cmdConfig init` (`bin/opencode-tokens.ts:541+`) 已经做了：
- ✅ 扫描 `tokens.jsonl` 提取出现过的 providers 和 models
- ✅ 对包含 "copilot" / "cursor" / "free" 关键词的 provider 自动加 zero-cost override
- ✅ 列出无 built-in pricing 的 model 并给默认占位价格 `$1/$4`

### 仍缺的

| 期望 | 现状 |
|---|---|
| zero-cost provider 建议（订阅制） | ✅ 已做（关键词匹配） |
| 标识 fallback models | ⚠️ 半做 —— `cmdModels` 已显示 fallback，但 `config init` 输出没区分"内置匹配但便宜"和"真 unknown" |
| 基于近期使用建议 budget | ❌ 完全未做（硬编码 daily=5 weekly=25 monthly=100） |
| 标识为什么这么建议 | ❌ 输出没解释来源 |

### 关键改进点

#### 1. budget 建议从历史数据估算
```ts
const last7DaysStart = getStartOfDay(new Date()) - 7 * 24 * 3600 * 1000
const last7DaysCost = entries
  .filter(e => e._ts >= last7DaysStart && e.cost)
  .reduce((sum, e) => sum + (e.cost ?? 0), 0)
const dailyAvg = last7DaysCost / 7

exampleConfig.budget = {
  daily:   round2(dailyAvg * 1.5),       // 留 50% buffer
  weekly:  round2(dailyAvg * 7 * 1.3),   // 留 30% buffer
  monthly: round2(dailyAvg * 30 * 1.2),  // 留 20% buffer
  warnAt:  0.8,
}
```

边界：
- 用户日志为空 → 回退硬编码默认（保持当前行为）
- `dailyAvg` < $0.01 → 给最小值 $0.50 防止全 0

#### 2. 输出注释化（解释为什么这么建议）

```
# Suggested based on your recent 7-day usage:
#   - dailyAvg ≈ $0.42, daily budget = $0.65 (1.5× buffer)
#   - 3 models using fallback pricing: <model A>, <model B>, <model C>
#   - <provider X> looks like a subscription provider (zero-cost suggested)
```

JSON 不支持注释，所以用 stderr 输出说明 + stdout 输出 JSON 让 `> config.json` 重定向干净。

#### 3. 区分 model 来源
复用 `cmdModels` 已有的 4 类状态，把它用到 `config init` 的输出中：
- 标记 "fallback (using built-in)" / "fallback (using default)" / "configured"
- 用户能清楚知道哪些 model 需要主动配 pricing

### 工作量 / 风险
- ~80 行代码 + 3-5 个单测
- 风险低，纯 CLI 行为变化，向后兼容
- 注意：JSON+注释方案需小心 stdout 重定向兼容性

---

## 总体打包建议

### 1.6.6 (patch) — 紧急修复 + 文档

包含：
- **#63 修复**（budget toast first-match bug）
- **#61 文档**（README 加 "Accuracy & Limitations" + 中文版 + CLI help 一行）
- **#60 部分**：手动更新 pricing 表到 2026-05-24（调研当下各 provider 实际定价）+ README 加 pricing freshness 段落

工作量：~50 行代码 + ~80 行文档 + pricing 调研  
PR：1 个 `feature/issue-60-61-63-budget-fix-and-clarity`

### 1.7.0 (minor) — CLI 增强

包含：
- **#60 CLI 改进**：metadata + `cmdPricing` 显示 fallback
- **#62 完整**：budget 建议 + fallback 标识 + 解释性输出

工作量：~120 行代码 + 10-15 个单测  
PR：1 个 `feature/issue-60-62-cli-enhancements`

### 顺序

1. 先发 **1.6.6**（修 bug + 文档诚实）
2. 再做 **1.7.0**（增强体验）

---

## 风险与遗留

- **Pricing 调研**是 1.6.6 的瓶颈 —— 需要人工去各 provider 网页核对 2026-05-24 当下定价。建议拆出独立任务，可以并行做。
- **#62 的 budget 建议算法**：1.5× 之类的 buffer 系数是经验值，未来可能需要让用户配置（"我希望 budget 比近期 avg 高 50%/100%/200%"）。当前实现按固定系数即可，留 TODO。
- **#60 的 freshness 长期机制**：每月手动核对的负担需要 contributor 文化支撑，或者后续考虑加 GitHub Action 自动提醒（不要联网，只是每月开一个 reminder issue）。
