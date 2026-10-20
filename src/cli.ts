#!/usr/bin/env node
import { Command, Option } from 'commander';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GenerateOptions, Lang, ProjectProfile, SectionId, TranslateOptions } from './types.js';
import { banner, c, log, setVerbosity } from './utils/logger.js';
import { scanProject, profileToJson } from './scanner/index.js';
import { DEFAULT_SECTIONS, LOCALE_FILENAME, LOCALE_NAME, defaultOptions, generateReadmes } from './generate/index.js';
import type { RenderedReadme } from './generate/index.js';
import { loadSectionOverrides, OVERRIDE_DIR } from './generate/overrides.js';
import { SECTION_IDS } from './generate/sections.js';
import { listProviders, translateMarkdown } from './i18n/index.js';
import type { ProviderId } from './i18n/provider.js';

/* ------------------------------------------------------------------ *
 * Setup
 * ------------------------------------------------------------------ */

function readPackageVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [path.join(here, '..', 'package.json'), path.join(here, 'package.json')];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: string };
        if (pkg.version) return pkg.version;
      }
    }
  } catch { /* fall through to unknown */ }
  return '0.0.0';
}

const program = new Command();

program
  .name('readme-smith')
  .description('Scan a repository and forge a structured, badge-rich, diagram-rich bilingual README.')
  .version(readPackageVersion(), '-V, --version', 'print the version and exit')
  .option('-q, --quiet', 'only print errors')
  .option('-v, --verbose', 'print detailed diagnostics')
  .hook('preAction', (thisCommand) => {
    // `optsWithGlobals` is required: -q/-v are declared on the root program, so
    // reading the subcommand's own opts would silently ignore them.
    const opts = thisCommand.optsWithGlobals<{ quiet?: boolean; verbose?: boolean }>();
    setVerbosity(opts.quiet ? 'quiet' : opts.verbose ? 'verbose' : 'normal');
  });

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function parseLangs(raw: string): Lang[] {
  const parts = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const langs: Lang[] = [];
  for (const part of parts) {
    const normalised = /^(zh|zh-cn|zh-hans|chinese|cn)$/.test(part) ? 'zh' : /^en(-[a-z]{2})?$/.test(part) ? 'en' : undefined;
    if (!normalised) throw new Error(`Unsupported language "${part}". Use en or zh.`);
    if (!langs.includes(normalised)) langs.push(normalised);
  }
  if (langs.length === 0) throw new Error('No languages specified. Use --lang en,zh');
  return langs;
}

function parseSections(raw: string): SectionId[] {
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 1 && /^(all|\*)$/.test(parts[0]!)) return [...SECTION_IDS];
  const valid = new Set<string>(SECTION_IDS);
  const out: SectionId[] = [];
  for (const part of parts) {
    if (!valid.has(part)) {
      throw new Error(`Unknown section "${part}". Available: ${SECTION_IDS.join(', ')}`);
    }
    out.push(part as SectionId);
  }
  return out.length > 0 ? out : DEFAULT_SECTIONS;
}

function resolveRoot(input: string): string {
  const resolved = path.resolve(input);
  if (!existsSync(resolved)) throw new Error(`Path does not exist: ${resolved}`);
  return resolved;
}

/**
 * Write a file, backing up any existing content first.
 * Silently overwriting someone's hand-written README would be unforgivable.
 */
function writeWithBackup(target: string, content: string, backup: boolean): { written: string; backupPath?: string } {
  mkdirSync(path.dirname(target), { recursive: true });
  let backupPath: string | undefined;
  if (backup && existsSync(target)) {
    backupPath = `${target}.bak`;
    // Never clobber an existing backup — keep the oldest copy.
    if (existsSync(backupPath)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      backupPath = `${target}.${stamp}.bak`;
    }
    renameSync(target, backupPath);
  }
  writeFileSync(target, content, 'utf8');
  return { written: target, ...(backupPath ? { backupPath } : {}) };
}

interface WrittenFile {
  file: string;
  lang: Lang;
  bytes: number;
  backupPath?: string;
}

