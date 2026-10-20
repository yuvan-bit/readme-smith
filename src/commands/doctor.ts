import { scoreReadme } from '../readme/score.js';
import { log } from '../utils/logger.js';
import {
  analyse,
  applyVerbosity,
  effectivePreset,
  EXIT,
  logScanDetails,
  prepare,
  printDoctorReport,
  printJson,
  resolveThreshold,
  scanRepository,
  weightsFor,
  type CliOptions,
} from './shared.js';

export function runDoctor(rawPath: string | undefined, options: CliOptions): number {
  applyVerbosity(options);
  const prepared = prepare(rawPath, options);
  const facts = scanRepository(prepared.root, prepared.forcedPreset);
  logScanDetails(facts);
  const preset = effectivePreset(facts);
  const analysis = analyse(prepared.root, facts, preset);
  const threshold = resolveThreshold(options, prepared.loaded);
  const report = scoreReadme({
    facts,
    analysis,
    root: prepared.root,
    weights: weightsFor(prepared.loaded, preset),
    preset: preset ?? 'lib',
    threshold,
  });

  if (options.json) printJson(report);
  else if (options.quiet) {
    log.line(`README health: ${report.score}/100 (threshold ${report.threshold}) — ${report.passed ? 'PASS' : 'FAIL'}`);
  } else printDoctorReport(report);

  return report.passed ? EXIT.OK : EXIT.FAIL;
}
