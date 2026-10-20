import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { AiBackend, DimensionId, LanguageSetting, LoadedConfig, PresetId, SmithConfig } from './types.js';
import { exists, readTextSafe, writeTextSafe } from './utils/fs.js';

export const CONFIG_FILES = ['.readme-smith.yaml', '.readme-smith.yml'];

const DIMENSIONS: DimensionId[] = ['completeness', 'usability', 'accuracy', 'readability', 'freshness'];

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
  if (rawWeights && typeof rawWeights === 'object') {
    const weights = { ...config.weights };
    for (const dim of DIMENSIONS) {
      if (rawWeights[dim] === undefined) continue;
      const n = Number(rawWeights[dim]);
      if (Number.isFinite(n) && n >= 0 && n <= 100) weights[dim] = n;
      else warnings.push(`${filename}: weight "${dim}" must be between 0 and 100.`);
    }
    const sum = DIMENSIONS.reduce((s, d) => s + weights[d], 0);
    if (Math.abs(sum - 100) < 0.01) {
      config.weights = weights;
      weightsExplicit = true;
    } else {
      warnings.push(`${filename}: weights must sum to 100 (got ${sum}); using defaults.`);
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
  return `# readme-smith configuration — https://gitee.com/yuwan41064/readme-smith
version: 1

# Project preset: auto | cli | lib | web | monorepo | dataset
preset: auto

# Draft language: auto (follow the current README) | en | zh
language: auto

# Minimum score for \`rf doctor\` and \`rf check\` to exit 0.
minScore: 80

# AI is optional. local = Ollama/OpenAI-compatible on this machine,
# openai = explicit cloud opt-in, off = deterministic templates only.
ai:
  backend: local
  baseUrl: null
  model: null

# Weights must sum to 100.
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
