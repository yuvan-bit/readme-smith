import path from 'node:path';
import type { CodeBlock, CommandMention, EnvMention, Heading, LanguageSetting, ParsedSection, ReadmeAnalysis, StandardSections } from '../types.js';
import type { FactSheet } from '../types.js';
import { exists, readTextSafe } from '../utils/fs.js';

export const README_FILE = 'README.md';

export interface ParsedReadme {
  raw: string;
  lines: string[];
  headings: Heading[];
  /** H2 sections (or the first heading level below H1 when no H2 exists). */
  sections: ParsedSection[];
  codeBlocks: CodeBlock[];
  preamble: string;
  intro: string;
  hasToc: boolean;
  imageCount: number;
  licenseStatement: string | null;
  language: LanguageSetting;
}

const SHELL_RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
// One or more leading `NAME=value` assignments, including quoted values.
const ENV_ASSIGNMENT_PREFIX = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)+/;
const BUILTIN_SUBCOMMANDS = new Set([
  'install', 'i', 'ci', 'add', 'remove', 'rm', 'uninstall', 'update', 'up', 'upgrade',
  'init', 'create', 'exec', 'dlx', 'link', 'unlink', 'publish', 'pack', 'audit',
  'outdated', 'why', 'config', 'cache', 'version', 'login', 'logout', 'ls', 'list',
  'bin', 'root', 'help', 'store', 'workspace', 'workspaces', 'patch', 'prune',
  'set', 'get', 'rebuild', 'doctor', 'dedupe', 'import', 'info', 'search', 'team',
]);

const ENV_NOISE = new Set([
  'TODO', 'NOTE', 'WARNING', 'EXAMPLE', 'DEFAULT', 'REQUIRED', 'OPTIONAL',
  'API', 'JSON', 'YAML', 'TOML', 'HTTP', 'HTTPS', 'URL', 'URI', 'CLI', 'README',
  'MIT', 'BSD', 'GPL', 'OSI', 'CPU', 'RAM', 'GPU', 'SQL', 'CSS', 'HTML', 'NPM',
  'DOCKER', 'LINUX', 'MACOS', 'WINDOWS', 'UNIX', 'UTF', 'ASCII', 'PDF', 'PNG',
  'JPG', 'GIF', 'SVG', 'UUID', 'HTTP', 'SSH', 'TLS', 'SSL', 'DNS', 'IP', 'OS',
  'PATH', 'HOME', 'USER', 'PWD', 'SHELL', 'TERM', 'LANG', 'TZ', 'CI', 'CD',
  'TRUE', 'FALSE', 'NULL', 'YES', 'NO', 'ON', 'OFF', 'ALL', 'NONE', 'AUTO',
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS',
]);

const LICENSE_NAMES: Array<[RegExp, string]> = [
  [/\bAGPL[- ]?3(?:\.0)?\b/i, 'AGPL-3.0'],
  [/\bLGPL[- ]?3(?:\.0)?\b/i, 'LGPL-3.0'],
  [/\bGPL[- ]?3(?:\.0)?\b/i, 'GPL-3.0'],
  [/\bGPL[- ]?2(?:\.0)?\b/i, 'GPL-2.0'],
  [/\bApache[- ]?2(?:\.0)?\b/i, 'Apache-2.0'],
  [/\bMPL[- ]?2(?:\.0)?\b/i, 'MPL-2.0'],
  [/\bBSD[- ]?3[- ]?Clause\b/i, 'BSD-3-Clause'],
  [/\bBSD[- ]?2[- ]Clause\b/i, 'BSD-2-Clause'],
  [/\bISC\b/i, 'ISC'],
  [/\bUnlicense\b/i, 'Unlicense'],
  [/\bCC0(?:-1\.0)?\b/i, 'CC0-1.0'],
  [/\bMIT\b/i, 'MIT'],
];

export function readReadme(root: string): { exists: boolean; path: string; text: string } {
  const abs = path.join(root, README_FILE);
  const text = readTextSafe(abs, 2 * 1024 * 1024);
  return { exists: text !== undefined && exists(root, README_FILE), path: README_FILE, text: text ?? '' };
}