/**
 * Write one render pass, honouring --force, --dry-run and --no-backup.
 *
 * `firstPass` gates two things at once. The backup only applies to the author's
 * file, so it has to stay recoverable; a stability pass only replaces this
 * tool's own output, and a `.bak` of that is clutter in the repository root.
 * The overwrite guard likewise belongs to the first pass: once a later pass is
 * rewriting what the first pass wrote, the file that "already exists" is ours,
 * and refusing to touch it would leave the README describing a repository that
 * no longer exists.
 *
 * `changed` says whether anything on disk ended up different, which is what
 * tells the caller the repository it just scanned no longer matches itself.
 */
function writeRenderPass(items: RenderedReadme[], opts: GenerateCliOptions, outDir: string, firstPass: boolean): { results: WrittenFile[]; changed: boolean } {
  const results: WrittenFile[] = [];
  let changed = false;

  for (const item of items) {
    const filename = opts.filename ?? item.filename;
    const target = path.join(outDir, filename);
    const existsAlready = existsSync(target);

    const mayOverwrite = opts.force || !firstPass;
    if (existsAlready && !mayOverwrite) {
      log.warn(`${filename} already exists — skipped. Re-run with --force to overwrite (a .bak copy is kept).`);
      continue;
    }
    if (opts.dryRun) {
      log.detail(`would write ${c.cyan(path.relative(process.cwd(), target) || target)} (${Buffer.byteLength(item.content)} bytes)${existsAlready ? ' [overwrite]' : ''}`);
      continue;
    }

    const previous = existsAlready ? readFileSync(target, 'utf8') : undefined;
    if (previous === item.content) {
      // Nothing to do, and nothing to recover: rewriting identical bytes only
      // churns the mtime and drops a `.bak` of a file that never changed, which
      // is how a repository accumulates eleven README backups in plain sight.
      log.detail(`${filename} already matches what this command generates — left as is.`);
      results.push({ file: path.relative(process.cwd(), target) || target, lang: item.lang, bytes: Buffer.byteLength(item.content) });
      continue;
    }

    const { written, backupPath } = writeWithBackup(target, item.content, firstPass && opts.backup && existsAlready);
    changed = true;
    const shown = path.relative(process.cwd(), written) || written;
    results.push({ file: shown, lang: item.lang, bytes: Buffer.byteLength(item.content), ...(backupPath ? { backupPath } : {}) });
    log.success(`Wrote ${c.cyan(shown)}${backupPath ? ` ${c.grey(`(backup: ${path.basename(backupPath)})`)}` : ''}`);
  }

  return { results, changed };
}

/** Count lines the way `wc -l` does: a trailing newline does not start one. */
function countLines(text: string): number {
  return text.replace(/\s+$/, '').split('\n').length;
}

