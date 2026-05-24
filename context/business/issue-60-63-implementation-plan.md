# Implementation Plan — Issues #60-#63 (v4 Upgrade)

This plan outlines the design updates to resolve core regressions and complete feature details for Issues #60, #61, #62, and #63 in `opencode-token-tracker`, responding directly to feedback on Backup Safety, Suggestions Summaries, and Budget Recommendation formulas.

## Critical Updates & Architectural Decisions

### 1. P1: Securing Backup Protections under Shell Redirection
* **Problem**: If `config generate` prints JSON to stdout while simultaneously writing to `CONFIG_FILE`, running `opencode-tokens config generate > ~/.config/opencode/token-tracker.json` causes the Shell to truncate the configuration file *before* Node starts up. Consequently, `saveConfig()` backs up a 0-byte truncated file, destroying preexisting user configurations.
* **Solution**:
  - **`config init` (Piping Path)**: Pure CLI stdout output. Continues to print clean valid JSON to `stdout` and logs/guides to `stderr`. No file-writing actions.
  - **`config generate` (Write Path)**: Sidebar write action only. **Stdout is kept completely empty**. All guides, suggestion summaries, and file creation status messages route exclusively to `stderr`.
  - **Benefit**: Completely eliminates the necessity or utility of running `generate > file.json` (as it yields 0 bytes), directing developers to use `init > file.json` instead, ensuring authentic files are backed up safely by the internal node process.

### 2. P2: Dynamic Usage-Aware Suggestions Summary in Stderr
* **Problem**: Although `config init/generate` analyzed 7-day average limits, unrecognized fallback models, and zero-cost subscription providers, the stderr `guideText` remained static, omitting this high-value personalized statistics summary.
* **Solution**:
  - Generate a formatted dynamic block `Usage-Aware Suggestions Summary` inside `stderr` showing:
    - Analyzed timeframes and entry counts.
    - Calculated `dailyAvg` base cost.
    - Mathematical formula derivations for the recommended daily/weekly/monthly limits.
    - Bulleted lists of detected subscription/free providers (pre-configured to 0 price).
    - Bulleted lists of fallback models defaulting to standard `$1/$4` pricing.

### 3. P3: Smooth & Isolated dailyAvg-based Budget Derivations
* **Problem**: The weekly/monthly budgets were derived from already rounded/clamped daily limits, amplifying step errors and rounding anomalies. Additionally, extremely tiny cost logs fell back to default 5/25/100 bounds due to loose `|| 5` fallback definitions.
* **Solution**:
  - Derive daily, weekly, and monthly budget limits directly and independently from the floating-point `dailyAvg` base:
    - `dailyLimitRaw = dailyAvg * 1.5`
    - `weeklyLimitRaw = dailyAvg * 7 * 1.3`
    - `monthlyLimitRaw = dailyAvg * 30 * 1.2`
  - Implement a pure floating utility `round2(val: number): number` (`Math.round(val * 100) / 100`).
  - Apply clamps independently: `limit = Math.max(0.5, round2(limitRaw))`.
  - Static Default Lock: If `dailyAvg === 0`, fall back directly to standard defaults `{ daily: 5, weekly: 25, monthly: 100 }`.
  - **Log-based Integration Test**: Inject custom fake usage logs in testing hooks to mock a active daily cost baseline, then assert that `config init` stdout returns the mathematically derived recommended budgets instead of generic defaults.

---

## Proposed Changes

### Shared Library
#### [shared.ts](file:///Users/loong/workspace/code/github/ai/opencode-token-tracker/lib/shared.ts)
- Export a pure helper `round2(val: number): number` to cleanly encapsulate precision rounding across components.

### Command Line Interface (CLI)
#### [opencode-tokens.ts](file:///Users/loong/workspace/code/github/ai/opencode-tokens.ts)
- Refactor `cmdConfig(positional)`:
  - Formulate budget limits independently using isolated `dailyAvg` floating targets:
    ```ts
    const dailyLimit = dailyAvg > 0 ? Math.max(0.5, round2(dailyAvg * 1.5)) : 5
    const weeklyLimit = dailyAvg > 0 ? Math.max(0.5, round2(dailyAvg * 7 * 1.3)) : 25
    const monthlyLimit = dailyAvg > 0 ? Math.max(0.5, round2(dailyAvg * 30 * 1.2)) : 100
    ```
  - Assemble Zero-Cost Provider and Fallback Model arrays for summaries.
  - Formulate and print `Usage-Aware Suggestions Summary` block using `process.stderr.write()` alongside standard guide text.
  - Clean up output stream routing:
    - **`init`**: Write suggestions and guides to `stderr`, write clean JSON configuration to `stdout`.
    - **`generate`**: Write suggestions, guides, and "Config file created" success messages to `stderr`. **Stdout remains completely empty (0 bytes)**.

---

## Verification Plan

### 🧪 Integration Test Suite Enhancements (`test/cli.test.ts`)
1. **P1 Stdout Isolation Checks**:
   - Confirm `config generate` stdout is 100% empty (length 0).
   - Assert `config generate` stderr has guides, and successfully writes configuration files with backup safety verified.
2. **P3 Active Log-based Budget Suggesters**:
   - Write mock JSONL log entries into `tmpHome` logs directory prior to executing configuration assertions to mock an average daily spent of `$1.00`.
   - Execute `config init`.
   - Assert that `stdout` parsed JSON config budget perfectly yields custom dynamic estimates:
     - `daily` = `1.5` (avg $1.0 * 1.5)
     - `weekly` = `9.1` (avg $1.0 * 7 * 1.3)
     - `monthly` = `36` (avg $1.0 * 30 * 1.2)
   - Assert that `stderr` contains the dynamic Suggestions Summary listing the computed averages and calculations.
