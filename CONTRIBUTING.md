# Contributing to readme-smith

Thanks for helping make READMEs less wrong. This project is intentionally small and deterministic, so the most valuable contributions are evidence-backed detectors, tests and documentation — not new prose generators.

## Development setup

Requires Node.js 18.17 or newer.

```bash
npm install
npm run build
npm test
```

During development:

```bash
npm run dev          # tsc --watch
npm run typecheck    # no emit
node dist/cli.js scan test/fixtures/node-cli
```

The suite uses the Node test runner and golden files. It has no network dependency; the AI tests start a local stub server.

## Non-negotiable rules

1. **Facts are never invented.** If the repository does not prove a value, the fact is `null` and the draft uses `[verify]`. Do not add fallbacks that guess a description, command, argument, environment variable, licence or author.
2. **README.md is never modified implicitly.** `draft`, `diff`, `doctor` and `check` only read it. Only `apply` writes, and it creates `.README.bak.md` first.
3. **AI only rewrites facts.** Prompts contain the fact block, never source files. Anything the validator rejects falls back to the deterministic template.
4. **No secrets in commits.** Do not add tokens, keys, `.env` files or screenshots containing credentials.

## Architecture map

| Path | Responsibility |
| --- | --- |
| `src/facts/` | Walk the repository and build the fact sheet. Each detector is pure and file-system based. |
| `src/readme/parse.ts` | Parse headings, fenced blocks, commands, environment variables and standard sections. |
| `src/readme/score.ts` | Five weighted dimensions: completeness, usability, accuracy, readability, freshness. |
| `src/draft/templates.ts` | Built-in en/zh presets rendered only from facts. |
| `src/draft/merge.ts` | Preserve existing sections; append only what is missing. |
| `src/draft/ai.ts` | Optional OpenAI-compatible prose rewrite plus the fact validator. |
| `src/diff/structured.ts` | Section-level diff and unified excerpt. |
| `src/commands/` | One module per CLI command; exit codes live here. |
| `src/tests/` | Unit, golden and end-to-end tests. |

## Adding a language or ecosystem detector

A language usually needs two touches: statistics and manifest metadata.

1. **Language statistics** — add or extend an entry in `EXTENSION_MAP` (or `BASENAME_MAP` for extensionless files) in `src/facts/languages.ts`. Keep the colour and weight fields reasonable; the weight affects the primary-language percentage.
2. **Manifest** — add a parser and a detection entry:
   - `detectManifests()` and `pickEcosystem()` in `src/facts/manifests.ts` declare which files exist and which ecosystem wins.
   - Implement `parseX()` returning the shared `ManifestResult`: name, display name, version, description, licence, dependencies, scripts, entry points, binaries, workspace packages and publication status.
   - Only set `binNames` when the manifest itself declares an executable (or a real binary target exists, as with Cargo `src/main.rs` and Go `package main`).
3. **Install and usage** — teach `installCommandFor()` in the same file the consumer and development install commands. Usage is derived automatically from a declared binary or the `dev`/`start` script; do not add prose.
4. **Fixture** — add a realistic project under `test/fixtures/<name>/` with its manifest, a small source file, a licence and a README. It must not contain secrets or generated build output.
5. **Tests** — add assertions to `src/tests/facts.test.ts` and include the fixture in `GOLDEN_CASES`. Regenerate golden facts intentionally:

   ```bash
   npm run build
   UPDATE_GOLDEN=1 node --test "dist/tests/facts.test.js"
   git diff test/golden
   ```

6. **Verify end to end**:

   ```bash
   node dist/cli.js scan test/fixtures/<name> --json
   node dist/cli.js doctor test/fixtures/<name> --json
   node dist/cli.js draft test/fixtures/<name> --ai off
   ```

If a detector cannot prove a fact, return `null` and add a warning. A missing fact is better than a confident lie.

## Changing scoring or templates

- Every scoring rule needs a test. Weights must still sum to 100 per preset.
- Templates must be factual and use the en/zh heading names that the analyser recognises (`Installation`/`安装`, `Usage`/`使用`, `Configuration`/`配置`, `License`/`许可证`).
- A merge-mode draft must return the input byte-for-byte when no sections are missing. Idempotence is covered by tests; keep it that way.
- If you change a built-in template, run the CLI against `test/fixtures/node-cli`, `monorepo` and `dataset` and inspect `rf diff --show`.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat(facts): detect uv workspaces
fix(score): never round a failing check to full credit
docs: explain the AI privacy boundary
test(diff): cover insertion line numbers
```

Before opening a pull request:

```bash
npm run typecheck
npm run build
npm test
node dist/cli.js doctor . --min-score 85
node dist/cli.js check . --min-score 85
```

The last two commands are the project dogfooding itself. Include the output in the PR description when it changes. Keep pull requests focused; mixed refactors and behaviour changes are hard to review.

## Reporting bugs

Use the issue templates and include:

- the command you ran (with `--verbose` if relevant),
- the exit code,
- the relevant fact JSON from `rf scan --json` (redact paths if needed),
- what you expected instead.

Please do not paste proprietary source code or credentials. A minimal fixture is the best reproduction.

## Licence

By contributing, you agree that your contribution is licensed under the MIT licence in [LICENSE](LICENSE).
