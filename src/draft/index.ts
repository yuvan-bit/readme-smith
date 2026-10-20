import path from 'node:path';
import type { DraftLanguage, DraftResult, FactSheet, LanguageSetting, PresetId } from '../types.js';
import { analyseReadme, parseReadme, readReadme } from '../readme/parse.js';
import { buildFreshDraft, renderFreshDraft } from './templates.js';
import { findCustomTemplate, renderCustomTemplate } from './custom.js';
import { mergeDraft } from './merge.js';
import { requestIntro, type AiSettings } from './ai.js';

export interface DraftOptions {
  root: string;
  facts: FactSheet;
  preset: PresetId;
  language: LanguageSetting;
  ai: AiSettings;
  /** Rewrite existing content in the draft instead of only appending missing sections. */
  force?: boolean;
}

export function resolveDraftLanguage(setting: LanguageSetting, existingLanguage: LanguageSetting): DraftLanguage {
  if (setting === 'en' || setting === 'zh') return setting;
  return existingLanguage === 'zh' ? 'zh' : 'en';
}

export async function buildDraft(options: DraftOptions): Promise<DraftResult> {
  const { facts, preset, root } = options;
  const warnings: string[] = [];
  const read = readReadme(root);
  const parsed = parseReadme(read.text);
  const analysis = analyseReadme(root, facts, preset);
  const language = resolveDraftLanguage(options.language, analysis.language);
  const languageExplicit = options.language === 'en' || options.language === 'zh';
  const languageChanged = read.exists &&
    languageExplicit &&
    (analysis.language === 'en' || analysis.language === 'zh') &&
    analysis.language !== language;

  const fresh = buildFreshDraft(facts, preset, language);

  const custom = findCustomTemplate(root, preset, language);
  const useCustom = !!custom && (!read.exists || !!options.force || languageChanged);
  if (custom && !useCustom) {
    warnings.push(`Custom template ${custom.path} is only used for new drafts or with --force; merged sections use the built-in preset.`);
  }

  let aiUsed = false;
  let aiProvider: string | null = null;

  if (useCustom) {
    const rendered = renderCustomTemplate(custom, facts, preset, language);
    warnings.push(...rendered.warnings);
    if (options.ai.backend !== 'off') {
      warnings.push('AI was not used: custom templates are rendered deterministically.');
    }
    return {
      markdown: rendered.markdown,
      language,
      aiUsed,
      aiProvider,
      warnings,
      addedSections: [],
    };
  }

  if (read.exists && !options.force && !languageChanged) {
    if (options.ai.backend !== 'off') {
      warnings.push('AI rewrite was skipped for the existing README; use --force to let AI rewrite the whole draft.');
    }
    const merged = mergeDraft(read.text, parsed, analysis, fresh, facts, preset, language);
    warnings.push(...merged.warnings);
    return {
      markdown: merged.markdown,
      language,
      aiUsed,
      aiProvider,
      warnings,
      addedSections: merged.addedSections,
    };
  }

  if (languageChanged) {
    warnings.push(`--lang ${language} differs from the existing README language; generated a full draft in ${language}. README.md is unchanged.`);
  }

  const prose = await requestIntro(facts, language, options.ai);
  warnings.push(...prose.warnings);
  if (prose.text) {
    fresh.intro = prose.text;
    aiUsed = true;
    aiProvider = prose.provider;
  }
  if (read.exists && options.force) {
    warnings.push('--force generated a fresh draft; README.md itself is untouched and remains the review baseline.');
  }

  return {
    markdown: renderFreshDraft(fresh, language),
    language,
    aiUsed,
    aiProvider,
    warnings,
    addedSections: [],
  };
}

export { buildFreshDraft, renderFreshDraft } from './templates.js';
export { mergeDraft } from './merge.js';
export { requestIntro, validateProse } from './ai.js';
export type { AiSettings, ProseResult } from './ai.js';

/** Absolute path of the draft file for a repository. */
export function draftPath(root: string): string {
  return path.join(root, 'README.draft.md');
}
