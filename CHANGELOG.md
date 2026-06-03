# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).


## [Unreleased]

### Added

- `opencode-tokens --by session` now shows human-readable session titles, captured from OpenCode `session.created` / `session.updated` events into a new append-only `sessions.jsonl` sidecar log next to `tokens.jsonl`.
- Added a `Last Active` column to the session breakdown so sessions can be told apart and ordered by recency at a glance.

### Changed

- The `--by session` table now rolls child/subagent sessions up into their parent session and labels each row by the parent's title. Sessions without captured metadata (including sessions created before this version) fall back to a distinctive short session code instead of a common-prefix truncated id.

## [1.7.1] - 2026-05-30

### Added

- Added `opencode-tokens doctor`, a read-only setup diagnostic covering the OpenCode plugin entry, tracker config, token log, latest log record, default-priced models, and next-step guidance.
- Added actionable `opencode-tokens models` next steps for default-priced models and local/subscription providers, including direct guidance to run `opencode-tokens config generate`.
- Added log-aware `config init` / `config generate` suggestions for zero-cost local providers and subscription providers such as GitHub Copilot, Cursor, Ollama, LM Studio, and localhost.
- Added 2026-05-29 pricing audit context and refreshed built-in model pricing metadata.

### Changed

- Improved CLI pricing visibility so users can distinguish built-in pricing, provider overrides, model overrides, and default fallback pricing more easily.
- Aligned release workflow documentation with the staged `release:check` -> `release:prepare` -> `release:tag` process.

### Fixed

