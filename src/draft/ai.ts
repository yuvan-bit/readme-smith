import type { AiBackend, FactSheet, Lang } from '../types.js';

export interface AiSettings {
  backend: AiBackend;
  baseUrl: string | null;
  model: string | null;
}

export interface AiCopyResult {
  intro: string | null;
  features: string[];
  usageNote: string | null;
  provider: string | null;
  warnings: string[];
}

export interface CopyPayload {
  intro: string | null;
  features: string[];
  usageNote: string | null;
}

const LOCAL_DEFAULT_URL = 'http://127.0.0.1:11434/v1';
const LOCAL_DEFAULT_MODEL = 'llama3.2';
const OPENAI_DEFAULT_URL = 'https://api.openai.com/v1';
const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';

const BUILTIN_RUNNER_COMMANDS = new Set([
  'install', 'i', 'ci', 'add', 'remove', 'rm', 'uninstall', 'update', 'up', 'upgrade',
  'init', 'create', 'exec', 'dlx', 'link', 'unlink', 'publish', 'pack', 'audit',
  'outdated', 'why', 'config', 'cache', 'version', 'login', 'logout', 'ls', 'list',
  'bin', 'root', 'help', 'store', 'workspace', 'workspaces', 'patch', 'prune',
  'set', 'get', 'rebuild', 'doctor', 'dedupe', 'import', 'info', 'search', 'team',
]);

const LICENSES: Array<[RegExp, string]> = [
  [/\bAGPL[- ]?3(?:\.0)?\b/i, 'AGPL-3.0'],
  [/\bLGPL[- ]?3(?:\.0)?\b/i, 'LGPL-3.0'],
  [/\bGPL[- ]?3(?:\.0)?\b/i, 'GPL-3.0'],
  [/\bGPL[- ]?2(?:\.0)?\b/i, 'GPL-2.0'],
  [/\bApache[- ]?2(?:\.0)?\b/i, 'Apache-2.0'],
  [/\bMPL[- ]?2(?:\.0)?\b/i, 'MPL-2.0'],
  [/\bBSD[- ]?3[- ]?Clause\b/i, 'BSD-3-Clause'],
  [/\bBSD[- ]?2[- ]Clause\b/i, 'BSD-2-Clause'],
  [/\bISC\b/i, 'ISC'],
  [/\bUnlicense\b/i, 'Unlicense'],
  [/\bCC0(?:-1\.0)?\b/i, 'CC0-1.0'],
  [/\bMIT\b/i, 'MIT'],
];

/** The AI may not introduce a licence claim the repository does not prove. */
export function validateProse(text: string, facts: FactSheet): string[] {
  const issues: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) {
    issues.push('AI returned empty prose.');
    return issues;
  }
  if (trimmed.length > 3000) issues.push('AI prose is longer than 3000 characters.');

  const scripts = new Set(facts.scripts.map((s) => s.name));
  const hasScripts = facts.scripts.length > 0;

  for (const match of trimmed.matchAll(/\b(?:npm|pnpm|yarn|bun)\s+(?:run(?:-script)?\s+)?([A-Za-z0-9:_.-]+)/g)) {
    const name = match[1]!;
    if (BUILTIN_RUNNER_COMMANDS.has(name)) {
      if ((name === 'test' || name === 'start') && hasScripts && !scripts.has(name)) {
        issues.push(`Command \`${match[0]}\` refers to a script that is not declared.`);
      }
      continue;
    }
    if (hasScripts && !scripts.has(name)) {
      issues.push(`Command \`${match[0]}\` refers to undeclared script "${name}".`);
    }
  }

  const envNames = new Set(facts.env.map((e) => e.name));
  for (const match of trimmed.matchAll(/\$\{?([A-Z][A-Z0-9_]{2,})\}?|(?<![A-Za-z0-9_])([A-Z][A-Z0-9]*_[A-Z0-9_]+)(?![A-Za-z0-9_])/g)) {
    const name = match[1] ?? match[2]!;
    if (!envNames.has(name)) issues.push(`Environment variable \`${name}\` is not present in the repository facts.`);
  }

  const knownFlags = new Set<string>();
  const commandSources = [
    facts.usage?.command,
    facts.install.consumer?.command,
    facts.install.development?.command,
    ...facts.scripts.flatMap((s) => [s.invocation, s.command]),
    ...facts.buildCommands.map((b) => b.command),
  ].filter((s): s is string => !!s);
  for (const source of commandSources) {
    for (const flag of source.matchAll(/--[A-Za-z0-9-]+/g)) knownFlags.add(flag[0]);
  }
  for (const match of trimmed.matchAll(/--[A-Za-z0-9-]+/g)) {
    if (!knownFlags.has(match[0])) issues.push(`Flag \`${match[0]}\` is not backed by any documented command.`);
  }

  const expectedLicense = facts.project.license?.spdx ?? facts.project.license?.family;
  for (const [re, name] of LICENSES) {
    if (!re.test(trimmed)) continue;
    if (!expectedLicense) issues.push(`AI mentions the ${name} licence, but no licence was detected.`);
    else if (name.toLowerCase() !== expectedLicense.toLowerCase()) {
      issues.push(`AI mentions the ${name} licence, but the repository licence is ${expectedLicense}.`);
    }
  }

  const allowedUrls = new Set<string>([facts.project.repository?.url].filter((u): u is string => !!u));
  for (const match of trimmed.matchAll(/https?:\/\/[^\s)>`]+/g)) {
    if (!allowedUrls.has(match[0])) issues.push(`URL \`${match[0]}\` is not backed by repository facts.`);
  }

  if (/\b(?:created|written|maintained|authored)\s+by\b/i.test(trimmed)) {
    issues.push('AI claims authorship, which repository facts cannot prove.');
  }

  const versionClaim = trimmed.match(/\b(?:version|v)\s*(\d+\.\d+\.\d+)\b/i);
  if (versionClaim) {
    if (!facts.project.version) issues.push('AI claims a version, but the manifest declares none.');
    else if (versionClaim[1] !== facts.project.version) {
      issues.push(`AI claims version ${versionClaim[1]}, but the manifest declares ${facts.project.version}.`);
    }
  }

  return [...new Set(issues)];
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

