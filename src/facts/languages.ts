import path from 'node:path';
import type { LanguageStat } from '../types.js';
import { readTextSafe, type WalkedFile } from '../utils/fs.js';

interface LangDef {
  name: string;
  color: string;
  /** Relative weight so a few huge config files do not outrank real source. */
  weight: number;
}

/** Extension → language, with GitHub linguist colours. */
const EXTENSION_MAP: Record<string, LangDef> = {
  '.ts': { name: 'TypeScript', color: '#3178c6', weight: 1 },
  '.tsx': { name: 'TSX', color: '#3178c6', weight: 1 },
  '.mts': { name: 'TypeScript', color: '#3178c6', weight: 1 },
  '.cts': { name: 'TypeScript', color: '#3178c6', weight: 1 },
  '.js': { name: 'JavaScript', color: '#f1e05a', weight: 1 },
  '.jsx': { name: 'JSX', color: '#f1e05a', weight: 1 },
  '.mjs': { name: 'JavaScript', color: '#f1e05a', weight: 1 },
  '.cjs': { name: 'JavaScript', color: '#f1e05a', weight: 1 },
  '.vue': { name: 'Vue', color: '#41b883', weight: 1 },
  '.svelte': { name: 'Svelte', color: '#ff3e00', weight: 1 },
  '.py': { name: 'Python', color: '#3572A5', weight: 1 },
  '.pyi': { name: 'Python', color: '#3572A5', weight: 0.5 },
  '.rs': { name: 'Rust', color: '#dea584', weight: 1 },
  '.go': { name: 'Go', color: '#00ADD8', weight: 1 },
  '.java': { name: 'Java', color: '#b07219', weight: 1 },
  '.kt': { name: 'Kotlin', color: '#A97BFF', weight: 1 },
  '.kts': { name: 'Kotlin', color: '#A97BFF', weight: 1 },
  '.scala': { name: 'Scala', color: '#c22d40', weight: 1 },
  '.c': { name: 'C', color: '#555555', weight: 1 },
  '.h': { name: 'C', color: '#555555', weight: 0.8 },
  '.cpp': { name: 'C++', color: '#f34b7d', weight: 1 },
  '.cc': { name: 'C++', color: '#f34b7d', weight: 1 },
  '.cxx': { name: 'C++', color: '#f34b7d', weight: 1 },
  '.hpp': { name: 'C++', color: '#f34b7d', weight: 0.8 },
  '.cs': { name: 'C#', color: '#178600', weight: 1 },
  '.fs': { name: 'F#', color: '#b845fc', weight: 1 },
  '.rb': { name: 'Ruby', color: '#701516', weight: 1 },
  '.php': { name: 'PHP', color: '#4F5D95', weight: 1 },
  '.swift': { name: 'Swift', color: '#F05138', weight: 1 },
  '.m': { name: 'Objective-C', color: '#438eff', weight: 1 },
  '.mm': { name: 'Objective-C++', color: '#6866fb', weight: 1 },
  '.dart': { name: 'Dart', color: '#00B4AB', weight: 1 },
  '.lua': { name: 'Lua', color: '#000080', weight: 1 },
  '.r': { name: 'R', color: '#198CE7', weight: 1 },
  '.jl': { name: 'Julia', color: '#a270ba', weight: 1 },
  '.ex': { name: 'Elixir', color: '#6e4a7e', weight: 1 },
  '.exs': { name: 'Elixir', color: '#6e4a7e', weight: 1 },
  '.erl': { name: 'Erlang', color: '#B83998', weight: 1 },
  '.hs': { name: 'Haskell', color: '#5e5086', weight: 1 },
  '.clj': { name: 'Clojure', color: '#db5855', weight: 1 },
  '.sh': { name: 'Shell', color: '#89e051', weight: 0.7 },
  '.bash': { name: 'Shell', color: '#89e051', weight: 0.7 },
  '.zsh': { name: 'Shell', color: '#89e051', weight: 0.7 },
  '.fish': { name: 'Shell', color: '#89e051', weight: 0.6 },
  '.ps1': { name: 'PowerShell', color: '#012456', weight: 0.7 },
  '.html': { name: 'HTML', color: '#e34c26', weight: 0.5 },
  '.htm': { name: 'HTML', color: '#e34c26', weight: 0.5 },
  '.css': { name: 'CSS', color: '#563d7c', weight: 0.5 },
  '.scss': { name: 'SCSS', color: '#c6538c', weight: 0.5 },
  '.sass': { name: 'Sass', color: '#a53b70', weight: 0.5 },
  '.less': { name: 'Less', color: '#1d365d', weight: 0.5 },
  '.styl': { name: 'Stylus', color: '#ff6347', weight: 0.4 },
  '.md': { name: 'Markdown', color: '#083fa1', weight: 0.3 },
  '.mdx': { name: 'MDX', color: '#083fa1', weight: 0.3 },
  '.json': { name: 'JSON', color: '#292929', weight: 0.2 },
  '.json5': { name: 'JSON5', color: '#292929', weight: 0.2 },
  '.jsonc': { name: 'JSONC', color: '#292929', weight: 0.2 },
  '.yaml': { name: 'YAML', color: '#cb171e', weight: 0.2 },
  '.yml': { name: 'YAML', color: '#cb171e', weight: 0.2 },
  '.toml': { name: 'TOML', color: '#9c4221', weight: 0.2 },
  '.xml': { name: 'XML', color: '#0060ac', weight: 0.2 },
  '.sql': { name: 'SQL', color: '#e38c00', weight: 0.4 },
  '.graphql': { name: 'GraphQL', color: '#e10098', weight: 0.6 },
  '.gql': { name: 'GraphQL', color: '#e10098', weight: 0.6 },
  '.proto': { name: 'Protocol Buffer', color: '#4285F4', weight: 0.6 },
  '.tf': { name: 'HCL', color: '#844FBA', weight: 0.4 },
  '.dockerfile': { name: 'Dockerfile', color: '#2496ED', weight: 0.4 },
  '.pl': { name: 'Perl', color: '#0298c3', weight: 0.6 },
  '.nim': { name: 'Nim', color: '#ffc200', weight: 0.6 },
  '.zig': { name: 'Zig', color: '#ec915c', weight: 0.8 },
  '.sol': { name: 'Solidity', color: '#AA6746', weight: 0.8 },
  '.mov': { name: 'Other', color: '#999999', weight: 0 },
};

