# readme-smith

A local-first README health doctor. It reads your repository, proves what it can, scores the README you already have, and writes a reviewable draft that never invents commands, arguments, environment variables or licences.

No account, no upload, no silent rewrites. The deterministic pipeline works fully offline.

## Contents

- [Why readme-smith](#why-readme-smith)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Scoring](#scoring)
- [Configuration](#configuration)
- [AI boundary](#ai-boundary)
- [Custom templates](#custom-templates)
- [CI integration](#ci-integration)
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

## Installation

Requires Node.js 18.17 or newer. Git is optional, but enables freshness checks and repository links.

```bash
git clone https://gitee.com/yuwan41064/readme-smith.git
cd readme-smith
npm install
npm run build
npm link
```

`npm link` exposes both `rf` and `readme-smith` on your PATH. You can also run the CLI directly with `node dist/cli.js`.

## Quick start

```console
$ rf scan .
$ rf doctor .
README health: 100/100 (threshold 80) — PASS
$ rf draft .
Wrote README.draft.md (en, deterministic)
$ rf diff --show
$ rf apply --dry-run
$ rf apply .
```

`scan` always prints the fact sheet as JSON. `doctor` tells you what is missing. `draft` proposes a document. `diff` shows section-level changes. `apply` writes the draft and keeps `.README.bak.md`.

If the project type is not recognised, the command exits with code `2` and names the manifests it looked for. You can force a template with `--preset cli|lib|web|monorepo|dataset`.

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

Every command accepts a path (default: the current directory) and these flags: `--preset`, `--ai local|openai|off`, `--json`, `--quiet`, `--verbose` and `--min-score`. `--quiet` prints only the final score or conclusion, `--json` emits structured data (including structured errors), and `--verbose` narrates fact extraction. `draft` also accepts `--lang auto|en|zh` and `--force`. `diff` accepts `--show`. `apply` accepts `--dry-run`.

`check` honours a `#rf-skip` marker in the head commit message: findings are still reported, but the gate passes so a human can review the exception. Use it sparingly.

## Scoring

The score is a weighted sum of five dimensions. Each applicable check carries partial credit, and a failing check is capped below its full weight so rounding cannot hide a defect.

| Dimension | Default weight | What it checks |
| --- | --- | --- |
| Completeness | 35 | Title, introduction, install, usage, licence, contributing, demo and package sections required by the preset |
| Usability | 25 | Install commands derived from the manifest, runnable usage examples, no command drift |
| Accuracy | 20 | Scripts exist, environment variables exist, the stated licence matches the repository |
| Readability | 10 | One H1, no heading-level jumps, labelled code fences, a table of contents for long documents |
| Freshness | 10 | Manifest changes after the last README update, using git history and working-tree state |

Presets adjust the weights: web projects value usability more, datasets value completeness and give install no weight. Set `minScore` in the config or pass `--min-score`. `doctor` and `check` exit `1` when the score is below it.

## Configuration

Run `rf init` to create `.readme-smith.yaml`, then edit only what you need. The file is optional; the defaults are the same values.

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

| Variable | When it is used |
| --- | --- |
| `OPENAI_API_KEY` | Only when you explicitly select `--ai openai`. It is never read for local or offline runs. |

Configuration warnings are printed to stderr and never abort a run; invalid values fall back to the default.

## AI boundary

AI is optional and narrow. It rewrites the fact block into an introductory paragraph; it never sees your source files, and it cannot add commands, flags, environment variables, API names, badges, authorship, versions or licences. Temperature is fixed at `0.2`.

| Backend | Behaviour |
| --- | --- |
| `local` (default) | Talks to an OpenAI-compatible server on `127.0.0.1:11434` (Ollama by default). If it is unavailable, the deterministic template is used with a warning. |
| `openai` | Explicit cloud opt-in. Requires `OPENAI_API_KEY`. The fact block is the only project data sent. |
| `off` | No network access. Everything is rendered from facts. `rf check` always uses this mode. |

Every AI result is validated against the fact sheet. Undeclared scripts, unknown environment variables, unsupported flags, wrong licence claims, unknown URLs, authorship and version claims are rejected, and the deterministic draft is used instead. Missing facts become `[verify]` markers rather than plausible-sounding guesses.

## Custom templates

Override a preset by adding a Markdown file under `.readme-smith/templates/`:

- `cli.md` applies to every CLI draft.
- `cli.zh.md` wins over `cli.md` for Chinese drafts.

Available variables are fact-backed: `name`, `displayName`, `description`, `version`, `type`, `preset`, `primaryLanguage`, `license`, `licenseFile`, `repository`, `install`, `installConsumer`, `installDev`, `usage`, `binaries`, `entryPoints`, `packages`, `scripts`, `scriptsTable`, `env`, `envTable`, `data`, `testCommand`, `buildCommand`, `contributing`, `ci`, `stats` and `installBlock`. An unknown variable is replaced with `[verify]` and reported as a warning.

A custom template is used for new documents, for `--force`, or when `--lang` changes the language of an existing README. In normal merge mode the built-in preset fills only the missing sections, preserving your prose byte-for-byte.

## CI integration

The repository ships `action.yml` with two modes:

- `check` runs `rf check` and fails the job on a low score or a stale draft. The result is written to the GitHub step summary.
- `proposal` writes `README.draft.md`, reports how many sections need work, and leaves `README.md` untouched. The bundled `README proposal` workflow then opens a reviewable pull request from the draft; merging is still a human decision.

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

The action builds the CLI from the checked-out source, so no npm release is required. Any other CI can run the CLI directly:

```bash
npm ci
npm run build
node dist/cli.js check . --min-score 80
```

For pre-commit, install the CLI and add the hook:

```yaml
repos:
  - repo: https://gitee.com/yuwan41064/readme-smith
    rev: main
    hooks:
      - id: readme-smith
        args: ["--min-score", "80"]
```

Set `fetch-depth: 2` (or more) when the CI checkout is shallow; freshness uses recent commit history.

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
