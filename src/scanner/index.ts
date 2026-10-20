import path from 'node:path';
import type { ProjectProfile, ProjectStats, RepoInfo } from '../types.js';
import { humanBytes, walk, type WalkedFile } from '../utils/fs.js';
import { collectContributors, collectRepoInfo, commitCount, latestTag } from '../utils/git.js';
import { log } from '../utils/logger.js';
import { analyzeLanguages } from './languages.js';
import { detectFeatures, detectLicense } from './features.js';
import { detectCliCommands } from './cli-detect.js';
import { installCommandFor, publishInstallCommand, readManifests } from './manifests.js';
import { buildTree, extractReadmeSummary, findEntryPoints } from './structure.js';

export interface ScanOptions {
  root: string;
  maxTreeDepth?: number;
  /** Skip git history inspection (faster; no contributors). */
  skipGit?: boolean;
  maxFiles?: number;
}

/** Turn `@acme/readme-smith` or `readme_smith` into `Readme Smith`. */
export function humanizeName(name: string): string {
  const bare = name.replace(/^@[^/]+\//, '').replace(/\.(js|ts|py|rs|go)$/i, '');
  return bare
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * Scan a repository into a `ProjectProfile`.
 *
 * Every sub-detector is defensive: a missing manifest, unreadable file or
 * absent git binary degrades that field to `undefined` rather than failing the
 * scan, because a partial README still beats no README.
 */
export function scanProject(options: ScanOptions): ProjectProfile {
  const started = Date.now();
  const root = path.resolve(options.root);
  const dirName = path.basename(root);
  const warnings: string[] = [];

  /* ---- 1. Walk the tree once; every detector reuses this list ---- */
  const files: WalkedFile[] = walk(root, {
    maxFiles: options.maxFiles ?? 20_000,
    useGitignore: true,
  });
  log.detail(`Found ${files.length} candidate files`);

  /* ---- 2. Languages (needed early: they steer ecosystem fallbacks) ---- */
  const langReport = analyzeLanguages(files, root);
  log.detail(langReport.languages.length
    ? `Languages: ${langReport.languages.slice(0, 4).map((l) => `${l.name} ${l.percent.toFixed(0)}%`).join(', ')}`
    : 'No recognised source languages');

  /* ---- 3. Manifests ---- */
  const manifest = readManifests(root, langReport.primaryLanguage);
  if (manifest.source) log.detail(`Manifest: ${manifest.source}`);
  else warnings.push('No package manifest found — install and usage commands were inferred from the primary language.');

  /* ---- 4. Git ---- */
  const repo: RepoInfo = options.skipGit
    ? { isGit: false, defaultBranch: 'main', name: manifest.name ? path.basename(manifest.name) : dirName }
    : collectRepoInfo(root, manifest.name ? (manifest.name.split('/').pop() ?? dirName) : dirName);
  if (!repo.isGit && !options.skipGit) {
    warnings.push('Not a git repository — host-specific badges (stars, issues, CI) were skipped.');
  }

  /* ---- 5. License ---- */
  const license = detectLicense(root, manifest.licenseSpdx);
  if (!license) warnings.push('No licence detected. Add a LICENSE file — unlicensed code is legally unusable by others, which silently kills adoption.');

  /* ---- 6. Name / description resolution ---- */
  const existing = extractReadmeSummary(root);
  const name = manifest.name ?? repo.name ?? dirName;
  const displayName = humanizeName(name);
  const description =
    manifest.description ??
    existing.description ??
    '';
  if (!description) warnings.push('No description found in a manifest or existing README — the tagline will be a placeholder you should edit.');

  /* ---- 7. Features, docs, env vars, frameworks ---- */
  const featureResult = detectFeatures({
    root,
    files: files.map((f) => ({ rel: f.rel.replace(/\\/g, '/'), abs: f.abs })),
    dependencies: manifest.dependencies,
    devDependencies: manifest.devDependencies,
    scripts: manifest.scripts,
    primaryLanguage: langReport.primaryLanguage,
    ecosystem: manifest.ecosystem,
  });

  /* ---- 8. CLI surface ---- */
  const cli = manifest.binNames.length > 0
    ? detectCliCommands(files.map((f) => ({ rel: f.rel.replace(/\\/g, '/'), abs: f.abs })), manifest.binNames)
    : undefined;
  featureResult.features.isCli = manifest.binNames.length > 0;
  if (featureResult.features.isCli) featureResult.features.isLibrary = false;

  /* ---- 9. Commands ---- */
  const installCommand = installCommandFor(manifest.ecosystem);
  const binName = manifest.binNames[0] ?? name.replace(/^@[^/]+\//, '');
  const usageCommand =
    featureResult.features.isCli
      ? `${binName} --help`
      : manifest.scripts.find((s) => s.kind === 'dev')?.name
        ? (manifest.ecosystem === 'pnpm' ? `pnpm run dev` : manifest.ecosystem === 'yarn' ? `yarn dev` : `npm run dev`)
        : manifest.scripts.find((s) => s.kind === 'start')?.name
          ? (manifest.ecosystem === 'pnpm' ? 'pnpm start' : manifest.ecosystem === 'yarn' ? 'yarn start' : 'npm start')
          : undefined;

  /* ---- 10. Structure ---- */
  const structure = buildTree(dirName, files, { maxDepth: options.maxTreeDepth ?? 3, maxChildren: 10 });
  const entryPoints = findEntryPoints(files, root, manifest.entryPoints);

  /* ---- 11. Stats ---- */
  const dirs = new Set(files.map((f) => path.dirname(f.rel).replace(/\\/g, '/')));
  const countedBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  const stats: ProjectStats = {
    totalFiles: files.length,
    scannedFiles: files.length,
    ignoredFiles: 0,
    linesOfCode: langReport.linesOfCode,
    bytes: countedBytes,
    directories: dirs.size,
    scanDurationMs: Date.now() - started,
  };

  /* ---- 12. Contributors ---- */
  const contributors = options.skipGit
    ? []
    : collectContributors(root).map((c) => ({ login: c.login, contributions: c.contributions }));

  /* ---- 13. Monorepo workspaces ---- */
  if (!manifest.isMonorepo) {
    // A `packages/*/package.json` layout is a monorepo even without a workspaces field.
    const workspaceDirs = new Set(
      files
        .map((f) => f.rel.replace(/\\/g, '/'))
        .filter((r) => /^(packages|apps|crates|libs)\/[^/]+\/(package\.json|Cargo\.toml|pyproject\.toml)$/.test(r))
        .map((r) => path.posix.dirname(r)),
    );
    if (workspaceDirs.size > 0) {
      manifest.isMonorepo = true;
      manifest.workspacePackages = [...workspaceDirs];
    }
  }
  featureResult.features.isMonorepo = manifest.isMonorepo;
  featureResult.features.workspacePackages = manifest.workspacePackages;
  featureResult.features.publishedToRegistry = manifest.publishedToRegistry;
  featureResult.features.registry = manifest.registry;

  const tag = options.skipGit ? undefined : latestTag(root);
  const commits = options.skipGit ? undefined : commitCount(root);
  if (tag) log.detail(`Latest tag: ${tag}`);

  const profile: ProjectProfile = {
    schemaVersion: 1,
    name,
    displayName,
    description,
    version: manifest.version ?? tag?.replace(/^v/, '') ?? '0.0.0',
    root,
    ...(manifest.homepage ? { homepage: manifest.homepage } : {}),
    ...(manifest.bugsUrl ? { bugsUrl: manifest.bugsUrl } : {}),
    keywords: manifest.keywords,
    authors: manifest.authors,
    repo,
    ...(license ? { license } : {}),
    languages: langReport.languages,
    ...(langReport.primaryLanguage ? { primaryLanguage: langReport.primaryLanguage } : {}),
    ...(manifest.ecosystem ? { ecosystem: manifest.ecosystem } : {}),
    ...(installCommand ? { installCommand } : {}),
    ...(usageCommand ? { usageCommand } : {}),
    engines: manifest.engines,
    scripts: manifest.scripts,
    dependencies: manifest.dependencies,
    devDependencies: manifest.devDependencies,
    entryPoints,
    structure,
    docs: featureResult.docs,
    features: featureResult.features,
    envVars: featureResult.envVars,
    ...(cli && cli.commands.length > 0
      ? { cli: { binNames: manifest.binNames, commands: cli.commands } }
      : manifest.binNames.length > 0
        ? { cli: { binNames: manifest.binNames, commands: [] } }
        : {}),
    stats,
    contributors,
    frameworks: featureResult.frameworks,
    generatedAt: new Date().toISOString(),
    warnings,
  };

  log.detail(`Profile ready in ${stats.scanDurationMs}ms · ${stats.linesOfCode} LOC · ${humanBytes(stats.bytes)}`);
  if (commits) log.detail(`${count(commits, 'commit')} · ${count(contributors.length, 'contributor')}`);

  return profile;
}

/** `1 commit`, `2 commits` — a fresh repository reads badly otherwise. */
function count(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun : `${noun}s`}`;
}

/** Serialize a profile for `--json`, dropping the absolute `root` for portability. */
export function profileToJson(profile: ProjectProfile): string {
  const { root: _root, ...rest } = profile;
  return JSON.stringify(rest, null, 2);
}
