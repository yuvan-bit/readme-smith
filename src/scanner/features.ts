import path from 'node:path';
import type { Dependency, DocReference, FeatureFlags, LicenseInfo } from '../types.js';
import { exists, findCaseInsensitive, readTextSafe, toPosix, OVERRIDE_DIR } from '../utils/fs.js';

/* ------------------------------------------------------------------ *
 * License detection
 * ------------------------------------------------------------------ */

const LICENSE_FILENAMES = [
  'LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'LICENCE.txt',
  'COPYING', 'COPYING.md', 'UNLICENSE',
];

interface LicenseRule {
  spdx: string;
  family: string;
  /** Ordered: every pattern must appear in the text. */
  all: RegExp[];
  /** Any of these must NOT appear. */
  none?: RegExp[];
}

const LICENSE_RULES: LicenseRule[] = [
  { spdx: 'MIT', family: 'MIT', all: [/permission is hereby granted, free of charge/i, /the software is provided "as is"/i] },
  { spdx: 'Apache-2.0', family: 'Apache', all: [/apache license/i, /version 2\.0/i] },
  { spdx: 'GPL-3.0-only', family: 'GPL', all: [/gnu general public license/i, /version 3/i], none: [/lesser/i] },
  { spdx: 'GPL-2.0-only', family: 'GPL', all: [/gnu general public license/i, /version 2/i], none: [/lesser/i] },
  { spdx: 'LGPL-3.0-only', family: 'LGPL', all: [/gnu lesser general public license/i, /version 3/i] },
  { spdx: 'AGPL-3.0-only', family: 'AGPL', all: [/gnu affero general public license/i] },
  { spdx: 'MPL-2.0', family: 'Mozilla', all: [/mozilla public license/i, /version 2\.0/i] },
  { spdx: 'BSD-3-Clause', family: 'BSD', all: [/redistribution and use in source and binary forms/i, /neither the name of/i] },
  { spdx: 'BSD-2-Clause', family: 'BSD', all: [/redistribution and use in source and binary forms/i], none: [/neither the name of/i] },
  { spdx: 'Unlicense', family: 'Unlicense', all: [/this is free and unencumbered software/i] },
  { spdx: '0BSD', family: 'BSD', all: [/permission to use, copy, modify/i] },
  { spdx: 'ISC', family: 'ISC', all: [/isc license|permission to use, copy, modify, and\/or distribute/i] },
  { spdx: 'CC0-1.0', family: 'CC0', all: [/creative commons/i, /cc0/i] },
];

export function detectLicense(root: string, spdxHint?: string): LicenseInfo | undefined {
  const filename = LICENSE_FILENAMES.map((f) => findCaseInsensitive(root, f)).find(Boolean);
  if (filename) {
    const text = readTextSafe(path.join(root, filename));
    if (text) {
      const head = text.slice(0, 8000);
      for (const rule of LICENSE_RULES) {
        if (rule.all.every((re) => re.test(head)) && !(rule.none ?? []).some((re) => re.test(head))) {
          return {
            spdx: rule.spdx,
            family: rule.family,
            file: filename,
            url: licenseUrl(rule.spdx),
          };
        }
      }
      // Recognised file but unrecognised text.
      return { family: 'Custom', file: filename };
    }
  }
  if (spdxHint && spdxHint !== 'UNLICENSED' && spdxHint !== 'SEE LICENSE IN LICENSE') {
    return { spdx: spdxHint, family: spdxFamily(spdxHint), url: licenseUrl(spdxHint) };
  }
  return undefined;
}

function spdxFamily(spdx: string): string {
  const base = spdx.split('-')[0]!;
  return /MIT|Apache|GPL|BSD|ISC|MPL|CC0|Unlicense|AGPL|LGPL/i.test(base) ? base : 'Custom';
}

function licenseUrl(spdx: string): string {
  if (spdx === 'UNLICENSED') return '';
  return `https://opensource.org/licenses/${spdx === 'GPL-3.0-only' ? 'GPL-3.0' : spdx === 'Apache-2.0' ? 'Apache-2.0' : spdx}`;
}