export function parseReadme(text: string): ParsedReadme {
  const raw = text.replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/);
  const headings: Heading[] = [];
  const codeBlocks: CodeBlock[] = [];
  const fenceLine = new Set<number>();

  let fence: { marker: string; lang: string | null; start: number; body: string[] } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)?.*$/);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (!fence) {
        fence = { marker, lang: normaliseLang(fenceMatch[2]), start: i + 1, body: [] };
        fenceLine.add(i);
        continue;
      }
      if (marker[0] === fence.marker[0] && marker.length >= fence.marker.length) {
        codeBlocks.push({ lang: fence.lang, content: fence.body.join('\n'), line: fence.start });
        fenceLine.add(i);
        fence = null;
        continue;
      }
    }
    if (fence) {
      fence.body.push(line);
      fenceLine.add(i);
      continue;
    }
    const atx = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (atx) {
      const headingText = stripInline(atx[2]!.trim());
      if (headingText) headings.push({ level: atx[1]!.length, text: headingText, slug: slugify(headingText), line: i + 1 });
      continue;
    }
    // Setext headings: a title line followed by === or ---.
    const next = lines[i + 1];
    if (line.trim() && next && /^\s{0,3}(=+|-+)\s*$/.test(next) && !line.startsWith('|')) {
      const level = next.trim().startsWith('=') ? 1 : 2;
      const headingText = stripInline(line.trim());
      headings.push({ level, text: headingText, slug: slugify(headingText), line: i + 1 });
      i++;
    }
  }
  if (fence) {
    codeBlocks.push({ lang: fence.lang, content: fence.body.join('\n'), line: fence.start });
  }

  const sectionLevel = headings.some((h) => h.level === 2)
    ? 2
    : Math.min(...headings.filter((h) => h.level > 1).map((h) => h.level), 6);

  const sections: ParsedSection[] = [];
  const firstSectionIndex = headings.findIndex((h) => h.level === sectionLevel);
  const preambleEnd = firstSectionIndex >= 0 ? headings[firstSectionIndex]!.line - 1 : lines.length;
  const preamble = lines.slice(0, preambleEnd).join('\n');

  const levelHeadings = headings.filter((h) => h.level === sectionLevel);
  for (let i = 0; i < levelHeadings.length; i++) {
    const heading = levelHeadings[i]!;
    let end = lines.length;
    for (let j = i + 1; j < levelHeadings.length; j++) {
      end = levelHeadings[j]!.line - 1;
      break;
    }
    // Sub-headings may end a section only at the same or shallower depth; H2
    // sections own their H3 children by construction.
    const bodyLines = lines.slice(heading.line, end);
    const leadingBlanks = bodyLines.findIndex((line) => line.trim() !== '');
    sections.push({
      title: heading.text,
      level: heading.level,
      startLine: heading.line,
      endLine: end,
      bodyStartLine: heading.line + 1 + (leadingBlanks < 0 ? 0 : leadingBlanks),
      headings: headings.filter((h) => h.line > heading.line && h.line <= end && h.level > heading.level),
      body: bodyLines.join('\n').trim(),
    });
  }

  const introLines = lines.slice(
    headings.find((h) => h.level === 1)?.line ?? 0,
    firstSectionIndex >= 0 ? headings[firstSectionIndex]!.line - 1 : Math.min(lines.length, 40),
  );
  const intro = introLines
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (/^!\[/.test(t) || /^<img\b/i.test(t) || /^<p\b/i.test(t) || /^<\/p>/i.test(t)) return false;
      if (/^\[!\[/.test(t)) return false;
      if (/^\[[^\]]+\]\([^)]*\)\s*\|/.test(t)) return false;
      return true;
    })
    .join('\n')
    .trim();

  const allText = lines.filter((_, i) => !fenceLine.has(i)).join('\n');
  const imageCount = countContentImages(allText);
  const hasToc =
    headings.some((h) => /^(table of contents|contents|目录)$/i.test(h.text)) ||
    countAnchorLinks(allText.split('\n').slice(0, 60).join('\n')) >= 3;

  const licenseSection = sections.find((s) => /licen[cs]e|许可证|许可协议/i.test(s.title));
  const licenseStatement = licenseSection ? findLicenseName(licenseSection.body) : findLicenseName(allText);

  return {
    raw,
    lines,
    headings,
    sections,
    codeBlocks,
    preamble,
    intro,
    hasToc,
    imageCount,
    licenseStatement,
    language: detectLanguage(allText),
  };
}

function normaliseLang(info: string | undefined): string | null {
  if (!info) return null;
  const clean = info.trim().toLowerCase().replace(/^\{?\.?/, '').replace(/[},].*$/, '');
  if (!clean || clean === 'text' || clean === 'plain' || clean === 'plaintext') return null;
  return clean;
}

export function stripInline(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .trim();
}

