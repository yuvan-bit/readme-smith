import path from 'node:path';
import { readdirSync } from 'node:fs';
import type { Dependency, PackageEcosystem, ScriptInfo } from '../types.js';
import { exists, readJsonSafe, readTextSafe } from '../utils/fs.js';
import { asRecord, asString, asStringArray, getToml, parseToml, type TomlValue } from '../utils/toml.js';

export interface ManifestResult {
  name?: string;
  displayName?: string;
  description?: string;
  version?: string;
  keywords: string[];
  authors: string[];
  homepage?: string;
  bugsUrl?: string;
  licenseSpdx?: string;
  ecosystem?: PackageEcosystem;
  dependencies: Dependency[];
  devDependencies: Dependency[];
  scripts: ScriptInfo[];
  binNames: string[];
  entryPoints: string[];
  engines: Record<string, string>;
  publishedToRegistry: boolean;
  registry?: string;
  workspacePackages: string[];
  isMonorepo: boolean;
  /** Manifest file that won, for provenance in `--json`. */
  source?: string;
}

export function emptyManifest(): ManifestResult {
  return {
    keywords: [],
    authors: [],
    dependencies: [],
    devDependencies: [],
    scripts: [],
    binNames: [],
    entryPoints: [],
    engines: {},
    publishedToRegistry: false,
    workspacePackages: [],
    isMonorepo: false,
  };
}

export type ManifestKind =
  | 'package.json'
  | 'pyproject.toml'
  | 'setup.py'
  | 'requirements.txt'
  | 'Cargo.toml'
  | 'go.mod'
  | 'composer.json'
  | 'Gemfile'
  | 'pom.xml'
  | 'build.gradle'
  | 'build.gradle.kts'
  | 'Package.swift'
  | 'mix.exs'
  | 'csproj'
  | 'pubspec.yaml'
  | 'none';

export function detectManifests(root: string): ManifestKind[] {
  const found: ManifestKind[] = [];
  const checks: Array<[ManifestKind, string[]]> = [
    ['package.json', ['package.json']],
    ['pyproject.toml', ['pyproject.toml']],
    ['setup.py', ['setup.py']],
    ['requirements.txt', ['requirements.txt']],
    ['Cargo.toml', ['Cargo.toml']],
    ['go.mod', ['go.mod']],
    ['composer.json', ['composer.json']],
    ['Gemfile', ['Gemfile']],
    ['pom.xml', ['pom.xml']],
    ['build.gradle', ['build.gradle']],
    ['build.gradle.kts', ['build.gradle.kts']],
    ['Package.swift', ['Package.swift']],
    ['mix.exs', ['mix.exs']],
    ['pubspec.yaml', ['pubspec.yaml']],
  ];
  for (const [kind, files] of checks) {
    if (files.some((f) => exists(root, f))) found.push(kind);
  }
  // *.csproj / *.sln need a directory scan rather than a fixed filename.
  try {
    if (readdirSync(root).some((f) => f.endsWith('.csproj') || f.endsWith('.sln'))) found.push('csproj');
  } catch { /* unreadable root — nothing to detect */ }
  return found.length > 0 ? found : ['none'];
}

