# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
