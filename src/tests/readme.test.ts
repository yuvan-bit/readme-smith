import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fixture, tempFixture, tempDir } from './helpers.js';
import { analyseReadme, analyseCodeCommands, parseReadme } from '../readme/parse.js';
import { scoreReadme } from '../readme/score.js';
import { scanFacts } from '../facts/index.js';
import { defaultWeights } from '../config.js';
import type { FactSheet, PresetId } from '../types.js';

function scanFixture(name: string): FactSheet {
  return scanFacts({ root: fixture(name), skipGit: true });
}

function reportFor(root: string, facts: FactSheet, preset: PresetId, threshold = 80) {
  const analysis = analyseReadme(root, facts, preset);
  return scoreReadme({
    facts,
    analysis,
    root,
    weights: defaultWeights(preset),
    preset,
    threshold,
  });
}

test('parses ATX headings, fenced blocks and preamble', () => {
  const parsed = parseReadme([
    '# Demo',
    '',
    'A short introduction that is long enough to count.',
    '',
    '## Usage',
    '',
    '```ts',
    'const answer = 42;',
    '```',
    '',
    '```',
    'plain text',
    '```',
    '',
    '## License',
    '',
    'MIT',
  ].join('\n'));

  assert.deepEqual(parsed.headings.map((h) => [h.level, h.text]), [
    [1, 'Demo'],
    [2, 'Usage'],
    [2, 'License'],
  ]);
  assert.equal(parsed.codeBlocks.length, 2);
  assert.equal(parsed.codeBlocks[0]?.lang, 'ts');
  assert.equal(parsed.codeBlocks[1]?.lang, null);
  assert.deepEqual(parsed.sections.map((s) => s.title), ['Usage', 'License']);
  assert.match(parsed.intro, /A short introduction/);
  assert.equal(parsed.licenseStatement, 'MIT');
});

test('a short sentence before the first section counts as an introduction', () => {
  const facts = scanFixture('go-service');
  const analysis = analyseReadme(fixture('go-service'), facts, 'cli');
  const report = reportFor(fixture('go-service'), facts, 'cli');
  assert.equal(analysis.standard.intro, true);
  assert.equal(report.missing.some((item) => item.code === 'missing_intro'), false);
});

test('parses Setext headings and ignores fences while scanning headings', () => {
  const parsed = parseReadme([
    'Project Name',
    '============',
    '',
    'Intro text.',
    '',
    'Usage',
    '-----',
    '',
    '```md',
    '## Not a heading',
    '```',
  ].join('\n'));

  assert.deepEqual(parsed.headings.map((h) => [h.level, h.text]), [
    [1, 'Project Name'],
    [2, 'Usage'],
  ]);
  assert.equal(parsed.codeBlocks.length, 1);
  assert.equal(parsed.sections.length, 1);
});

test('detects English and Chinese READMEs', () => {
  const english = parseReadme('# Demo\n\nThis is a small project written in English for developers.\n');
  assert.equal(english.language, 'en');
  const chinese = parseReadme('# 演示\n\n这是一个用中文编写的项目，用来展示语言检测是否可靠。\n');
  assert.equal(chinese.language, 'zh');
  const tiny = parseReadme('# x\n');
  assert.equal(tiny.language, 'auto');
});

test('standard section detection is case-insensitive', () => {
  const facts = scanFixture('node-cli');
  const analysis = analyseReadme(fixture('node-cli'), facts, 'cli');
  assert.deepEqual(analysis.standard, {
    title: true,
    intro: true,
    install: true,
    usage: true,
    license: true,
    contributing: true,
    demo: true,
    packages: false,
    configuration: true,
  });
});

test('validates scripts, package-manager built-ins and environment variables', () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    const facts = scanFacts({ root, skipGit: true });
    const parsed = parseReadme([
      '# acme-tool',
      '',
      'A synthetic README long enough for the introduction check.',
      '',
      '## Usage',
      '',
      '```bash',
      'npm run build',
      'npm run deploy',
      'npm install',
      'ACME_SECRET=abc npm run deploy',
      '```',
      '',
      '| Variable | Purpose |',
      '| --- | --- |',
      '| `ACME_TOKEN` | required |',
      '| `NOT_DECLARED_VAR` | made up |',
      '',
      '## License',
      '',
      'MIT',
    ].join('\n'));
    const { commands, envMentions } = analyseCodeCommands(parsed, facts);

    const build = commands.find((c) => c.raw === 'npm run build');
    assert.equal(build?.valid, true);
    const deploy = commands.find((c) => c.raw === 'npm run deploy');
    assert.equal(deploy?.valid, false);
    assert.match(deploy?.detail ?? '', /not declared/);
    const install = commands.find((c) => c.raw === 'npm install');
    assert.equal(install?.valid, null, 'package-manager built-ins are not project scripts');
    const prefixed = commands.find((c) => c.raw === 'ACME_SECRET=abc npm run deploy');
    assert.equal(prefixed?.valid, false, 'env-prefixed command was not validated');
    assert.match(prefixed?.detail ?? '', /not declared/);

    const known = envMentions.find((e) => e.name === 'ACME_TOKEN');
    assert.equal(known?.known, true);
    const unknown = envMentions.find((e) => e.name === 'NOT_DECLARED_VAR');
    assert.equal(unknown?.known, false);
  } finally {
    cleanup();
  }
});

