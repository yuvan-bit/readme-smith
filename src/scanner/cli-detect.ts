import path from 'node:path';
import type { CliCommandInfo } from '../types.js';
import { readTextSafe } from '../utils/fs.js';

/**
 * Static extraction of CLI surface area from source.
 *
 * We never execute the target project — running untrusted code just to read
 * `--help` is not acceptable for a tool people pipe into CI. Instead we
 * pattern-match the registration idioms of the major CLI frameworks. This is
 * inherently best-effort: the goal is a useful "Commands" table, not a
 * complete argument parser.
 */

interface Extractor {
  framework: string;
  /** File extensions worth scanning for this framework. */
  extensions: string[];
  /** Marker that suggests the file uses this framework at all. */
  marker: RegExp;
  extract(text: string): CliCommandInfo[];
}

const EXTRACTORS: Extractor[] = [
  {
    framework: 'commander',
    extensions: ['.ts', '.js', '.mjs', '.cjs', '.tsx'],
    marker: /from ['"]commander['"]|require\(['"]commander['"]\)/,
    extract(text) {
      const out: CliCommandInfo[] = [];
      // Locate every `.command('name')`, then look at the text up to the *next*
      // one. An earlier version searched a fixed 400-character window, which
      // silently found nothing in files where each command body is dozens of
      // lines long — including this tool's own CLI. Distance is not a signal;
      // the next `.command(` is.
      const marks = [...text.matchAll(/\.command\(\s*['"`]([^'"`]+)['"`]\s*\)/g)];
      marks.forEach((mark, position) => {
        const start = (mark.index ?? 0) + mark[0].length;
        const end = position + 1 < marks.length ? (marks[position + 1]!.index ?? text.length) : text.length;
        const chain = text.slice(start, end);

        const raw = mark[1]!.trim();
        const name = raw.split(/\s+/)[0]!;
        if (!name || name.startsWith('-')) return;
        const description = chain.match(/\.description\(\s*['"`]([^'"`]+)['"`]/)?.[1]?.trim();
        // `new Option(...)` is how commander declares a flag with a fixed set of
        // choices, and it is the same flag surface as `.option(...)`: matching
        // only the latter advertised a command without its constrained options.
        const flags = [...chain.matchAll(/(?:\.option\(|new Option\()\s*['"`](-{1,2}[A-Za-z0-9][^'"`]*)['"`]/g)].map((f) => f[1]!.trim());
        out.push({
          name,
          ...(description ? { description } : {}),
          ...(flags.length ? { flags: [...new Set(flags)] } : {}),
          ...(raw.split(/\s+/).length > 1 ? { subcommands: [] } : {}),
        });
      });
      return dedupe(out);
    },
  },
  {
    framework: 'yargs',
    extensions: ['.ts', '.js', '.mjs', '.cjs'],
    marker: /from ['"]yargs['"]|require\(['"]yargs['"]\)/,
    extract(text) {
      const out: CliCommandInfo[] = [];
      // `.command('name', 'description'` or `.command({ command: 'name', describe: '...' })`
      const re = /\.command\(\s*(?:['"`]([^'"`]+)['"`]|\{[\s\S]{0,300}?command:\s*['"`]([^'"`]+)['"`][\s\S]{0,300}?\})\s*(?:,\s*['"`]([^'"`]+)['"`])?/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const raw = (m[1] ?? m[2])?.trim();
        if (!raw) continue;
        const name = raw.split(/\s+/)[0]!;
        if (!name || name.startsWith('-') || name.startsWith('$')) continue;
        const description = m[3]?.trim();
        out.push({ name, ...(description ? { description } : {}) });
      }
      // Object form: `{ command: 'x', describe: 'y' }`
      const objRe = /command:\s*['"`]([^'"`]+)['"`]\s*,\s*(?:describe|description):\s*['"`]([^'"`]+)['"`]/g;
      while ((m = objRe.exec(text)) !== null) {
        const name = m[1]!.split(/\s+/)[0]!;
        if (name) out.push({ name, description: m[2]!.trim() });
      }
      return dedupe(out);
    },
  },
  {
    framework: 'click',
    extensions: ['.py'],
    marker: /^import click|^from click/m,
    extract(text) {
      const out: CliCommandInfo[] = [];
      const re = /@(?:(\w+)\.)?command\(([^)]*)\)\s*\n(?:\s*@[^\n]*\n)*\s*def\s+(\w+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const args = m[2] ?? '';
        const explicit = args.match(/['"]([^'"]+)['"]/)?.[1];
        const fn = m[3]!;
        const name = explicit ?? fn.replace(/_/g, '-');
        if (!name || name === '__main__') continue;
        // Click descriptions live in the docstring.
        const after = text.slice(re.lastIndex, re.lastIndex + 400);
        const doc = after.match(/^\s*\(\s*\n?\s*("""|''')([\s\S]*?)\1/);
        const description = doc?.[2]?.split('\n')[0]?.trim();
        out.push({ name, ...(description ? { description } : {}) });
      }
      // `@click.group()` root
      if (/@\w*\.group\(/.test(text) && out.length === 0) {
        const g = text.match(/@(\w+)\.group\(/);
        if (g) out.push({ name: g[1]!.replace(/_/g, '-'), description: 'Command group' });
      }
      return dedupe(out);
    },
  },
  {
    framework: 'typer',
    extensions: ['.py'],
    marker: /^import typer|^from typer/m,
    extract(text) {
      const out: CliCommandInfo[] = [];
      const re = /@\w+\.command\(([^)]*)\)\s*\n(?:\s*@[^\n]*\n)*\s*def\s+(\w+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const explicit = (m[1] ?? '').match(/['"]([^'"]+)['"]/)?.[1];
        const fn = m[2]!;
        out.push({ name: explicit ?? fn.replace(/_/g, '-') });
      }
      return dedupe(out);
    },
  },
  {
    framework: 'cobra',
    extensions: ['.go'],
    marker: /spf13\/cobra/,
    extract(text) {
      const out: CliCommandInfo[] = [];
      const re = /Use:\s*"([^"]+)"[\s\S]{0,300}?Short:\s*"([^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const name = m[1]!.split(/\s+/)[0]!;
        if (!name) continue;
        out.push({ name, description: m[2] });
      }
      return dedupe(out);
    },
  },
  {
    framework: 'clap',
    extensions: ['.rs'],
    marker: /use clap::/,
    extract(text) {
      const out: CliCommandInfo[] = [];
      // Derive-style subcommand enums: `#[command(name = "x", about = "y")] Variant`
      const re = /#\[(?:command|clap)\(name\s*=\s*"([^"]+)"(?:[^)]*about\s*=\s*"([^"]+)")?\)\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        out.push({ name: m[1]!, ...(m[2] ? { description: m[2] } : {}) });
      }
      // Builder-style: `Command::new("x").about("y")`
      const re2 = /Command::new\(\s*"([^"]+)"\s*\)(?:[\s\S]{0,200}?\.about\(\s*"([^"]+)"\s*\))?/g;
      while ((m = re2.exec(text)) !== null) {
        out.push({ name: m[1]!, ...(m[2] ? { description: m[2] } : {}) });
      }
      return dedupe(out);
    },
  },
];

function dedupe(commands: CliCommandInfo[]): CliCommandInfo[] {
  const seen = new Map<string, CliCommandInfo>();
  for (const cmd of commands) {
    const key = cmd.name.toLowerCase();
    const existing = seen.get(key);
    if (!existing) { seen.set(key, cmd); continue; }
    // Prefer whichever entry carries more information.
    if (!existing.description && cmd.description) existing.description = cmd.description;
    if ((!existing.flags || existing.flags.length === 0) && cmd.flags?.length) existing.flags = cmd.flags;
  }
  return [...seen.values()];
}

/** Names that are framework plumbing rather than user-facing commands. */
const NOISE_COMMANDS = new Set([
  'help', 'completion', 'completions', '__default__', '$0', '*',
]);

/**
 * Names that are *usually* plumbing but are perfectly ordinary commands in
 * real CLIs — `taskflow run`, `docker compose run`, `cargo run`, `npm run`.
 * Dropping them outright silently removed a documented command with its
 * flags, so they are only filtered when the extractor found no description:
 * an undescribed `run` is probably plumbing, a described one is deliberate.
 */
const WEAK_NOISE_COMMANDS = new Set(['run', 'main', 'cli']);

export interface CliDetection {
  commands: CliCommandInfo[];
  framework?: string;
}

export function detectCliCommands(
  files: Array<{ rel: string; abs: string }>,
  binNames: string[],
  maxCommands = 20,
): CliDetection {
  const collected: CliCommandInfo[] = [];
  const frameworks = new Set<string>();

  for (const file of files) {
    const ext = path.extname(file.rel).toLowerCase();
    const applicable = EXTRACTORS.filter((e) => e.extensions.includes(ext));
    if (applicable.length === 0) continue;

    const text = readTextSafe(file.abs, 512 * 1024);
    if (!text) continue;

    for (const extractor of applicable) {
      if (!extractor.marker.test(text)) continue;
      const commands = extractor.extract(text);
      if (commands.length === 0) continue;
      frameworks.add(extractor.framework);
      collected.push(...commands);
    }
  }

  const binSet = new Set(binNames.map((b) => b.toLowerCase()));
  const filtered = dedupe(collected)
    .filter((c) => !NOISE_COMMANDS.has(c.name.toLowerCase()))
    .filter((c) => !(WEAK_NOISE_COMMANDS.has(c.name.toLowerCase()) && !c.description))
    .filter((c) => !binSet.has(c.name.toLowerCase()) || c.description)
    .sort((a, b) => {
      // Commands with descriptions read better and are more likely real.
      // Array.prototype.sort is stable, so ties keep declaration order — which
      // is the order `--help` shows and the order a reader expects.
      const score = (x: CliCommandInfo) => (x.description ? 0 : 1);
      return score(a) - score(b);
    })
    .slice(0, maxCommands);

  return { commands: filtered, ...(frameworks.size ? { framework: [...frameworks].join(', ') } : {}) };
}
