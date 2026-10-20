export * from './types.js';

export { scanFacts, factsToJson, humanizeName } from './facts/index.js';
export type { ScanOptions } from './facts/index.js';
export { detectProjectType, EXPECTED_MANIFESTS } from './facts/project-type.js';
export { analyzeLanguages, languageBar } from './facts/languages.js';
export { detectLicense, licenseMentionedIn } from './facts/license.js';

export {
  README_FILE,
  readReadme,
  parseReadme,
  analyseReadme,
  analyseCodeCommands,
  emptyStandard,
  slugify,
} from './readme/parse.js';
export type { ParsedReadme } from './readme/parse.js';
export { scoreReadme, computeFreshness } from './readme/score.js';
export type { ScoreInput } from './readme/score.js';

export { buildDraft, buildFreshDraft, renderFreshDraft, mergeDraft, requestIntro, validateProse, resolveDraftLanguage } from './draft/index.js';
export type { DraftOptions } from './draft/index.js';
export type { AiSettings, ProseResult } from './draft/index.js';
export { buildFreshDraft as createDraftContent, renderFreshDraft as renderDraft } from './draft/templates.js';
export { findCustomTemplate, renderCustomTemplate, templateVariables } from './draft/custom.js';

export { computeDiff, unifiedExcerpt, diffLines } from './diff/structured.js';

export {
  CONFIG_FILES,
  loadConfig,
  defaultConfig,
  defaultWeights,
  configTemplate,
  initConfig,
} from './config.js';
