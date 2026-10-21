import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fixture, tempFixture } from './helpers.js';
import { scanFacts } from '../facts/index.js';
import { buildDraft, resolveDraftLanguage, validateProse, requestCopy } from '../draft/index.js';
import type { AiSettings } from '../draft/index.js';
import type { FactSheet, LanguageSetting, PresetId } from '../types.js';

const AI_OFF: AiSettings = { backend: 'off', baseUrl: null, model: null };

async function draftFor(
  root: string,
  preset: PresetId,
  language: LanguageSetting = 'auto',
  ai: AiSettings = AI_OFF,
  force = false,
) {
  const facts = scanFacts({ root, skipGit: true });
  return buildDraft({ root, facts, preset, language, ai, force });
}

async function factsFor(name: string): Promise<FactSheet> {
  return scanFacts({ root: fixture(name), skipGit: true });
}

test('resolves draft language from explicit settings before the existing README', () => {
  assert.equal(resolveDraftLanguage('en', 'zh'), 'en');
  assert.equal(resolveDraftLanguage('zh', 'en'), 'zh');
  assert.equal(resolveDraftLanguage('auto', 'zh'), 'zh');
  assert.equal(resolveDraftLanguage('auto', 'en'), 'en');
  assert.equal(resolveDraftLanguage('auto', 'auto'), 'en');
});

test('a complete README is returned byte-for-byte in merge mode', async () => {
  const readme = readFileSync(path.join(fixture('node-cli'), 'README.md'), 'utf8');
  const draft = await draftFor(fixture('node-cli'), 'cli', 'auto', {
    backend: 'local',
    baseUrl: null,
    model: null,
  });
  assert.equal(draft.markdown, readme);
  assert.deepEqual(draft.addedSections, []);
  assert.equal(draft.aiUsed, false);
  assert.ok(draft.warnings.some((w) => /AI rewrite was skipped/.test(w)));
});

test('merge leaves a short but complete introduction untouched', async () => {
  const readme = readFileSync(path.join(fixture('go-service'), 'README.md'), 'utf8');
  const draft = await draftFor(fixture('go-service'), 'cli');
  assert.equal(draft.markdown, readme);
  assert.deepEqual(draft.addedSections, []);
});

