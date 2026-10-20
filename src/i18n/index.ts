import type { Lang, TranslateOptions } from '../types.js';
import { buildGlossary, type Glossary } from './glossary.js';
import {
  reassemble, segmentMarkdown, placeholdersPreserved, restoreInline,
  type SegmentedDocument,
} from './markdown.js';
import {
  runBatches, type ProviderId, type TranslationProvider, type TranslationRequest,
} from './provider.js';
import { LlmProvider, resolveLlmConfig } from './providers/llm.js';
import { DeepLProvider } from './providers/deepl.js';
import { FreeProvider } from './providers/free.js';
import { slugify } from '../generate/markdown.js';

export { buildGlossary, maskGlossary, type Glossary } from './glossary.js';
export { segmentMarkdown, reassemble, protectInline, restoreInline } from './markdown.js';
export { LlmProvider, DeepLProvider, FreeProvider } from './providers/index.js';
export type { TranslationProvider, ProviderId } from './provider.js';

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  available: boolean;
  detail?: string;
  /** Selection priority — lower is preferred. */
  priority: number;
}

/**
 * Probe every provider and report availability.
 * Order encodes preference: LLM (best prose) → DeepL (strong, cheap, no
 * prompt tuning) → free endpoints (keyless but low quality and rate limited).
 */
export function listProviders(): ProviderStatus[] {
  const llm = new LlmProvider();
  const deepl = new DeepLProvider();
  const free = new FreeProvider();

  const llmAvailability = llm.isAvailable();
  const deeplAvailability = deepl.isAvailable();
  const freeAvailability = free.isAvailable();

  return [
    { id: 'llm', label: llm.label, available: llmAvailability.available, detail: llmAvailability.detail, priority: 1 },
    { id: 'deepl', label: deepl.label, available: deeplAvailability.available, detail: deeplAvailability.detail, priority: 2 },
    { id: 'free', label: free.label, available: freeAvailability.available, detail: freeAvailability.detail, priority: 3 },
  ];
}

/** Instantiate a provider by id, or auto-select the best available one. */
export function selectProvider(preference?: ProviderId): { provider: TranslationProvider; auto: boolean } | undefined {
  // `none` is an explicit request to translate nothing, not a missing
  // preference. Treating the two alike made `--provider none` fall through to
  // auto-selection and quietly call a public endpoint.
  if (preference === 'none') return undefined;
  if (preference) {
    const provider = instantiate(preference);
    return provider ? { provider, auto: false } : undefined;
  }
  const ranked = listProviders().filter((p) => p.available).sort((a, b) => a.priority - b.priority);
  const best = ranked[0];
  if (!best) return undefined;
  const provider = instantiate(best.id);
  return provider ? { provider, auto: true } : undefined;
}

function instantiate(id: ProviderId): TranslationProvider | undefined {
  switch (id) {
    case 'llm': return resolveLlmConfig() ? new LlmProvider() : undefined;
    case 'deepl': {
      const provider = new DeepLProvider();
      return provider.isAvailable().available ? provider : undefined;
    }
    case 'free': {
      const provider = new FreeProvider();
      return provider.isAvailable().available ? provider : undefined;
    }
    case 'none': return undefined;
  }
}

/* ------------------------------------------------------------------ *
 * Language detection
 * ------------------------------------------------------------------ */

/**
 * Cheap script-based detection for the `from: 'auto'` case.
 * Counting CJK characters against Latin letters is sufficient because we only
 * ever need to distinguish English from Chinese, and the two use disjoint
 * scripts.
 */
export function detectLanguage(text: string): Lang {
  let cjk = 0;
  let latin = 0;
  for (const char of text) {
    if (/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(char)) cjk++;
    else if (/[A-Za-z]/.test(char)) latin++;
  }
  if (cjk === 0 && latin === 0) return 'en';
  return cjk / (cjk + latin) > 0.12 ? 'zh' : 'en';
}