export function slugify(text: string): string {
  return stripInline(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function countContentImages(text: string): number {
  const urls: string[] = [];
  for (const m of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)) urls.push(m[1]!);
  for (const m of text.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) urls.push(m[1]!);
  return urls.filter((u) => !/shields\.io|badgen|badge|coveralls|codecov|travis-ci|circleci|appveyor|github\.com\/[^/]+\/[^/]+\/actions/i.test(u)).length;
}

function countAnchorLinks(text: string): number {
  return [...text.matchAll(/\[[^\]]+\]\(#[^)]+\)/g)].length;
}

function findLicenseName(text: string): string | null {
  for (const [re, name] of LICENSE_NAMES) {
    if (re.test(text)) return name;
  }
  return null;
}

function detectLanguage(text: string): LanguageSetting {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (cjk + latin < 20) return 'auto';
  if (cjk / Math.max(1, cjk + latin) >= 0.15) return 'zh';
  return 'en';
}

export function analyseCodeCommands(
  parsed: ParsedReadme,
  facts: FactSheet,
): { commands: CommandMention[]; envMentions: EnvMention[] } {
  const commands: CommandMention[] = [];
  const envMentions: EnvMention[] = [];
  const seenCommands = new Set<string>();
  const seenEnv = new Set<string>();
  const scripts = new Set(facts.scripts.map((s) => s.name));
  const hasScripts = facts.scripts.length > 0;
  const bins = new Set(facts.binaries);

  const addCommand = (raw: string, line: number): void => {
    const clean = raw.trim().replace(/^\$\s+/, '').replace(/^>\s+/, '');
    if (!clean || clean.startsWith('#') || clean.startsWith('//')) return;
    if (/^(usage|output|result|example|stdout|stderr):/i.test(clean)) return;
    // `TOKEN=value npm run build` runs npm after setting an inline variable;
    // validate the command, but keep the assignment in the reported raw line.
    const command = clean.replace(ENV_ASSIGNMENT_PREFIX, '');
    const firstToken = command.split(/\s+/)[0]!;
    let mention: CommandMention | null = null;
    if (SHELL_RUNNERS.has(firstToken)) {
      mention = validatePackageManagerCommand(command, line, scripts, hasScripts);
    } else if (bins.has(firstToken)) {
      mention = { raw: command, line, kind: 'bin', valid: true };
    }
    if (mention) mention.raw = clean;
    if (!mention) return;
    const key = `${mention.kind}\u0000${mention.raw}`;
    if (seenCommands.has(key)) return;
    seenCommands.add(key);
    commands.push(mention);
  };

  const addEnv = (name: string, line: number): void => {
    if (!isEnvName(name)) return;
    const known = facts.env.some((e) => e.name === name);
    if (seenEnv.has(name)) return;
    seenEnv.add(name);
    envMentions.push({ name, line, known });
  };

  for (const block of parsed.codeBlocks) {
    if (block.lang && !/^(sh|bash|shell|zsh|console|terminal|cmd|powershell|ps1|text|plaintext)?$/i.test(block.lang)) continue;
    let line = block.line;
    for (const rawLine of block.content.split('\n')) {
      const trimmed = rawLine.trim();
      if (trimmed) {
        // Split obvious command chains so `npm ci && npm run build` validates both.
        for (const piece of trimmed.split(/\s*(?:&&|\|\|)\s*/)) addCommand(piece, line);
        for (const m of trimmed.matchAll(/\b([A-Z][A-Z0-9_]{2,})\s*=/g)) addEnv(m[1]!, line);
        for (const m of trimmed.matchAll(/\$\{([A-Z][A-Z0-9_]{2,})\}|\$([A-Z][A-Z0-9_]{2,})/g)) addEnv(m[1] ?? m[2]!, line);
      }
      line++;
    }
  }

  // Inline code spans are how most READMEs mention a single command.
  for (let i = 0; i < parsed.lines.length; i++) {
    const line = parsed.lines[i]!;
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const snippet = m[1]!.trim();
      addCommand(snippet, i + 1);
      for (const env of snippet.matchAll(/^([A-Z][A-Z0-9_]{2,})=/g)) addEnv(env[1]!, i + 1);
      for (const env of snippet.matchAll(/\$\{?([A-Z][A-Z0-9_]{2,})\}?/g)) addEnv(env[1]!, i + 1);
    }
    // Markdown tables in configuration sections list env names in the first cell.
    const table = line.match(/^\|\s*`?([A-Z][A-Z0-9_]{2,})`?\s*\|/);
    if (table) addEnv(table[1]!, i + 1);
  }

  return { commands, envMentions };
}

function validatePackageManagerCommand(
  raw: string,
  line: number,
  scripts: Set<string>,
  hasScripts: boolean,
): CommandMention | null {
  const tokens = raw.split(/\s+/).filter((t) => t && !t.startsWith('-'));
  const runner = tokens[0]!;
  const rest = tokens.slice(1);
  if (rest.length === 0) return null;

  let script: string | undefined;
  if (['run', 'run-script'].includes(rest[0]!)) {
    script = rest[1];
  } else {
    script = rest[0];
  }
  if (!script) {
    return { raw, line, kind: 'script', valid: false, detail: `missing script name after ${runner} ${rest[0] ?? ''}`.trim() };
  }
  const isBuiltin = BUILTIN_SUBCOMMANDS.has(script);
  if (isBuiltin) {
    // `npm test` and `npm start` only work when the script exists; other
    // built-ins are package-manager commands, not project scripts.
    if ((script === 'test' || script === 'start') && hasScripts && !scripts.has(script)) {
      return { raw, line, kind: 'script', valid: false, detail: `script "${script}" is not declared in the manifest` };
    }
    return { raw, line, kind: 'script', valid: null, detail: `${script} is a package-manager subcommand` };
  }
  if (!hasScripts) return { raw, line, kind: 'script', valid: null };
  return scripts.has(script)
    ? { raw, line, kind: 'script', valid: true }
    : { raw, line, kind: 'script', valid: false, detail: `script "${script}" is not declared in the manifest` };
}

function isEnvName(name: string): boolean {
  if (ENV_NOISE.has(name)) return false;
  if (!/^[A-Z][A-Z0-9_]{2,}$/.test(name)) return false;
  // Require an underscore or at least four characters: short all-caps words are
  // almost always prose (GET, CLI, PDF), not configuration.
  return name.includes('_') || name.length >= 4;
}

export function analyseReadme(root: string, facts: FactSheet, preset: string): ReadmeAnalysis {
  const read = readReadme(root);
  if (!read.exists) {
    return {
      path: null,
      exists: false,
      lines: 0,
      language: 'auto',
      headings: [],
      sections: [],
      codeBlocks: [],
      standard: emptyStandard(),
      commands: [],
      envMentions: [],
      hasToc: false,
      imageCount: 0,
      h1Count: 0,
      headingJumps: 0,
      unlabelledCodeBlocks: 0,
      licenseStatement: null,
    };
  }
  const parsed = parseReadme(read.text);
  const { commands, envMentions } = analyseCodeCommands(parsed, facts);
  const standard = detectStandardSections(parsed, facts, preset);

  let previous = 0;
  let jumps = 0;
  for (const h of parsed.headings) {
    if (previous && h.level > previous + 1) jumps++;
    previous = h.level;
  }

  return {
    path: read.path,
    exists: true,
    lines: read.text.split(/\r?\n/).length,
    language: parsed.language,
    headings: parsed.headings,
    sections: parsed.sections,
    codeBlocks: parsed.codeBlocks,
    standard,
    commands,
    envMentions,
    hasToc: parsed.hasToc,
    imageCount: parsed.imageCount,
    h1Count: parsed.headings.filter((h) => h.level === 1).length,
    headingJumps: jumps,
    unlabelledCodeBlocks: parsed.codeBlocks.filter((b) => !b.lang).length,
    licenseStatement: parsed.licenseStatement,
  };
}

export function emptyStandard(): StandardSections {
  return {
    title: false, intro: false, install: false, usage: false, license: false,
    contributing: false, demo: false, packages: false, configuration: false,
  };
}

function detectStandardSections(parsed: ParsedReadme, facts: FactSheet, preset: string): StandardSections {
  const has = (re: RegExp) => parsed.headings.some((h) => re.test(h.text));
  const usage = has(/usage|how to use|quick ?start|example|使用|用法|示例|快速/i);
  const install = has(/install|installation|setup|set ?up|getting started|requirements|安装|环境|准备/i);
  const linksContributing = /\[[^\]]+\]\([^)]*contribut[^)]*\)/i.test(parsed.raw) || /CONTRIBUTING\.md/i.test(parsed.raw);
  const demo = parsed.imageCount > 0 || (preset === 'cli' && parsed.codeBlocks.some((b) => /^(sh|bash|shell|console|terminal)?$/i.test(b.lang ?? '') && b.content.includes('\n')));
  return {
    title: parsed.headings.some((h) => h.level === 1),
    // Any prose before the first section is an introduction; brevity is a
    // writing-quality question, not a structural absence.
    intro: parsed.intro.replace(/[#>*_`\-[\]()]/g, '').trim().length > 0,
    install,
    usage,
    license: has(/licen[cs]e|许可证|许可协议/i),
    contributing: has(/contribut|贡献/i) || linksContributing,
    demo,
    packages: has(/packages|workspace|modules|project structure|repository structure|项目结构|目录结构|monorepo/i),
    configuration: has(/config|environment|env|settings|配置|环境变量/i),
  };
}