/** Pick the primary ecosystem when several manifests coexist. */
export function pickEcosystem(root: string, kinds: ManifestKind[], primaryLanguage?: string): PackageEcosystem | undefined {
  if (kinds.includes('package.json')) {
    if (exists(root, 'pnpm-lock.yaml')) return 'pnpm';
    if (exists(root, 'yarn.lock') || exists(root, '.yarnrc.yml')) return 'yarn';
    if (exists(root, 'bun.lockb') || exists(root, 'bun.lock')) return 'bun';
    return 'npm';
  }
  if (kinds.includes('pyproject.toml')) {
    const toml = readToml(root, 'pyproject.toml');
    if (getToml(toml, 'tool', 'poetry')) return 'poetry';
    if (getToml(toml, 'tool', 'uv') || exists(root, 'uv.lock')) return 'uv';
    return 'pip';
  }
  if (kinds.includes('requirements.txt') || kinds.includes('setup.py')) return 'pip';
  if (kinds.includes('Cargo.toml')) return 'cargo';
  if (kinds.includes('go.mod')) return 'go';
  if (kinds.includes('composer.json')) return 'composer';
  if (kinds.includes('Gemfile')) return 'gem';
  if (kinds.includes('pom.xml')) return 'maven';
  if (kinds.includes('build.gradle') || kinds.includes('build.gradle.kts')) return 'gradle';
  if (kinds.includes('csproj')) return 'nuget';
  if (primaryLanguage) {
    const byLang: Record<string, PackageEcosystem> = {
      Python: 'pip', Rust: 'cargo', Go: 'go', Java: 'maven', PHP: 'composer',
      Ruby: 'gem', TypeScript: 'npm', JavaScript: 'npm',
    };
    return byLang[primaryLanguage];
  }
  return undefined;
}

function readToml(root: string, file: string): Record<string, TomlValue> | undefined {
  const text = readTextSafe(path.join(root, file));
  if (text === undefined) return undefined;
  try {
    return parseToml(text);
  } catch {
    return undefined;
  }
}

export function classifyScript(name: string): ScriptInfo['kind'] {
  const n = name.toLowerCase();
  if (/^(pre)?install$|^postinstall$|^setup$/.test(n)) return 'install';
  if (/^(pre)?(build|compile)$/.test(n) || n.includes('build')) return 'build';
  if (n.includes('test') || n.includes('spec') || n === 'check') return 'test';
  if (n.includes('lint') || n.includes('eslint') || n.includes('check-format')) return 'lint';
  if (n.includes('format') || n.includes('prettier') || n.includes('pretty')) return 'format';
  if (n === 'dev' || n === 'serve' || n === 'watch' || n.startsWith('dev:')) return 'dev';
  if (n === 'start' || n === 'run' || n === 'serve:prod') return 'start';
  return 'other';
}

/** Read `package.json` (npm/pnpm/yarn/bun ecosystems). */
export function parsePackageJson(root: string): ManifestResult | undefined {
  interface PkgJson {
    name?: string;
    version?: string;
    description?: string;
    keywords?: string[];
    author?: string | { name?: string; email?: string };
    contributors?: Array<string | { name?: string }>;
    license?: string;
    homepage?: string;
    bugs?: string | { url?: string };
    main?: string;
    module?: string;
    types?: string;
    typings?: string;
    bin?: string | Record<string, string>;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    workspaces?: string[] | { packages?: string[] };
    engines?: Record<string, string>;
    private?: boolean;
    publishConfig?: { registry?: string };
    repository?: string | { url?: string };
  }
  const pkg = readJsonSafe<PkgJson>(path.join(root, 'package.json'));
  if (!pkg) return undefined;

  const result = emptyManifest();
  result.source = 'package.json';
  result.ecosystem = 'npm';
  if (pkg.name) result.name = pkg.name;
  if (pkg.version) result.version = pkg.version;
  if (pkg.description) result.description = pkg.description;
  if (Array.isArray(pkg.keywords)) result.keywords = pkg.keywords.filter((k) => typeof k === 'string');
  if (pkg.license && typeof pkg.license === 'string') result.licenseSpdx = pkg.license;
  if (pkg.homepage) result.homepage = pkg.homepage;
  result.bugsUrl = typeof pkg.bugs === 'string' ? pkg.bugs : pkg.bugs?.url;

  const authors: string[] = [];
  if (typeof pkg.author === 'string') authors.push(pkg.author);
  else if (pkg.author?.name) authors.push(pkg.author.email ? `${pkg.author.name} <${pkg.author.email}>` : pkg.author.name);
  for (const c of pkg.contributors ?? []) {
    if (typeof c === 'string') authors.push(c);
    else if (c?.name) authors.push(c.name);
  }
  result.authors = authors;

  const toDeps = (rec: Record<string, string> | undefined, dev: boolean): Dependency[] =>
    Object.entries(rec ?? {})
      .filter(([, v]) => typeof v === 'string')
      .map(([name, version]) => ({ name, version, dev }))
      .sort((a, b) => a.name.localeCompare(b.name));

  result.dependencies = toDeps(pkg.dependencies, false);
  result.devDependencies = toDeps(pkg.devDependencies, true);

  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    if (typeof command !== 'string') continue;
    result.scripts.push({ name, command, kind: classifyScript(name) });
  }

  if (typeof pkg.bin === 'string') result.binNames.push(pkg.name ?? path.basename(root));
  else if (pkg.bin) result.binNames.push(...Object.keys(pkg.bin));

  for (const key of ['main', 'module', 'types', 'typings'] as const) {
    const v = pkg[key];
    if (typeof v === 'string' && v && !result.entryPoints.includes(v)) result.entryPoints.push(v);
  }

  result.engines = pkg.engines ?? {};
  result.publishedToRegistry = pkg.private !== true && !!pkg.name && !pkg.name.startsWith('@types/');
  result.registry = pkg.publishConfig?.registry ?? (result.publishedToRegistry ? 'https://www.npmjs.com' : undefined);

  const workspaces = Array.isArray(pkg.workspaces)
    ? pkg.workspaces
    : pkg.workspaces?.packages ?? [];
  result.workspacePackages = workspaces;
  result.isMonorepo = workspaces.length > 0;

  return result;
}