/* ------------------------------------------------------------------ *
 * Document translation
 * ------------------------------------------------------------------ */

export interface TranslateResult {
  text: string;
  provider: ProviderId | 'none';
  providerLabel: string;
  from: Lang;
  to: Lang;
  segmentsTotal: number;
  segmentsTranslated: number;
  /** Segments the provider dropped or failed — still in the source language. */
  segmentsFailed: number;
  /**
   * Segments the provider returned verbatim. Usually nothing was worth
   * translating (a heading that is one product name, a line of identifiers);
   * reporting these as failures would tell the user their provider broke when
   * it did nothing wrong.
   */
  segmentsUnchanged: number;
  warnings: string[];
}

/**
 * Translate a whole Markdown document.
 *
 * Pipeline: segment → protect code/badges/links → batch-translate the
 * translatable blocks → validate placeholders → restore → rewrite internal
 * anchor links so the table of contents still resolves against the translated
 * headings.
 */
export async function translateMarkdown(
  document: string,
  options: TranslateOptions,
): Promise<TranslateResult> {
  const warnings: string[] = [];
  const from: Lang = options.from === 'auto' ? detectLanguage(document) : options.from;
  const to = options.to;
  // Segmentation works on LF. Remember the caller's convention so translating
  // a CRLF file does not rewrite every line ending (and every git diff).
  const usesCrlf = document.includes('\r\n');

  if (from === to) {
    return {
      text: document,
      provider: 'none',
      providerLabel: 'no-op',
      from,
      to,
      segmentsTotal: 0,
      segmentsTranslated: 0,
      segmentsFailed: 0,
      segmentsUnchanged: 0,
      warnings: [`Source is already ${to === 'zh' ? 'Chinese' : 'English'}; nothing to translate.`],
    };
  }

  const selected = selectProvider(options.provider);
  if (!selected) {
    warnings.push(
      options.provider === 'none'
        ? 'Translation was disabled (--provider none); the document was left untouched.'
        : options.provider
          ? `Requested provider "${options.provider}" is not configured. ${describeMissing(options.provider)}`
          : `No translation provider is configured. ${describeMissing()}`,
    );
    return {
      text: document,
      provider: 'none',
      providerLabel: 'unavailable',
      from,
      to,
      segmentsTotal: 0,
      segmentsTranslated: 0,
      segmentsFailed: 0,
      segmentsUnchanged: 0,
      warnings,
    };
  }
  if (selected.provider.id === 'free') {
    warnings.push('Using a free public endpoint: quality is lower than an LLM or DeepL, and requests are rate limited. Set OPENAI_API_KEY / DEEPSEEK_API_KEY / DEEPL_API_KEY for better results.');
  }
  if (selected.auto) {
    warnings.push(`Auto-selected provider: ${selected.provider.label}.`);
  }

  const glossary: Glossary = buildGlossary(to, options.glossary ?? {}, options.preserveTerms ?? []);
  const segmented: SegmentedDocument = segmentMarkdown(document);

  const translatable = segmented.blocks
    .map((block, index) => ({ block, index }))
    .filter((entry) => entry.block.kind === 'translate');

  if (translatable.length === 0) {
    warnings.push('The document contains no translatable prose (only code, badges and links).');
    return {
      text: document,
      provider: selected.provider.id,
      providerLabel: selected.provider.label,
      from,
      to,
      segmentsTotal: 0,
      segmentsTranslated: 0,
      segmentsFailed: 0,
      segmentsUnchanged: 0,
      warnings,
    };
  }

  const request: TranslationRequest = {
    from,
    to,
    glossary,
    ...(options.instruction ? { instruction: options.instruction } : {}),
  };

  const sources = translatable.map((entry) => entry.block.text);
  const maxChars = selected.provider.id === 'free' ? 1200 : 12_000;
  const translated = await runBatches(sources, maxChars, options.concurrency, async (batch) => {
    const result = await selected.provider.translate(batch, request);
    // A provider returning the wrong shape must not shift segments out of place.
    if (result.length !== batch.length) throw new Error('provider returned a mismatched batch length');
    return result;
  }, options.onProgress);

  const mapped = new Map<number, string>();
  let translatedCount = 0;
  let failedCount = 0;
  let unchangedCount = 0;
  translatable.forEach((entry, i) => {
    const value = translated[i];
    // `undefined` cannot happen through runBatches today, but the index is
    // provider-supplied; guarding it keeps a hostile provider from silently
    // deleting a segment.
    if (value === undefined || !placeholdersPreserved(entry.block.text, value)) { failedCount++; return; }
    mapped.set(entry.index, value);
    if (value === entry.block.text) unchangedCount++;
    else translatedCount++;
  });

  // Rewrite `](#anchor)` links so the TOC matches the translated headings.
  const anchorMap = buildAnchorMap(segmented, mapped);
  let output = reassemble(segmented, mapped);
  if (anchorMap.size > 0) {
    output = rewriteAnchors(output, anchorMap);
  }

  if (failedCount > 0) {
    warnings.push(`${failedCount} of ${translatable.length} segments were left in ${from === 'zh' ? 'Chinese' : 'English'}: the provider failed or dropped protected spans.`);
  }
  // Verbatim segments are reported through `segmentsUnchanged`, not here:
  // `warnings` lists things a human should act on, and a heading that is only
  // a product name coming back unchanged is not one.

  return {
    text: usesCrlf ? output.replace(/\n/g, '\r\n') : output,
    provider: selected.provider.id,
    providerLabel: selected.provider.label,
    from,
    to,
    segmentsTotal: translatable.length,
    segmentsTranslated: translatedCount,
    segmentsFailed: failedCount,
    segmentsUnchanged: unchangedCount,
    warnings,
  };
}

