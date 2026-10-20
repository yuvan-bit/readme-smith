/**
 * Markdown-aware segmentation for translation.
 *
 * Naively piping a README through a translator destroys it: fenced code gets
 * "translated", shields.io badge URLs get mangled, Mermaid diagrams stop
 * parsing, and relative links break. This module splits a document into
 * protected spans (never sent to a translator) and translatable text, using
 * `[[n]]` placeholders that every provider is instructed to pass through.
 */

/** Placeholder format: `[[0]]`, `[[1]]`, … Chosen because it survives both
 *  LLM and statistical MT better than unicode sentinels, and cannot appear
 *  naturally in Markdown prose. */
export const PLACEHOLDER = (index: number): string => `[[${index}]]`;
export const PLACEHOLDER_RE = /\[\[(\d+)\]\]/g;

export type BlockKind = 'protect' | 'translate';

export interface DocBlock {
  kind: BlockKind;
  /** Original text; for `translate` blocks this still contains placeholders. */
  text: string;
  /** For `translate` blocks, the placeholder → original span map. */
  placeholders?: string[];
  /**
   * Markup that must survive translation verbatim but must not be shown to the
   * translator: the `##` of a heading, for example. Sending `## Demo` as one
   * segment invites the model to drop the marker or swallow the space; keeping
   * it here and re-attaching it afterwards makes heading loss impossible.
   */
  prefix?: string;
}

export interface SegmentedDocument {
  blocks: DocBlock[];
  /** Headings in document order, used to rewrite in-document anchor links. */
  headings: Array<{ blockIndex: number; level: number; text: string }>;
}

/* ------------------------------------------------------------------ *
 * Inline protection
 * ------------------------------------------------------------------ */

/**
 * Ordered patterns for spans that must never be translated.
 * Earlier entries win: an image is protected whole before its URL is
 * considered separately.
 */
const PROTECT_PATTERNS: RegExp[] = [
  /`[^`\n]*`/,                                        // inline code
  /!\[[^\]]*\]\([^)]*\)/,                              // images (incl. badges)
  /\]\([^)]*\)/,                                       // link target: `](url)`
  /\*\*/,                                              // bold delimiters
  /<\/?[a-zA-Z][^>]*>/,                                // HTML tags
  /https?:\/\/[^\s<>)\]]+/,                            // bare URLs
  /www\.[^\s<>)\]]+/,                                  // bare www URLs
  /\b[A-Za-z]:\\[^\s<>)\]]+/,                          // Windows paths
  /(?<![\w`])\.?\/[A-Za-z0-9._\-/]+(?![\w`])/,         // POSIX-ish relative paths
];

interface Range { start: number; end: number }

function rangesOverlap(a: Range, b: Range): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Replace protected inline spans with placeholders.
 * Returns the placeholder-ised text plus the ordered list of protected spans.
 */
export function protectInline(text: string): { text: string; placeholders: string[] } {
  const ranges: Range[] = [];
  for (const pattern of PROTECT_PATTERNS) {
    const re = new RegExp(pattern.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      const candidate: Range = { start: m.index, end: m.index + m[0].length };
      if (!ranges.some((r) => rangesOverlap(r, candidate))) ranges.push(candidate);
    }
  }

  if (ranges.length === 0) return { text, placeholders: [] };
  ranges.sort((a, b) => a.start - b.start);

  const placeholders: string[] = [];
  let out = '';
  let cursor = 0;
  for (const range of ranges) {
    out += text.slice(cursor, range.start);
    const span = text.slice(range.start, range.end);
    placeholders.push(span);
    out += PLACEHOLDER(placeholders.length - 1);
    cursor = range.end;
  }
  out += text.slice(cursor);
  return { text: out, placeholders };
}

/** Reverse of `protectInline`. Missing placeholders resolve to empty so a
 *  partially-mangled translation cannot corrupt the document structure. */
export function restoreInline(text: string, placeholders: string[]): string {
  return text.replace(PLACEHOLDER_RE, (match, rawIndex: string) => {
    const index = Number(rawIndex);
    return Number.isInteger(index) && index >= 0 && index < placeholders.length
      ? placeholders[index]!
      : match;
  });
}

/** Distinct placeholder indices referenced by a piece of text. */
export function placeholderIndices(text: string): Set<number> {
  const found = new Set<number>();
  for (const m of text.matchAll(PLACEHOLDER_RE)) found.add(Number(m[1]));
  return found;
}

/**
 * True when `translated` still references every placeholder `original` did.
 *
 * Comparing index *sets* rather than counts is deliberate: a placeholder may
 * legitimately appear twice in the source and once in the translation (or the
 * model may reorder them), and neither is corruption. A *missing* index is.
 */
export function placeholdersPreserved(original: string, translated: string): boolean {
  const actual = placeholderIndices(translated);
  for (const index of placeholderIndices(original)) {
    if (!actual.has(index)) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Block-level segmentation
 * ------------------------------------------------------------------ */

const FENCE_RE = /^\s*(```|~~~)/;
const HTML_ONLY_LINE = /^\s*<\/?[a-zA-Z][^>]*>\s*$/;
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FRONTMATTER_DELIM = /^---\s*$/;

/** True when a whole line/block should never be translated. */
function isProtectedLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '') return true;
  if (TABLE_SEPARATOR.test(trimmed) && trimmed.includes('|')) return true;
  if (HTML_ONLY_LINE.test(line)) return true;
  // A line that is nothing but an image/badge, possibly inside `<p align>`.
  if (/^\s*<p[^>]*>\s*(!?\[[^\]]*\]\([^)]*\)\s*)+<\/p>\s*$/.test(line)) return true;
  if (/^\s*!?\[[^\]]*\]\([^)]*\)\s*$/.test(line)) return true;
  // Horizontal rules.
  if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return true;
  return false;
}