/** Report what the final render contains, counted rather than remembered. */
function summarise(items: RenderedReadme[]): void {
  for (const item of items) {
    const diagrams = (item.content.match(/```mermaid/g) ?? []).length;
    const badges = (item.content.match(/img\.shields\.io|badge\.svg/g) ?? []).length;
    log.detail(`${item.filename} · ${countLines(item.content)} lines · ${badges} badges · ${diagrams} diagrams`);
  }
}

/** Two render passes that agree byte for byte, so the document is stable. */
function agree(a: RenderedReadme[], b: RenderedReadme[]): boolean {
  return a.length === b.length && a.every((item, i) => item.content === b[i]!.content);
}

function reportWarnings(warnings: string[]): void {
  if (warnings.length === 0) return;
  log.blank();
  log.warn(`${warnings.length} thing${warnings.length === 1 ? '' : 's'} worth fixing:`);
  for (const warning of warnings) log.detail(warning);
}

/* ------------------------------------------------------------------ *
 * Drift check (`generate --check`)
 * ------------------------------------------------------------------ */

/**
 * Normalise the two things that are not drift.
 *
 * A contributor with `core.autocrlf=true` checks the committed README out with
 * CRLF endings, so a byte comparison would fail their CI for a difference git
 * itself refuses to report. A missing final newline is the same class of
 * accident. Nothing else is forgiven: a rewritten sentence is a real
 * difference, and this check exists to catch exactly that.
 */
function normaliseForCompare(text: string): string {
  return `${text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\s+$/, '')}\n`;
}

/** Describe the first line where the two documents stop agreeing. */
function firstDifference(generated: string, onDisk: string): string {
  const a = generated.split('\n');
  const b = onDisk.split('\n');
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    const left = a[i]!;
    const right = b[i]!;
    if (left === right) continue;
    const at = differingColumn(left, right);
    return `first difference at line ${i + 1}, column ${at + 1}\n      generated: ${lineWindow(left, at)}\n      on disk:   ${lineWindow(right, at)}`;
  }
  if (a.length === b.length) return 'the files differ';
  const at = `first difference at line ${shared + 1}`;
  return a.length > b.length
    ? `${at}: the file stops there, the generated output continues: ${lineWindow(a[shared]!, 0)}`
    : `${at}: the generated output stops there, the file continues: ${lineWindow(b[shared]!, 0)}`;
}

/** Characters of shared context kept on each side of a differing column. */
const DIFF_CONTEXT = 36;

function differingColumn(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let at = 0;
  while (at < limit && a[at] === b[at]) at++;
  return at;
}

/**
 * Show the line around the column where the two versions part company.
 *
 * Clipping both sides to a fixed prefix printed two identical-looking lines
 * under a message that says they differ: a badge line only diverges in its
 * query string, which sits far past any reasonable leading slice.
 */
function lineWindow(line: string, at: number): string {
  if (!line.trim()) return '(blank)';
  const start = Math.max(0, at - DIFF_CONTEXT);
  const end = start + DIFF_CONTEXT * 2;
  return `${start > 0 ? '…' : ''}${line.slice(start, end)}${line.length > end ? '…' : ''}`;
}

/**
 * Render nothing, write nothing, and report how far the README files on disk
 * have fallen behind what this command would produce. Returns the exit code so
 * CI fails on drift — but not on a warning such as an inferred registry claim,
 * which every run of a publishable package emits.
 */
function checkForDrift(rendered: RenderedReadme[], opts: GenerateCliOptions, root: string): number {
  const outDir = opts.out ? path.resolve(opts.out) : root;
  const stale: string[] = [];

  for (const item of rendered) {
    const filename = opts.filename ?? item.filename;
    const target = path.join(outDir, filename);
    if (!existsSync(target)) {
      stale.push(`${c.cyan(filename)} does not exist yet — this command would create it.`);
      continue;
    }
    const generated = normaliseForCompare(item.content);
    const onDisk = normaliseForCompare(readFileSync(target, 'utf8'));
    if (generated === onDisk) {
      log.detail(`${filename} is up to date (${countLines(generated)} lines)`);
      continue;
    }
    stale.push(`${c.cyan(filename)} is out of date — ${firstDifference(generated, onDisk)}`);
  }

  if (stale.length === 0) {
    log.success(`${rendered.length} README file${rendered.length === 1 ? '' : 's'} ${rendered.length === 1 ? 'matches' : 'match'} what this command generates.`);
    return 0;
  }
  log.blank();
  log.warn(`${stale.length} README ${stale.length === 1 ? 'file is' : 'files are'} out of date:`);
  for (const entry of stale) log.detail(entry);
  log.detail('Re-run the same command without --check to rewrite them.');
  return 1;
}

/* ------------------------------------------------------------------ *
 * generate
 * ------------------------------------------------------------------ */

interface GenerateCliOptions {
  lang: string;
  out?: string;
  filename?: string;
  stdout: boolean;
  json: boolean;
  badges: boolean;
  diagrams: boolean;
  toc: boolean;
  badgeStyle: string;
  sections?: string;
  treeDepth: string;
  force: boolean;
  /** `--no-backup` sets this false; commander defaults it to true. */
  backup: boolean;
  dryRun: boolean;
  check: boolean;
  skipGit: boolean;
  translateProse: boolean;
  provider?: string;
  switcher: boolean;
  unpublished: boolean;
}

program
  .command('generate')
  .alias('gen')
  .description('scan a project and write a structured bilingual README')
  .argument('[path]', 'project directory to scan', '.')
  .option('-l, --lang <langs>', 'comma-separated output languages', 'en,zh')
  .option('-o, --out <dir>', 'output directory (defaults to the project root)')
  .option('--filename <name>', 'force a single output file name (only with one --lang)')
  .option('--stdout', 'print the README to stdout instead of writing files')
  .option('--json', 'print the detected project profile as JSON and exit')
  .option('--no-badges', 'omit the badge row')
  .option('--no-diagrams', 'omit Mermaid diagrams')
  .option('--no-toc', 'omit the table of contents')
  .option('--no-switcher', 'omit the language switcher links')
  .addOption(new Option('--badge-style <style>', 'shields.io badge style').choices(['flat', 'flat-square', 'for-the-badge', 'plastic', 'social']).default('flat-square'))
  .option('--sections <list>', `comma-separated sections, or "all" (${DEFAULT_SECTIONS.join(',')})`)
  .option('--tree-depth <n>', 'maximum depth of the project structure tree', '3')
  .option('-f, --force', 'overwrite existing README files')
  .option('--no-backup', 'overwrite without keeping a .bak copy')
  .option('--dry-run', 'show what would be written without touching disk')
  .option('--check', 'fail instead of write: exit 1 when a README on disk no longer matches what this command would generate. Pass the same options you passed to generate.')
  .option('--skip-git', 'do not read git history (faster, no contributors)')
  .option('--translate-prose', 'translate the project description into every output language')
  .addOption(new Option('--provider <id>', 'provider for --translate-prose (default: best configured)').choices(['llm', 'deepl', 'free', 'none']))
  .option('--unpublished', 'the package is not on a registry: no version/downloads badges and no install-from-registry step')
  .action(async (inputPath: string, opts: GenerateCliOptions) => {
    try {
      const root = resolveRoot(inputPath);
      const langs = parseLangs(opts.lang);
      const sections = opts.sections ? parseSections(opts.sections) : DEFAULT_SECTIONS;

      if (opts.filename && langs.length > 1) {
        throw new Error('--filename can only be used with a single --lang value.');
      }
      if (opts.check) {
        const conflicting = [opts.stdout ? '--stdout' : undefined, opts.json ? '--json' : undefined].filter(Boolean);
        if (conflicting.length > 0) {
          throw new Error(`--check compares the README files on disk and never writes, so it cannot be combined with ${conflicting.join(' or ')}.`);
        }
      }

      banner('readme-smith', `Forging a README for ${c.cyan(root)}`);

      log.step(1, opts.json ? 1 : 3, 'Scanning repository');
      const profile = scanProject({ root, maxTreeDepth: Number(opts.treeDepth) || 3, skipGit: opts.skipGit });

      if (opts.json) {
        log.raw(profileToJson(profile) + '\n');
        return;
      }

      log.detail(`${profile.displayName} v${profile.version}${profile.primaryLanguage ? ` · ${profile.primaryLanguage}` : ''}`);
      if (profile.description) log.detail(profile.description.slice(0, 100));

      log.step(2, 3, `Rendering ${langs.map((l) => LOCALE_NAME[l]).join(' + ')}`);
      const overrides = loadSectionOverrides(root, langs);
      const options: GenerateOptions = {
        ...defaultOptions(root),
        langs,
        sections,
        badges: opts.badges,
        diagrams: opts.diagrams,
        toc: opts.toc,
        includeLanguageSwitcher: opts.switcher,
        badgeStyle: opts.badgeStyle as GenerateOptions['badgeStyle'],
        maxTreeDepth: Number(opts.treeDepth) || 3,
        overwrite: opts.force,
        translateProse: opts.translateProse,
        ...(opts.provider ? { provider: opts.provider as GenerateOptions['provider'] } : {}),
        allowRegistryClaims: !opts.unpublished,
        sectionOverrides: overrides.values,
      };

      const overrideCount = Object.keys(overrides.values).length;
      if (overrideCount > 0) log.detail(`${overrideCount} section ${overrideCount === 1 ? 'body' : 'bodies'} taken from ${OVERRIDE_DIR}/`);

      // A manifest proves a package *could* be published, not that it was.
      // Registry badges and a one-line install step are the loudest claims in a
      // README, so say out loud that they came from an inference.
      const notes = [...overrides.warnings];
      if (options.allowRegistryClaims && profile.features.publishedToRegistry) {
        notes.push(`Registry badges and an install-from-registry step were added because ${profile.name} looks publishable in its manifest. If it was never actually published, re-run with --unpublished.`);
      }

      // Notes the scanner cannot rediscover, so every profile a render pass uses
      // has to be given them again. Dropping them on a later pass would quietly
      // delete the footer line telling a reader to edit `.readme-smith/` instead
      // of the README, because that line only appears when there are notes.
      const decorate = (candidate: ProjectProfile): ProjectProfile => {
        candidate.warnings.push(...notes);
        return candidate;
      };
      decorate(profile);

      const rendered = await generateReadmes(profile, options);

      if (opts.check) {
        log.step(3, 3, 'Comparing with the files on disk');
        process.exitCode = checkForDrift(rendered, opts, root);
        reportWarnings(profile.warnings);
        return;
      }

      let current = rendered;

      if (opts.stdout) {
        summarise(current);
        // A single document must come out byte-exact: `readme-smith generate
        // --stdout | pbcopy` is a normal thing to do, and a banner glued to the
        // front of it is corruption. Separators only make sense when two or
        // more files share one stream.
        const separated = current.length > 1;
        current.forEach((item, i) => {
          if (separated) log.raw(`${i === 0 ? '' : '\n'}${'='.repeat(70)}\n${item.filename}\n${'='.repeat(70)}\n`);
          const content = item.content.endsWith('\n') ? item.content : `${item.content}\n`;
          log.raw(i === current.length - 1 ? content : content.replace(/\n$/, ''));
        });
        return;
      }

      log.step(3, 3, opts.dryRun ? 'Dry run' : 'Writing files');
      const outDir = opts.out ? path.resolve(opts.out) : root;
      let pass = writeRenderPass(current, opts, outDir, true);
      let settled = !opts.dryRun && !pass.changed;

      // The README this tool writes is repository content the scanner reads
      // back: it appears in the structure tree and is counted in the file and
      // size statistics. So the first render of a repository describes a state
      // that the write itself invalidates, and `--check` would report the file
      // that was just written as out of date. Re-scan and re-render until the
      // document stops moving, so what is left on disk is its own fixed point.
      // The last iteration only re-renders to prove that, which is why the cap
      // is one scan more than the number of rewrite passes it takes.
      for (let extra = 0; extra < 3 && !settled; extra++) {
        const rescan = scanProject({ root, maxTreeDepth: options.maxTreeDepth, skipGit: opts.skipGit });
        const again = await generateReadmes(decorate(rescan), options);
        if (agree(again, current)) {
          settled = true;
          break;
        }
        log.detail('Re-rendering so the document describes the files it just wrote');
        current = again;
        pass = writeRenderPass(current, opts, outDir, false);
      }
      if (!settled && !opts.dryRun && pass.results.length > 0) {
        log.warn('The statistics in this README count the README itself, and the numbers were still moving after repeated passes. Run generate once more so they settle.');
      }

      summarise(current);
      reportWarnings(profile.warnings);

      if (!opts.dryRun && pass.results.length > 0) {
        log.blank();
        log.info(c.bold('Next steps'));
        log.detail('Rewrite the “edit this” placeholders in .readme-smith/<section>.<lang>.md — they survive the next run, edits to the README itself do not.');
        log.detail('Preview the Mermaid diagrams on GitHub, or locally with any Markdown viewer that supports them.');
        log.detail('Keep the committed README in CI with `readme-smith generate --check`.');
        if (pass.results.length > 1) {
          log.detail(`Keep ${pass.results.map((r) => r.file).join(' and ')} in sync when you edit either one.`);
        }
      }
    } catch (error) {
      fail(error);
    }
  });

