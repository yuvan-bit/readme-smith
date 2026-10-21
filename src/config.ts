import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { AiBackend, DimensionId, LanguageSetting, LoadedConfig, PresetId, SmithConfig } from './types.js';
import { exists, readTextSafe, writeTextSafe } from './utils/fs.js';

export const CONFIG_FILES = ['.readme-smith.yaml', '.readme-smith.yml'];

const DIMENSIONS: DimensionId[] = ['completeness', 'usability', 'accuracy', 'readability', 'freshness'];

/**
 * Converts any positive weight mix into integers that sum to exactly 100.
 * Relative weights such as 2/1/1/1/1 are therefore valid configuration.
 */
export function normalizeWeights(weights: Record<DimensionId, number>): Record<DimensionId, number> | null {
  const total = DIMENSIONS.reduce((sum, dim) => sum + weights[dim], 0);
  if (!Number.isFinite(total) || total <= 0) return null;

  const parts = DIMENSIONS.map((dim) => {
    const exact = (weights[dim] / total) * 100;
    const floor = Math.floor(exact);
    return { dim, weight: floor, remainder: exact - floor };
  });
  let remaining = 100 - parts.reduce((sum, part) => sum + part.weight, 0);
  const byRemainder = [...parts].sort(
    (a, b) => b.remainder - a.remainder || DIMENSIONS.indexOf(a.dim) - DIMENSIONS.indexOf(b.dim),
  );
  for (let i = 0; i < remaining; i += 1) byRemainder[i]!.weight += 1;

  const normalized = {} as Record<DimensionId, number>;
  for (const part of parts) normalized[part.dim] = part.weight;
  return normalized;
}

export function defaultWeights(preset: PresetId | 'auto'): Record<DimensionId, number> {
  if (preset === 'dataset') {
    return { completeness: 40, usability: 20, accuracy: 20, readability: 10, freshness: 10 };
  }
  if (preset === 'web') {
    return { completeness: 30, usability: 30, accuracy: 20, readability: 10, freshness: 10 };
  }
  return { completeness: 35, usability: 25, accuracy: 20, readability: 10, freshness: 10 };
}

export function defaultConfig(preset: PresetId | 'auto' = 'auto'): SmithConfig {
  return {
    version: 1,
    preset,
    language: 'auto',
    minScore: 80,
    ai: { backend: 'local', baseUrl: null, model: null },
    weights: defaultWeights(preset),
  };
}

const PRESETS: Array<PresetId | 'auto'> = ['auto', 'cli', 'lib', 'web', 'monorepo', 'dataset'];
const LANGUAGES: LanguageSetting[] = ['auto', 'en', 'zh'];
const AI_BACKENDS: AiBackend[] = ['local', 'openai', 'off'];

