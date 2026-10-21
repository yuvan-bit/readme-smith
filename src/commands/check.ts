import path from 'node:path';
import { appendFileSync } from 'node:fs';
import type {
  DoctorReport,
  FactSheet,
  LoadedConfig,
  PresetId,
  ReadmeAnalysis,
  StructuredDiff,
} from '../types.js';
import { scoreReadme } from '../readme/score.js';
import { computeDiff } from '../diff/structured.js';
import { buildDraft } from '../draft/index.js';
import { README_FILE } from '../readme/parse.js';
import { EXPECTED_MANIFESTS } from '../facts/project-type.js';
import { affectedPackageTargets } from '../ci/affected.js';
import { changedFiles, headCommitMessage } from '../utils/git.js';
import { readTextSafe } from '../utils/fs.js';
import { log } from '../utils/logger.js';
import {
  analyse,
  effectivePreset,
  EXIT,
  CliError,
  logScanDetails,
  prepare,
  printJson,
  resolveThreshold,
  scanRepository,
  weightsFor,
  applyVerbosity,
  type CliOptions,
} from './shared.js';

export interface CheckOptions extends CliOptions {
  changed?: boolean;
  base?: string;
}

export interface CheckTargetReport {
  path: string;
  score: number;
  threshold: number;
  passed: boolean;
  skipped: boolean;
  reasons: string[];
  missing: string[];
}

export interface CheckReport {
  passed: boolean;
  skipped: boolean;
  score: number;
  threshold: number;
  reasons: string[];
  doctor: DoctorReport;
  diff: StructuredDiff;
  draftWarnings: string[];
  affected: CheckTargetReport[];
  /** Git revision used by --changed. */
  base?: string;
}

interface Evaluation {
  facts: FactSheet;
  preset: PresetId | null;
  analysis: ReadmeAnalysis;
  doctor: DoctorReport;
  diff: StructuredDiff;
  reasons: string[];
  draftWarnings: string[];
}

async function evaluateRepository(
  root: string,
  loaded: LoadedConfig,
  threshold: number,
  forcedPreset: PresetId | undefined,
  narrate: boolean,
): Promise<Evaluation> {
  const facts = scanRepository(root, forcedPreset);
  if (narrate) logScanDetails(facts);
  const preset = effectivePreset(facts);
  const analysis = analyse(root, facts, preset);
  const doctor = scoreReadme({
    facts,
    analysis,
    root,
    weights: weightsFor(loaded, preset),
    preset: preset ?? 'lib',
    threshold,
  });

  const draft = await buildDraft({
    root,
    facts,
    preset: preset ?? 'lib',
    language: loaded.config.language,
    ai: { backend: 'off', baseUrl: null, model: null },
  });
  const readme = readTextSafe(path.join(root, README_FILE)) ?? '';
  const diff = computeDiff(readme, draft.markdown);

  const reasons: string[] = [];
  if (!preset) {
    reasons.push(`Project type is unknown. Add one of: ${EXPECTED_MANIFESTS.join(', ')}.`);
  }
  if (!analysis.exists) reasons.push('README.md does not exist.');
  if (doctor.score < threshold) {
    reasons.push(`Score ${doctor.score} is below the threshold ${threshold}.`);
  }
  if (diff.hasChanges) {
    reasons.push(`README.md differs from the deterministic draft in ${diff.changes.length} section(s).`);
  }

  return { facts, preset, analysis, doctor, diff, reasons, draftWarnings: draft.warnings };
}

