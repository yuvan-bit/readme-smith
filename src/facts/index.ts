import path from 'node:path';
import type {
  FactSheet,
  FactScript,
  InstallFact,
  PackageEcosystem,
  PresetId,
  RepoInfo,
  ScriptKind,
} from '../types.js';
import { humanBytes, readTextSafe, walk, type WalkedFile } from '../utils/fs.js';
import { collectContributors, collectRepoInfo, commitCount, recentCommits } from '../utils/git.js';
import { log } from '../utils/logger.js';
import { analyzeLanguages } from './languages.js';
import type { ManifestResult } from './manifests.js';
import { installCommandFor, readManifests } from './manifests.js';
import { detectLicense } from './license.js';
import { detectEnvFacts } from './env.js';
import { detectCiWorkflows } from './ci.js';
import { detectBuildCommands } from './build.js';
import { detectConfigFiles } from './config-files.js';
import { detectProjectType, type TypeInput } from './project-type.js';

export interface ScanOptions {
  root: string;
  /** Force a preset; also makes an otherwise unrecognisable repository scannable. */
  preset?: PresetId;
  maxFiles?: number;
  skipGit?: boolean;
}

const DOC_LANGUAGES = new Set(['Markdown', 'JSON', 'YAML', 'TOML', 'XML', 'CSV', 'Text']);
const DATA_EXTENSIONS = new Set(['.csv', '.tsv', '.parquet', '.jsonl', '.ndjson', '.arrow', '.feather']);

