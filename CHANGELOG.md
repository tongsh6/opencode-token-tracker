# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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

[1.5.0]: https://github.com/tongsh6/opencode-token-tracker/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/tongsh6/opencode-token-tracker/compare/v1.3.2...v1.4.0
[1.3.2]: https://github.com/tongsh6/opencode-token-tracker/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/tongsh6/opencode-token-tracker/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/tongsh6/opencode-token-tracker/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/tongsh6/opencode-token-tracker/releases/tag/v1.2.0