/* ------------------------------------------------------------------ *
 * CI / test / lint / docs detection
 * ------------------------------------------------------------------ */

const CI_SOURCES: Array<{ provider: string; paths: string[]; name: string }> = [
  { provider: 'GitHub Actions', name: 'github-actions', paths: ['.github/workflows'] },
  { provider: 'GitLab CI', name: 'gitlab', paths: ['.gitlab-ci.yml'] },
  { provider: 'CircleCI', name: 'circleci', paths: ['.circleci/config.yml'] },
  { provider: 'Travis CI', name: 'travis', paths: ['.travis.yml'] },
  { provider: 'Azure Pipelines', name: 'azure', paths: ['azure-pipelines.yml'] },
  { provider: 'Buildkite', name: 'buildkite', paths: ['.buildkite'] },
  { provider: 'Drone CI', name: 'drone', paths: ['.drone.yml'] },
  { provider: 'Jenkins', name: 'jenkins', paths: ['Jenkinsfile'] },
  { provider: 'AppVeyor', name: 'appveyor', paths: ['appveyor.yml'] },
  { provider: 'Codecov', name: 'codecov', paths: ['codecov.yml', '.codecov.yml'] },
];

const TEST_FRAMEWORK_HINTS: Array<{ name: string; deps: RegExp[]; files: RegExp[]; configs: string[] }> = [
  { name: 'Vitest', deps: [/^vitest$/], files: [], configs: ['vitest.config.ts', 'vitest.config.js'] },
  { name: 'Jest', deps: [/^jest$/, /^ts-jest$/], files: [], configs: ['jest.config.js', 'jest.config.ts'] },
  { name: 'Mocha', deps: [/^mocha$/], files: [], configs: ['.mocharc.json', '.mocharc.yml'] },
  { name: 'node:test', deps: [], files: [], configs: [] },
  { name: 'pytest', deps: [/^pytest$/], files: [/^test_.*\.py$/, /_test\.py$/], configs: ['pytest.ini', 'tox.ini'] },
  { name: 'unittest', deps: [], files: [/^test_.*\.py$/], configs: [] },
  { name: 'cargo test', deps: [], files: [], configs: [] },
  { name: 'go test', deps: [], files: [/_test\.go$/], configs: [] },
  { name: 'RSpec', deps: [/^rspec$/], files: [/_spec\.rb$/], configs: ['.rspec'] },
  { name: 'PHPUnit', deps: [/^phpunit\/phpunit$/], files: [/Test\.php$/], configs: ['phpunit.xml', 'phpunit.xml.dist'] },
  { name: 'JUnit', deps: [/junit/], files: [/Test\.java$/], configs: [] },
  { name: 'Playwright', deps: [/@playwright\/test/, /^playwright$/], files: [], configs: ['playwright.config.ts'] },
  { name: 'Cypress', deps: [/^cypress$/], files: [], configs: ['cypress.config.ts', 'cypress.config.js'] },
  { name: 'Testing Library', deps: [/@testing-library\/(react|dom|vue)/], files: [], configs: [] },
];

/**
 * Test-file naming shared by every JS/TS runner.
 *
 * `foo.test.ts` proves the project has tests, but it does not say *which*
 * runner owns them: Vitest, Jest, Mocha and `node:test` all use it. Matching it
 * per-framework is how the fixture ended up claiming "Vitest + Jest" from a
 * single Vitest test file. So this pattern only ever answers "are there
 * tests?", never "which framework?" — that question needs a dependency, a
 * config file or a script, all of which are unambiguous.
 */
const AMBIGUOUS_JS_TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

