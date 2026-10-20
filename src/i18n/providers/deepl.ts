import type { AvailabilityResult, TranslationProvider, TranslationRequest } from '../provider.js';
import { LANG_CODES, fetchWithTimeout, firstEnv } from '../provider.js';
import { placeholdersPreserved } from '../markdown.js';
import { maskGlossary } from '../glossary.js';

/**
 * DeepL provider.
 *
 * DeepL produces consistently strong EN↔ZH prose and needs no model tuning,
 * which makes it a good default when a key is available. It is weaker than an
 * LLM at honouring "leave this term alone" instructions, so glossary terms are
 * placeholder-masked before the request and restored afterwards.
 */

export interface DeepLConfig {
  apiKey?: string;
  /** Free-tier keys end in `:fx` and must use the free host. */
  freeTier?: boolean;
  timeoutMs?: number;
}

function resolveDeepLConfig(): DeepLConfig | undefined {
  const found = firstEnv('DEEPL_API_KEY', 'README_SMITH_DEEPL_API_KEY');
  if (!found) return undefined;
  return { apiKey: found.value, freeTier: found.value.endsWith(':fx'), timeoutMs: 45_000 };
}

export class DeepLProvider implements TranslationProvider {
  readonly id = 'deepl' as const;
  readonly label = 'DeepL';
  private readonly config: DeepLConfig;

  constructor(config?: DeepLConfig) {
    this.config = config ?? resolveDeepLConfig() ?? {};
  }

  isAvailable(): AvailabilityResult {
    if (!this.config.apiKey) return { available: false, detail: 'DEEPL_API_KEY is not set.' };
    return { available: true, detail: this.config.freeTier ? 'free tier' : 'pro tier' };
  }

  async translate(segments: string[], request: TranslationRequest): Promise<string[]> {
    if (!this.config.apiKey) return segments;
    const host = this.config.freeTier ? 'https://api-free.deepl.com' : 'https://api.deepl.com';

    // Mask glossary terms DeepL would otherwise translate away.
    const masks = segments.map((segment) => maskGlossary(segment, request.glossary));

    const body = new URLSearchParams();
    for (const mask of masks) body.append('text', mask.masked);
    if (request.from !== 'auto') body.append('source_lang', LANG_CODES.deepl[request.from]);
    body.append('target_lang', LANG_CODES.deepl[request.to]);
    // Everything structural is already placeholder-protected, so we only need
    // DeepL to keep our newlines intact.
    body.append('preserve_formatting', '1');

    const response = await fetchWithTimeout(
      `${host}/v2/translate`,
      {
        method: 'POST',
        headers: {
          authorization: `DeepL-Auth-Key ${this.config.apiKey}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      },
      this.config.timeoutMs ?? 45_000,
      request.signal,
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`DeepL request failed (${response.status}): ${text.slice(0, 300)}`);
    }

    const json = (await response.json()) as { translations?: Array<{ text?: string }>; message?: string };
    if (json.message && !json.translations) throw new Error(`DeepL error: ${json.message}`);
    const translations = json.translations ?? [];

    return segments.map((original, i) => {
      const raw = translations[i]?.text;
      if (typeof raw !== 'string' || raw.trim().length === 0) return original;
      const restored = masks[i]!.restore(raw);
      return placeholdersPreserved(original, restored) ? restored : original;
    });
  }
}