/** Files recognised by basename rather than extension. */
const BASENAME_MAP: Record<string, LangDef> = {
  dockerfile: { name: 'Dockerfile', color: '#2496ED', weight: 0.4 },
  makefile: { name: 'Makefile', color: '#427819', weight: 0.4 },
  'gnumakefile': { name: 'Makefile', color: '#427819', weight: 0.4 },
  justfile: { name: 'Just', color: '#384d54', weight: 0.3 },
  rakefile: { name: 'Ruby', color: '#701516', weight: 0.8 },
  gemfile: { name: 'Ruby', color: '#701516', weight: 0.6 },
  'cmakelists.txt': { name: 'CMake', color: '#DA3434', weight: 0.4 },
  gradle: { name: 'Gradle', color: '#02303A', weight: 0.4 },
};

/** Languages whose line counts we compute (i.e. treated as real source). */
const COUNTABLE = new Set(
  Object.values(EXTENSION_MAP)
    .filter((d) => d.weight >= 0.5)
    .map((d) => d.name),
);

function detectFor(file: WalkedFile): LangDef | undefined {
  const base = path.basename(file.rel).toLowerCase();
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) {
    return EXTENSION_MAP['.dockerfile'];
  }
  const byName = BASENAME_MAP[base];
  if (byName) return byName;
  return EXTENSION_MAP[file.ext];
}

export interface LanguageReport {
  languages: LanguageStat[];
  primaryLanguage?: string;
  linesOfCode: number;
}

/**
 * Files that must not influence the language mix.
 *
 * The README this tool writes is often the largest file in a small repository,
 * so counting it creates a feedback loop: run once and the project becomes
 * "80% Markdown"; run again and the badge advertises Markdown on a TypeScript
 * codebase. A README is also not what anyone means by a project's language.
 */
const IGNORED_FOR_LANGUAGE_STATS = /^readme(?:\.[a-z0-9-]+)?\.(?:md|markdown|mdx|rst)$/i;

/**
 * Aggregate per-language statistics. Ranking uses weighted bytes so that a
 * directory of large JSON fixtures does not make "JSON" the project's
 * primary language, matching what a human would say the project "is in".
 */