export async function runCheck(rawPath: string | undefined, options: CheckOptions): Promise<number> {
  applyVerbosity(options);
  const prepared = prepare(rawPath, options);
  const threshold = resolveThreshold(options, prepared.loaded);
  const evaluated = await evaluateRepository(
    prepared.root,
    prepared.loaded,
    threshold,
    prepared.forcedPreset,
    true,
  );

  const skipped = /#rf-skip\b/i.test(headCommitMessage(prepared.root) ?? '');
  const reasons = [...evaluated.reasons];
  const affected: CheckTargetReport[] = [];
  let base: string | undefined;

  if (options.changed) {
    if (!evaluated.facts.git.isGit) {
      throw new CliError(
        '--changed requires a git repository.',
        'changed_requires_git',
        EXIT.ERROR,
        'Initialise git or omit --changed.',
      );
    }
    base = (options.base ?? '').trim() || 'HEAD^';
    const changed = changedFiles(prepared.root, base);
    if (changed === null) {
      throw new CliError(
        `Cannot resolve git revision "${base}" for --changed.`,
        'git_base_not_found',
        EXIT.ERROR,
        'Fetch more history or pass --base <ref>.',
      );
    }

    for (const target of affectedPackageTargets(prepared.root, changed)) {
      const evaluation = await evaluateRepository(
        path.resolve(prepared.root, target),
        prepared.loaded,
        threshold,
        undefined,
        false,
      );
      affected.push({
        path: target,
        score: evaluation.doctor.score,
        threshold,
        passed: skipped || evaluation.reasons.length === 0,
        skipped,
        reasons: evaluation.reasons,
        missing: [...new Set(evaluation.doctor.missing.map((issue) => issue.message))],
      });
      for (const reason of evaluation.reasons) reasons.push(`[${target}] ${reason}`);
    }
  }

  const passed = skipped || reasons.length === 0;
  const report: CheckReport = {
    passed,
    skipped,
    score: evaluated.doctor.score,
    threshold,
    reasons,
    doctor: evaluated.doctor,
    diff: evaluated.diff,
    draftWarnings: evaluated.draftWarnings,
    affected,
    ...(base ? { base } : {}),
  };

  if (options.json) printJson(report);
  else if (options.quiet) {
    const status = report.skipped ? 'SKIPPED (#rf-skip)' : report.passed ? 'PASS' : 'FAIL';
    log.line(`README check: ${status} — ${report.score}/100 (threshold ${report.threshold})`);
  } else printCheckReport(report, evaluated.doctor.missing.map((i) => i.message));
  appendGithubSummary(report);

  return passed ? EXIT.OK : EXIT.FAIL;
}

function printCheckReport(report: CheckReport, missing: string[]): void {
  const status = report.skipped ? 'SKIPPED (#rf-skip)' : report.passed ? 'PASS' : 'FAIL';
  log.line(`README check: ${status} — ${report.score}/100 (threshold ${report.threshold})`);
  if (report.skipped && report.reasons.length > 0) {
    log.line('  The skip marker requests manual review; the findings below are still reported.');
  }
  if (report.base) {
    if (report.affected.length > 0) {
      log.line('  Affected packages:');
      for (const target of report.affected) {
        log.line(`    ${target.passed ? 'PASS' : 'FAIL'} ${target.path} — ${target.score}/100`);
      }
    } else {
      log.line(`  No package manifests or package READMEs changed since ${report.base}.`);
    }
  }
  const uniqueMissing = [...new Set(missing)].slice(0, 12);
  if (uniqueMissing.length > 0) {
    log.line('  Missing:');
    for (const item of uniqueMissing) log.line(`    - ${item}`);
  }
  if (report.diff.hasChanges) {
    log.line('  Draft differences:');
    for (const change of report.diff.changes.slice(0, 12)) {
      const mark = change.kind === 'added' ? '+' : change.kind === 'removed' ? '-' : '~';
      log.line(`    ${mark} ${change.title} (+${change.added} -${change.removed})`);
    }
  }
  for (const reason of report.reasons) log.line(`  - ${reason}`);
}

function appendGithubSummary(report: CheckReport): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const status = report.skipped ? 'skipped (#rf-skip)' : report.passed ? 'passed' : 'failed';
  const lines = [
    `## readme-smith check: ${status}`,
    '',
    `Score: **${report.score}/100** (threshold ${report.threshold})`,
  ];
  if (report.base) {
    lines.push('', `Comparison base: \`${report.base}\``);
    if (report.affected.length > 0) {
      lines.push(
        '',
        '### Affected packages',
        ...report.affected.map((target) => `- ${target.passed ? 'pass' : 'fail'}: \`${target.path}\` — ${target.score}/100`),
      );
      const affectedMissing = report.affected.flatMap((target) =>
        target.missing.slice(0, 5).map((message) => `- \`${target.path}\`: ${message}`),
      );
      if (affectedMissing.length > 0) {
        lines.push('', '### Affected package findings', ...affectedMissing);
      }
    } else {
      lines.push('', 'No package manifests or package READMEs changed.');
    }
  }
  if (report.reasons.length > 0) {
    lines.push('', '### Findings', ...report.reasons.map((r) => `- ${r}`));
  }
  const missing = [...new Set(report.doctor.missing.map((i) => i.message))].slice(0, 15);
  if (missing.length > 0) {
    lines.push('', '### Missing', ...missing.map((m) => `- ${m}`));
  }
  if (report.diff.hasChanges) {
    lines.push('', '### Draft sections', ...report.diff.changes.slice(0, 15).map((c) => `- ${c.kind}: ${c.title}`));
  }
  try {
    appendFileSync(file, lines.join('\n') + '\n');
  } catch {
    /* A missing summary file must never fail the check itself. */
  }
}
