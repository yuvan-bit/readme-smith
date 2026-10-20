import type { Lang } from '../types.js';

/**
 * GitHub-flavoured anchor slug.
 * CJK characters are preserved (GitHub keeps them), which is what makes the
 * table of contents work in the Chinese README too.
 */
export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/<[^>]*>/g, '')                 // strip inline HTML (badges, links)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // `[text](url)` → `text`
    .replace(/[`*_~]/g, '')                  // strip emphasis markers
    .replace(/[^\p{L}\p{N}\s\-_]/gu, '')     // keep letters (any script), digits, dash, underscore
    .trim()
    .replace(/\s+/g, '-');
}

export function heading(level: number, text: string): string {
  return `${'#'.repeat(Math.min(Math.max(level, 1), 6))} ${text}`;
}

/** A level-2 section heading with a blank line before and after. */
export function section(text: string): string {
  return `\n${heading(2, text)}\n`;
}

export function sub(text: string): string {
  return `\n${heading(3, text)}\n`;
}

/** Fenced code block. `lang` is the info string (`bash`, `ts`, `mermaid`, `text`). */
export function code(lang: string, body: string): string {
  const trimmed = body.replace(/\n+$/, '');
  return `\`\`\`${lang}\n${trimmed}\n\`\`\``;
}

/** Inline code, tolerating backticks inside the value. */
export function inline(value: string): string {
  if (!value.includes('`')) return `\`${value}\``;
  const run = '`'.repeat((value.match(/`+/g) ?? ['']).reduce((m, s) => Math.max(m, s.length), 0) + 1);
  return `${run}${value}${run}`;
}

export interface TableOptions {
  headers: string[];
  rows: Array<Array<string | undefined>>;
  /** Column alignment. */
  align?: Array<'left' | 'center' | 'right'>;
}

/**
 * Render a GitHub-flavoured Markdown table.
 * Pipes inside cells are escaped and newlines are collapsed so the table
 * cannot be broken by dependency names or descriptions.
 */
export function table({ headers, rows, align }: TableOptions): string {
  if (headers.length === 0) return '';
  const cell = (value: string | undefined): string =>
    (value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() || '—';

  const alignRow = (align ?? headers.map(() => 'left' as const)).map((a) =>
    a === 'center' ? ':---:' : a === 'right' ? '---:' : '---',
  );

  const lines = [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${alignRow.join(' | ')} |`,
  ];
  for (const row of rows) {
    // Pad or truncate to the header width so malformed rows cannot break layout.
    const normalized = headers.map((_, i) => cell(row[i]));
    lines.push(`| ${normalized.join(' | ')} |`);
  }
  return lines.join('\n');
}

export function bullet(text: string): string {
  return `- ${text}`;
}

export function bullets(items: string[]): string {
  return items.map(bullet).join('\n');
}

/**
 * Ordered list. An item may carry block content on continuation lines (a step
 * followed by a fenced command, for example); those lines are indented to the
 * item's content column so the block stays inside the item.
 *
 * Leaving a fence at column 0 instead ends the list early and makes the parser
 * restart numbering, so the whole block — closing fence included — must be
 * indented, not just its first line.
 */
export function numbered(items: string[]): string {
  const rendered = items.map((item, i) => {
    const marker = `${i + 1}. `;
    const pad = ' '.repeat(marker.length);
    const [first, ...rest] = item.split('\n');
    if (rest.length === 0) return marker + first;
    const body = rest.map((line) => (line.trim() === '' ? '' : pad + line)).join('\n');
    return `${marker}${first}\n\n${body}`;
  });
  // Blank lines between items are only needed once an item holds a block;
  // a plain list stays tight.
  const loose = rendered.some((item) => item.includes('\n\n'));
  return rendered.join(loose ? '\n\n' : '\n');
}

export function link(text: string, url: string): string {
  return `[${text}](${url.replace(/ /g, '%20')})`;
}

/** Blockquote used for notes and warnings. */
export function note(text: string, lang: Lang): string {
  const prefix = lang === 'zh' ? '> **提示** · ' : '> **Note** · ';
  return `${prefix}${text}`;
}

export function warning(text: string, lang: Lang): string {
  const prefix = lang === 'zh' ? '> **注意** · ' : '> **Heads up** · ';
  return `${prefix}${text}`;
}

/** Collapse long content behind a `<details>` disclosure. */
export function details(summary: string, body: string, open = false): string {
  return [`<details${open ? ' open' : ''}>`, `<summary>${summary}</summary>`, '', body, '', '</details>'].join('\n');
}

/** Join non-empty blocks with exactly one blank line between them. */
export function joinBlocks(blocks: Array<string | undefined | false | null>): string {
  return blocks
    .filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
    .map((b) => b.trim())
    .join('\n\n');
}

/** Ensure the document ends with exactly one newline. */
export function normalizeDocument(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Build a table of contents from the headings present in a rendered document. */
export function buildToc(markdown: string, maxDepth: number, tocHeading: string): string {
  const lines: string[] = [];
  let insideFence = false;
  let tocHeadingSlug: string | undefined;

  for (const raw of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) { insideFence = !insideFence; continue; }
    if (insideFence) continue;
    const m = raw.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!m) continue;
    const level = m[1]!.length;
    if (level === 1) continue;                       // skip the title
    if (level - 1 > maxDepth) continue;              // depth is relative to h2
    const text = m[2]!.trim();
    const slug = slugify(text);
    if (!tocHeadingSlug) tocHeadingSlug = slugify(tocHeading);
    if (slug === tocHeadingSlug) continue;           // never list the TOC itself
    const indent = '  '.repeat(level - 2);
    lines.push(`${indent}- [${text.replace(/<[^>]*>/g, '')}](#${slug})`);
  }

  return lines.join('\n');
}