const LINTER_HINTS: Array<{ name: string; deps: RegExp[]; configs: RegExp[] }> = [
  { name: 'ESLint', deps: [/^eslint$/], configs: [/^eslint\.config\./, /^\.eslintrc/] },
  { name: 'Biome', deps: [/@biomejs\/biome$/], configs: [/^biome\.json/] },
  { name: 'Oxlint', deps: [/^oxlint$/], configs: [/^\.oxlintrc/] },
  { name: 'Ruff', deps: [/^ruff$/], configs: [/^ruff\.toml$/] },
  { name: 'Pylint', deps: [/^pylint$/], configs: [/^\.pylintrc$/] },
  { name: 'Flake8', deps: [/^flake8$/], configs: [/^\.flake8$/] },
  { name: 'mypy', deps: [/^mypy$/], configs: [/^mypy\.ini$/] },
  { name: 'Clippy', deps: [], configs: [/^clippy\.toml$/] },
  { name: 'golangci-lint', deps: [], configs: [/^\.golangci\./] },
  { name: 'RuboCop', deps: [/^rubocop$/], configs: [/^\.rubocop/] },
  { name: 'PHP CS Fixer', deps: [/friendsofphp\/php-cs-fixer/], configs: [/^\.php-cs-fixer/] },
  { name: 'Stylelint', deps: [/^stylelint$/], configs: [/^\.stylelintrc/, /^stylelint\.config/] },
  { name: 'ShellCheck', deps: [/^shellcheck$/], configs: [/^\.shellcheckrc$/] },
];

const FORMATTER_HINTS: Array<{ name: string; deps: RegExp[]; configs: RegExp[] }> = [
  { name: 'Prettier', deps: [/^prettier$/], configs: [/^\.prettierrc/, /^prettier\.config/] },
  { name: 'dprint', deps: [/^dprint$/], configs: [/^dprint\.json$/] },
  { name: 'Black', deps: [/^black$/], configs: [] },
  { name: 'rustfmt', deps: [], configs: [/^rustfmt\.toml$/] },
  { name: 'gofmt', deps: [], configs: [] },
  { name: 'EditorConfig', deps: [], configs: [/^\.editorconfig$/] },
];

const DOC_FILE_MAP: Array<{ kind: DocReference['kind']; patterns: RegExp[] }> = [
  { kind: 'changelog', patterns: [/^change_?log/i, /^history\.md$/i, /^releases\.md$/i, /^news\.md$/i] },
  { kind: 'contributing', patterns: [/^contributing/i, /^贡献/i] },
  { kind: 'license', patterns: [/^licen[cs]e/i, /^copying/i] },
  { kind: 'security', patterns: [/^security/i, /^安全/i] },
];

export interface FeatureContext {
  root: string;
  files: Array<{ rel: string; abs: string }>;
  dependencies: Dependency[];
  devDependencies: Dependency[];
  scripts: Array<{ name: string; command: string }>;
  primaryLanguage?: string;
  ecosystem?: string;
}

export interface FeatureResult {
  features: FeatureFlags;
  docs: DocReference[];
  envVars: string[];
  frameworks: string[];
}