/** Read `pyproject.toml` (PEP 621 and Poetry flavours). */
export function parsePyproject(root: string): ManifestResult | undefined {
  const toml = readToml(root, 'pyproject.toml');
  if (!toml) return undefined;

  const result = emptyManifest();
  result.source = 'pyproject.toml';

  const poetry = asRecord(getToml(toml, 'tool', 'poetry'));
  const pep621 = asRecord(getToml(toml, 'project'));

  if (poetry) {
    result.ecosystem = 'poetry';
    result.name = asString(poetry.name);
    result.version = asString(poetry.version);
    result.description = asString(poetry.description);
    result.licenseSpdx = asString(poetry.license);
    result.keywords = asStringArray(poetry.keywords);
    const authors = asStringArray(poetry.authors);
    result.authors = authors;
    result.homepage = asString(poetry.homepage) ?? asString(poetry.repository);

    const collect = (section: string, dev: boolean) => {
      const rec = asRecord(getToml(toml, 'tool', 'poetry', section));
      if (!rec) return [];
      return Object.entries(rec)
        .filter(([name]) => name.toLowerCase() !== 'python')
        .map(([name, spec]) => ({
          name,
          version: typeof spec === 'string' ? spec : JSON.stringify(spec),
          dev,
        }));
    };
    result.dependencies = collect('dependencies', false);
    result.devDependencies = [...collect('dev-dependencies', true), ...collect('group.dev.dependencies', true)];

    const scripts = asRecord(getToml(toml, 'tool', 'poetry', 'scripts'));
    if (scripts) result.binNames.push(...Object.keys(scripts));
  }

  if (pep621) {
    result.ecosystem ??= 'pip';
    result.name ??= asString(pep621.name);
    result.version ??= asString(pep621.version);
    result.description ??= asString(pep621.description);
    result.keywords = result.keywords.length ? result.keywords : asStringArray(pep621.keywords);
    result.licenseSpdx ??= typeof pep621.license === 'string' ? pep621.license : undefined;
    const urls = asRecord(pep621.urls);
    if (urls) result.homepage ??= asString(urls.Homepage) ?? asString(urls.Repository) ?? asString(urls.Documentation);
    result.publishedToRegistry = true;
    result.registry ??= 'https://pypi.org';

    const deps = asStringArray(pep621.dependencies).map((spec) => splitPyDep(spec, false));
    result.dependencies = [...result.dependencies, ...deps];
    const optional = asRecord(pep621['optional-dependencies']);
    if (optional) {
      for (const group of Object.values(optional)) {
        for (const spec of asStringArray(group)) result.devDependencies.push(splitPyDep(spec, true));
      }
    }
    const scripts = asRecord(pep621.scripts);
    if (scripts) result.binNames.push(...Object.keys(scripts));
    const requiresPython = asString(pep621['requires-python']);
    if (requiresPython) result.engines.python = requiresPython;
  }

  // Build backend hint.
  const requires = asStringArray(getToml(toml, 'build-system', 'requires'));
  if (!result.ecosystem || result.ecosystem === 'pip') {
    if (requires.some((r) => /poetry/i.test(r))) result.ecosystem = 'poetry';
    else if (requires.some((r) => /hatch/i.test(r))) result.ecosystem = 'pip';
  }

  if (!result.name && !result.description && result.dependencies.length === 0) return undefined;
  return result;
}

