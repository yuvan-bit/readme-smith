import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import type { AiBackend, DimensionId, DoctorReport, FactSheet, LoadedConfig, PresetId, ReadmeAnalysis } from '../types.js';
import { defaultWeights, loadConfig } from '../config.js';
import { scanFacts } from '../facts/index.js';
import { analyseReadme } from '../readme/parse.js';
import { log, setVerbosity } from '../utils/logger.js';
import { EXPECTED_MANIFESTS } from '../facts/project-type.js';
import type { AiSettings } from '../draft/ai.js';

export const EXIT = { OK: 0, FAIL: 1, ERROR: 2 } as const;

export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly hint?: string;

  constructor(message: string, code = 'error', exitCode: number = EXIT.ERROR, hint?: string) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.exitCode = exitCode;
    this.hint = hint;
  }
}

export interface CliOptions {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  preset?: string;
  ai?: string;
  minScore?: number;
}

export const PRESET_VALUES: PresetId[] = ['cli', 'lib', 'web', 'monorepo', 'dataset'];
export const AI_VALUES: AiBackend[] = ['local', 'openai', 'off'];

export interface Prepared {
  root: string;
  loaded: LoadedConfig;
  forcedPreset: PresetId | undefined;
  ai: AiSettings;
}

export function applyVerbosity(options: CliOptions): void {
  setVerbosity(options.quiet ? 'quiet' : options.verbose ? 'verbose' : 'normal');
}

export function prepare(rawPath: string | undefined, options: CliOptions): Prepared {
  const root = path.resolve(rawPath ?? process.cwd());
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new CliError(`Not a directory: ${root}`, 'invalid_path', EXIT.ERROR);
  }

  const loaded = loadConfig(root);
  if (!options.quiet) {
    for (const warning of loaded.warnings) log.warn(warning);
  }

  let preset: PresetId | undefined;
  if (options.preset !== undefined) {
    if (!PRESET_VALUES.includes(options.preset as PresetId)) {
      throw new CliError(`Unknown preset "${options.preset}". Expected one of: ${PRESET_VALUES.join(', ')}.`, 'invalid_preset', EXIT.ERROR);
    }
    preset = options.preset as PresetId;
  } else if (loaded.config.preset !== 'auto') {
    preset = loaded.config.preset;
  }

  let backend: AiBackend = loaded.config.ai.backend;
  if (options.ai !== undefined) {
    if (!AI_VALUES.includes(options.ai as AiBackend)) {
      throw new CliError(`Unknown AI backend "${options.ai}". Expected one of: ${AI_VALUES.join(', ')}.`, 'invalid_ai_backend', EXIT.ERROR);
    }
    backend = options.ai as AiBackend;
  }

  return {
    root,
    loaded,
    forcedPreset: preset,
    ai: {
      backend,
      baseUrl: loaded.config.ai.baseUrl,
      model: loaded.config.ai.model,
    },
  };
}

export function effectivePreset(facts: FactSheet): PresetId | null {
  return facts.project.type === 'unknown' ? null : facts.project.type;
}

export function weightsFor(loaded: LoadedConfig, preset: PresetId | null): Record<DimensionId, number> {
  if (loaded.weightsExplicit) return loaded.config.weights;
  return defaultWeights(preset ?? loaded.config.preset);
}

export function scanRepository(root: string, forcedPreset: PresetId | undefined): FactSheet {
  try {
    return scanFacts({ root, ...(forcedPreset ? { preset: forcedPreset } : {}) });
  } catch (error) {
    throw new CliError(`Scan failed: ${error instanceof Error ? error.message : String(error)}`, 'scan_failed', EXIT.ERROR);
  }
}

export function analyse(root: string, facts: FactSheet, preset: PresetId | null): ReadmeAnalysis {
  return analyseReadme(root, facts, preset ?? 'lib');
}

export function requireKnownType(facts: FactSheet): PresetId {
  const preset = effectivePreset(facts);
  if (preset) return preset;
  throw new CliError(
    'Could not recognise the project type.',
    'unknown_project_type',
    EXIT.ERROR,
    `Add one of these manifests at the repository root: ${EXPECTED_MANIFESTS.join(', ')}. Or force a preset with --preset.`,
  );
}

export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

export function printDoctorReport(report: DoctorReport): void {
  const status = report.passed ? 'PASS' : 'FAIL';
  log.line(`README health: ${report.score}/100 (threshold ${report.threshold}) — ${status}`);
  for (const dimension of report.dimensions) {
    log.line(`  ${dimension.label.padEnd(14)} ${String(dimension.score).padStart(3)}/${dimension.max}`);
    for (const issue of dimension.issues) {
      const line = issue.line ? ` (line ${issue.line})` : '';
      log.line(`    - [${issue.code}] ${issue.message}${line}`);
    }
  }
  if (!report.readme.exists) log.line('  README.md does not exist.');
}

export function printWarnings(warnings: string[]): void {
  for (const warning of warnings) log.warn(warning);
}

/** Narrate what the deterministic scanner actually found under `--verbose`. */
export function logScanDetails(facts: FactSheet): void {
  log.debug(`Manifests: ${facts.manifests.map((m) => m.path).join(', ') || 'none'}`);
  log.debug(`Type: ${facts.project.type} (confidence ${facts.project.typeConfidence}); evidence: ${facts.project.typeEvidence.join('; ') || 'none'}`);
  log.debug(`Languages: ${facts.project.languages.map((l) => `${l.name} ${l.percent}%`).join(', ') || 'none'}`);
  log.debug(`Scripts: ${facts.scripts.map((s) => s.invocation).join(', ') || 'none'}`);
  log.debug(`Entry points: ${facts.entryPoints.join(', ') || 'none'}`);
  log.debug(`Environment variables: ${facts.env.map((e) => e.name).join(', ') || 'none'}`);
  log.debug(`CI workflows: ${facts.ci.map((w) => w.file).join(', ') || 'none'}`);
  log.debug(`Config files: ${facts.configFiles.map((c) => c.path).join(', ') || 'none'}`);
}

export function isJson(options: CliOptions): boolean {
  return options.json === true;
}

/** Resolve the threshold, rejecting nonsense values with exit code 2. */
export function resolveThreshold(options: CliOptions, loaded: LoadedConfig): number {
  const raw = options.minScore;
  if (raw === undefined) return loaded.config.minScore;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new CliError(`--min-score must be an integer between 0 and 100 (got ${raw}).`, 'invalid_min_score', EXIT.ERROR);
  }
  return value;
}
