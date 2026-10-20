import type { AvailabilityResult, TranslationProvider, TranslationRequest } from '../provider.js';
import { LANG_CODES, fetchWithTimeout } from '../provider.js';
import { placeholdersPreserved } from '../markdown.js';
import { maskGlossary } from '../glossary.js';

/**
 * Keyless provider — the "works out of the box, no account" fallback.
 *
 * Honest caveats, also surfaced to the user at runtime:
 *  - Both endpoints used here are public/unofficial and carry no availability
 *    guarantee. They are rate limited and will start returning errors or
 *    truncated text under sustained load.
 *  - Quality is markedly below a real LLM or DeepL for idiomatic prose.
 *  - Do not use this for high-volume or commercial translation; get a key.
 *
 * It exists so that a first-time user gets a bilingual README immediately,
 * then upgrades to a keyed provider when they care about quality.
 */

export interface FreeProviderConfig {
  /** Delay between requests, to stay under informal rate limits. */
  throttleMs?: number;
  timeoutMs?: number;
  /** Disable the Google endpoint (e.g. when blocked in the user's region). */
  disableGoogle?: boolean;
  disableMyMemory?: boolean;
}

type Engine = 'google' | 'mymemory';

export class FreeProvider implements TranslationProvider {
  readonly id = 'free' as const;
  readonly label = 'Free public endpoint';
  private readonly config: FreeProviderConfig;
  private lastRequestAt = 0;
  /**
   * Consecutive failures per engine.
   *
   * Both endpoints are unofficial and one of them is routinely blocked in some
   * networks. Without this, every batch paid the full timeout twice: a 12 KB
   * README took ten minutes to fail slowly. After two consecutive failures an
   * engine is skipped for the rest of the run, so a dead endpoint costs one
   * timeout instead of one per batch.
   */
  private readonly failures = new Map<Engine, number>();

  constructor(config: FreeProviderConfig = {}) {
    this.config = {
      throttleMs: 350,
      timeoutMs: 25_000,
      disableGoogle: process.env.README_SMITH_DISABLE_GOOGLE === '1',
      disableMyMemory: process.env.README_SMITH_DISABLE_MYMEMORY === '1',
      ...config,
    };
  }

  isAvailable(): AvailabilityResult {
    const google = !this.config.disableGoogle;
    const mymemory = !this.config.disableMyMemory;
    if (!google && !mymemory) return { available: false, detail: 'Both free endpoints are disabled.' };
    const engines = [google ? 'Google' : '', mymemory ? 'MyMemory' : ''].filter(Boolean).join(' + ');
    return {
      available: true,
      detail: `${engines} — no API key required, but quality is lower and requests are rate limited.`,
    };
  }

  private async throttle(signal?: AbortSignal): Promise<void> {
    const wait = this.config.throttleMs ?? 350;
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < wait) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, wait - elapsed);
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
      });
    }
    this.lastRequestAt = Date.now();
  }

  private async googleTranslate(text: string, from: string, to: string, signal?: AbortSignal): Promise<string> {
    await this.throttle(signal);
    const url = new URL('https://translate.googleapis.com/translate_a/single');
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', from);
    url.searchParams.set('tl', to);
    url.searchParams.set('dt', 't');
    url.searchParams.set('q', text);

    const response = await fetchWithTimeout(url.toString(), { method: 'GET' }, this.config.timeoutMs ?? 25_000, signal);
    if (!response.ok) throw new Error(`Google endpoint returned ${response.status}`);
    const raw = await response.text();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !Array.isArray(parsed[0])) throw new Error('Unexpected Google response shape');

    // The response is a list of sentence chunks: [[translated, source, ...], ...]
    return (parsed[0] as unknown[][])
      .map((chunk) => (typeof chunk?.[0] === 'string' ? chunk[0] : ''))
      .join('');
  }

  private async myMemoryTranslate(text: string, from: string, to: string, signal?: AbortSignal): Promise<string> {
    await this.throttle(signal);
    // MyMemory rejects `auto`; it needs an explicit source language.
    const source = from === 'auto' ? 'en' : from;
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', text);
    url.searchParams.set('langpair', `${source}|${to}`);
    const email = process.env.MYMEMORY_EMAIL;
    if (email) url.searchParams.set('de', email); // raises the anonymous quota

    const response = await fetchWithTimeout(url.toString(), { method: 'GET' }, this.config.timeoutMs ?? 25_000, signal);
    if (!response.ok) throw new Error(`MyMemory returned ${response.status}`);
    const json = (await response.json()) as {
      responseStatus?: number | string;
      responseData?: { translatedText?: string };
      responseDetails?: string;
    };
    const translated = json.responseData?.translatedText;
    if (!translated) throw new Error(`MyMemory: ${json.responseDetails ?? 'no translation returned'}`);
    if (String(json.responseStatus) !== '200') throw new Error(`MyMemory status ${json.responseStatus}`);
    return translated;
  }

  async translate(segments: string[], request: TranslationRequest): Promise<string[]> {
    const to = LANG_CODES.free[request.to];
    const from = request.from === 'auto' ? 'auto' : LANG_CODES.free[request.from];
    const engines: Engine[] = [];
    if (!this.config.disableGoogle) engines.push('google');
    if (!this.config.disableMyMemory) engines.push('mymemory');
    if (engines.length === 0) return segments;

    const out: string[] = [];
    for (const original of segments) {
      // Statistical engines mangle technical terms badly; mask them first.
      const mask = maskGlossary(original, request.glossary);
      let translated: string | undefined;

      for (const engine of engines) {
        if ((this.failures.get(engine) ?? 0) >= 2) continue;
        try {
          const raw = engine === 'google'
            ? await this.googleTranslate(mask.masked, from, to, request.signal)
            : await this.myMemoryTranslate(mask.masked, from, to, request.signal);
          const restored = mask.restore(raw);
          if (placeholdersPreserved(original, restored)) {
            this.failures.set(engine, 0);
            translated = restored;
            break;
          }
          // A 200 response that drops placeholders counts as a failure of this
          // engine for this segment: retrying the same endpoint will not help.
          this.failures.set(engine, (this.failures.get(engine) ?? 0) + 1);
        } catch {
          // Try the next engine; both may be blocked in some networks.
          this.failures.set(engine, (this.failures.get(engine) ?? 0) + 1);
        }
      }
      // Untranslatable → keep the source rather than emit garbage.
      out.push(translated ?? original);
    }
    return out;
  }
}