/* ------------------------------------------------------------------ *
 * translate
 * ------------------------------------------------------------------ */

interface TranslateCliOptions {
  from: string;
  to: string;
  provider?: string;
  out?: string;
  stdout: boolean;
  concurrency: string;
  instruction?: string;
  preserve?: string;
  force: boolean;
}

program
  .command('translate')
  .alias('tr')
  .description('translate an existing Markdown file, preserving code, badges and links')
  .argument('<file>', 'Markdown file to translate')
  .option('--from <lang>', 'source language ("auto" to detect)', 'auto')
  .option('--to <lang>', 'target language: en or zh', 'zh')
  .option('--provider <id>', 'force a provider: llm, deepl, free or none')
  .option('-o, --out <file>', 'output path (default: <name>.<to>.md next to the source)')
  .option('--stdout', 'print the translation instead of writing a file')
  .option('--concurrency <n>', 'parallel batches for keyed providers', '4')
  .option('--instruction <text>', 'extra style instruction for LLM providers')
  .option('--preserve <terms>', 'comma-separated terms to leave untranslated')
  .option('-f, --force', 'overwrite the output file if it exists')
  .action(async (file: string, opts: TranslateCliOptions) => {
    try {
      const source = path.resolve(file);
      if (!existsSync(source)) throw new Error(`File not found: ${source}`);

      const to = parseLangs(opts.to)[0]!;
      const fromRaw = opts.from.trim().toLowerCase();
      const from: Lang | 'auto' = fromRaw === 'auto' ? 'auto' : parseLangs(fromRaw)[0]!;

      const options: TranslateOptions = {
        from,
        to,
        ...(opts.provider ? { provider: opts.provider as ProviderId } : {}),
        ...(opts.instruction ? { instruction: opts.instruction } : {}),
        ...(opts.preserve ? { preserveTerms: opts.preserve.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
        concurrency: Math.max(1, Number(opts.concurrency) || 4),
        onProgress: (done, total) => log.progress(`Translated ${done}/${total} batches`),
      };

      const document = readFileSync(source, 'utf8');
      banner('readme-smith translate', `${path.basename(source)} → ${LOCALE_NAME[to]}`);

      log.step(1, 2, 'Segmenting Markdown');
      const result = await translateMarkdown(document, options);
      log.endProgress();
      log.detail(`Provider: ${result.providerLabel}`);
      const breakdown = [
        result.segmentsUnchanged > 0 ? `${result.segmentsUnchanged} unchanged` : undefined,
        result.segmentsFailed > 0 ? `${result.segmentsFailed} failed` : undefined,
      ].filter(Boolean).join(', ');
      log.detail(`Segments: ${result.segmentsTranslated}/${result.segmentsTotal} translated${breakdown ? ` (${breakdown})` : ''}`);
      if (result.provider === 'none') {
        log.blank();
        if (opts.provider === 'none') {
          log.info('Skipped: --provider none was passed, so the document was left untouched.');
          return;
        }
        log.warn('Nothing was translated. Configure a provider and try again:');
        printProviderHelp();
        return;
      }

      log.step(2, 2, opts.stdout ? 'Writing to stdout' : 'Writing file');
      if (opts.stdout) {
        log.raw(result.text.endsWith('\n') ? result.text : result.text + '\n');
      } else {
        const parsed = path.parse(source);
        const target = opts.out
          ? path.resolve(opts.out)
          : path.join(parsed.dir, `${parsed.name}.${to === 'zh' ? 'zh-CN' : 'en'}${parsed.ext || '.md'}`);

        if (existsSync(target) && !opts.force) {
          throw new Error(`${path.basename(target)} already exists. Re-run with --force to overwrite (a .bak copy is kept).`);
        }
        const { written, backupPath } = writeWithBackup(target, result.text, existsSync(target));
        log.success(`Wrote ${c.cyan(path.relative(process.cwd(), written) || written)}${backupPath ? ` ${c.grey(`(backup: ${path.basename(backupPath)})`)}` : ''}`);
      }

      reportWarnings(result.warnings);
      if (result.segmentsFailed > 0) {
        log.blank();
        log.warn('Some segments were left untranslated. Review the output before publishing.');
      }
    } catch (error) {
      fail(error);
    }
  });

/* ------------------------------------------------------------------ *
 * scan / providers / sections
 * ------------------------------------------------------------------ */

program
  .command('scan')
  .description('print what the scanner detects, without writing anything')
  .argument('[path]', 'project directory to scan', '.')
  .option('--json', 'output the full profile as JSON')
  .option('--skip-git', 'do not read git history')
  .action((inputPath: string, opts: { json?: boolean; skipGit?: boolean }) => {
    try {
      const root = resolveRoot(inputPath);
      const profile = scanProject({ root, skipGit: opts.skipGit });

      if (opts.json) { log.raw(profileToJson(profile) + '\n'); return; }

      banner('readme-smith scan', root);
      const rows: Array<[string, string]> = [
        ['Name', profile.displayName],
        ['Package', profile.name],
        ['Version', profile.version],
        ['Description', profile.description || c.yellow('(none)')],
        ['Language', profile.languages.map((l) => `${l.name} ${l.percent.toFixed(0)}%`).join(', ') || '(none)'],
        ['Ecosystem', profile.ecosystem ?? '(unknown)'],
        ['License', profile.license ? (profile.license.spdx ?? profile.license.family) : c.yellow('(none)')],
        ['Repository', profile.repo.slug ?? '(not a git repo)'],
        ['Shape', profile.features.isCli ? 'CLI' : profile.features.isLibrary ? 'library' : 'application'],
        ['CI', profile.features.hasCI ? profile.features.ciProviders.join(', ') : c.yellow('none')],
        ['Tests', profile.features.hasTests
          ? (profile.features.testFrameworks.join(', ') || 'detected')
          : c.yellow('none')],
        ['Deps', `${profile.dependencies.length} runtime / ${profile.devDependencies.length} dev`],
        ['Size', `${profile.stats.totalFiles} files · ${profile.stats.linesOfCode} LOC`],
      ];
      const width = Math.max(...rows.map(([k]) => k.length));
      for (const [key, value] of rows) log.line(`  ${c.grey(key.padEnd(width))}  ${value}`);

      if (profile.frameworks.length > 0) {
        log.blank();
        log.info(`Detected frameworks: ${profile.frameworks.join(', ')}`);
      }
      if (profile.cli && profile.cli.commands.length > 0) {
        log.blank();
        log.info(`CLI commands: ${profile.cli.commands.map((c2) => c2.name).join(', ')}`);
      }
      if (profile.envVars.length > 0) {
        log.blank();
        log.info(`Environment variables: ${profile.envVars.join(', ')}`);
      }
      reportWarnings(profile.warnings);
    } catch (error) {
      fail(error);
    }
  });

program
  .command('providers')
  .description('show which translation backends are available')
  .action(() => {
    banner('Translation providers', 'checked in preference order');
    const providers = listProviders();
    for (const provider of providers) {
      const mark = provider.available ? c.green('ready  ') : c.grey('missing');
      log.line(`  ${mark} ${c.bold(provider.id.padEnd(6))} ${provider.label}`);
      if (provider.detail) log.line(`           ${c.grey(provider.detail)}`);
    }
    if (!providers.some((p) => p.available)) {
      log.blank();
      printProviderHelp();
    }
  });

program
  .command('sections')
  .description('list the section ids accepted by --sections')
  .action(() => {
    const enabled = new Set<string>(DEFAULT_SECTIONS);
    log.line('');
    for (const id of SECTION_IDS) {
      log.line(`  ${enabled.has(id) ? c.green('+') : c.grey('-')} ${id}`);
    }
    log.line('');
    log.line(c.grey('  + included by default   - available on request'));
    log.line('');
  });

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

function printProviderHelp(): void {
  log.info('Set one of these to enable translation:');
  log.detail(`${c.cyan('DEEPSEEK_API_KEY')} or ${c.cyan('OPENAI_API_KEY')} — best prose quality (LLM provider)`);
  log.detail(`${c.cyan('DASHSCOPE_API_KEY')} / ${c.cyan('MOONSHOT_API_KEY')} / ${c.cyan('ZHIPUAI_API_KEY')} / ${c.cyan('OPENROUTER_API_KEY')} — other OpenAI-compatible LLMs`);
  log.detail(`${c.cyan('README_SMITH_LLM_BASE_URL')} — a local server (Ollama, LM Studio, vLLM); no key needed`);
  log.detail(`${c.cyan('DEEPL_API_KEY')} — DeepL, strong and cheap`);
  log.detail('No key at all — falls back to free public endpoints (lower quality, rate limited)');
}

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  log.error(message);
  if (process.env.README_SMITH_DEBUG && error instanceof Error && error.stack) {
    log.raw(`\n${c.grey(error.stack)}\n`);
  }
  process.exit(1);
}

process.on('unhandledRejection', (reason) => { fail(reason); });

program.parseAsync(process.argv).catch(fail);