export function detectFeatures(ctx: FeatureContext): FeatureResult {
  const { root, files } = ctx;
  const rels = files.map((f) => f.rel);
  const baseNames = new Set(rels.map((r) => path.basename(r)));
  const lowerBaseNames = new Set([...baseNames].map((b) => b.toLowerCase()));
  const allDepNames = [...ctx.dependencies, ...ctx.devDependencies].map((d) => d.name);
  const matchesDep = (patterns: RegExp[]) => patterns.some((re) => allDepNames.some((n) => re.test(n)));

  const f: FeatureFlags = {
    hasTests: false, testFrameworks: [], hasCI: false, ciProviders: [],
    hasDocker: false, dockerFiles: [], hasCompose: false,
    hasLinter: false, linters: [], hasFormatter: false, formatters: [],
    hasTypeCheck: false, hasChangelog: false, hasContributing: false,
    hasCodeOfConduct: false, hasSecurityPolicy: false, hasIssueTemplates: false,
    hasPullRequestTemplate: false, hasEnvSample: false, hasReleases: false,
    isMonorepo: false, workspacePackages: [],
    isLibrary: false, isCli: false, isApplication: false, hasApi: false,
    hasDocsSite: false, hasBenchmarks: false, hasStorybook: false, hasI18n: false,
    publishedToRegistry: false,
  };

  /* ---- CI ---- */
  for (const ci of CI_SOURCES) {
    if (ci.paths.some((p) => exists(root, p) || rels.some((r) => r.startsWith(`${p}/`)))) {
      f.hasCI = true;
      if (!f.ciProviders.includes(ci.provider)) f.ciProviders.push(ci.provider);
    }
  }
  // Identify a primary workflow so we can build a real status badge.
  const workflows = rels.filter((r) => r.startsWith('.github/workflows/') && /\.(ya?ml)$/.test(r));
  if (workflows.length > 0) {
    const preferred =
      workflows.find((w) => /(ci|build|test|main)\.ya?ml$/i.test(path.basename(w))) ??
      workflows[0]!;
    f.ciWorkflowFile = preferred;
    const text = readTextSafe(path.join(root, preferred)) ?? '';
    const nameMatch = text.match(/^\s*name:\s*['"]?([^'"\n#]+)/m);
    f.ciWorkflowName = nameMatch?.[1]?.trim() || path.basename(preferred, path.extname(preferred));
  }

  /* ---- Tests ---- */
  for (const hint of TEST_FRAMEWORK_HINTS) {
    const depHit = hint.deps.length > 0 && matchesDep(hint.deps);
    const fileHit = hint.files.some((re) => rels.some((r) => re.test(path.basename(r))));
    const configHit = hint.configs.some((c) => lowerBaseNames.has(c.toLowerCase()));
    const scriptHit = ctx.scripts.some((s) => s.command.includes(hint.name.toLowerCase()));
    if (depHit || fileHit || configHit || scriptHit) {
      f.hasTests = true;
      if (!f.testFrameworks.includes(hint.name)) f.testFrameworks.push(hint.name);
    }
  }
  // Test files alone prove a suite exists, but not which runner owns it.
  // Record that tests exist and leave `testFrameworks` empty rather than
  // crediting a framework the evidence does not support.
  if (!f.hasTests && rels.some((r) => AMBIGUOUS_JS_TEST_FILE.test(path.basename(r)))) {
    f.hasTests = true;
  }
  // Rust: a #[test] anywhere counts; Go: *_test.go already handled above.
  if (ctx.primaryLanguage === 'Rust') {
    const hasRustTest = rels.some((r) => r.endsWith('.rs') && /#\[(test|cfg\(test\))\]/.test(readTextSafe(path.join(root, r)) ?? ''));
    if (hasRustTest) { f.hasTests = true; if (!f.testFrameworks.includes('cargo test')) f.testFrameworks.push('cargo test'); }
  }
  if (ctx.primaryLanguage === 'TypeScript' || ctx.primaryLanguage === 'JavaScript') {
    if (rels.some((r) => /^test.*\.(m|c)?js$/.test(path.basename(r)) && readTextSafe(path.join(root, r))?.includes('node:test'))) {
      f.hasTests = true;
      if (!f.testFrameworks.includes('node:test')) f.testFrameworks.push('node:test');
    }
  }
  f.testCommand = pickTestCommand(ctx.scripts, ctx.ecosystem, f.testFrameworks);

  /* ---- Lint / format ---- */
  for (const hint of LINTER_HINTS) {
    if ((hint.deps.length > 0 && matchesDep(hint.deps)) || hint.configs.some((re) => rels.some((r) => re.test(path.basename(r))))) {
      f.hasLinter = true;
      if (!f.linters.includes(hint.name)) f.linters.push(hint.name);
    }
  }
  for (const hint of FORMATTER_HINTS) {
    if ((hint.deps.length > 0 && matchesDep(hint.deps)) || hint.configs.some((re) => rels.some((r) => re.test(path.basename(r))))) {
      f.hasFormatter = true;
      if (!f.formatters.includes(hint.name)) f.formatters.push(hint.name);
    }
  }
  f.hasTypeCheck =
    ctx.primaryLanguage === 'TypeScript' ||
    allDepNames.includes('typescript') ||
    exists(root, 'tsconfig.json') ||
    allDepNames.includes('mypy') ||
    ctx.scripts.some((s) => /\btsc\b/.test(s.command));

  /* ---- Docker ---- */
  f.dockerFiles = rels.filter((r) => /(^|\/)dockerfile(\.|$)/i.test(path.basename(r)) || /^dockerfile/i.test(path.basename(r)));
  f.hasDocker = f.dockerFiles.length > 0;
  f.hasCompose = rels.some((r) => /(^|\/)(docker-)?compose(\.override)?\.ya?ml$/i.test(r));

  /* ---- Community health files ---- */
  f.hasChangelog = rels.some((r) => /^change_?log/i.test(path.basename(r)));
  f.hasContributing = rels.some((r) => /^contributing/i.test(path.basename(r)));
  f.hasCodeOfConduct = rels.some((r) => /^code_?of_?conduct/i.test(path.basename(r)));
  f.hasSecurityPolicy = exists(root, 'SECURITY.md') || exists(root, '.github/SECURITY.md') || rels.some((r) => /^security\.md$/i.test(path.basename(r)));
  f.hasIssueTemplates = exists(root, '.github/ISSUE_TEMPLATE') || rels.some((r) => r.startsWith('.github/ISSUE_TEMPLATE/'));
  f.hasPullRequestTemplate = ['.github/PULL_REQUEST_TEMPLATE.md', '.github/pull_request_template.md', 'PULL_REQUEST_TEMPLATE.md', 'docs/pull_request_template.md']
    .some((p) => exists(root, p));
  f.hasEnvSample = ['.env.example', '.env.sample', '.env.template', 'env.example'].some((p) => exists(root, p));
  f.hasReleases = exists(root, 'RELEASES.md') || f.hasChangelog;
  f.hasBenchmarks = rels.some((r) => /(^|\/)(bench|benches|benchmarks|perf)(\/|$)/i.test(r)) || allDepNames.some((n) => /^(crit|ben)c|benchmark|^tinybench$/i.test(n));
  f.hasStorybook = allDepNames.includes('@storybook/react') || allDepNames.some((n) => n.startsWith('@storybook/')) || exists(root, '.storybook');
  f.hasI18n = allDepNames.some((n) => /^(i18next|react-i18next|vue-i18n|@formatjs\/intl|react-intl|next-intl|lingui|@lingui\/core|polyglot|gettext)$/i.test(n)) || rels.some((r) => /(^|\/)(locales|i18n|lang)(\/|$)/i.test(r));
  f.hasDocsSite =
    exists(root, 'docusaurus.config.ts') || exists(root, 'docusaurus.config.js') ||
    exists(root, 'mkdocs.yml') || exists(root, 'docsify') ||
    rels.some((r) => /^docs\/(index|_sidebar|conf)\.(md|py)$/i.test(r)) ||
    exists(root, 'vitepress.config.ts') || exists(root, '.vitepress') ||
    exists(root, 'astro.config.mjs');

  /* ---- Project shape ---- */
  const hasServerDep = allDepNames.some((n) => /^(express|fastify|koa|hono|@nestjs\/core|next|nuxt|remix|svelte-kit|@hapi\/hapi|polka|elysia)$/i.test(n)) ||
    allDepNames.some((n) => /^(django|flask|fastapi|starlette|tornado|bottle|pyramid|gin-gonic|echo|fiber|actix-web|axum|rocket|rails|laravel|symfony|spring-boot)$/i.test(n));
  f.hasApi = hasServerDep || rels.some((r) => /(^|\/)(routes?|controllers?|api|endpoints?|handlers?)(\/|$)/i.test(r));
  f.isApplication = hasServerDep || f.hasDocker || rels.some((r) => /(^|\/)(pages|views|screens|app)(\/|$)/i.test(r));
  // `isCli` depends on manifest `bin` entries, which only the orchestrator
  // has fully resolved, so it is assigned there rather than guessed here.
  f.isLibrary = !f.isApplication;

  /* ---- Frameworks ---- */
  const frameworks = detectFrameworks(allDepNames, rels, root);

  /* ---- Docs ---- */
  const docs: DocReference[] = [];
  for (const rel of rels) {
    if (!/\.(md|mdx|rst|adoc)$/i.test(rel)) continue;
    const relPath = rel.replace(/\\/g, '/');
    // The generator's own inputs, not reader-facing documentation. Listing them
    // in the Documentation table would advertise a directory most people never
    // opened before.
    if (relPath.startsWith(`${OVERRIDE_DIR}/`)) continue;
    const base = path.basename(rel);
    if (/^readme/i.test(base)) continue; // handled separately
    const rule = DOC_FILE_MAP.find((d) => d.patterns.some((re) => re.test(base)));
    const kind = rule?.kind ?? (relPath.startsWith('docs/') ? 'docs' : 'other');
    let title: string | undefined;
    const text = readTextSafe(path.join(root, rel), 4096);
    const h1 = text?.match(/^#\s+(.+)$/m);
    if (h1) title = h1[1]!.trim();
    docs.push({ path: relPath, ...(title ? { title } : {}), kind });
  }
  docs.sort((a, b) => a.path.localeCompare(b.path));

  /* ---- Env vars ---- */
  const envVars = extractEnvVars(files, root);

  return { features: f, docs: docs.slice(0, 40), envVars, frameworks };
}

function pickTestCommand(scripts: Array<{ name: string; command: string }>, ecosystem: string | undefined, frameworks: string[]): string | undefined {
  const explicit = scripts.find((s) => s.name === 'test');
  if (explicit) return `run test`;
  if (ecosystem === 'cargo') return 'cargo test';
  if (ecosystem === 'go') return 'go test ./...';
  if (ecosystem === 'pip' || ecosystem === 'poetry' || ecosystem === 'uv') {
    if (frameworks.includes('pytest')) return ecosystem === 'poetry' ? 'poetry run pytest' : 'pytest';
  }
  if (ecosystem === 'composer') return 'composer test';
  if (ecosystem === 'gem') return 'bundle exec rspec';
  if (ecosystem === 'maven') return 'mvn test';
  if (ecosystem === 'gradle') return './gradlew test';
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Framework detection
 * ------------------------------------------------------------------ */

const FRAMEWORK_MAP: Array<{ name: string; test: (dep: string) => boolean }> = [
  { name: 'React', test: (d) => d === 'react' || d === 'react-dom' },
  { name: 'Next.js', test: (d) => d === 'next' },
  { name: 'Vue', test: (d) => d === 'vue' },
  { name: 'Nuxt', test: (d) => d === 'nuxt' },
  { name: 'Svelte', test: (d) => d === 'svelte' },
  { name: 'SvelteKit', test: (d) => d === '@sveltejs/kit' },
  { name: 'Astro', test: (d) => d === 'astro' },
  { name: 'Angular', test: (d) => d === '@angular/core' },
  { name: 'Solid', test: (d) => d === 'solid-js' },
  { name: 'Express', test: (d) => d === 'express' },
  { name: 'Fastify', test: (d) => d === 'fastify' },
  { name: 'NestJS', test: (d) => d === '@nestjs/core' },
  { name: 'Hono', test: (d) => d === 'hono' },
  { name: 'tRPC', test: (d) => d === '@trpc/server' || d === '@trpc/client' },
  { name: 'GraphQL', test: (d) => d === 'graphql' || d === 'apollo-server' || d === '@apollo/server' },
  { name: 'Prisma', test: (d) => d === 'prisma' || d === '@prisma/client' },
  { name: 'Drizzle', test: (d) => d === 'drizzle-orm' },
  { name: 'Tailwind CSS', test: (d) => d === 'tailwindcss' },
  { name: 'Commander', test: (d) => d === 'commander' },
  { name: 'Yargs', test: (d) => d === 'yargs' },
  { name: 'oclif', test: (d) => d === '@oclif/core' },
  { name: 'Electron', test: (d) => d === 'electron' },
  { name: 'Tauri', test: (d) => d.startsWith('@tauri-apps/') },
  { name: 'Zod', test: (d) => d === 'zod' },
  { name: 'OpenAI SDK', test: (d) => d === 'openai' || d === '@anthropic-ai/sdk' },
  { name: 'LangChain', test: (d) => d.startsWith('langchain') },
];

const PY_FRAMEWORK_MAP: Array<{ name: string; re: RegExp }> = [
  { name: 'Django', re: /^django/i },
  { name: 'Flask', re: /^flask$/i },
  { name: 'FastAPI', re: /^fastapi$/i },
  { name: 'Streamlit', re: /^streamlit$/i },
  { name: 'PyTorch', re: /^torch$/i },
  { name: 'TensorFlow', re: /^tensorflow/i },
  { name: 'NumPy', re: /^numpy$/i },
  { name: 'Pandas', re: /^pandas$/i },
  { name: 'Click', re: /^click$/i },
  { name: 'Typer', re: /^typer$/i },
  { name: 'Rich', re: /^rich$/i },
];

const RUST_FRAMEWORK_MAP: Array<{ name: string; re: RegExp }> = [
  { name: 'Tokio', re: /^tokio$/ },
  { name: 'Axum', re: /^axum$/ },
  { name: 'Actix Web', re: /^actix-web$/ },
  { name: 'Clap', re: /^clap$/ },
  { name: 'Serde', re: /^serde$/ },
];

const GO_FRAMEWORK_MAP: Array<{ name: string; re: RegExp }> = [
  { name: 'Gin', re: /gin-gonic\/gin$/ },
  { name: 'Echo', re: /labstack\/echo/ },
  { name: 'Cobra', re: /spf13\/cobra$/ },
  { name: 'Chi', re: /go-chi\/chi/ },
];

function detectFrameworks(deps: string[], rels: string[], root: string): string[] {
  const found: string[] = [];
  const add = (name: string) => { if (!found.includes(name)) found.push(name); };

  for (const { name, test } of FRAMEWORK_MAP) if (deps.some(test)) add(name);
  for (const { name, re } of PY_FRAMEWORK_MAP) if (deps.some((d) => re.test(d))) add(name);
  for (const { name, re } of RUST_FRAMEWORK_MAP) if (deps.some((d) => re.test(d))) add(name);
  for (const { name, re } of GO_FRAMEWORK_MAP) if (deps.some((d) => re.test(d))) add(name);

  // Manifest-free signals: some stacks declare nothing in a dependency list.
  if (exists(root, 'manage.py')) add('Django');
  if (rels.some((r) => /(^|\/)next\.config\./i.test(path.basename(r)))) add('Next.js');
  if (exists(root, 'Gemfile') && readTextSafe(path.join(root, 'Gemfile'))?.includes('rails')) add('Rails');
  if (exists(root, 'pom.xml') && readTextSafe(path.join(root, 'pom.xml'))?.includes('spring-boot')) add('Spring Boot');

  return found;
}

/* ------------------------------------------------------------------ *
 * Environment variable extraction
 * ------------------------------------------------------------------ */

/**
 * Environment-variable extraction.
 *
 * Patterns are scoped per file type on purpose. A single global `\$\{([A-Z_]+)\}`
 * rule looks reasonable until it runs on TypeScript, where `${SOME_CONST}` is a
 * template-literal interpolation of a local variable — which produces a README
 * documenting `SECTION_IDS` as a required environment variable. Precision here
 * matters more than recall: a wrong "Configuration" table is actively harmful.
 */
interface EnvPatternSet {
  extensions: Set<string>;
  patterns: RegExp[];
}

const ENV_PATTERN_SETS: EnvPatternSet[] = [
  {
    extensions: new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte']),
    patterns: [
      /process\.env\.([A-Z][A-Z0-9_]{2,})/g,
      /process\.env\[\s*['"`]([A-Z][A-Z0-9_]{2,})['"`]\s*\]/g,
      /Deno\.env\.get\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g,
    ],
  },
  {
    extensions: new Set(['.py']),
    patterns: [
      /os\.environ(?:\.get)?\(?[\s]*['"]([A-Z][A-Z0-9_]{2,})['"]/g,
      /os\.environ\[\s*['"]([A-Z][A-Z0-9_]{2,})['"]\s*\]/g,
      /os\.getenv\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g,
      /environ\.get\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g,
    ],
  },
  {
    extensions: new Set(['.rs']),
    patterns: [
      /(?:std::)?env::var(?:_os)?\(\s*"([A-Z][A-Z0-9_]{2,})"/g,
      /env!\(\s*"([A-Z][A-Z0-9_]{2,})"/g,
    ],
  },
  {
    extensions: new Set(['.go']),
    patterns: [/os\.(?:Getenv|LookupEnv)\(\s*"([A-Z][A-Z0-9_]{2,})"/g],
  },
  {
    extensions: new Set(['.java', '.kt']),
    patterns: [/System\.getenv\(\s*"([A-Z][A-Z0-9_]{2,})"/g],
  },
  {
    extensions: new Set(['.php']),
    patterns: [/getenv\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g],
  },
  {
    extensions: new Set(['.rb']),
    patterns: [/ENV\[\s*['"]([A-Z][A-Z0-9_]{2,})['"]\s*\]/g],
  },
  {
    // Shell and compose files: `$VAR` / `${VAR}` really are environment refs.
    extensions: new Set(['.sh', '.bash', '.zsh', '.yml', '.yaml']),
    patterns: [/\$\{([A-Z][A-Z0-9_]{2,})\}|\$([A-Z][A-Z0-9_]{2,})/g],
  },
];

/** Well-known vars that are noise rather than project configuration. */
const ENV_NOISE = new Set([
  'PATH', 'HOME', 'USER', 'PWD', 'SHELL', 'TERM', 'LANG', 'LC_ALL', 'TZ',
  'NODE_ENV', 'CI', 'GITHUB_ACTIONS', 'GITHUB_TOKEN', 'GITHUB_SHA', 'GITHUB_REF',
  'GITHUB_WORKSPACE', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_EVENT_NAME',
  'TMPDIR', 'TEMP', 'TMP', 'EDITOR', 'DEBUG', 'PYTHONPATH', 'GOPATH', 'GOROOT',
  'CARGO_HOME', 'RUSTUP_HOME', 'JAVA_HOME', 'NVM_DIR', 'FORCE_COLOR', 'NO_COLOR',
]);

/** `.env*` files use plain `KEY=value` assignment. */
const ENV_FILE_ASSIGNMENT = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})\s*=/;

export function extractEnvVars(files: Array<{ rel: string; abs: string }>, root: string, limit = 40): string[] {
  const found = new Map<string, number>();
  const bump = (name: string, weight: number) => {
    if (ENV_NOISE.has(name)) return;
    found.set(name, (found.get(name) ?? 0) + weight);
  };

  // A checked-in `.env.example` is the most authoritative source there is.
  for (const candidate of ['.env.example', '.env.sample', '.env.template']) {
    const text = readTextSafe(path.join(root, candidate));
    if (!text) continue;
    for (const line of text.split('\n')) {
      const m = line.match(ENV_FILE_ASSIGNMENT);
      if (m) bump(m[1]!, 1000);
    }
  }

  for (const file of files) {
    const base = path.basename(file.rel);
    const ext = path.extname(file.rel).toLowerCase();
    const isEnvFile = /^\.env/.test(base);

    const text = readTextSafe(file.abs, 256 * 1024);
    if (!text) continue;

    if (isEnvFile) {
      for (const line of text.split('\n')) {
        const m = line.match(ENV_FILE_ASSIGNMENT);
        if (m) bump(m[1]!, 500);
      }
      continue;
    }

    const set = ENV_PATTERN_SETS.find((s) => s.extensions.has(ext));
    if (!set) continue;
    for (const re of set.patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        // `$VAR` and `${VAR}` land in different capture groups.
        const name = m[1] ?? m[2];
        if (name) bump(name, 1);
      }
    }
  }

  return [...found.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}
