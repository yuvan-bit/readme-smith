import type { Lang } from '../types.js';
import type { Glossary } from './glossary.js';

export type ProviderId = 'llm' | 'deepl' | 'free' | 'none';

export interface TranslationRequest {
  from: Lang | 'auto';
  to: Lang;
  glossary: Glossary;
  /** Extra instruction appended to LLM prompts (tone, audience). */
  instruction?: string;
  /** Abort signal so a hung provider cannot wedge the CLI. */
  signal?: AbortSignal;
}

export interface AvailabilityResult {
  available: boolean;
  /** Why it is unavailable, or which credentials were detected. */
  detail?: string;
}

export interface TranslationProvider {
  readonly id: ProviderId;
  readonly label: string;
  isAvailable(): AvailabilityResult;
  /**
   * Translate a batch of independent Markdown segments.
   * MUST return exactly `segments.length` items, in order. Segments that
   * could not be translated should be returned unchanged rather than dropped.
   */
  translate(segments: string[], request: TranslationRequest): Promise<string[]>;
}

/** Language codes per provider dialect. */
export const LANG_CODES = {
  llm: { en: 'English', zh: 'Simplified Chinese' },
  deepl: { en: 'EN', zh: 'ZH' },
  free: { en: 'en', zh: 'zh-CN' },
} as const;

/**
 * Split segments into batches that fit an engine's size limit.
 * Batching matters for both cost and rate limits: a 300-segment README should
 * be a handful of requests, not 300.
 */
export function batchSegments(segments: string[], maxChars: number, maxItems = 40): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let size = 0;

  for (const segment of segments) {
    const len = segment.length;
    if (current.length > 0 && (size + len > maxChars || current.length >= maxItems)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(segment);
    size += len;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Run batches with bounded concurrency.
 * Results are keyed by segment index so out-of-order completion is safe.
 */
export async function runBatches(
  segments: string[],
  maxChars: number,
  concurrency: number,
  handler: (batch: string[], offset: number) => Promise<string[]>,
  onProgress?: (completed: number, total: number) => void,
): Promise<string[]> {
  const batches: Array<{ items: string[]; offset: number }> = [];
  let offset = 0;
  for (const batch of batchSegments(segments, maxChars)) {
    batches.push({ items: batch, offset });
    offset += batch.length;
  }

  const results: string[] = new Array(segments.length).fill('');
  // Seed with originals so a failing batch degrades instead of blanking.
  segments.forEach((s, i) => { results[i] = s; });

  let cursor = 0;
  let completed = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, batches.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= batches.length) return;
      const batch = batches[index]!;
      try {
        const translated = await handler(batch.items, batch.offset);
        if (translated.length === batch.items.length) {
          translated.forEach((value, i) => { results[batch.offset + i] = value; });
        } else {
          // Length mismatch: keep whatever aligns, leave the rest untouched.
          translated.slice(0, batch.items.length).forEach((value, i) => { results[batch.offset + i] = value; });
        }
      } catch {
        // Leave originals in place; the caller reports the partial failure.
      }
      onProgress?.(++completed, batches.length);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Shared fetch with timeout; Node 18+ provides global fetch. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** First environment variable that is set and non-empty. */
export function firstEnv(...names: string[]): { name: string; value: string } | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim().length > 0) return { name, value: value.trim() };
  }
  return undefined;
}
