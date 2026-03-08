# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Keep it brief!

## [Unreleased]

## [0.0.2] - 2026-03-08

### Added
- `RepairPolicy` — repair mode is now configurable (`never | on_validation_failure | always`) with per-layer enable/disable. Default `on_validation_failure` matches old behavior but skips the pipeline entirely when input already validates.
- `HarnessEvent` + `onEvent` callback — lightweight observability without external tracing deps. Emits repair lifecycle events (`repair_skipped`, `repair_layer_used`, etc.).
- Grouped prompt block styles — `grouped_with_breadth` is the new default. Benchmarks showed 100% tool fidelity vs ~85% for `minimal`. Organizes tools by domain groups with breadth examples.
- Fuzzy enum word-overlap guard — adaptive Levenshtein threshold (0.65 for long strings, 0.5 for short) plus a shared-substring check to prevent overcorrection on unrelated enum values.
- Array/object type display in signatures — `str[]`, `num[]`, `enum[]|val1|val2`, `:object` instead of losing type info.

### Changed
- Default prompt block style changed from `minimal` to `grouped_with_breadth`.
- Repair pipeline internals refactored from inline sequential calls to a `LAYERS` array — easier to extend and reason about.
- `inputExamples` no longer sent to AI SDK. Benchmarks showed they cause over-cautious model behavior. Field kept on `ToolDef` for backward compat.

### Removed
- `CapabilityRegistry`, `compileTools`, `HandleStore` removed from public exports. Compiled surfaces hit 20% accuracy vs 65% for direct — needs intent-based activation before shipping.
- `suggestToolChoice()` removed — code didn't match the validated v4 structural signal from experiments. Will rewrite if needed.

## [0.0.1] - 2026-02-22

### Added
- Alpha release of tool-harness for benchmarking