function emptyCopy(warnings: string[] = []): AiCopyResult {
  return { intro: null, features: [], usageNote: null, provider: null, warnings };
}

/**
 * Ask an OpenAI-compatible endpoint for the optional README copy fields.
 * Sends only the fact block — never repository files. Each field is validated
 * independently; rejected fields fall back to the deterministic template.
 */
export async function requestCopy(facts: FactSheet, lang: Lang, ai: AiSettings): Promise<AiCopyResult> {
  if (ai.backend === 'off') return emptyCopy();
  if (!facts.project.description) {
    return emptyCopy(['AI skipped: the manifest has no description, and the project purpose must not be inferred.']);
  }

  const endpoint = ai.backend === 'local'
    ? `${(ai.baseUrl ?? LOCAL_DEFAULT_URL).replace(/\/+$/, '')}/chat/completions`
    : `${(ai.baseUrl ?? OPENAI_DEFAULT_URL).replace(/\/+$/, '')}/chat/completions`;
  const model = ai.model ?? (ai.backend === 'local' ? LOCAL_DEFAULT_MODEL : OPENAI_DEFAULT_MODEL);
  const languageName = lang === 'zh' ? 'Simplified Chinese' : 'English';

  const header: Record<string, string> = { 'content-type': 'application/json' };
  if (ai.backend === 'openai') {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      return emptyCopy(['AI backend "openai" requires OPENAI_API_KEY; used the deterministic template instead.']);
    }
    header.authorization = `Bearer ${key}`;
  }

  const factBlock = {
    name: facts.project.name,
    description: facts.project.description,
    version: facts.project.version,
    type: facts.project.type,
    language: facts.project.primaryLanguage,
    license: facts.project.license?.spdx ?? facts.project.license?.family ?? null,
    binaries: facts.binaries,
    entryPoints: facts.entryPoints,
    packages: facts.packages,
    scripts: facts.scripts.map((s) => ({ name: s.name, command: s.command, invocation: s.invocation })),
    install: {
      consumer: facts.install.consumer?.command ?? null,
      development: facts.install.development?.command ?? null,
    },
    usage: facts.usage?.command ?? null,
    env: facts.env.map((e) => e.name),
    repository: facts.project.repository?.url ?? null,
  };

  const prompt = [
    'You write a small README copy block from repository facts.',
    'Rules:',
    '- Use ONLY the facts in the JSON block. Do not infer purpose, features, audience, performance or history.',
    '- Never invent commands, flags, environment variables, API names, versions, licences, badges, authors or links.',
    '- "intro": one to three short sentences.',
    '- "features": two to four short single-line bullets, each supported by a fact (declared script, executable, entry point, environment variable, package metadata or licence). Return an empty array when the facts support none.',
    '- "usageNote": one short sentence that introduces the exact usage command rendered below it. Do not repeat or alter the command.',
    '- Do not use Markdown headings or nested bullets.',
    '- If something is unclear, include the marker [verify].',
    `- Write in ${languageName}.`,
    '- Answer with JSON only: {"intro":"...","features":["..."],"usageNote":"..."}',
    '',
    'FACTS:',
    JSON.stringify(factBlock, null, 2),
  ].join('\n');

  const timeout = ai.backend === 'local' ? 8000 : 30_000;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: header,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a precise technical writer. You never invent facts.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return emptyCopy([`AI backend "${ai.backend}" is unavailable (${reason}); used the deterministic template instead.`]);
  }

  if (!response.ok) {
    return emptyCopy([`AI backend "${ai.backend}" returned HTTP ${response.status}; used the deterministic template instead.`]);
  }

  let body: ChatResponse;
  try {
    body = await response.json() as ChatResponse;
  } catch {
    return emptyCopy([`AI backend "${ai.backend}" returned invalid JSON; used the deterministic template instead.`]);
  }
  if (body.error?.message) {
    return emptyCopy([`AI backend error: ${body.error.message}`]);
  }
  const content = body.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return emptyCopy([`AI backend "${ai.backend}" returned no text; used the deterministic template instead.`]);
  }

  const parsed = parseCopyPayload(content);
  if (!parsed) {
    return emptyCopy(['AI response was not the required JSON object; used the deterministic template instead.']);
  }
  const validated = validateCopyPayload(parsed, facts);
  if (!validated.intro && validated.features.length === 0 && !validated.usageNote) {
    const detail = validated.warnings.slice(0, 3).join(' ') || 'no usable fields were returned';
    return emptyCopy([`AI copy was rejected by the fact validator (${detail}); used the deterministic template instead.`]);
  }
  return {
    intro: validated.intro,
    features: validated.features,
    usageNote: validated.usageNote,
    provider: `${ai.backend}:${model}`,
    warnings: validated.warnings,
  };
}

