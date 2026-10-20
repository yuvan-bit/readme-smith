# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-10-21

This release replaces the bilingual README generator with the local-first health doctor described in the specification.

### Added

- `rf scan`: deterministic fact sheet with provenance, per-project-type detection, install/usage derivation, environment variables, CI workflows and build commands.
- `rf doctor`: five-dimension score (completeness, usability, accuracy, readability, freshness) with per-dimension issues and line numbers.
- `rf draft`: writes `README.draft.md` only, merges missing sections into existing READMEs, supports `--lang en|zh` and custom templates in `.readme-smith/templates/`.
- `rf diff`: section-level structured diff plus an optional unified excerpt (`--show`).
- `rf check`: CI gate combining doctor and a deterministic draft diff; honours `#rf-skip` and writes a GitHub step summary.
- `rf apply`: preview with `--dry-run`, back up to `.README.bak.md`, then copy the draft into `README.md`.
- `rf init`: commented `.readme-smith.yaml` configuration.
- Optional AI rewrite through OpenAI-compatible endpoints (`local` Ollama by default, `openai` only with an explicit key). Prompts contain only the fact block; prose is validated against facts before use.
- Composite GitHub Action (`action.yml`) with `check` and `proposal` modes, example workflows, and a pre-commit hook definition.
- Fixtures for Node/TypeScript, Python, Rust, Go, Ruby, monorepo, web and dataset projects, with golden fact snapshots and end-to-end CLI tests.

### Changed

- Fact extraction uses `null` and `[verify]` for unknown values instead of inferring them.
- The CLI is now `rf` with the `readme-smith` alias and SPEC-compliant exit codes.
- Scoring caps failing checks below full credit, so rounding can never hide a defect.
- Diff line numbers are derived from a single-pass edit script, keeping added-line offsets correct.
- README analysis is case-insensitive for standard section headings.

### Removed

- The two-way README translation pipeline and its providers.
- Badge, Mermaid and custom section generation from the 0.1.x generator.
- The old `scanner/` and `generate/` modules.

## [0.1.0] — 2026-10-20

### Added

- Initial repository scanner and bilingual README generation prototype.
- Language statistics, manifest detection and Chinese/English templates.

[0.2.0]: https://gitee.com/yuwan41064/readme-smith/compare/v0.1.0...v0.2.0
[0.1.0]: https://gitee.com/yuwan41064/readme-smith/releases/tag/v0.1.0
