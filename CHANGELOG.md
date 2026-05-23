# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.6.4] - 2026-05-24

### Changed

- Trend chart uses Braille characters for 4× resolution boost (2×4 dot grid per character), adaptive chart height, and summary line with peak/avg/delta

## [1.6.3] - 2026-05-24

### Fixed

- Trend chart uses per-row intersection rendering for clean single-character diagonals, proper horizontal `───` connections, and correct corner characters at slope-to-flat transitions

## [1.6.2] - 2026-05-24

### Fixed

- `opencode-tokens trend` chart rendering produces clean single-line diagonals using per-row intersection math instead of thick filled regions

## [1.6.1] - 2026-05-24

### Fixed

- `config get` now correctly displays unset values instead of showing "Unknown key" after `config unset`
- `saveConfig` creates parent directories when they don't exist, fixing CI test failures

## [1.6.0] - 2026-05-24

### Added

- `opencode-tokens trend` — ASCII line chart of daily cost/tokens/messages over time with box-drawing characters (#57)
- `opencode-tokens --by session` — group statistics by session ID (#57)
- `opencode-tokens export --format csv|json` — export token entries to CSV or JSON with optional file output (#57)
- `opencode-tokens config set/get/unset <key> [value]` — manage budget and toast settings directly from CLI, with type validation and automatic backup (#57)
- Internal CLI argparse helper for consistent `--flag value` / `--flag=value` / `-f value` parsing across all subcommands

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