function parseCopyPayload(content: string): CopyPayload | null {
  const withoutFence = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const doc = JSON.parse(withoutFence) as Record<string, unknown>;
    const intro = typeof doc.intro === 'string' && doc.intro.trim() ? doc.intro.trim() : null;
    const usageNote = typeof doc.usageNote === 'string' && doc.usageNote.trim() ? doc.usageNote.trim() : null;
    const features = Array.isArray(doc.features)
      ? doc.features.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
      : [];
    if (!intro && !usageNote && features.length === 0) return null;
    return { intro, features, usageNote };
  } catch {
    /* fall through */
  }
  return null;
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function lineIssues(text: string): string[] {
  const issues: string[] = [];
  if (text.length > 400) issues.push('is longer than 400 characters.');
  if (/^(?:#{1,6}\s|[-*+]\s|>\s|\|)/.test(text)) issues.push('must not start with a Markdown block marker.');
  return issues;
}

function validateCopyField(
  label: string,
  text: string,
  facts: FactSheet,
  warnings: string[],
): string | null {
  const issues = [...lineIssues(text), ...validateProse(text, facts)];
  if (issues.length > 0) {
    warnings.push(`AI ${label} was rejected by the fact validator (${issues.slice(0, 2).join(' ')}).`);
    return null;
  }
  return text;
}

function validateCopyPayload(payload: CopyPayload, facts: FactSheet): {
  intro: string | null;
  features: string[];
  usageNote: string | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  const intro = payload.intro
    ? validateCopyField('introduction', singleLine(payload.intro), facts, warnings)
    : null;
  const usageNote = payload.usageNote
    ? validateCopyField('usage note', singleLine(payload.usageNote), facts, warnings)
    : null;

  if (payload.features.length > 4) {
    warnings.push(`AI returned ${payload.features.length} features; only the first four were kept.`);
  }
  const features: string[] = [];
  for (const raw of payload.features.slice(0, 4)) {
    const feature = singleLine(raw);
    const accepted = validateCopyField('feature', feature, facts, warnings);
    if (accepted) features.push(accepted);
  }

  return { intro, features, usageNote, warnings };
}
