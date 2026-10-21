import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ROOT } from './helpers.js';
import { parseReadme, slugify } from '../../src/readme/parse.js';

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function yaml(rel: string): unknown {
  return parseYaml(read(rel));
}

test('package metadata exposes both binaries and the CI action', () => {
  const pkg = JSON.parse(read('package.json')) as {
    version: string;
    bin: Record<string, string>;
    engine: string;
    files: string[];
  };
  assert.equal(pkg.version, '0.2.0');
  assert.deepEqual(Object.keys(pkg.bin).sort(), ['readme-smith', 'rf']);
  for (const target of Object.values(pkg.bin)) assert.ok(target.startsWith('./dist/'));
  assert.ok(pkg.files.includes('dist'));
  assert.ok(pkg.files.includes('action.yml'));
  assert.ok(pkg.files.includes('README.md'));
  assert.ok(pkg.files.includes('CHANGELOG.md'));
});

test('the lockfile and changelog agree on the version', () => {
  const lock = JSON.parse(read('package-lock.json')) as { version: string; packages: Record<string, { version?: string }> };
  assert.equal(lock.version, '0.2.0');
  assert.equal(lock.packages['']?.version, '0.2.0');
  assert.match(read('CHANGELOG.md'), /## \[0\.2\.0\]/);
});

test('action.yml is a composite action with check and proposal modes', () => {
  const action = yaml('action.yml') as {
    runs: { using: string; steps: Array<{ uses?: string }> };
    inputs: Record<string, { default?: string }>;
    outputs: Record<string, unknown>;
  };
  assert.equal(action.runs.using, 'composite');
  assert.ok(action.runs.steps.some((step) => step.uses === 'actions/setup-node@v4'));
  assert.ok(action.inputs.mode);
  assert.ok(action.inputs['min-score']);
  assert.equal(action.inputs.ai?.default, 'off');
  assert.equal(action.inputs['changed-only']?.default, 'false');
  assert.ok('base' in action.inputs);
  assert.ok(action.outputs.score);
  assert.ok(action.outputs['affected-packages']);
  assert.ok(action.outputs['draft-path']);
  const text = read('action.yml');
  assert.match(text, /check/);
  assert.match(text, /proposal/);
});

test('every workflow, issue template and hook parses as YAML', () => {
  const files = [
    '.pre-commit-hooks.yaml',
    ...readdirSync(path.join(ROOT, '.github/workflows')).map((f) => `.github/workflows/${f}`),
    ...readdirSync(path.join(ROOT, '.github/ISSUE_TEMPLATE')).map((f) => `.github/ISSUE_TEMPLATE/${f}`),
  ];
  for (const rel of files) {
    const doc = yaml(rel);
    assert.notEqual(doc, null, `${rel} should not be empty`);
  }
  const hooks = yaml('.pre-commit-hooks.yaml') as Array<{ id: string; entry: string; args: string[] }>;
  assert.equal(hooks[0]?.id, 'readme-smith');
  assert.match(hooks[0]?.entry ?? '', /rf check/);
  assert.deepEqual(hooks[0]?.args, ['--min-score', '80']);
});

test('README table-of-contents anchors resolve to real headings', () => {
  const text = read('README.md');
  const parsed = parseReadme(text);
  const anchors = [...text.matchAll(/^- \[[^\]]+\]\(#([^)]+)\)$/gm)].map((m) => m[1]!);
  assert.ok(anchors.length >= 5);
  const slugs = new Set(parsed.headings.map((h) => slugify(h.text)));
  for (const anchor of anchors) assert.ok(slugs.has(anchor), `missing heading for #${anchor}`);
});

test('README documents the required commands and never claims README edits by draft', () => {
  const text = read('README.md');
  for (const command of ['rf scan', 'rf draft', 'rf diff', 'rf doctor', 'rf check', 'rf apply', 'rf init']) {
    assert.ok(text.includes(command), `README should document ${command}`);
  }
  assert.match(text, /绝不修改 `README\.md`/);
  assert.match(text, /#rf-skip/);
  assert.match(text, /\[CONTRIBUTING\.md\]\(CONTRIBUTING\.md\)/);
});

test('the project contains no obviously committed secrets', () => {
  const files = [
    'README.md',
    'CONTRIBUTING.md',
    'CHANGELOG.md',
    'action.yml',
    '.pre-commit-hooks.yaml',
    'package.json',
  ];
  const secret = /\b(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/;
  for (const rel of files) assert.doesNotMatch(read(rel), secret, `${rel} contains a credential-like string`);
});
