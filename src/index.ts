/**
 * Public API — everything the CLI does is reachable programmatically.
 */

export { scanProject, profileToJson, humanizeName, type ScanOptions } from './scanner/index.js';
export {
  generateReadmes, renderReadme, defaultOptions, LOCALE_FILENAME, LOCALE_NAME,
  DEFAULT_SECTIONS, SECTION_IDS, type RenderedReadme,
} from './generate/index.js';
export { makeContext, renderSections, TOC_SENTINEL, OVERRIDABLE_SECTION_IDS } from './generate/sections.js';
export { loadSectionOverrides, OVERRIDE_DIR, type LoadedOverrides } from './generate/overrides.js';
export { collectBadges, renderBadge, renderBadgeRow, renderLanguageSwitcher, shieldsUrl } from './generate/badges.js';
export { buildDiagrams, architectureDiagram, dependencyDiagram, cliFlowDiagram, workflowDiagram } from './generate/mermaid.js';
export { slugify, table, code, buildToc } from './generate/markdown.js';
export {
  translateMarkdown, translateText, detectLanguage, listProviders, selectProvider,
  buildGlossary, segmentMarkdown, reassemble,
  type TranslateResult, type ProviderStatus, type Glossary,
} from './i18n/index.js';
export { makeT, translate, EN, ZH, DICT_KEYS, type DictKey, type Dict } from './i18n/dict.js';
export * from './types.js';
