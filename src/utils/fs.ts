import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/** Directories that never carry signal about a project. */
const ALWAYS_IGNORED_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'bower_components', 'vendor/bundle',
  'dist', 'build', 'out', 'target', 'bin', 'obj', 'coverage', '.nyc_output',
  '.next', '.nuxt', '.output', '.turbo', '.cache', '.parcel-cache', '.vite',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', 'venv',
  '.venv', 'env', '.env.d', 'site-packages', '.gradle', '.idea', '.vs',
  '.DS_Store', 'tmp', 'temp', '.tmp', 'logs', '.serverless', '.docusaurus',
  'storybook-static', '.angular', '.svelte-kit', 'Pods', '.terraform',
]);

/** File names/patterns that are noise regardless of location. */
const ALWAYS_IGNORED_FILES = [
  /\.min\.(js|css|map)$/i,
  /\.map$/,
  // Backup copies written by this tool. Scanning them made a second run report
  // a larger project than the first and counted the old README as content.
  /\.(?:bak|orig|rej|swp)$/i,
  /~$/,
  /\.lock$/i,
  /^package-lock\.json$/,
  /^yarn\.lock$/,
  /^pnpm-lock\.yaml$/,
  /^bun\.lockb$/,
  /^poetry\.lock$/,
  /^Cargo\.lock$/,
  /^composer\.lock$/,
  /^Gemfile\.lock$/,
  /\.(png|jpg|jpeg|gif|webp|ico|svg|pdf|zip|tar|gz|tgz|bz2|7z|mp4|mov|woff2?|ttf|eot|wasm|jar|class|so|dll|dylib|exe)$/i,
];

const MAX_FILE_BYTES_FOR_CONTENT = 512 * 1024;

/**
 * Project directory holding hand-written README section bodies.
 *
 * Shared because both halves of the tool need the same name: the scanner must
 * not present these files as project documentation, and the renderer must read
 * them back as overrides.
 */
export const OVERRIDE_DIR = '.readme-smith';

export interface WalkOptions {
  /** Extra directory names to skip. */
  ignoreDirs?: Iterable<string>;
  /** Extra file-path regexes to skip. */
  ignoreFiles?: RegExp[];
  /** Stop descending below this depth (root = 0). */
  maxDepth?: number;
  /** Hard cap on visited files, to stay safe on giant repos. */
  maxFiles?: number;
  /** Respect `.gitignore`-style patterns found at the root. */
  useGitignore?: boolean;
}

export interface WalkedFile {
  /** Absolute path. */
  abs: string;
  /** Path relative to the walk root, POSIX separators. */
  rel: string;
  bytes: number;
  ext: string;
}

/** Parse a `.gitignore` into matcher predicates. Deliberately small-but-correct. */
export function parseIgnorePatterns(content: string): RegExp[] {
  const patterns: RegExp[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    if (negated) continue; // negations are rare; treat as non-matching
    let p = line.replace(/\/$/, '');
    const dirOnly = line.endsWith('/');
    // Escape regex metachars, then translate glob syntax.
    let re = p
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/\u0000/g, '.*');
    if (!re.startsWith('/')) re = `(?:^|/)${re}`;
    else re = `^${re.slice(1)}`;
    patterns.push(new RegExp(dirOnly ? `${re}(?:/|$)` : `${re}(?:/|$)`));
  }
  return patterns;
}

/**
 * Depth-first walk that collects files while pruning ignored subtrees.
 * Returns early once `maxFiles` is reached so huge monorepos stay fast.
 */
export function walk(root: string, options: WalkOptions = {}): WalkedFile[] {
  const ignoreDirs = new Set([...ALWAYS_IGNORED_DIRS, ...(options.ignoreDirs ?? [])]);
  const ignoreFiles = [...ALWAYS_IGNORED_FILES, ...(options.ignoreFiles ?? [])];
  const maxDepth = options.maxDepth ?? 12;
  const maxFiles = options.maxFiles ?? 20_000;

  let gitignorePatterns: RegExp[] = [];
  if (options.useGitignore !== false) {
    const gi = path.join(root, '.gitignore');
    if (existsSync(gi)) {
      try {
        gitignorePatterns = parseIgnorePatterns(readFileSync(gi, 'utf8'));
      } catch {
        gitignorePatterns = [];
      }
    }
  }

  const out: WalkedFile[] = [];
  const stack: Array<{ dir: string; rel: string; depth: number }> = [
    { dir: root, rel: '', depth: 0 },
  ];

  while (stack.length > 0 && out.length < maxFiles) {
    const current = stack.pop()!;
    if (current.depth > maxDepth) continue;

    let entries;
    try {
      entries = readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue; // permission denied, broken symlink, etc.
    }

    for (const entry of entries) {
      if (out.length >= maxFiles) break;
      const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name) || ignoreDirs.has(rel)) continue;
        if (gitignorePatterns.some((re) => re.test(`${rel}/`))) continue;
        stack.push({ dir: path.join(current.dir, entry.name), rel, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      if (ignoreFiles.some((re) => re.test(rel))) continue;
      if (gitignorePatterns.some((re) => re.test(rel))) continue;

      let bytes = 0;
      try {
        bytes = statSync(path.join(current.dir, entry.name)).size;
      } catch {
        continue;
      }
      out.push({ abs: path.join(current.dir, entry.name), rel, bytes, ext: path.extname(entry.name).toLowerCase() });
    }
  }

  return out;
}

export function readTextSafe(abs: string, maxBytes = MAX_FILE_BYTES_FOR_CONTENT): string | undefined {
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > maxBytes) return undefined;
    return readFileSync(abs, 'utf8');
  } catch {
    return undefined;
  }
}

export function readJsonSafe<T = unknown>(abs: string): T | undefined {
  const text = readTextSafe(abs);
  if (text === undefined) return undefined;
  try {
    // Tolerate BOM and trailing commas (rare but real in the wild).
    return JSON.parse(text.replace(/^\uFEFF/, '')) as T;
  } catch {
    return undefined;
  }
}

export function exists(...parts: string[]): boolean {
  return existsSync(path.join(...parts));
}

/** Case-insensitive lookup of a file in a directory; returns the real name. */
export function findCaseInsensitive(dir: string, target: string): string | undefined {
  try {
    const entries = readdirSync(dir);
    const lower = target.toLowerCase();
    return entries.find((e) => e.toLowerCase() === lower);
  } catch {
    return undefined;
  }
}

/** First of `candidates` that exists, resolved against `dir`. */
export function firstExisting(dir: string, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const real = findCaseInsensitive(dir, candidate);
    if (real) return candidate;
  }
  return undefined;
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** `1234567` → `1.2 MB`. */
export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

/** `1234` → `1.2k`. */
export function humanCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
