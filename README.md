# readme-smith

A local-first README health doctor. It reads your repository, proves what it can, scores the README you already have, and writes a reviewable draft that never invents commands, arguments, environment variables or licences.

No account, no upload, no silent rewrites. The deterministic pipeline works fully offline.

[中文简介](#中文简介) · [Quick start](#quick-start) · [Commands](#commands) · [Scoring](#scoring) · [CI integration](#ci-integration)

## 中文简介

readme-smith 是一个本地优先的 README 健康检查工具。它只从仓库文件中提取可证明的事实，为现有 README 做五维评分，生成可审阅的 `README.draft.md`，并在 CI 中阻止 README 随代码腐化。

- **默认离线。** 扫描、评分、草稿和检查都在本地完成，不需要账号，也不上传代码。
- **不静默改写。** `rf draft` 只写 `README.draft.md`；只有显式执行 `rf apply` 才会更新 `README.md`，并先保留 `.README.bak.md`。
- **不编造事实。** 命令、参数、环境变量和许可证都来自仓库证据；无法证明的信息标记为 `[verify]`，而不是猜一个看起来合理的值。
- **可接入 CI。** `rf check` 同时校验评分和草稿差异，让过期的 README 在合并前失败，而不是在数月后误导新贡献者。

## Contents

- [中文简介](#中文简介)
- [Why readme-smith](#why-readme-smith)
- [What it checks](#what-it-checks)
- [Supported projects](#supported-projects)
- [Installation](#installation)
- [Quick start](#quick-start)
- [A real diagnosis](#a-real-diagnosis)
- [Commands](#commands)
- [Draft workflow](#draft-workflow)
- [Scoring](#scoring)
- [Configuration](#configuration)
- [AI boundary](#ai-boundary)
- [Custom templates](#custom-templates)
- [CI integration](#ci-integration)
- [JSON output](#json-output)
- [Programmatic API](#programmatic-api)
- [Safety and privacy](#safety-and-privacy)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Why readme-smith

READMEs rot quietly. A script is renamed, a flag disappears, an install command stops working, and the README keeps promising the old world. Reviewers rarely notice until a new contributor hits the broken step.

readme-smith treats the README as something to verify against the repository:

- **Facts first.** Names, versions, scripts, binaries, entry points, environment variables, config files, CI jobs, licences and dependency counts are extracted from files. Anything not proven is `null`, never guessed.
- **Drafts, not edits.** `rf draft` writes `README.draft.md`. `README.md` is only changed by `rf apply`, after a preview and a backup.
- **A CI gate for rot.** `rf check` combines the score with a deterministic draft diff, so a stale README fails the pull request instead of drifting for months.

The tool is deliberately narrow: it does not generate a website, rewrite your title style, audit security or translate committed READMEs.

## What it checks

| Layer | What is inspected |
| --- | --- |
| Repository facts | Manifests, scripts and their real invocations, binaries, entry points, workspace packages, install/usage commands, environment variable names and their sources, config files, CI workflows, dataset shape, licence files, language distribution and git history. |
| README structure | H1–H3 headings, standard sections, fenced code blocks and their languages, table of contents, command mentions, environment variable mentions, licence claims and demo material. |
| Verdict | Five weighted dimensions, missing items with line numbers, and a deterministic comparison between the committed README and a draft built from current facts. |

Every fact carries provenance where it matters: an environment variable remembers which files mention it, a script keeps its actual invocation, and a licence records the file it came from. Unknown values stay `null`; missing prose becomes `[verify]`.

## Supported projects

The scanner understands these manifest families:

| Ecosystem | Manifest evidence |
| --- | --- |
| Node.js / TypeScript | `package.json`, including npm/pnpm/yarn/bun workspaces |
| Python | `pyproject.toml`, `setup.py`, `setup.cfg` |
| Rust | `Cargo.toml` |
| Go | `go.mod` |
| Ruby | `Gemfile`, `*.gemspec` |
| PHP | `composer.json` |
| Java | `pom.xml` |
| .NET | `*.csproj`, `*.sln` |

Project type is resolved in this order: monorepo markers, then the primary manifest, then language distribution. Use `--preset` to override detection.

| Preset | Best for | Default weights (completeness / usability / accuracy / readability / freshness) |
| --- | --- | --- |
| `cli` | Command-line tools and binaries | 35 / 25 / 20 / 10 / 10 |
| `lib` | Libraries and packages | 35 / 25 / 20 / 10 / 10 |
| `web` | Web apps and browser UIs | 30 / 30 / 20 / 10 / 10 |
| `monorepo` | Workspaces with several packages | 35 / 25 / 20 / 10 / 10 |
| `dataset` | Data and notebook repositories | 40 / 20 / 20 / 10 / 10 |

`auto` uses the detected preset and falls back to the standard weights.

## Installation

Requires Node.js 18.17 or newer. Git is optional, but enables freshness checks and repository links.

```bash
git clone https://gitee.com/yuwan41064/readme-smith.git
cd readme-smith
npm install
npm run build
npm link
```

`npm link` exposes both `rf` and `readme-smith` on your PATH. If you prefer not to link, run the CLI from the checkout:

```bash
node /path/to/readme-smith/dist/cli.js doctor /path/to/project
```

You can also install the checkout globally:

```bash
npm install -g .
```

## Quick start

```bash
rf init                 # optional: write .readme-smith.yaml
rf scan .               # deterministic facts as JSON
rf doctor .             # five-dimension score and missing items
rf draft . --ai off     # write README.draft.md, leave README.md alone
rf diff . --show        # section-level diff plus a unified excerpt
rf apply . --dry-run    # preview the write
rf apply .              # update README.md, keep .README.bak.md
rf check .              # CI gate: score plus draft differences
```

`scan` always prints the fact sheet as JSON. `doctor` tells you what is missing. `draft` proposes a document. `diff` shows section-level changes. `apply` writes the draft and keeps a backup. `check` never writes a draft or changes the README.

If the project type is not recognised, the command exits with code `2` and names the manifests it looked for. You can force a template with `--preset cli|lib|web|monorepo|dataset`.

## A real diagnosis

Given a repository whose README mentions a script that does not exist, `rf doctor` reports the problem at the exact line:

```output
$ rf doctor .
README health: 46/100 (threshold 80) — FAIL
  Completeness    18/35
    - [missing_install] No install or setup section.
    - [missing_license_section] A MIT licence exists in the repository but the README has no licence section.
    - [missing_contributing] A CONTRIBUTING file exists but the README does not link to it.
    - [missing_demo] A CLI/UI project should show a screenshot, GIF, terminal recording or console example.
  Usability        8/25
    - [command_drift] 1 documented command(s) do not match the manifest scripts.
  Accuracy         0/20
    - [command_not_found] 1 command(s) in the README do not exist in the manifest scripts.
    - [env_not_found] 1 environment variable(s) mentioned in the README were not found in the repository.
    - [command_not_found] ACME_SECRET=abc npm run deploy cannot run: script "deploy" is not declared in the manifest. (line 7)
    - [env_not_found] Environment variable ACME_SECRET is mentioned but does not exist in repository sources. (line 7)
  Readability     10/10
  Freshness       10/10
```

The first draft merges only the missing sections, preserving your prose byte-for-byte:

```console
$ rf draft . --ai off
[ok] Wrote README.draft.md (en, deterministic)
  - Added sections: Installation, Contributing, License
  - README.md was not modified. Review with `rf diff`, apply with `rf apply`.
```

Merge mode deliberately does not rewrite existing commands. To replace stale prose with a fresh fact-backed document, ask for a full draft instead:

```bash
rf draft . --force --ai off
rf diff . --show
rf apply .
rf doctor .
```

## Commands

| Command | What it does | Exit codes |
| --- | --- | --- |
| `rf scan [path]` | Extract the deterministic fact sheet and print JSON. | `0` success, `2` unrecognised project type |
| `rf draft [path]` | Write `README.draft.md`; never touch `README.md`. | `0` success, `2` scan/type failure |
| `rf diff [path]` | Compare `README.md` with the draft section by section. | `0` differences, `1` none, `2` error or missing draft |
| `rf doctor [path]` | Score completeness, usability, accuracy, readability and freshness. | `0` pass, `1` below threshold, `2` execution error |
| `rf check [path]` | Run doctor plus a deterministic draft diff for CI. | `0` pass, `1` fail, `2` error |
| `rf apply [path]` | Copy the draft into `README.md`, creating a backup. | `0` success, `2` missing draft or write failure |
| `rf init [path]` | Write a commented `.readme-smith.yaml`. | `0` success |

Every command accepts a repository path (default: the current directory) and the global options below.

| Option | Values | Meaning |
| --- | --- | --- |
| `--preset <name>` | `cli`, `lib`, `web`, `monorepo`, `dataset` | Force a preset instead of detecting one. |
| `--ai <backend>` | `local`, `openai`, `off` | AI backend for `draft`. `check` always uses `off`. |
| `--min-score <n>` | `0`–`100` | Threshold for `doctor` and `check`. |
| `--json` | flag | Emit structured data on stdout, including structured errors. |
| `--quiet` | flag | Print only the final score, conclusion or written path. |
| `--verbose` | flag | Narrate fact extraction on stderr. |

Command-specific options:

| Command | Option | Meaning |
| --- | --- | --- |
| `draft` | `--lang auto\|en\|zh` | Draft language; `auto` follows the existing README. |
| `draft` | `--force` | Generate a full draft and allow AI to rewrite existing prose. |
| `diff` | `--show` | Print a unified line excerpt in addition to the section summary. |
| `apply` | `--dry-run` | Print the pending change without writing anything. |
| `init` | `--force` | Overwrite an existing configuration file. |

## Draft workflow

`rf draft` has two modes:

- **Merge mode** (the default when a README exists and the language does not change): only missing sections are appended. Existing headings, prose and code are preserved byte-for-byte.
- **Full draft** (new README, `--force`, or a language change): the preset or custom template renders a complete document from facts. AI rewrites are possible only in this mode.

Review and apply are separate steps:

```bash
rf draft .
rf diff . --show       # exits 0 when differences exist, 1 when identical
rf apply . --dry-run   # exits 0; writes nothing, creates no backup
rf apply .             # backups to .README.bak.md, then replaces README.md
```

`rf diff` exits `2` when the draft is missing or unreadable. `rf apply` refuses to run without a draft. Applying an identical draft is a no-op.

## Scoring

The score is a weighted sum of five dimensions. Each applicable check carries partial credit, and a failing check is capped below its full weight so rounding cannot hide a defect.

| Dimension | Default weight | What it checks |
| --- | --- | --- |
| Completeness | 35 | Title, introduction, install, usage, licence, contributing, demo and package sections required by the preset |
| Usability | 25 | Install commands derived from the manifest, runnable usage examples, no command drift |
| Accuracy | 20 | Scripts exist, environment variables exist, the stated licence matches the repository |
| Readability | 10 | One H1, no heading-level jumps, labelled code fences, a table of contents for long documents |
| Freshness | 10 | Manifest changes after the last README update, using git history and working-tree state |

Presets adjust the weights as shown above. Set `minScore` in the config or pass `--min-score`. `doctor` and `check` exit `1` when the score is below it.

`check` is stricter than `doctor`: it fails when the project type is unknown, the README is missing, the score is below the threshold, **or** the committed README differs from the deterministic draft. That last rule is what catches prose that has drifted from current facts.

## Configuration

Run `rf init` to create `.readme-smith.yaml`, then edit only what you need. The file is optional; the defaults are the same values. Both `.readme-smith.yaml` and `.readme-smith.yml` are recognised.

```yaml
version: 1
preset: auto          # auto | cli | lib | web | monorepo | dataset
language: auto        # auto | en | zh
minScore: 80

ai:
  backend: local      # local | openai | off
  baseUrl: null       # OpenAI-compatible endpoint
  model: null         # defaults to llama3.2 locally, gpt-4o-mini for openai

weights:              # must sum to 100
  completeness: 35
  usability: 25
  accuracy: 20
  readability: 10
  freshness: 10
```

| Environment variable | When it is used |
| --- | --- |
| `OPENAI_API_KEY` | Only when you explicitly select `--ai openai`. It is never read for local or offline runs. |

Configuration warnings are printed to stderr and never abort a run; invalid values fall back to the default. In particular, weights that do not sum to `100` are ignored as a set.

## AI boundary

AI is optional and narrow. It rewrites the fact block into an introductory paragraph; it never sees your source files, and it cannot add commands, flags, environment variables, API names, badges, authorship, versions or licences. Temperature is fixed at `0.2`.

| Backend | Behaviour |
| --- | --- |
| `local` (default) | Talks to an OpenAI-compatible server at `http://127.0.0.1:11434/v1` (Ollama by default). If it is unavailable, the deterministic template is used with a warning. |
| `openai` | Explicit cloud opt-in. Requires `OPENAI_API_KEY`. The fact block is the only project data sent. |
| `off` | No network access. Everything is rendered from facts. `rf check` always uses this mode. |

Every AI result is validated against the fact sheet. Undeclared scripts, unknown environment variables, unsupported flags, wrong licence claims, unknown URLs, authorship and version claims are rejected, and the deterministic draft is used instead. Missing facts become `[verify]` markers rather than plausible-sounding guesses.

## Custom templates

Override a preset by adding a Markdown file under `.readme-smith/templates/`:

- `cli.md` applies to every CLI draft.
- `cli.zh.md` wins over `cli.md` for Chinese drafts.

```markdown
# {{displayName}}

{{description}}

## Installation

{{installBlock}}
```

Available variables are fact-backed: `name`, `displayName`, `description`, `version`, `type`, `preset`, `primaryLanguage`, `license`, `licenseFile`, `repository`, `install`, `installConsumer`, `installDev`, `usage`, `binaries`, `entryPoints`, `packages`, `scripts`, `scriptsTable`, `env`, `envTable`, `data`, `testCommand`, `buildCommand`, `contributing`, `ci`, `stats` and `installBlock`. An unknown variable is replaced with `[verify]` and reported as a warning.

A custom template is used for new documents, for `--force`, or when `--lang` changes the language of an existing README. In normal merge mode the built-in preset fills only the missing sections, preserving your prose byte-for-byte.

## CI integration

The repository ships `action.yml` with two modes:

- `check` runs `rf check` and fails the job on a low score or a stale draft. The result is written to the GitHub step summary.
- `proposal` writes `README.draft.md`, reports how many sections need work, and leaves `README.md` untouched. The bundled `README proposal` workflow then opens a reviewable pull request from the draft; merging is still a human decision.

Inside this repository, the bundled workflow uses the local action:

```yaml
name: README check
on: [pull_request]
permissions:
  contents: read
jobs:
  readme:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2
      - uses: ./
        with:
          mode: check
          min-score: "80"
```

The action builds the CLI from the checked-out source, so no npm release is required. For other repositories, install the CLI in the job and run it directly; the CLI is CI-agnostic:

```bash
npm ci
npm run build
node dist/cli.js check . --min-score 80
```

For pre-commit, install the CLI and add the hook:

```yaml
repos:
  - repo: https://gitee.com/yuwan41064/readme-smith
    rev: master
    hooks:
      - id: readme-smith
        args: ["--min-score", "80"]
```

Set `fetch-depth: 2` (or more) when the CI checkout is shallow; freshness uses recent commit history.

`check` honours a `#rf-skip` marker in the head commit message: findings are still reported, but the gate passes so a human can review the exception. Use it sparingly.

## JSON output

`--json` makes every command machine-readable and keeps human narration on stderr. Errors use the same envelope, so a script can parse failures too:

```json
{
  "error": {
    "code": "invalid_min_score",
    "message": "--min-score must be an integer between 0 and 100 (got 101).",
    "exitCode": 2
  }
}
```

Reports contain relative paths, not absolute ones, and never include environment variable values. `scan --json --quiet` is suitable for piping into `jq` or another tool.

## Programmatic API

The ESM entry point exports the deterministic pipeline:

```js
import { scanFacts, scoreReadme, buildDraft, computeDiff } from 'readme-smith';

const facts = scanFacts({ root: process.cwd(), skipGit: false });
const draft = await buildDraft({
  root: process.cwd(),
  facts,
  preset: facts.project.type === 'unknown' ? 'lib' : facts.project.type,
  language: 'en',
  ai: { backend: 'off', baseUrl: null, model: null },
});
console.log(draft.markdown);
```

The main exports include `scanFacts`, `detectProjectType`, `analyseReadme`, `analyseCodeCommands`, `scoreReadme`, `computeFreshness`, `buildDraft`, `mergeDraft`, `validateProse`, `computeDiff`, `defaultWeights` and the configuration helpers.

## Safety and privacy

- **No telemetry.** readme-smith has no account system, analytics or upload step.
- **No source upload.** AI, when explicitly enabled, receives only the fact block. `--ai off` never opens a network connection.
- **No secret values.** The scanner records environment variable names and their source files, never their values.
- **No silent writes.** `scan`, `doctor`, `diff` and `check` are read-only. `draft` writes only `README.draft.md`. `apply` is explicit and keeps `.README.bak.md`.
- **Deterministic.** The same repository state produces the same facts, score and draft, minus git freshness.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Exit code `2`, “project type is unknown” | Add a supported manifest, or force one with `--preset`. |
| `doctor` passes but `check` fails | `check` also requires the README to match the deterministic draft. Run `rf draft`, review `rf diff`, then `rf apply`; use `#rf-skip` only for a deliberate exception. |
| A draft adds sections but leaves a wrong command in place | Merge mode preserves existing prose. Edit it yourself, or generate a full draft with `rf draft . --force`. |
| AI warning about an unavailable backend | Start a local OpenAI-compatible server, configure `ai.baseUrl`, or use `--ai off` for deterministic output. |
| Freshness looks wrong on CI | Shallow clones hide history. Set `fetch-depth: 2` or deeper. |
| Config warning about weights | All five weights must sum to `100`; otherwise the whole weight block falls back to defaults. |
| `diff` exits `1` | There are no differences between the README and the draft. This is the “already in sync” case. |

## Project layout

- `src/facts/` — deterministic detectors for manifests, languages, scripts, binaries, environment variables, config files, CI workflows, build commands and licences.
- `src/readme/` — README parser and the five-dimension scorer.
- `src/draft/` — built-in templates, custom templates, merge-only-missing logic and the optional AI boundary.
- `src/diff/` — section-level diff and unified excerpts.
- `src/commands/` — one module per CLI command, including exit codes.
- `test/fixtures/` and `test/golden/` — language fixtures and golden fact snapshots.
- `src/tests/` — unit, golden and end-to-end tests.

## Development

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm test` | Run the Node test suite |
| `npm run typecheck` | Type-check without emitting |
| `npm run dev` | Rebuild on change |
| `npm run clean` | Remove `dist/` |
| `npm run self:doctor` | Score this repository |
| `npm run self:check` | Run the CI gate against this repository |

The test suite covers nine fixtures (Node, Python, Rust, Go, Ruby, monorepo, web, dataset and an unrecognised project), golden fact sheets, scoring, merge idempotence, diff semantics, AI validation with a local stub, and every CLI exit code.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, the fact contract, and the steps for adding a language or ecosystem detector. Pull requests should keep the two dogfood commands green.

## License

MIT. See [LICENSE](LICENSE) for the full text.