function describeMissing(requested?: ProviderId): string {
  const hint = requested === 'deepl'
    ? 'Set DEEPL_API_KEY to enable DeepL.'
    : requested === 'llm'
      ? 'Set OPENAI_API_KEY (or DEEPSEEK_API_KEY / DASHSCOPE_API_KEY / README_SMITH_LLM_BASE_URL) to enable an LLM provider.'
      : 'Run `readme-smith providers` to see what is configured.';
  return hint;
}

/**
 * Map original heading anchors to translated ones.
 * Headings are matched positionally, which is safe because translation never
 * reorders blocks.
 */
function buildAnchorMap(segmented: SegmentedDocument, translated: Map<number, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const heading of segmented.headings) {
    const block = segmented.blocks[heading.blockIndex];
    if (!block || block.kind !== 'translate') continue;
    const placeholders = block.placeholders ?? [];
    const originalText = restoreInline(block.text, placeholders);
    const translatedText = translated.has(heading.blockIndex)
      ? restoreInline(translated.get(heading.blockIndex)!, placeholders)
      : originalText;
    const originalSlug = slugify(originalText);
    const newSlug = slugify(translatedText);
    if (originalSlug && newSlug && originalSlug !== newSlug) map.set(originalSlug, newSlug);
  }
  return map;
}

/** Replace `](#old-slug)` with `](#new-slug)` for every translated heading. */
function rewriteAnchors(document: string, anchorMap: Map<string, string>): string {
  return document.replace(/\]\(#([^)\s]+)\)/g, (match, slug: string) => {
    const decoded = decodeURIComponent(slug);
    const replacement = anchorMap.get(decoded) ?? anchorMap.get(slug);
    return replacement ? `](#${encodeURIComponent(replacement)})` : match;
  });
}

/** Translate a single plain-text string (used for descriptions and taglines). */
export async function translateText(text: string, options: TranslateOptions): Promise<string> {
  if (!text.trim()) return text;
  const result = await translateMarkdown(text, options);
  return result.text;
}