export function analyzeLanguages(files: WalkedFile[], root: string): LanguageReport {
  const buckets = new Map<string, { def: LangDef; extensions: Set<string>; files: number; bytes: number; lines: number }>();
  let linesOfCode = 0;

  for (const file of files) {
    if (IGNORED_FOR_LANGUAGE_STATS.test(path.basename(file.rel))) continue;
    const def = detectFor(file);
    if (!def || def.weight === 0) continue;

    let bucket = buckets.get(def.name);
    if (!bucket) {
      bucket = { def, extensions: new Set(), files: 0, bytes: 0, lines: 0 };
      buckets.set(def.name, bucket);
    }
    bucket.extensions.add(file.ext || path.basename(file.rel).toLowerCase());
    bucket.files += 1;
    bucket.bytes += file.bytes;

    if (COUNTABLE.has(def.name) && file.bytes < 1_000_000) {
      const text = readTextSafe(path.join(root, file.rel));
      if (text !== undefined) {
        const lines = countCodeLines(text, def.name);
        bucket.lines += lines;
        linesOfCode += lines;
      }
    }
  }

  const totalWeighted = [...buckets.values()].reduce((sum, b) => sum + b.bytes * b.def.weight, 0);
  const totalFiles = [...buckets.values()].reduce((sum, b) => sum + b.files, 0);

  const languages: LanguageStat[] = [...buckets.values()]
    .map((b) => ({
      name: b.def.name,
      extensions: [...b.extensions].sort(),
      files: b.files,
      bytes: b.bytes,
      lines: b.lines,
      percent: totalWeighted > 0
        ? Math.round(((b.bytes * b.def.weight) / totalWeighted) * 1000) / 10
        : totalFiles > 0
          ? Math.round((b.files / totalFiles) * 1000) / 10
          : 0,
      color: b.def.color,
    }))
    .sort((a, b) => b.percent - a.percent || b.lines - a.lines);

  // Drop trace languages (<0.3%) unless that would empty the list.
  const significant = languages.filter((l) => l.percent >= 0.3);
  const final = (significant.length > 0 ? significant : languages).slice(0, 10);

  // Normalise percentages over what we actually display.
  const shownTotal = final.reduce((s, l) => s + l.percent, 0);
  if (shownTotal > 0 && shownTotal !== 100) {
    for (const l of final) l.percent = Math.round((l.percent / shownTotal) * 1000) / 10;
  }

  const primary = final.find((l) => COUNTABLE.has(l.name) && l.lines > 0)?.name ?? final[0]?.name;

  return { languages: final, ...(primary ? { primaryLanguage: primary } : {}), linesOfCode };
}

/** Count non-blank, non-comment lines using language-appropriate comment syntax. */
function countCodeLines(text: string, lang: string): number {
  const lineComment = ['#', '//', '--', ';', '%'].includes(commentTokenFor(lang)) ? commentTokenFor(lang) : null;
  const hashStyle = ['Python', 'Shell', 'Ruby', 'YAML', 'TOML', 'Makefile', 'PowerShell', 'R', 'Julia', 'Dockerfile', 'Elixir', 'Erlang', 'Perl', 'CMake', 'Just'].includes(lang);
  const sqlStyle = lang === 'SQL';

  let count = 0;
  let inBlock = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    if (!hashStyle && !sqlStyle) {
      if (inBlock) {
        if (line.includes('*/') || line.includes('-->')) inBlock = false;
        continue;
      }
      if (line.startsWith('/*') || line.startsWith('<!--')) {
        if (!line.includes('*/') && !line.includes('-->')) inBlock = true;
        continue;
      }
    } else if (hashStyle && inBlock) {
      // Hash-style languages have no block comments.
      inBlock = false;
    }

    if (lineComment && line.startsWith(lineComment)) continue;
    if (hashStyle && line.startsWith('#')) continue;
    if (sqlStyle && line.startsWith('--')) continue;
    if (line.startsWith('//')) continue;
    count++;
  }
  return count;
}

function commentTokenFor(lang: string): string {
  if (['Python', 'Shell', 'Ruby', 'YAML', 'TOML', 'Makefile', 'R', 'Julia', 'Dockerfile', 'CMake'].includes(lang)) return '#';
  if (lang === 'SQL') return '--';
  if (lang === 'Lua') return '--';
  if (['Erlang', 'Elixir'].includes(lang)) return '%';
  return '//';
}

/** Human-readable language bar for the README, e.g. `TypeScript 82% · Shell 12%`. */
export function languageBar(languages: LanguageStat[]): string {
  return languages
    .filter((l) => l.percent >= 1)
    .slice(0, 6)
    .map((l) => `${l.name} ${l.percent.toFixed(l.percent >= 10 ? 0 : 1)}%`)
    .join(' · ');
}