test('a complete fixture README scores 100', () => {
  const facts = scanFixture('node-cli');
  const report = reportFor(fixture('node-cli'), facts, 'cli', 85);
  assert.equal(report.score, 100);
  assert.equal(report.passed, true);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.dimensions.map((d) => d.score), [35, 25, 20, 10, 10]);
});

test('unknown commands and environment variables reduce accuracy with line numbers', () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    writeFileSync(path.join(root, 'README.md'), [
      '# acme-tool',
      '',
      'A synthetic README long enough for the introduction check.',
      '',
      '## Usage',
      '',
      '```bash',
      'npm run build',
      'npm run deploy',
      '```',
      '',
      '| Variable | Purpose |',
      '| --- | --- |',
      '| `NOT_DECLARED_VAR` | made up |',
    ].join('\n'));
    const facts = scanFacts({ root, skipGit: true });
    const report = reportFor(root, facts, 'cli');
    const accuracy = report.dimensions.find((d) => d.id === 'accuracy');
    assert.ok(accuracy);
    assert.ok(accuracy.score < accuracy.max);
    assert.ok(report.missing.some((i) => i.code === 'command_not_found' && i.line));
    assert.ok(report.missing.some((i) => i.code === 'env_not_found'));
  } finally {
    cleanup();
  }
});

test('a licence mismatch is an accuracy issue', () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    const readme = readFileSync(path.join(root, 'README.md'), 'utf8').replace('MIT. See', 'Apache-2.0. See');
    writeFileSync(path.join(root, 'README.md'), readme);
    const facts = scanFacts({ root, skipGit: true });
    const report = reportFor(root, facts, 'cli');
    assert.ok(report.missing.some((i) => i.code === 'license_mismatch'));
    const accuracy = report.dimensions.find((d) => d.id === 'accuracy');
    assert.ok(accuracy && accuracy.score < accuracy.max);
  } finally {
    cleanup();
  }
});

test('unlabelled code blocks and missing TOC reduce readability', () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    writeFileSync(path.join(root, 'README.md'), [
      '# acme-tool',
      '',
      'A synthetic README long enough for the introduction check.',
      '',
      '## Usage',
      '',
      '```',
      'acme --help',
      '```',
      '',
      '## Installation',
      '',
      '```bash',
      'npm install -g acme-tool',
      '```',
      '',
      '## Configuration',
      '',
      'Nothing to configure.',
      '',
      '## Demo',
      '',
      'No demo.',
      '',
      '## Contributing',
      '',
      'See CONTRIBUTING.md.',
      '',
      '## License',
      '',
      'MIT',
    ].join('\n'));
    const facts = scanFacts({ root, skipGit: true });
    const analysis = analyseReadme(root, facts, 'cli');
    assert.equal(analysis.unlabelledCodeBlocks, 1);
    const report = scoreReadme({
      facts,
      analysis,
      root,
      weights: defaultWeights('cli'),
      preset: 'cli',
      threshold: 80,
    });
    const readability = report.dimensions.find((d) => d.id === 'readability');
    assert.ok(readability && readability.score < readability.max);
    assert.ok(report.missing.some((i) => i.code === 'unlabelled_code'));
    assert.ok(report.missing.some((i) => i.code === 'missing_toc'));
  } finally {
    cleanup();
  }
});

test('a missing README scores zero freshness and reports missing_readme', () => {
  const facts = scanFixture('node-cli');
  const { root, cleanup } = tempDir();
  try {
    const report = reportFor(root, facts, 'cli');
    assert.ok(report.missing.some((i) => i.code === 'missing_readme'));
    assert.equal(report.dimensions.find((d) => d.id === 'freshness')?.score, 0);
    assert.ok(report.score < 50);
  } finally {
    cleanup();
  }
});

test('freshness is neutral when git facts are unavailable', () => {
  const facts = scanFixture('node-cli');
  const report = reportFor(fixture('node-cli'), facts, 'cli');
  assert.equal(report.dimensions.find((d) => d.id === 'freshness')?.score, 10);
});

test('the dataset preset does not require an install section', () => {
  const facts = scanFixture('dataset');
  const analysis = analyseReadme(fixture('dataset'), facts, 'dataset');
  assert.equal(analysis.standard.install, false);
  assert.equal(analysis.standard.usage, false);
  const report = reportFor(fixture('dataset'), facts, 'dataset');
  assert.ok(!report.missing.some((i) => i.code === 'missing_install' && i.message.includes('No install')));
});

test('a header-only README fails the threshold', () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    writeFileSync(path.join(root, 'README.md'), '# acme-tool\n');
    const facts = scanFacts({ root, skipGit: true });
    const report = reportFor(root, facts, 'cli');
    assert.equal(report.passed, false);
    assert.ok(report.score < 60);
  } finally {
    cleanup();
  }
});