test('merge adds only missing sections and preserves existing ones', async () => {  const { root, cleanup } = tempFixture('node-cli');
  try {
    writeFileSync(path.join(root, 'README.md'), [
      '# acme-tool',
      '',
      'Formats widgets from the command line.',
      '',
      '## Configuration',
      '',
      '| Variable | Evidence |',
      '| --- | --- |',
      '| `ACME_TOKEN` | `.env.example` |',
    ].join('\n'));
    const draft = await draftFor(root, 'cli');
    assert.deepEqual(draft.addedSections, ['Installation', 'Usage', 'Contributing', 'License']);
    assert.match(draft.markdown, /^# acme-tool\n\nFormats widgets from the command line\./);
    assert.match(draft.markdown, /## Configuration\n\n\| Variable \| Evidence \|/);
    assert.equal(draft.markdown.match(/## Installation/g)?.length, 1);
    assert.match(draft.markdown, /npm install -g acme-tool/);
    assert.match(draft.markdown, /acme --help/);
    assert.match(draft.markdown, /\[\`CONTRIBUTING\.md\`\]\(CONTRIBUTING\.md\)/);
    assert.match(draft.markdown, /Licensed under MIT/);
  } finally {
    cleanup();
  }
});

test('merging is a fixpoint once the draft is applied', async () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    writeFileSync(path.join(root, 'README.md'), '# acme-tool\n\nFormats widgets from the command line.\n');
    const first = await draftFor(root, 'cli');
    writeFileSync(path.join(root, 'README.md'), first.markdown);
    const second = await draftFor(root, 'cli');
    assert.equal(second.markdown, first.markdown);
    assert.deepEqual(second.addedSections, []);
  } finally {
    cleanup();
  }
});

test('a new monorepo draft is deterministic and lists workspace packages', async () => {
  const facts = await factsFor('monorepo');
  const draft = await draftFor(fixture('monorepo'), 'monorepo');
  assert.match(draft.markdown, /^# acme-workspace\n/);
  assert.match(draft.markdown, /A workspace with two widget packages\./);
  assert.match(draft.markdown, /## Installation/);
  assert.match(draft.markdown, /npm install/);
  assert.match(draft.markdown, /## Packages/);
  assert.match(draft.markdown, /`packages\/a`/);
  assert.match(draft.markdown, /`packages\/b`/);
  assert.ok(!draft.markdown.includes('[verify]'));
  assert.equal(draft.language, 'en');
  assert.match(draft.markdown, new RegExp(facts.project.name!));
});

test('Chinese drafts use Chinese headings and copy', async () => {
  const draft = await draftFor(fixture('monorepo'), 'monorepo', 'zh');
  assert.match(draft.markdown, /^# acme-workspace\n/);
  assert.match(draft.markdown, /## 安装/);
  assert.match(draft.markdown, /## 使用/);
  assert.match(draft.markdown, /## 项目结构/);
  assert.doesNotMatch(draft.markdown, /## Installation/);
  assert.equal(draft.language, 'zh');
});

test('an explicit language change regenerates the document without touching README.md', async () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    const before = readFileSync(path.join(root, 'README.md'), 'utf8');
    const draft = await draftFor(root, 'cli', 'zh');
    assert.equal(readFileSync(path.join(root, 'README.md'), 'utf8'), before);
    assert.equal(draft.language, 'zh');
    assert.match(draft.markdown, /## 安装/);
    assert.match(draft.markdown, /## 配置/);
    assert.doesNotMatch(draft.markdown, /## Configuration/);
    assert.ok(draft.warnings.some((w) => /--lang zh differs/.test(w)));
  } finally {
    cleanup();
  }
});

test('missing facts produce [verify] placeholders instead of guesses', async () => {
  const { root, cleanup } = tempFixture('unknown');
  try {
    const facts = scanFacts({ root, skipGit: true });
    const draft = await buildDraft({
      root,
      facts,
      preset: 'lib',
      language: 'en',
      ai: AI_OFF,
    });
    assert.match(draft.markdown, /\[verify\]/);
    assert.match(draft.markdown, /^# rf-(?:test|empty)-/);
  } finally {
    cleanup();
  }
});

test('custom templates are used for new or forced drafts and warn on unknown variables', async () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    const dir = path.join(root, '.readme-smith', 'templates');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'cli.md'),
      '# {{name}}\n\n{{description}}\n\nUnknown: {{mysteryVar}}\n\n{{installBlock}}\n',
    );
    const merged = await draftFor(root, 'cli');
    assert.ok(merged.warnings.some((w) => /only used for new drafts or with --force/.test(w)));

    const forced = await draftFor(root, 'cli', 'auto', AI_OFF, true);
    assert.match(forced.markdown, /^# acme-tool\n\nFormats widgets from the command line\./);
    assert.match(forced.markdown, /Unknown: \[verify\]/);
    assert.match(forced.markdown, /```bash\nnpm install -g acme-tool\n```/);
    assert.ok(forced.warnings.some((w) => /mysteryVar/.test(w)));
  } finally {
    cleanup();
  }
});

test('language-specific custom templates win over the generic one', async () => {
  const { root, cleanup } = tempFixture('monorepo');
  try {
    const dir = path.join(root, '.readme-smith', 'templates');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'monorepo.md'), '# generic {{name}}\n');
    writeFileSync(path.join(dir, 'monorepo.zh.md'), '# 中文 {{name}}\n');
    const draft = await draftFor(root, 'monorepo', 'zh');
    assert.match(draft.markdown, /^# 中文 acme-workspace/);
  } finally {
    cleanup();
  }
});

test('validateProse rejects invented commands, env vars, flags, licences and URLs', async () => {
  const facts = await factsFor('node-cli');
  assert.deepEqual(validateProse('acme-tool formats widgets. Use `npm run build` with `ACME_TOKEN`.', facts), []);
  assert.deepEqual(validateProse('acme-tool is licensed under MIT.', facts), []);

  const checks: Array<[string, RegExp]> = [
    ['Run `npm run deploy` to ship.', /undeclared script/],
    ['Set ${SECRET_VALUE} first.', /SECRET_VALUE/],
    ['Pass --turbo for speed.', /--turbo/],
    ['Licensed under Apache-2.0.', /Apache-2\.0/],
    ['See https://example.com for docs.', /example\.com/],
    ['Maintained by the Acme team.', /authorship/],
    ['Version 9.9.9 is the latest.', /version 9\.9\.9/],
  ];
  for (const [text, pattern] of checks) {
    assert.ok(validateProse(text, facts).some((issue) => pattern.test(issue)), `expected issue for: ${text}`);
  }
  assert.deepEqual(validateProse('   ', facts), ['AI returned empty prose.']);
});

test('requestCopy is a no-op when AI is off', async () => {
  const facts = await factsFor('node-cli');
  const result = await requestCopy(facts, 'en', AI_OFF);
  assert.equal(result.intro, null);
  assert.deepEqual(result.features, []);
  assert.equal(result.usageNote, null);
  assert.deepEqual(result.warnings, []);
});

test('requestCopy requires an OpenAI key for the cloud backend', async () => {
  const facts = await factsFor('node-cli');
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const result = await requestCopy(facts, 'en', { backend: 'openai', baseUrl: null, model: null });
    assert.equal(result.intro, null);
    assert.ok(result.warnings.some((w) => /OPENAI_API_KEY/.test(w)));
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test('requestCopy sends only facts and accepts validated copy', async () => {
  const facts = await factsFor('node-cli');
  let requestBody = '';
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requestBody = body;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          intro: 'acme-tool formats widgets from the command line. It is licensed under MIT.',
          features: ['Builds with the declared `npm run build` script.', 'Reads `ACME_TOKEN` from the environment.'],
          usageNote: 'Run the declared executable to see its options.',
        }) } }],
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const result = await requestCopy(facts, 'en', {
      backend: 'local',
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      model: 'stub-model',
    });
    assert.equal(result.intro, 'acme-tool formats widgets from the command line. It is licensed under MIT.');
    assert.deepEqual(result.features, [
      'Builds with the declared `npm run build` script.',
      'Reads `ACME_TOKEN` from the environment.',
    ]);
    assert.equal(result.usageNote, 'Run the declared executable to see its options.');
    assert.equal(result.provider, 'local:stub-model');
    assert.deepEqual(result.warnings, []);

    const payload = JSON.parse(requestBody) as {
      model: string;
      temperature: number;
      messages: Array<{ role: string; content: string }>;
    };
    assert.equal(payload.model, 'stub-model');
    assert.equal(payload.temperature, 0.2);
    assert.match(payload.messages[1]!.content, /FACTS:/);
    assert.match(payload.messages[1]!.content, /"name": "acme-tool"/);
    assert.match(payload.messages[1]!.content, /"features"/);
    assert.doesNotMatch(payload.messages[1]!.content, /process\.env/);
    assert.doesNotMatch(payload.messages[1]!.content, /import \{/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('AI features and usage notes are rendered, invalid fields are dropped', async () => {
  const { root, cleanup } = tempFixture('node-cli');
  const server = createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        intro: 'acme-tool formats widgets from the command line.',
        features: [
          'Builds with the declared `npm run build` script.',
          'Run `npm run deploy` to publish.',
          '## Heading injection',
          'Reads `ACME_TOKEN` from the environment.',
        ],
        usageNote: 'Run `acme --help` to list the supported flags.',
      }) } }],
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const facts = scanFacts({ root, skipGit: true });
    const draft = await buildDraft({
      root,
      facts,
      preset: 'cli',
      language: 'en',
      ai: {
        backend: 'local',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: 'stub-model',
      },
      force: true,
    });
    assert.equal(draft.aiUsed, true);
    assert.match(draft.markdown, /## Features\n\n- Builds with the declared `npm run build` script\./);
    assert.match(draft.markdown, /- Reads `ACME_TOKEN` from the environment\./);
    assert.doesNotMatch(draft.markdown, /npm run deploy/);
    assert.doesNotMatch(draft.markdown, /Heading injection/);
    assert.match(draft.markdown, /## Usage\n\nRun `acme --help` to list the supported flags\.\n\n```bash\nacme --help\n```/);
    assert.ok(draft.warnings.some((w) => /AI feature was rejected/.test(w)));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    cleanup();
  }
});

test('requestCopy falls back when the model invents facts', async () => {
  const facts = await factsFor('node-cli');
  const server = createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '{"intro":"Run npm run deploy and set SECRET_VALUE."}' } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const result = await requestCopy(facts, 'en', {
      backend: 'local',
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      model: 'stub-model',
    });
    assert.equal(result.intro, null);
    assert.deepEqual(result.features, []);
    assert.ok(result.warnings.some((w) => /validator/.test(w)));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('requestCopy falls back when the backend is unreachable', async () => {
  const facts = await factsFor('node-cli');
  const result = await requestCopy(facts, 'en', {
    backend: 'local',
    baseUrl: 'http://127.0.0.1:1/v1',
    model: 'nope',
  });
  assert.equal(result.intro, null);
  assert.ok(result.warnings.some((w) => /unavailable/.test(w)));
});
