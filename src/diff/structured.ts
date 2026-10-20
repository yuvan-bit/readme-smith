import type { SectionChange, StructuredDiff } from '../types.js';
import { parseReadme, type ParsedReadme } from '../readme/parse.js';

type OpType = ' ' | '-' | '+';
type RawOp = { type: OpType; text: string };
type Op = RawOp & { oldLine: number; newLine: number };

/** Section-level comparison of README.md against README.draft.md. */
export function computeDiff(readmeText: string, draftText: string): StructuredDiff {
  const actual = parseReadme(readmeText);
  const expected = parseReadme(draftText);
  const changes: SectionChange[] = [];

  const actualPreamble = actual.preamble.trim();
  const expectedPreamble = expected.preamble.trim();
  if (actualPreamble !== expectedPreamble) {
    const ops = diffLines(actualPreamble.split(/\r?\n/), expectedPreamble.split(/\r?\n/));
    changes.push({
      kind: actualPreamble ? 'changed' : 'added',
      title: actual.headings.find((h) => h.level === 1)?.text ?? 'Introduction',
      added: ops.filter((o) => o.type === '+').length,
      removed: ops.filter((o) => o.type === '-').length,
    });
  }

  const buckets = new Map<string, ParsedReadme['sections']>();
  for (const section of expected.sections) {
    const key = normaliseTitle(section.title);
    const bucket = buckets.get(key) ?? [];
    bucket.push(section);
    buckets.set(key, bucket);
  }

  const matched = new Set<ParsedReadme['sections'][number]>();
  for (const section of actual.sections) {
    const bucket = buckets.get(normaliseTitle(section.title));
    const counterpart = bucket?.shift();
    if (!counterpart) {
      changes.push({
        kind: 'removed',
        title: section.title,
        added: 0,
        removed: countLines(section.body),
      });
      continue;
    }
    matched.add(counterpart);
    if (section.body.trim() === counterpart.body.trim()) continue;
    const ops = diffLines(section.body.split(/\r?\n/), counterpart.body.split(/\r?\n/));
    const firstIndex = ops.findIndex((o) => o.type !== ' ');
    const first = firstIndex >= 0 ? ops[firstIndex] : undefined;
    const firstRemoved = ops.slice(Math.max(0, firstIndex)).find((o) => o.type === '-');
    const firstAdded = ops.slice(Math.max(0, firstIndex)).find((o) => o.type === '+');
    changes.push({
      kind: 'changed',
      title: section.title,
      added: ops.filter((o) => o.type === '+').length,
      removed: ops.filter((o) => o.type === '-').length,
      ...(first
        ? {
          firstDifference: {
            line: section.bodyStartLine + (firstRemoved ?? first).oldLine - 1,
            expected: firstAdded?.text ?? '',
            actual: firstRemoved?.text ?? '',
          },
        }
        : {}),
    });
  }

  for (const sections of buckets.values()) {
    for (const section of sections) {
      if (matched.has(section)) continue;
      changes.push({
        kind: 'added',
        title: section.title,
        added: countLines(section.body),
        removed: 0,
      });
    }
  }

  const summary = {
    added: changes.filter((c) => c.kind === 'added').length,
    removed: changes.filter((c) => c.kind === 'removed').length,
    changed: changes.filter((c) => c.kind === 'changed').length,
  };

  return {
    hasChanges: changes.length > 0,
    changes,
    summary,
    unified: unifiedExcerpt(readmeText, draftText),
  };
}

function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function countLines(body: string): number {
  return body.trim() ? body.trim().split(/\r?\n/).length : 0;
}

/**
 * Line diff based on an LCS table. Copied READMEs are small enough for this;
 * huge inputs fall back to a prefix/suffix comparison to stay bounded.
 */
export function diffLines(a: string[], b: string[]): Op[] {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) suffix++;

  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);
  const raw: RawOp[] = [];
  for (let i = 0; i < prefix; i++) raw.push({ type: ' ', text: a[i]! });

  if (midA.length * midB.length > 4_000_000) {
    for (const line of midA) raw.push({ type: '-', text: line });
    for (const line of midB) raw.push({ type: '+', text: line });
  } else {
    raw.push(...lcsDiff(midA, midB));
  }

  for (let i = 0; i < suffix; i++) raw.push({ type: ' ', text: a[a.length - suffix + i]! });

  let oldLine = 1;
  let newLine = 1;
  return raw.map((op) => {
    const numbered: Op = { ...op, oldLine, newLine };
    if (op.type !== '+') oldLine++;
    if (op.type !== '-') newLine++;
    return numbered;
  });
}

function lcsDiff(a: string[], b: string[]): RawOp[] {
  const n = a.length;
  const m = b.length;
  const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const ops: RawOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: ' ', text: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      ops.push({ type: '-', text: a[i]! });
      i++;
    } else {
      ops.push({ type: '+', text: b[j]! });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: '-', text: a[i]! });
    i++;
  }
  while (j < m) {
    ops.push({ type: '+', text: b[j]! });
    j++;
  }
  return ops;
}

export function unifiedExcerpt(readmeText: string, draftText: string, context = 3): string {
  const a = readmeText.split(/\r?\n/);
  const b = draftText.split(/\r?\n/);
  if (a.length * b.length > 16_000_000) {
    return '(diff too large for a terminal excerpt; review README.draft.md directly)';
  }
  const ops = diffLines(a, b);
  const changed = ops
    .map((op, index) => ({ op, index }))
    .filter(({ op }) => op.type !== ' ')
    .map(({ index }) => index);
  if (changed.length === 0) return '';

  const hunks: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(ops.length - 1, index + context);
    const last = hunks[hunks.length - 1];
    if (last && start <= last[1] + 1) last[1] = end;
    else hunks.push([start, end]);
  }

  const output: string[] = ['--- README.md', '+++ README.draft.md'];
  for (const [start, end] of hunks) {
    const slice = ops.slice(start, end + 1);
    const oldStart = slice[0]!.oldLine;
    const newStart = slice[0]!.newLine;
    const oldCount = slice.filter((o) => o.type !== '+').length;
    const newCount = slice.filter((o) => o.type !== '-').length;
    output.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    output.push(...slice.map((o) => `${o.type}${o.text}`));
  }
  return output.join('\n');
}