function splitPyDep(spec: string, dev: boolean): Dependency {
  const m = spec.match(/^\s*([A-Za-z0-9_.\-\[\]]+)\s*(.*)$/);
  return { name: m?.[1]?.replace(/\[.*\]$/, '') ?? spec.trim(), version: (m?.[2] ?? '').trim(), dev };
}

/** `requirements.txt` → dependency list (no metadata). */
export function parseRequirements(root: string): ManifestResult | undefined {
  const text = readTextSafe(path.join(root, 'requirements.txt'));
  if (text === undefined) return undefined;
  const result = emptyManifest();
  result.source = 'requirements.txt';
  result.ecosystem = 'pip';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue;
    result.dependencies.push(splitPyDep(line, false));
  }
  return result.dependencies.length ? result : undefined;
}

/** `Cargo.toml` → crate metadata and dependencies. */
export function parseCargo(root: string): ManifestResult | undefined {
  const toml = readToml(root, 'Cargo.toml');
  if (!toml) return undefined;
  const result = emptyManifest();
  result.source = 'Cargo.toml';
  result.ecosystem = 'cargo';

  const pkg = asRecord(getToml(toml, 'package'));
  if (pkg) {
    result.name = asString(pkg.name);
    result.version = asString(pkg.version);
    result.description = asString(pkg.description);
    result.licenseSpdx = asString(pkg.license);
    result.keywords = asStringArray(pkg.keywords);
    result.authors = asStringArray(pkg.authors);
    result.homepage = asString(pkg.homepage) ?? asString(pkg.repository);
    result.publishedToRegistry = pkg.publish !== false;
    result.registry = 'https://crates.io';
    const bins = asRecord(getToml(toml, 'bin'));
    if (bins) result.binNames.push(...Object.keys(bins));
    const binList = getToml(toml, 'bin');
    if (Array.isArray(binList)) {
      for (const entry of binList) {
        const rec = asRecord(entry);
        const n = rec ? asString(rec.name) : undefined;
        if (n) result.binNames.push(n);
      }
    }
    if (result.binNames.length === 0 && result.name) result.binNames.push(result.name);
  }

  const collect = (section: string, dev: boolean) => {
    const rec = asRecord(getToml(toml, ...section.split('.')));
    if (!rec) return [];
    return Object.entries(rec).map(([name, spec]) => ({
      name,
      version: typeof spec === 'string' ? spec : (asString(asRecord(spec)?.version) ?? ''),
      dev,
    }));
  };
  result.dependencies = collect('dependencies', false);
  result.devDependencies = collect('dev-dependencies', true);

  const workspace = asStringArray(getToml(toml, 'workspace', 'members'));
  result.workspacePackages = workspace;
  result.isMonorepo = workspace.length > 0;

  return result;
}