/** `@acme/readme-smith` or `readme_smith` → `Readme Smith`. */
export function humanizeName(name: string): string {
  const bare = name.replace(/^@[^/]+\//, '').replace(/\.(js|ts|py|rs|go|rb)$/i, '');
  return bare
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ') || bare;
}

function runnerFor(ecosystem: PackageEcosystem | undefined): string | null {
  switch (ecosystem) {
    case 'npm': return 'npm';
    case 'pnpm': return 'pnpm';
    case 'yarn': return 'yarn';
    case 'bun': return 'bun';
    case 'composer': return 'composer';
    default: return null;
  }
}

function scriptInvocation(script: string, ecosystem: PackageEcosystem | undefined): string | null {
  const runner = runnerFor(ecosystem);
  if (!runner) return null;
  return runner === 'composer' ? `composer run-script ${script}` : `${runner} run ${script}`;
}

function developmentInstall(
  ecosystem: PackageEcosystem | undefined,
  manifest: ManifestResult,
): InstallFact | null {
  let command = installCommandFor(ecosystem);
  if (!command) return null;
  if (ecosystem === 'pip' && manifest.source !== 'requirements.txt') {
    command = 'pip install -e .';
  }
  return { command, source: `${manifest.source ?? 'manifest'} (${ecosystem})` };
}

function consumerInstall(
  ecosystem: PackageEcosystem | undefined,
  name: string | null,
  isCli: boolean,
  published: boolean,
): InstallFact | null {
  if (!name) return null;
  if (!published && (ecosystem === 'npm' || ecosystem === 'pnpm' || ecosystem === 'yarn' || ecosystem === 'bun')) return null;
  const source = `manifest name (${ecosystem ?? 'unknown'})`;
  switch (ecosystem) {
    case 'npm': return { command: `npm install ${isCli ? '-g ' : ''}${name}`, source };
    case 'pnpm': return { command: `pnpm add ${isCli ? '-g ' : ''}${name}`, source };
    case 'yarn': return { command: isCli ? `yarn global add ${name}` : `yarn add ${name}`, source };
    case 'bun': return { command: `bun add ${isCli ? '-g ' : ''}${name}`, source };
    case 'pip': return { command: isCli ? `pipx install ${name}` : `pip install ${name}`, source };
    case 'poetry': return { command: isCli ? `pipx install ${name}` : `poetry add ${name}`, source };
    case 'uv': return { command: isCli ? `uv tool install ${name}` : `uv add ${name}`, source };
    case 'cargo': return { command: isCli ? `cargo install ${name}` : `cargo add ${name}`, source };
    case 'go': return { command: isCli ? `go install ${name}@latest` : `go get ${name}`, source };
    case 'gem': return { command: `gem install ${name}`, source };
    case 'composer': return { command: `composer require ${name}`, source };
    default: return null;
  }
}

function usageFor(
  isCli: boolean,
  type: string,
  ecosystem: PackageEcosystem | undefined,
  binNames: string[],
  scripts: FactScript[],
): InstallFact | null {
  if (isCli && binNames[0]) {
    return { command: `${binNames[0]} --help`, source: 'declared executable' };
  }
  if (type === 'web' || type === 'monorepo') {
    const dev = scripts.find((s) => s.kind === 'dev') ?? scripts.find((s) => s.kind === 'start');
    if (dev) return { command: dev.invocation, source: `manifest script "${dev.name}"` };
  }
  return null;
}

/** Check whether a Go module contains an executable package. */
function goHasMain(files: WalkedFile[], root: string): boolean {
  for (const file of files) {
    if (!file.rel.endsWith('.go')) continue;
    if (/^package\s+main\b/m.test(readTextSafe(file.abs) ?? '')) return true;
  }
  return false;
}

function collectBinNames(
  manifest: ManifestResult,
  files: WalkedFile[],
  root: string,
  ecosystem: PackageEcosystem | undefined,
): string[] {
  const names = [...manifest.binNames];
  if (ecosystem === 'cargo' && files.some((f) => /(^|\/)src\/main\.rs$/.test(f.rel.replace(/\\/g, '/')))) {
    if (manifest.name) names.push(manifest.name);
  }
  if (ecosystem === 'go' && goHasMain(files, root) && manifest.name) {
    names.push(manifest.name.split('/').pop()!);
  }
  return [...new Set(names.filter(Boolean))];
}

function entryPointsFor(manifest: ManifestResult, files: WalkedFile[], binNames: string[]): string[] {
  const rels = new Set(files.map((f) => f.rel.replace(/\\/g, '/')));
  const entries = new Set<string>(manifest.entryPoints);
  for (const candidate of ['src/main.rs', 'src/lib.rs', 'src/index.ts', 'src/index.js', 'src/main.ts', 'main.go']) {
    if (rels.has(candidate)) entries.add(candidate);
  }
  for (const bin of binNames) entries.add(bin);
  return [...entries].filter(Boolean).sort();
}

function isMonorepo(manifest: ManifestResult, files: WalkedFile[]): { value: boolean; evidence: string[] } {
  if (manifest.isMonorepo) {
    return { value: true, evidence: manifest.workspacePackages.length > 0 ? [`workspaces: ${manifest.workspacePackages.slice(0, 6).join(', ')}`] : ['workspace manifest'] };
  }
  const packageDirs = files
    .map((f) => f.rel.replace(/\\/g, '/'))
    .filter((r) => /^(packages|apps|crates|libs|modules)\/[^/]+\/(package\.json|Cargo\.toml|pyproject\.toml|go\.mod|Gemfile)$/.test(r))
    .map((r) => path.posix.dirname(r));
  const unique = [...new Set(packageDirs)];
  return { value: unique.length >= 2, evidence: unique.length > 0 ? [`package directories: ${unique.slice(0, 6).join(', ')}`] : [] };
}

export function scanFacts(options: ScanOptions): FactSheet {
  const started = Date.now();
  const root = path.resolve(options.root);
  const dirName = path.basename(root);
  const warnings: string[] = [];

  const files = walk(root, { maxFiles: options.maxFiles ?? 20_000, useGitignore: true });
  log.debug(`Walked ${files.length} files`);

  const languageReport = analyzeLanguages(files, root);
  const hasSource = languageReport.languages.some((l) => !DOC_LANGUAGES.has(l.name));

  const manifest = readManifests(root, languageReport.primaryLanguage);
  if (!manifest.source) warnings.push('No supported manifest found. Facts fall back to directory names and language statistics.');

  const mono = isMonorepo(manifest, files);
  const ecosystem = manifest.ecosystem;
  const binNames = collectBinNames(manifest, files, root, ecosystem);
  const dependencyNames = [...manifest.dependencies, ...manifest.devDependencies].map((d) => d.name);

  const typeInput: TypeInput = {
    ...(options.preset ? { forced: options.preset } : {}),
    hasManifest: !!manifest.source,
    isMonorepo: mono.value,
    binNames,
    dependencyNames,
    languages: languageReport.languages.filter((l) => !DOC_LANGUAGES.has(l.name)),
    rels: files.map((f) => f.rel.replace(/\\/g, '/')),
    ecosystem,
  };
  const typeResult = detectProjectType(typeInput);
  if (mono.value && typeResult.type !== 'monorepo') typeResult.evidence.push(...mono.evidence);

  if (typeResult.type === 'unknown') {
    warnings.push('Project type could not be identified. Add a manifest or force one with --preset.');
  } else if (typeResult.confidence < 0.7) {
    warnings.push(`Project type "${typeResult.type}" was inferred with low confidence (${typeResult.confidence.toFixed(2)}); override with --preset.`);
  }

  const isCli = binNames.length > 0 || typeResult.type === 'cli';
  const license = detectLicense(root, manifest.licenseSpdx);
  if (!license) warnings.push('No licence detected (no LICENSE file and no manifest licence field).');

  const env = detectEnvFacts(root, files);
  const configFiles = detectConfigFiles(files);
  const rels = files.map((f) => f.rel.replace(/\\/g, '/'));
  const packageDirs = [...new Set(
    rels
      .filter((r) => /^(packages|apps|crates|libs|modules)\/[^/]+\/(package\.json|Cargo\.toml|pyproject\.toml|go\.mod|Gemfile)$/.test(r))
      .map((r) => path.posix.dirname(r)),
  )];
  const packages = [...new Set(packageDirs.length > 0 ? packageDirs : manifest.workspacePackages)].sort();
  const dataFiles = files.filter((f) => DATA_EXTENSIONS.has(f.ext));
  const data = dataFiles.length > 0
    ? {
      files: dataFiles.length,
      formats: [...new Set(dataFiles.map((f) => f.ext.slice(1)))].sort(),
    }
    : null;
  const contributingPath = rels.find((r) => /(^|\/)contributing(?:\.[a-z]+)?$/i.test(r)) ?? null;
  const community = {
    contributing: contributingPath !== null,
    contributingPath,
    changelog: rels.some((r) => /(^|\/)(change_?log|history|releases)(?:\.[a-z]+)?$/i.test(r)),
    security: rels.some((r) => /(^|\/)security(?:\.[a-z]+)?$/i.test(r)),
    issueTemplates: rels.some((r) => r.startsWith('.github/ISSUE_TEMPLATE/')),
    pullRequestTemplate: rels.some((r) => /(^|\/)pull_request_template\.md$/i.test(r)),
  };
  const ciResult = detectCiWorkflows(root, files);
  warnings.push(...ciResult.warnings);
  const buildCommands = detectBuildCommands(root, files, ciResult.workflows);

  const repo: RepoInfo = options.skipGit
    ? { isGit: false }
    : collectRepoInfo(root, manifest.name ? (manifest.name.split('/').pop() ?? dirName) : dirName);
  if (!repo.isGit && !options.skipGit) warnings.push('Not a git repository: everything works, but freshness cannot be assessed.');
  const commits = options.skipGit || !repo.isGit ? null : commitCount(root) ?? null;
  const contributors = options.skipGit || !repo.isGit ? null : collectContributors(root, 100).length;
  const recent = options.skipGit || !repo.isGit ? [] : recentCommits(root, 10);

  const scripts: FactScript[] = manifest.scripts
    .map((s) => {
      const invocation = scriptInvocation(s.name, ecosystem);
      return invocation ? { name: s.name, command: s.command, invocation, kind: s.kind as ScriptKind } : null;
    })
    .filter((s): s is FactScript => s !== null);

  const name = manifest.name ?? repo.name ?? dirName;
  const displayName = manifest.displayName ?? humanizeName(name);
  const description = manifest.description ?? null;
  if (!description) warnings.push('No project description in the manifest; drafts will leave a [verify] placeholder instead of guessing.');
  if (!manifest.source) warnings.push('No scripts, dependencies or entry points could be extracted.');
  if (scripts.length === 0) warnings.push('No runnable manifest scripts found.');
  if (env.length === 0) warnings.push('No environment variables found.');

  const entryPoints = entryPointsFor(manifest, files, binNames);
  const devInstall = developmentInstall(ecosystem, manifest);
  const consumer = consumerInstall(ecosystem, manifest.name ?? null, isCli, manifest.publishedToRegistry);
  const usage = usageFor(isCli, typeResult.type, ecosystem, binNames, scripts);

  const dirs = new Set(files.map((f) => path.posix.dirname(f.rel.replace(/\\/g, '/'))));
  const sourceBytes = languageReport.languages.reduce((sum, l) => sum + l.bytes, 0);

  const missing: string[] = [];
  if (!manifest.source) missing.push('manifests');
  if (!description) missing.push('project.description');
  if (!manifest.version) missing.push('project.version');
  if (!license) missing.push('project.license');
  if (!repo.isGit) missing.push('repository');
  if (scripts.length === 0) missing.push('scripts');
  if (entryPoints.length === 0) missing.push('entryPoints');
  if (!devInstall) missing.push('install.development');
  if (!consumer) missing.push('install.consumer');
  if (!usage) missing.push('usage');
  if (env.length === 0) missing.push('env');
  if (ciResult.workflows.length === 0) missing.push('ci');

  if (typeResult.type !== 'unknown' && typeResult.type !== options.preset) {
    log.debug(`Type: ${typeResult.type} (${typeResult.confidence}) — ${typeResult.evidence.join('; ')}`);
  }
  log.debug(`Facts in ${Date.now() - started}ms · ${files.length} files · ${humanBytes(sourceBytes)}`);

  return {
    schemaVersion: 1,
    project: {
      name,
      displayName,
      description,
      version: manifest.version ?? null,
      type: typeResult.type,
      typeConfidence: typeResult.confidence,
      typeEvidence: typeResult.evidence,
      languages: languageReport.languages,
      primaryLanguage: languageReport.primaryLanguage ?? null,
      license,
      repository: repo.isGit ? repo : null,
    },
    manifests: manifest.source
      ? [{ kind: ecosystem ?? inferManifestKind(manifest.source), path: manifest.source }]
      : [],
    scripts,
    binaries: binNames,
    entryPoints,
    packages,
    install: { development: devInstall, consumer },
    usage,
    env,
    configFiles,
    ci: ciResult.workflows,
    buildCommands,
    data,
    community,
    git: {
      isGit: repo.isGit,
      commits,
      lastCommit: recent[0] ? { hash: recent[0].hash, date: recent[0].date, subject: recent[0].subject } : null,
      contributors,
      recentCommits: recent,
    },
    stats: {
      files: files.length,
      directories: dirs.size,
      sourceBytes,
      sourceLines: languageReport.linesOfCode,
      runtimeDependencies: manifest.dependencies.length,
      developmentDependencies: manifest.devDependencies.length,
    },
    missing,
    warnings,
  };
}

function inferManifestKind(source: string): string {
  return source.endsWith('.gemspec') ? 'gemspec' : source;
}

/** JSON projection for `rf scan --json`: no absolute path, stable key order. */
export function factsToJson(facts: FactSheet): string {
  return JSON.stringify(facts, null, 2);
}