- (#80) Fixed `opencode-tokens --by daily` grouping rows by UTC date while `today`, `week`, `month`, and budget periods use local natural date boundaries.
- Fixed CLI log loading so cache-only token records are included in stats, budget checks, exports, trends, model diagnostics, and configuration suggestions.
- Fixed DeepSeek V4 Pro pricing coverage and refreshed related CLI pricing output.
- Fixed invalid CLI option handling for export, trend, stats breakdowns, config commands, and unknown top-level commands so failures exit non-zero with actionable usage text.

### Documentation

- Clarified that OpenCode plugin auto-install does not put the `opencode-tokens` CLI binary on the shell `PATH`, and documented `npx` / `npm exec` usage for occasional CLI runs.
- Expanded walkthrough and context documentation for real OpenCode CLI dogfood, pricing audit evidence, and release-flow handoff.

### Internal

- Added shared token-usage validation for plugin runtime and CLI ingestion so `input`, `output`, `cacheRead`, and `cacheWrite` use one billable-entry contract.
- Added and hardened the staged release controller around local checks, metadata preparation, clean `main` tagging, and GitHub Actions publish handoff.
- Fixed release controller `git status --porcelain` parsing so clean release metadata staging is not rejected when status lines start with a leading space.

## [1.7.0] - 2026-05-24

### Added

- (#60) Added built-in pricing table metadata (`pricingLastUpdated` & `metadataLastUpdated`) and notes visible via `opencode-tokens pricing`.
- (#62) Enhanced `opencode-tokens config init / generate` to provide personalised budget suggestions and automatically scan for fallback models and subscription providers.
- Added repo-only real OpenCode CLI dogfood script for validating the plugin against the local `opencode run` path without relying on mocks or `opencode server`.

### Changed

- (#60 & #62) Decoupled pricing status matching tree into central shared pure resolver helper `resolvePricingStatus`.
- (#62) Config init emits clean JSON exclusively to `stdout`; config generate writes the config file and keeps `stdout` completely empty; both route guides and recommendations exclusively to `stderr`.

### Fixed

- DeepSeek pricing corrected (input $0.28 → $0.14, output $0.42 → $0.28, cacheRead $0.028 → $0.0028 per 1M tokens) to match current DeepSeek official pricing. Existing entries in tokens.jsonl retain their original cost values; only future entries use the corrected rates.
- Cost calculation now treats OpenCode `input` tokens as net-new input and charges `cacheRead` separately, matching the token semantics observed in real OpenCode CLI events.
- Plugin entry no longer exports internal helpers (`calculateCost`, `getProviderFamily`). Resolves OpenCode v1.15.10 legacy plugin loader spuriously calling these helpers as plugin functions and emitting `failed to load plugin opencode-token-tracker` even though hooks were registered successfully.

## [1.6.6] - 2026-05-24

### Fixed

- (#63) Fixed budget warning toast using a pure `evaluateBudgetStatus` selector that correctly prioritises the most severe period.

### Documentation

- (#61) Added "Accuracy & Limitations" / "准确性与限制" sections to English & Chinese READMEs detailing cost estimates and budget warning non-enforcement.
- (#61) Added disclaimers to CLI `budget` and `--help` command outputs.

## [1.6.5] - 2026-05-24

### Added

- `opencode-tokens trend` — High-resolution daily cost/tokens/messages trend chart over time using smooth, continuous rounded-arc Unicode box-drawing characters (`╭`, `╯`, `╰`, `╮`) and precise X-axis ticks, featuring an adaptive height layout containing peak/avg/delta statistics. (#57)
- `opencode-tokens --by session` — Group statistics by session ID (#57)
- `opencode-tokens export --format csv|json` — Export token entries to CSV or JSON with optional file output (#57)
- `opencode-tokens config set/get/unset <key> [value]` — Manage budget and toast settings directly from CLI, with type validation, automatic backup, and proper display of unset keys (#57)
- Internal CLI argparse helper for consistent `--flag value` / `--flag=value` / `-f value` parsing across all subcommands

### Fixed

- `saveConfig` now automatically creates parent directories when they don't exist, preventing unexpected IO/CI test failures
- Consolidated and unified releases 1.6.0 through 1.6.4 into a stable 1.6.5 release, resolving visual alignment and terminal font-spacing staircase gaps in the CLI trend chart.

## [1.5.7] - 2026-05-24

### Fixed

- Partial pricing matching now prefers longer (more specific) keys by sorting entries by key length descending before iteration. Prevents shorter keys like `gpt-4o` from shadowing longer keys like `gpt-4o-mini` when both match a variant model name such as `gpt-4o-mini-2024-07-18`. (#60)
- Restored correct 6-step pricing resolution priority in `getModelPricing()`. v1.5.1 inadvertently promoted user config partial matching above built-in exact matching, causing broad config keys (e.g. `"claude"`) to override precise built-in pricing. User config partial matching now correctly runs after built-in exact and partial resolution. (#60)
- `cmdModels` CLI status labels now mirror the same resolution order as the plugin runtime, eliminating cases where the CLI displayed `"model cfg"` but the runtime used built-in pricing. (#60)
- Config validation no longer produces misleading cascading warnings when a flat pricing entry contains invalid values. Previously, a malformed entry like `{input: "free"}` would generate up to 4 contradictory warnings; now it produces a single clear diagnostic. (#60)

### Changed

- Simplified `isDirectModelPricing` to a pure type guard, removing redundant post-validation value checks already performed by `validateConfig`. (#60)

## [1.5.6] - 2026-05-23

### Fixed

- Prevent double-billing during assistant streaming updates. The previous heuristic (`role === "assistant" && !time.completed`) relied on a hard-coded role string and ignored the provider's `finish` reason. Event tracing on real OpenCode sessions showed that `finish` arrives in the same frame as the final tokens but ~3 ms before `time.completed`, so a stream interrupted between those two frames could lose the final tokens. The guard is now driven by `info.modelID` (presence of a model identifier) combined with `time.completed || finish`, eliminating the role-string assumption and closing the last-frame gap.
- Restore the conservative error semantics of `loadCostsSince`: on IO failure it now returns `0` (as in 1.5.5 and earlier) instead of the partially-accumulated value introduced during the reverse-parser port, so downstream budget checks are never based on an under-counted total.
- Include `cacheRead` and `cacheWrite` when deciding whether a message has billable tokens (`hasTokens`) and when building the deduplication key, so cache-only updates and cache-field-only changes can no longer slip through unrecorded.
- Stop writing `{"type":"init"}` markers to `tokens.jsonl`. OpenCode loads the plugin in multiple worker processes (LSP, tool runner, etc.), causing several no-op init lines per launch; these have no billing value and only inflated the log.

### Changed

- Apply the same reverse chunk-based parser introduced for the CLI in 1.5.3 to the in-plugin budget loaders (`loadCostsSince` and `initBudgetTracker`). Initial budget reconstruction on large logs is now bounded by the active budget window rather than the full file size. `initBudgetTracker` becomes async to support `fs/promises.open`; the plugin bootstrap awaits it so budget state is ready before the first event is dispatched.

### Internal

- Extend `MessageInfo` with `finish` and reuse the existing `modelID` field to recognise AI-generated messages without role string matching.
- Type the async `FileHandle` instead of `any` in `initBudgetTracker`.

## [1.5.5] - 2026-05-23

### Added

- Support refined provider-specific cache pricing default fallbacks. Introduced `getProviderFamily` to classify provider groups (OpenAI, DeepSeek, Google, Anthropic) and apply exact, realistic default rates (e.g. OpenAI write = free, read = 50%; DeepSeek/Gemini write = free, read = 10%) when not explicitly specified, avoiding cost overestimation.

## [1.5.4] - 2026-05-23


### Added

- Support lightweight configuration hot-reloading in the plugin dynamically without restarting the OpenCode editor. The configuration modification timestamp (`mtimeMs`) is passively verified during core event cycles, backed by a 2000ms debounce protection during high-frequency chat streaming.

## [1.5.3] - 2026-05-23

### Added

- Implement high-performance O(1) **Reverse Chunk-based Parser (Tail-reading)** for loading token log entries in CLI (`opencode-tokens`). The tool now reads log buffers backward from the end and terminates instantly once earlier timestamps are hit, boosting CLI query performance by up to 190x on large logs.

## [1.5.2] - 2026-05-23

### Fixed

- Wrap `TokenTrackerPlugin` asynchronous bootstrap in a global try-catch to prevent plugin initialization failures from blocking or breaking OpenCode host startup.

## [1.5.1] - 2026-05-23

### Added

- Support provider-specific model pricing overrides in `models` configuration
- Unit tests covering edge cases for provider pricing resolution and fallback logic

### Fixed

- Tightened validation checks for raw config to handle non-object providers or invalid nested model properties gracefully
- Improved partial match resolution for provider-specific model pricing configurations

## [1.5.0] - 2026-02-11

### Added

- Config validation: `validateConfig(raw)` function normalizes arbitrary config input with warnings
- Shared config types: `TrackerConfig`, `ToastConfig`, `BudgetConfig`, `ConfigValidationResult`
- `DEFAULT_CONFIG` constant exported from `lib/shared.ts`
- Unit tests for `lib/shared.ts` (31 tests covering formatting, date utils, pricing, config validation)
- GitHub Actions CI (Node 18 + 22 matrix, runs on push/PR to main/dev)
- New model pricing: claude-opus-4.6, gemini-2.0-flash-lite, corrected Gemini prices

### Changed

- **Breaking (internal)**: `Config` interface replaced by `TrackerConfig` (same shape, renamed for clarity)
- Budget tracker optimized to in-memory accumulator — no per-message JSONL reads
- Shared module `lib/shared.ts` now contains all types, pricing, utils, and config validation
- Plugin shows config validation warnings via Toast; CLI prints to stderr

### Refactored

- Extracted shared types, pricing table, and utility functions to `lib/shared.ts`
- Removed duplicated `Config` interface and `DEFAULT_CONFIG` from `index.ts` and `bin/opencode-tokens.ts`

## [1.4.0] - 2026-02-05

### Added

- Budget control feature: daily/weekly/monthly spending limits with configurable warnings

## [1.3.2] - 2026-02-05

### Fixed

- Updated pricing table to latest official prices (2026-02-05)

## [1.3.1] - 2026-02-05

### Changed

- Improved pricing config explanation in documentation

## [1.3.0] - 2026-02-05

### Added

- CLI commands for pricing discovery (`pricing` subcommand)

## [1.2.0] - 2026-02-05

### Added

- Config file support for custom pricing overrides
- CLI tool for token usage statistics (`opencode-tokens` command)
- Contributing guide with branch strategy

### Fixed

- Corrected bin path format in package.json

[1.7.1]: https://github.com/tongsh6/opencode-token-tracker/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/tongsh6/opencode-token-tracker/compare/v1.6.6...v1.7.0
[1.6.6]: https://github.com/tongsh6/opencode-token-tracker/compare/v1.6.5...v1.6.6
[1.6.5]: https://github.com/tongsh6/opencode-token-tracker/compare/v1.5.7...v1.6.5
[1.5.7]: https://github.com/tongsh6/opencode-token-tracker/compare/v1.5.6...v1.5.7
[1.5.6]: https://github.com/tongsh6/opencode-token-tracker/compare/v1.5.5...v1.5.6
[1.5.5]: https://github.com/tongsh6/opencode-token-tracker/compare/v1.5.4...v1.5.5
[1.5.4]: https://github.com/tongsh6/opencode-token-tracker/compare/v1.5.3...v1.5.4
[1.5.3]: https://github.com/tongsh6/opencode-token-tracker/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/tongsh6/opencode-token-tracker/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/tongsh6/opencode-token-tracker/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/tongsh6/opencode-token-tracker/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/tongsh6/opencode-token-tracker/compare/v1.3.2...v1.4.0
[1.3.2]: https://github.com/tongsh6/opencode-token-tracker/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/tongsh6/opencode-token-tracker/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/tongsh6/opencode-token-tracker/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/tongsh6/opencode-token-tracker/releases/tag/v1.2.0