/** `go.mod` → module path, Go version, required modules. */
export function parseGoMod(root: string): ManifestResult | undefined {
  const text = readTextSafe(path.join(root, 'go.mod'));
  if (text === undefined) return undefined;
  const result = emptyManifest();
  result.source = 'go.mod';
  result.ecosystem = 'go';

  const module = text.match(/^module\s+(\S+)/m);
  if (module) result.name = module[1]!.trim();
  const goVer = text.match(/^go\s+(\S+)/m);
  if (goVer) result.engines.go = `>= ${goVer[1]!.trim()}`;

  let inRequire = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('require (')) { inRequire = true; continue; }
    if (inRequire && line === ')') { inRequire = false; continue; }
    if (inRequire) {
      const m = line.match(/^([^\s/]+(?:\/[^\s/]+)*)\s+(v[\w.+\-]+)/);
      if (m) result.dependencies.push({ name: m[1]!, version: m[2]!, dev: line.includes('// indirect') });
    } else if (line.startsWith('require ') && !line.includes('(')) {
      const m = line.replace(/^require\s+/, '').match(/^(\S+)\s+(v[\w.+\-]+)/);
      if (m) result.dependencies.push({ name: m[1]!, version: m[2]!, dev: false });
    }
  }

  // The last path segment is the idiomatic binary name.
  if (result.name) result.binNames.push(result.name.split('/').pop()!);
  return result;
}

/** `composer.json` → PHP package metadata. */
export function parseComposer(root: string): ManifestResult | undefined {
  interface ComposerJson {
    name?: string;
    description?: string;
    version?: string;
    keywords?: string[];
    license?: string | string[];
    homepage?: string;
    require?: Record<string, string>;
    'require-dev'?: Record<string, string>;
    bin?: string[];
    scripts?: Record<string, string | string[]>;
  }
  const json = readJsonSafe<ComposerJson>(path.join(root, 'composer.json'));
  if (!json) return undefined;
  const result = emptyManifest();
  result.source = 'composer.json';
  result.ecosystem = 'composer';
  result.name = json.name;
  result.description = json.description;
  result.version = json.version;
  result.keywords = json.keywords ?? [];
  result.homepage = json.homepage;
  result.licenseSpdx = Array.isArray(json.license) ? json.license.join(' OR ') : json.license;
  result.publishedToRegistry = true;
  result.registry = 'https://packagist.org';
  for (const [name, version] of Object.entries(json.require ?? {})) {
    if (name === 'php' || name.startsWith('ext-')) { result.engines[name] = version; continue; }
    result.dependencies.push({ name, version, dev: false });
  }
  for (const [name, version] of Object.entries(json['require-dev'] ?? {})) {
    result.devDependencies.push({ name, version, dev: true });
  }
  result.binNames = json.bin ?? [];
  for (const [name, cmd] of Object.entries(json.scripts ?? {})) {
    result.scripts.push({ name, command: Array.isArray(cmd) ? cmd.join(' && ') : cmd, kind: classifyScript(name) });
  }
  return result;
}

