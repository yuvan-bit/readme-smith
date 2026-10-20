import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDiff, diffLines, unifiedExcerpt } from '../diff/structured.js';

const BASE = [
  '# acme-tool',
  '',
  'Formats widgets from the command line.',
  '',
  '## Usage',
  '',
  'Run it.',
  '',
  '## License',
  '',
  'MIT',
].join('\n');

test('identical documents have no changes', () => {
  const diff = computeDiff(BASE, BASE);
  assert.equal(diff.hasChanges, false);
  assert.deepEqual(diff.changes, []);
  assert.deepEqual(diff.summary, { added: 0, removed: 0, changed: 0 });
  assert.equal(diff.unified, '');
});

test('an appended section is reported as added', () => {
  const draft = `${BASE}\n\n## Contributing\n\nPull requests are welcome.\n`;
  const diff = computeDiff(BASE, draft);
  assert.equal(diff.hasChanges, true);
  assert.deepEqual(diff.changes.map((c) => [c.kind, c.title]), [['added', 'Contributing']]);
  assert.equal(diff.changes[0]?.added, 1);
  assert.equal(diff.summary.added, 1);
});

test('a removed section is reported with its line count', () => {
  const draft = BASE.replace(/\n## License\n\nMIT$/, '');
  const diff = computeDiff(BASE, draft);
  assert.deepEqual(diff.changes.map((c) => [c.kind, c.title, c.removed]), [['removed', 'License', 1]]);
  assert.equal(diff.summary.removed, 1);
});

test('a modified section reports counts and the first difference', () => {
  const draft = BASE.replace('Run it.', 'Run it twice.');
  const diff = computeDiff(BASE, draft);
  assert.equal(diff.changes.length, 1);
  const change = diff.changes[0]!;
  assert.equal(change.kind, 'changed');
  assert.equal(change.title, 'Usage');
  assert.equal(change.added, 1);
  assert.equal(change.removed, 1);
  assert.equal(change.firstDifference?.actual, 'Run it.');
  assert.equal(change.firstDifference?.expected, 'Run it twice.');
  assert.equal(change.firstDifference?.line, 7);
});

test('title and introduction changes are reported as a preamble change', () => {
  const draft = BASE.replace('# acme-tool', '# acme-toolkit').replace('Formats widgets', 'Formats many widgets');
  const diff = computeDiff(BASE, draft);
  assert.equal(diff.changes.length, 1);
  assert.deepEqual(
    [diff.changes[0]?.kind, diff.changes[0]?.title],
    ['changed', 'acme-tool'],
  );
});

test('a new draft from an empty README is all additions', () => {
  const diff = computeDiff('', BASE);
  assert.equal(diff.hasChanges, true);
  assert.deepEqual(diff.changes.map((c) => c.kind), ['added', 'added', 'added']);
});

test('unified excerpts carry file headers, hunks and markers', () => {
  const draft = `${BASE}\n\n## Contributing\n\nPull requests are welcome.\n`;
  const excerpt = unifiedExcerpt(BASE, draft);
  assert.match(excerpt, /^--- README\.md/m);
  assert.match(excerpt, /^\+\+\+ README\.draft\.md/m);
  assert.match(excerpt, /^@@ /m);
  assert.match(excerpt, /^\+## Contributing$/m);
  assert.match(excerpt, /^\+Pull requests are welcome\.$/m);
});

test('diffLines keeps shared context and reports old and new line numbers', () => {
  const ops = diffLines(['a', 'b', 'c'], ['a', 'B', 'c']);
  assert.deepEqual(ops.map((o) => o.type), [' ', '-', '+', ' ']);
  assert.deepEqual(ops.map((o) => [o.oldLine, o.newLine]), [[1, 1], [2, 2], [3, 2], [3, 3]]);
});
