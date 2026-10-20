import type {
  AvailabilityResult, TranslationProvider, TranslationRequest,
} from '../provider.js';
import { LANG_CODES, fetchWithTimeout, firstEnv } from '../provider.js';
import { placeholdersPreserved } from '../markdown.js';

/**
 * OpenAI-compatible chat completions provider.
 *
 * "OpenAI-compatible" is the useful abstraction here: it covers OpenAI,
 * DeepSeek, Moonshot/Kimi, Qwen (DashScope), Zhipu GLM, OpenRouter, and local
 * runtimes such as Ollama, LM Studio and vLLM. One code path, many backends.
 */

interface Preset {
  keyEnv: string[];
  baseUrl?: string;
  model?: string;
  label: string;
}

const PRESETS: Preset[] = [
  { keyEnv: ['OPENAI_API_KEY'], baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', label: 'OpenAI' },
  { keyEnv: ['DEEPSEEK_API_KEY'], baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', label: 'DeepSeek' },
  { keyEnv: ['MOONSHOT_API_KEY'], baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', label: 'Moonshot' },
  { keyEnv: ['DASHSCOPE_API_KEY', 'QWEN_API_KEY'], baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', label: 'Qwen' },
  { keyEnv: ['ZHIPUAI_API_KEY', 'GLM_API_KEY'], baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', label: 'Zhipu GLM' },
  { keyEnv: ['OPENROUTER_API_KEY'], baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', label: 'OpenRouter' },
  { keyEnv: ['GROQ_API_KEY'], baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-70b-versatile', label: 'Groq' },
];

export interface LlmConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** Detected preset name, for user-facing messages. */
  presetLabel?: string;
  temperature?: number;
  timeoutMs?: number;
}

/**
 * Resolve configuration from the environment.
 * Precedence: explicit `README_SMITH_LLM_*` → a recognised vendor preset →
 * a keyless local base URL (Ollama/LM Studio).
 */
export function resolveLlmConfig(): LlmConfig | undefined {
  const explicitKey = firstEnv('README_SMITH_LLM_API_KEY');
  const explicitBase = firstEnv('README_SMITH_LLM_BASE_URL', 'LLM_BASE_URL');
  const explicitModel = firstEnv('README_SMITH_LLM_MODEL', 'LLM_MODEL');

  for (const preset of PRESETS) {
    const found = firstEnv(...preset.keyEnv);
    if (!found) continue;
    return {
      apiKey: explicitKey?.value ?? found.value,
      baseUrl: explicitBase?.value ?? process.env.OPENAI_BASE_URL ?? preset.baseUrl,
      model: explicitModel?.value ?? process.env.OPENAI_MODEL ?? preset.model,
      presetLabel: preset.label,
      temperature: 0.2,
      timeoutMs: 90_000,
    };
  }

  // Keyless local server: base URL alone is enough (Ollama, LM Studio, vLLM).
  const localBase = explicitBase ?? firstEnv('OLLAMA_BASE_URL');
  if (localBase) {
    return {
      apiKey: explicitKey?.value,
      baseUrl: localBase.value.replace(/\/$/, ''),
      model: explicitModel?.value ?? 'qwen2.5:7b',
      presetLabel: 'local OpenAI-compatible server',
      temperature: 0.2,
      timeoutMs: 120_000,
    };
  }

  if (explicitKey) {
    return {
      apiKey: explicitKey.value,
      baseUrl: explicitBase?.value ?? 'https://api.openai.com/v1',
      model: explicitModel?.value ?? 'gpt-4o-mini',
      presetLabel: 'custom',
      temperature: 0.2,
      timeoutMs: 90_000,
    };
  }

  return undefined;
}

function buildPrompt(request: TranslationRequest, segments: string[]): { system: string; user: string } {
  const sourceName = request.from === 'auto' ? 'the source language' : LANG_CODES.llm[request.from];
  const targetName = LANG_CODES.llm[request.to];

  const system = [
    `You are a technical documentation translator for open source projects.`,
    `Translate a JSON array of GitHub-flavoured Markdown fragments from ${sourceName} into ${targetName}.`,
    '',
    'Hard rules:',
    `1. Return ONLY a JSON array of ${segments.length} strings. No prose, no code fences, no commentary.`,
    '2. The output array must have exactly the same length and order as the input.',
    '3. Preserve every `[[n]]` placeholder exactly as-is, in a position that reads naturally. These wrap code, URLs, badges and links.',
    '4. Never translate text inside placeholders — they are already opaque to you.',
    '5. Keep Markdown syntax intact: heading hashes, list markers, table pipes, bold and italic markers.',
    '6. Write like a native technical writer, not like a translation engine. Preserve tone and sentence rhythm.',
    '7. Leave brand names, package names, file names and identifiers in their original form.',
    '',
    request.glossary.promptHint(request.to),
    request.instruction ? `\nAdditional instruction: ${request.instruction}` : '',
  ].filter(Boolean).join('\n');

  const user = JSON.stringify(segments, null, 0);
  return { system, user };
}

/** Extract a JSON array from a model reply, tolerating code fences and prose. */
function parseJsonArray(text: string): string[] | undefined {
  const trimmed = text.trim();
  const candidates: string[] = [trimmed];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]!.trim());

  // Last resort: the outermost `[ ... ]` span.
  const first = trimmed.indexOf('[');
  const last = trimmed.lastIndexOf(']');
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) return parsed;
    } catch {
      continue;
    }
  }
  return undefined;
}

export class LlmProvider implements TranslationProvider {
  readonly id = 'llm' as const;
  readonly label: string;
  private readonly config: LlmConfig;

  constructor(config?: LlmConfig) {
    this.config = config ?? resolveLlmConfig() ?? {};
    this.label = `LLM (${this.config.presetLabel ?? 'openai-compatible'})${this.config.model ? ` · ${this.config.model}` : ''}`;
  }

  isAvailable(): AvailabilityResult {
    const resolved = resolveLlmConfig();
    if (!resolved) {
      return {
        available: false,
        detail: 'No API key found. Set one of: OPENAI_API_KEY, DEEPSEEK_API_KEY, MOONSHOT_API_KEY, DASHSCOPE_API_KEY, ZHIPUAI_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY — or README_SMITH_LLM_BASE_URL for a local server.',
      };
    }
    if (!resolved.baseUrl) return { available: false, detail: 'LLM base URL could not be determined.' };
    if (!resolved.model) return { available: false, detail: 'LLM model could not be determined. Set README_SMITH_LLM_MODEL.' };
    return { available: true, detail: `${resolved.presetLabel} · ${resolved.model}` };
  }

  async translate(segments: string[], request: TranslationRequest): Promise<string[]> {
    const config = this.config;
    if (!config.baseUrl || !config.model) return segments;

    const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const { system, user } = buildPrompt(request, segments);

    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          temperature: config.temperature ?? 0.2,
          // Deliberately no `response_format: json_object` — it forces an
          // object wrapper on some backends and is unsupported on others.
          // Parsing below already tolerates both shapes.
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      },
      config.timeoutMs ?? 90_000,
      request.signal,
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`LLM request failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (json.error?.message) throw new Error(`LLM error: ${json.error.message}`);

    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM returned an empty completion');

    // `response_format: json_object` makes some models wrap the array in an
    // object, so unwrap common shapes before parsing.
    let parsed = parseJsonArray(content);
    if (!parsed) {
      try {
        const asObject = JSON.parse(content) as Record<string, unknown>;
        for (const value of Object.values(asObject)) {
          if (Array.isArray(value) && value.every((x) => typeof x === 'string')) { parsed = value; break; }
        }
      } catch { /* fall through */ }
    }
    if (!parsed) throw new Error('Could not parse the LLM response as a JSON array of strings');

    return segments.map((original, i) => {
      const candidate = parsed![i];
      if (typeof candidate !== 'string' || candidate.trim().length === 0) return original;
      // Reject translations that lost placeholders — restoring the original is
      // safer than emitting a README with broken badges and links.
      return placeholdersPreserved(original, candidate) ? candidate : original;
    });
  }
}