/** Does this block contain any natural-language characters worth translating? */
function hasTranslatableContent(text: string): boolean {
  const withoutPlaceholders = text.replace(PLACEHOLDER_RE, '');
  // Letters from any script, excluding pure markup residue.
  return /[\p{L}]{2,}/u.test(withoutPlaceholders.replace(/[*_|>#`\-[\]()]/g, ' '));
}

/**
 * Split a Markdown document into protected and translatable blocks.
 * Fenced code blocks (including ```mermaid) are always a single protected block.
 */
export function segmentMarkdown(document: string): SegmentedDocument {
  // A UTF-8 BOM (very common on files written by Windows editors) stops
  // `^#` from matching, silently demoting the first heading to a paragraph.
  // CRLF does the same one line further down: the `\r` lands inside the last
  // translatable segment and leaks into the output.
  const normalized = document.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const blocks: DocBlock[] = [];
  const headings: SegmentedDocument['headings'] = [];

  let i = 0;
  // YAML front matter is metadata — never translate it.
  if (lines[0] !== undefined && FRONTMATTER_DELIM.test(lines[0])) {
    const fm = [lines[0]!];
    i = 1;
    while (i < lines.length && !FRONTMATTER_DELIM.test(lines[i]!)) { fm.push(lines[i]!); i++; }
    if (i < lines.length) { fm.push(lines[i]!); i++; }
    blocks.push({ kind: 'protect', text: fm.join('\n') });
  }

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block: consume until the closing fence.
    if (FENCE_RE.test(line)) {
      const fenceMatch = line.match(/^\s*(```|~~~)/)![1]!;
      const collected = [line];
      i++;
      while (i < lines.length) {
        collected.push(lines[i]!);
        const isClose = lines[i]!.trim().startsWith(fenceMatch);
        i++;
        if (isClose) break;
      }
      blocks.push({ kind: 'protect', text: collected.join('\n') });
      continue;
    }

    // Blank lines are structural separators — keep them protected.
    if (line.trim() === '') {
      blocks.push({ kind: 'protect', text: line });
      i++;
      continue;
    }

    // Headings: protect the marker, translate the text.
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const text = headingMatch[2]!;
      const { text: protectedText, placeholders } = protectInline(text);
      const blockIndex = blocks.length;
      if (hasTranslatableContent(protectedText)) {
        blocks.push({ kind: 'translate', text: protectedText, placeholders, prefix: `${'#'.repeat(level)} ` });
        headings.push({ blockIndex, level, text });
      } else {
        blocks.push({ kind: 'protect', text: line });
      }
      i++;
      continue;
    }

    // Consecutive non-blank, non-fence lines form one paragraph block.
    const paragraph: string[] = [];
    while (i < lines.length) {
      const current = lines[i]!;
      if (current.trim() === '' || FENCE_RE.test(current)) break;
      paragraph.push(current);
      i++;
    }
    const raw = paragraph.join('\n');

    if (paragraph.every(isProtectedLine)) {
      blocks.push({ kind: 'protect', text: raw });
      continue;
    }

    // Per-line protection keeps list items and table rows aligned.
    const outLines: string[] = [];
    const placeholders: string[] = [];
    for (const pLine of paragraph) {
      if (isProtectedLine(pLine)) { outLines.push(pLine); continue; }
      // Preserve leading markers (`> `, `- `, `1. `, `|`) around the payload.
      // A bullet only counts when whitespace follows it: `**Note**` at the
      // start of a quote line is bold text, and matching its first `*` as a
      // bullet used to leave a stray asterisk in the translated output.
      const marker = pLine.match(/^(\s*(?:>\s*|\|)?\s*(?:(?:[-*+]|\d+[.)])\s+)?(?:\|)?)/)?.[1] ?? '';
      const rest = pLine.slice(marker.length);
      const { text, placeholders: local } = protectInline(rest);
      // Renumber local placeholders into the block-level namespace.
      const renumbered = text.replace(PLACEHOLDER_RE, (_m, rawIdx: string) => {
        const idx = Number(rawIdx);
        placeholders.push(local[idx]!);
        return PLACEHOLDER(placeholders.length - 1);
      });
      outLines.push(marker + renumbered + (marker.endsWith('|') ? '' : trailingPipe(rest)));
    }
    const blockText = outLines.join('\n');
    if (hasTranslatableContent(blockText)) {
      blocks.push({ kind: 'translate', text: blockText, placeholders });
    } else {
      blocks.push({ kind: 'protect', text: raw });
    }
  }

  return { blocks, headings };
}

/** Table rows end with a `|` that protectInline may have swallowed. */
function trailingPipe(rest: string): string {
  return rest.trimEnd().endsWith('|') && !rest.endsWith('|') ? '|' : '';
}

/** Reassemble translated blocks into a full document. */
export function reassemble(segmented: SegmentedDocument, translated: Map<number, string>): string {
  return segmented.blocks
    .map((block, index) => {
      if (block.kind === 'protect') return block.text;
      const prefix = block.prefix ?? '';
      const value = translated.get(index) ?? block.text;
      return prefix + repairListMarkers(restoreInline(value, block.placeholders ?? []));
    })
    .join('\n');
}

/**
 * Statistical MT engines trim the space after a list or quote marker, turning
 * `- item` into `-item`, which Markdown renders as a literal dash instead of a
 * list. Re-inserting one space is safe; a leading `*` that belongs to `**bold**`
 * is left alone so emphasis is not broken in the process.
 */
export function repairListMarkers(text: string): string {
  return text.replace(
    /^([ \t]*(?:>[ \t]*)*)([-*+]|\d{1,3}[.)])(\S)/gm,
    (whole: string, lead: string, marker: string, next: string) => {
      // A leading `*` immediately followed by another `*` is bold text
      // (`**Note**`), not a bullet — inserting a space there would break it.
      if (marker === '*' && next === '*') return whole;
      return `${lead}${marker} ${next}`;
    },
  );
}
