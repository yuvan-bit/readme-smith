import path from 'node:path';
import type { EnvFact } from '../types.js';
import { readTextSafe, type WalkedFile } from '../utils/fs.js';

const NOISE = new Set([
  'PATH', 'HOME', 'USER', 'PWD', 'SHELL', 'TERM', 'LANG', 'LC_ALL', 'TZ',
  'NODE_ENV', 'CI', 'GITHUB_ACTIONS', 'GITHUB_TOKEN', 'GITHUB_SHA', 'GITHUB_REF',
  'GITHUB_WORKSPACE', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_EVENT_NAME',
  'GITHUB_HEAD_REF', 'GITHUB_BASE_REF', 'GITHUB_OUTPUT', 'GITHUB_STEP_SUMMARY',
  'TMPDIR', 'TEMP', 'TMP', 'EDITOR', 'VISUAL', 'DEBUG', 'PYTHONPATH', 'GOPATH',
  'GOROOT', 'CARGO_HOME', 'RUSTUP_HOME', 'JAVA_HOME', 'NVM_DIR', 'FORCE_COLOR',
  'NO_COLOR',
]);

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})\s*=/;

const PATTERNS: Array<{ exts: Set<string>; res: RegExp[] }> = [
  {
    exts: new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte']),
    res: [
      /process\.env\.([A-Z][A-Z0-9_]{2,})/g,
      /process\.env\[\s*['"`]([A-Z][A-Z0-9_]{2,})['"`]\s*\]/g,
      /Deno\.env\.get\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g,
    ],
  },
  {
    exts: new Set(['.py']),
    res: [
      /os\.environ(?:\.get)?\(?\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g,
      /os\.environ\[\s*['"]([A-Z][A-Z0-9_]{2,})['"]\s*\]/g,
      /os\.getenv\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g,
      /environ\.get\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g,
    ],
  },
  {
    exts: new Set(['.rs']),
    res: [
      /(?:std::)?env::var(?:_os)?\(\s*"([A-Z][A-Z0-9_]{2,})"/g,
      /env!\(\s*"([A-Z][A-Z0-9_]{2,})"/g,
    ],
  },
  { exts: new Set(['.go']), res: [/os\.(?:Getenv|LookupEnv)\(\s*"([A-Z][A-Z0-9_]{2,})"/g] },
  { exts: new Set(['.java', '.kt']), res: [/System\.getenv\(\s*"([A-Z][A-Z0-9_]{2,})"/g] },
  { exts: new Set(['.php']), res: [/getenv\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g] },
  { exts: new Set(['.rb']), res: [/ENV\[\s*['"]([A-Z][A-Z0-9_]{2,})['"]\s*\]/g] },
  {
    exts: new Set(['.sh', '.bash', '.zsh', '.yml', '.yaml', '.toml']),
    res: [/\$\{([A-Z][A-Z0-9_]{2,})\}|\$([A-Z][A-Z0-9_]{2,})/g],
  },
];

const MAX_ENV_FACTS = 60;

/**
 * Environment variables with provenance. `.env.example` wins the tie-break, but
 * every source is kept so a reader can audit where a name came from.
 */
export function detectEnvFacts(root: string, files: WalkedFile[]): EnvFact[] {
  const found = new Map<string, { sources: Set<string>; weight: number }>();
  const add = (name: string, source: string, weight: number): void => {
    if (NOISE.has(name)) return;
    const entry = found.get(name) ?? { sources: new Set<string>(), weight: 0 };
    entry.sources.add(source);
    entry.weight += weight;
    found.set(name, entry);
  };

  for (const candidate of ['.env.example', '.env.sample', '.env.template', 'env.example']) {
    const text = readTextSafe(path.join(root, candidate));
    if (!text) continue;
    for (const line of text.split('\n')) {
      const m = line.match(ASSIGNMENT);
      if (m) add(m[1]!, candidate, 1000);
    }
  }

  for (const file of files) {
    const rel = file.rel.replace(/\\/g, '/');
    const base = path.basename(rel);
    if (/^readme/i.test(base)) continue;
    const text = readTextSafe(file.abs, 256 * 1024);
    if (!text) continue;

    if (/^\.env/.test(base)) {
      for (const line of text.split('\n')) {
        const m = line.match(ASSIGNMENT);
        if (m) add(m[1]!, rel, 500);
      }
      continue;
    }

    const set = PATTERNS.find((p) => p.exts.has(file.ext));
    if (!set) continue;
    for (const re of set.res) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const name = m[1] ?? m[2];
        if (name) add(name, rel, 1);
      }
    }
  }

  return [...found.entries()]
    .sort((a, b) => b[1].weight - a[1].weight || a[0].localeCompare(b[0]))
    .slice(0, MAX_ENV_FACTS)
    .map(([name, entry]) => ({
      name,
      sources: [...entry.sources].sort().slice(0, 8),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