export function loadConfig(root: string): LoadedConfig {
  const filename = CONFIG_FILES.find((f) => exists(root, f));
  const warnings: string[] = [];
  const base = defaultConfig();
  if (!filename) return { config: base, path: null, warnings, weightsExplicit: false };

  const text = readTextSafe(path.join(root, filename));
  if (text === undefined) {
    warnings.push(`Could not read ${filename}; using defaults.`);
    return { config: base, path: filename, warnings, weightsExplicit: false };
  }
  let doc: Record<string, unknown>;
  try {
    doc = (parseYaml(text) ?? {}) as Record<string, unknown>;
  } catch (error) {
    warnings.push(`Could not parse ${filename}: ${(error as Error).message.split('\n')[0]}. Using defaults.`);
    return { config: base, path: filename, warnings, weightsExplicit: false };
  }
  if (!doc || typeof doc !== 'object') {
    warnings.push(`${filename} is empty; using defaults.`);
    return { config: base, path: filename, warnings, weightsExplicit: false };
  }

  const preset = asPreset(doc.preset);
  if (preset === undefined) warnings.push(`${filename}: unknown preset "${String(doc.preset)}"; using auto.`);
  const effectivePreset = preset ?? 'auto';
  const config = defaultConfig(effectivePreset);

  const language = asLanguage(doc.language);
  if (doc.language !== undefined && language === undefined) warnings.push(`${filename}: language must be auto, en or zh.`);
  if (language) config.language = language;

  if (doc.minScore !== undefined) {
    const n = Number(doc.minScore);
    if (Number.isFinite(n) && n >= 0 && n <= 100) config.minScore = Math.round(n);
    else warnings.push(`${filename}: minScore must be between 0 and 100.`);
  }

  const rawAi = doc.ai;
  if (rawAi && typeof rawAi === 'object') {
    const ai = rawAi as Record<string, unknown>;
    if (ai.backend !== undefined) {
      const backend = AI_BACKENDS.find((b) => b === ai.backend);
      if (backend) config.ai.backend = backend;
      else warnings.push(`${filename}: ai.backend must be local, openai or off.`);
    }
    if (typeof ai.baseUrl === 'string' && ai.baseUrl.trim()) config.ai.baseUrl = ai.baseUrl.trim();
    if (typeof ai.model === 'string' && ai.model.trim()) config.ai.model = ai.model.trim();
  }

  const rawWeights = (doc.weights ?? (doc.score as Record<string, unknown> | undefined)?.weights) as Record<string, unknown> | undefined;
  let weightsExplicit = false;
  if (rawWeights && typeof rawWeights === 'object' && !Array.isArray(rawWeights)) {
    const provided: Partial<Record<DimensionId, number>> = {};
    let providedAny = false;
    for (const dim of DIMENSIONS) {
      const raw = rawWeights[dim];
      if (raw === undefined) continue;
      providedAny = true;
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : Number.NaN;
      if (Number.isFinite(n) && n >= 0) provided[dim] = n;
      else warnings.push(`${filename}: weight "${dim}" must be a finite number greater than or equal to 0.`);
    }

    if (Object.keys(provided).length === 0) {
      if (providedAny) warnings.push(`${filename}: no usable weights; using preset defaults.`);
    } else {
      const normalized = normalizeWeights({ ...config.weights, ...provided });
      if (normalized) {
        config.weights = normalized;
        weightsExplicit = true;
      } else {
        warnings.push(`${filename}: weights must contain at least one positive value; using preset defaults.`);
      }
    }
  }

  return { config, path: filename, warnings, weightsExplicit };
}

function asPreset(value: unknown): PresetId | 'auto' | undefined {
  return PRESETS.find((p) => p === value);
}

function asLanguage(value: unknown): LanguageSetting | undefined {
  return LANGUAGES.find((l) => l === value);
}

export function configTemplate(): string {
  return `# readme-smith configuration — https://github.com/yuvan-bit/readme-smith
version: 1

# Project preset: auto | cli | lib | web | monorepo | dataset
preset: auto

# Draft language: auto (follow the current README) | en | zh
language: auto

# Minimum score for \`readme-smith doctor\` and \`readme-smith check\` to exit 0.
minScore: 80

# AI is optional. local = Ollama/OpenAI-compatible on this machine,
# openai = explicit cloud opt-in, off = deterministic templates only.
ai:
  backend: local
  baseUrl: null
  model: null

# Weights can be any relative values; they are normalized to 100.
# Omitted dimensions inherit the preset defaults. Set a dimension to 0 to exclude it.
weights:
  completeness: 35
  usability: 25
  accuracy: 20
  readability: 10
  freshness: 10
`;
}

export function initConfig(root: string, force: boolean): { path: string; created: boolean } {
  const filename = CONFIG_FILES[0]!;
  const abs = path.join(root, filename);
  if (exists(root, filename) && !force) return { path: filename, created: false };
  if (!writeTextSafe(abs, configTemplate())) {
    throw new Error(`Could not write ${filename}`);
  }
  return { path: filename, created: true };
}
