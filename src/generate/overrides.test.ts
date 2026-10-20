import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadSectionOverrides, OVERRIDE_DIR } from './overrides.js';
import type { Lang } from '../types.js';

/**
 * The loader is the only thing standing between a hand-written README and a
 * silently discarded one, so every way a file can be wrong has to be reported
 * rather than ignored.
 */
function forge(t: TestContext, files: Record<string, string>, langs: Lang[] = ['en', 'zh']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-smith-overrides-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, OVERRIDE_DIR));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, OVERRIDE_DIR, name), body);
  }
  return loadSectionOverrides(root, langs);
}

test('a matching pair loads under both language keys', (t) => {
  const loaded = forge(t, {
    'highlights.en.md': '- English prose.\n',
    'highlights.zh.md': '- 中文正文。\n',
  });
  assert.deepEqual(loaded.values, {
    'highlights:en': '- English prose.',
    'highlights:zh': '- 中文正文。',
  });
  assert.deepEqual(loaded.warnings, []);
});

test('CRLF and a BOM never reach the rendered document', (t) => {
  const loaded = forge(t, { 'faq.en.md': '\uFEFF### Q\r\n\r\nA second line\r\n' });
  const body = loaded.values['faq:en']!;
  assert.doesNotMatch(body, /\r/, 'CRLF leaked into the override body');
  assert.doesNotMatch(body, /^\uFEFF/, 'BOM leaked into the override body');
  assert.match(body, /\n/);
});

test('a wrong file name is reported instead of silently ignored', (t) => {
  const loaded = forge(t, { 'highlights.md': '- no language', 'notes.txt': 'hello' });
  assert.deepEqual(loaded.values, {});
  assert.equal(loaded.warnings.length, 2);
  assert.match(loaded.warnings.join(' '), /<section>\.<lang>\.md/);
});

test('an unknown or fact-only section is refused with the list of what works', (t) => {
  const loaded = forge(t, {
    'temples.en.md': '- typo',
    'stats.en.md': '- derived facts',
    'stats.zh.md': '- 派生数据',
  });
  assert.deepEqual(loaded.values, {});
  assert.equal(loaded.warnings.length, 3);
  assert.match(loaded.warnings.join(' '), /highlights[\s\S]*roadmap/, 'the warning should list the overridable sections');
});

test('an empty override keeps the generated wording and says so', (t) => {
  const loaded = forge(t, { 'roadmap.en.md': '   \n', 'roadmap.zh.md': '- 真内容\n' });
  assert.deepEqual(Object.keys(loaded.values), ['roadmap:zh']);
  assert.match(loaded.warnings.join(' '), /roadmap\.en\.md is empty/);
});

test('a one-language override warns about the file that is missing', (t) => {
  const loaded = forge(t, { 'highlights.en.md': '- English only\n' });
  assert.deepEqual(Object.keys(loaded.values), ['highlights:en']);
  assert.match(loaded.warnings.join(' '), /highlights\.zh\.md/);
});

test('an override for a language that is not being generated is reported', (t) => {
  const loaded = forge(t, { 'highlights.zh.md': '- 中文正文\n', 'highlights.fr.md': '- français\n' }, ['en']);
  assert.deepEqual(loaded.values, {});
  assert.match(loaded.warnings.join(' '), /written for Simplified Chinese, but no README/);
  assert.match(loaded.warnings.join(' '), /written for an unsupported language \("fr"\)/);
});

test('a project without the directory loads nothing and warns nothing', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-smith-clean-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(loadSectionOverrides(root, ['en', 'zh']), { values: {}, warnings: [] });
});
