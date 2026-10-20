import path from 'node:path';
import { appendFileSync } from 'node:fs';
import type { StructuredDiff } from '../types.js';
import { scoreReadme } from '../readme/score.js';
import { computeDiff } from '../diff/structured.js';
import { buildDraft } from '../draft/index.js';
import { README_FILE } from '../readme/parse.js';
import { EXPECTED_MANIFESTS } from '../facts/project-type.js';
import { headCommitMessage } from '../utils/git.js';
import { readTextSafe } from '../utils/fs.js';
import { log } from '../utils/logger.js';
import {
  analyse,
  effectivePreset,
  EXIT,
  logScanDetails,
  prepare,
  printJson,
  resolveThreshold,
  scanRepository,
  weightsFor,
  applyVerbosity,
  type CliOptions,
} from './shared.js';

export interface CheckReport {
  passed: boolean;
  skipped: boolean;
  score: number;
  threshold: number;
  reasons: string[];
  doctor: ReturnType<typeof scoreReadme>;
  diff: StructuredDiff;
  draftWarnings: string[];
}

export async function runCheck(rawPath: string | undefined, options: CliOptions): Promise<number> {
  applyVerbosity(options);
  const prepared = prepare(rawPath, options);
  const facts = scanRepository(prepared.root, prepared.forcedPreset);
  logScanDetails(facts);
  const preset = effectivePreset(facts);
  const analysis = analyse(prepared.root, facts, preset);
  const threshold = resolveThreshold(options, prepared.loaded);
  const doctor = scoreReadme({
    facts,
    analysis,
    root: prepared.root,
    weights: weightsFor(prepared.loaded, preset),
    preset: preset ?? 'lib',
    threshold,
  });

  const draft = await buildDraft({
    root: prepared.root,
    facts,
    preset: preset ?? 'lib',
    language: prepared.loaded.config.language,
    ai: { backend: 'off', baseUrl: null, model: null },
  });
  const readme = readTextSafe(path.join(prepared.root, README_FILE)) ?? '';
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

  const skipped = /#rf-skip\b/i.test(headCommitMessage(prepared.root) ?? '');
  const passed = skipped || reasons.length === 0;
  const report: CheckReport = {
    passed,
    skipped,
    score: doctor.score,
    threshold,
    reasons,
    doctor,
    diff,
    draftWarnings: draft.warnings,
  };

  if (options.json) printJson(report);
  else if (options.quiet) {
    const status = report.skipped ? 'SKIPPED (#rf-skip)' : report.passed ? 'PASS' : 'FAIL';
    log.line(`README check: ${status} — ${report.score}/100 (threshold ${report.threshold})`);
  } else printCheckReport(report, doctor.missing.map((i) => i.message));
  appendGithubSummary(report);

  return passed ? EXIT.OK : EXIT.FAIL;
}

function printCheckReport(report: CheckReport, missing: string[]): void {
  const status = report.skipped ? 'SKIPPED (#rf-skip)' : report.passed ? 'PASS' : 'FAIL';
  log.line(`README check: ${status} — ${report.score}/100 (threshold ${report.threshold})`);
  if (report.skipped && report.reasons.length > 0) {
    log.line('  The skip marker requests manual review; the findings below are still reported.');
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