/** Fallback: derive metadata from `setup.py` via regex (best-effort only). */
export function parseSetupPy(root: string): ManifestResult | undefined {
  const text = readTextSafe(path.join(root, 'setup.py'));
  if (text === undefined) return undefined;
  const result = emptyManifest();
  result.source = 'setup.py';
  result.ecosystem = 'pip';
  const grab = (key: string): string | undefined => {
    const m = text.match(new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`));
    return m?.[1];
  };
  result.name = grab('name');
  result.version = grab('version');
  result.description = grab('description');
  result.homepage = grab('url');
  result.licenseSpdx = grab('license');
  const entryPoints = text.match(/console_scripts["']?\s*:\s*\[([^\]]*)\]/);
  if (entryPoints) {
    for (const m of entryPoints[1]!.matchAll(/([A-Za-z0-9_.\-]+)\s*=/g)) result.binNames.push(m[1]!);
  }
  return result.name ? result : undefined;
}

/** Merge manifests, highest-signal first, without overwriting real values with blanks. */
export function readManifests(root: string, primaryLanguage?: string): ManifestResult {
  const kinds = detectManifests(root);
  const ecosystem = pickEcosystem(root, kinds, primaryLanguage);
  const parsers: Array<() => ManifestResult | undefined> = [];

  if (kinds.includes('package.json')) parsers.push(() => parsePackageJson(root));
  if (kinds.includes('pyproject.toml')) parsers.push(() => parsePyproject(root));
  if (kinds.includes('Cargo.toml')) parsers.push(() => parseCargo(root));
  if (kinds.includes('go.mod')) parsers.push(() => parseGoMod(root));
  if (kinds.includes('composer.json')) parsers.push(() => parseComposer(root));
  if (kinds.includes('setup.py')) parsers.push(() => parseSetupPy(root));
  if (kinds.includes('requirements.txt')) parsers.push(() => parseRequirements(root));

  const base = emptyManifest();
  base.ecosystem = ecosystem;

  for (const parse of parsers) {
    const m = parse();
    if (!m) continue;
    mergeInto(base, m);
  }
  if (base.ecosystem) base.ecosystem = ecosystem ?? base.ecosystem;
  return base;
}

function mergeInto(target: ManifestResult, patch: ManifestResult): void {
  target.name ??= patch.name;
  target.description ??= patch.description;
  target.version ??= patch.version;
  target.homepage ??= patch.homepage;
  target.bugsUrl ??= patch.bugsUrl;
  target.licenseSpdx ??= patch.licenseSpdx;
  target.registry ??= patch.registry;
  target.source ??= patch.source;
  target.ecosystem ??= patch.ecosystem;
  if (target.keywords.length === 0) target.keywords = patch.keywords;
  if (target.authors.length === 0) target.authors = patch.authors;
  if (target.binNames.length === 0) target.binNames = patch.binNames;
  if (target.entryPoints.length === 0) target.entryPoints = patch.entryPoints;
  if (target.scripts.length === 0) target.scripts = patch.scripts;
  if (target.dependencies.length === 0) target.dependencies = patch.dependencies;
  if (target.devDependencies.length === 0) target.devDependencies = patch.devDependencies;
  if (Object.keys(target.engines).length === 0) target.engines = patch.engines;
  target.publishedToRegistry ||= patch.publishedToRegistry;
  if (!target.isMonorepo && patch.isMonorepo) {
    target.isMonorepo = true;
    target.workspacePackages = patch.workspacePackages;
  }
}

/** Choose the install command a newcomer should actually run. */
export function installCommandFor(ecosystem: PackageEcosystem | undefined): string | undefined {
  switch (ecosystem) {
    case 'npm': return 'npm install';
    case 'pnpm': return 'pnpm install';
    case 'yarn': return 'yarn install';
    case 'bun': return 'bun install';
    case 'poetry': return 'poetry install';
    case 'uv': return 'uv sync';
    case 'pip': return 'pip install -r requirements.txt';
    case 'cargo': return 'cargo build';
    case 'go': return 'go mod download';
    case 'composer': return 'composer install';
    case 'gem': return 'bundle install';
    case 'nuget': return 'dotnet restore';
    case 'maven': return 'mvn install';
    case 'gradle': return './gradlew build';
    default: return undefined;
  }
}

/** Public install one-liner for consumers (as opposed to contributors). */
export function publishInstallCommand(ecosystem: PackageEcosystem | undefined, name: string | undefined): string | undefined {
  if (!name) return undefined;
  switch (ecosystem) {
    case 'npm': return `npm install -g ${name}`;
    case 'pnpm': return `pnpm add -g ${name}`;
    case 'yarn': return `yarn global add ${name}`;
    case 'bun': return `bun add -g ${name}`;
    case 'poetry': return `poetry add ${name}`;
    case 'uv': return `uv add ${name}`;
    case 'pip': return `pip install ${name}`;
    case 'cargo': return `cargo install ${name}`;
    case 'go': return `go install ${name}@latest`;
    case 'composer': return `composer require ${name}`;
    case 'gem': return `gem install ${name}`;
    case 'nuget': return `dotnet add package ${name}`;
    default: return undefined;
  }
}
