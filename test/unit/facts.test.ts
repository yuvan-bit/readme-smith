import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { scanFacts } from '../../src/facts/index.js';
import { detectLicense } from '../../src/facts/license.js';
import { fixture, GOLDEN, tempDir } from './helpers.js';

test('node CLI fixture extracts executable, scripts and install commands', () => {
  const facts = scanFacts({ root: fixture('node-cli'), skipGit: true });
  assert.equal(facts.project.type, 'cli');
  assert.equal(facts.project.name, 'acme-tool');
  assert.equal(facts.project.version, '1.4.2');
  assert.equal(facts.project.description, 'Formats widgets from the command line.');
  assert.deepEqual(facts.binaries, ['acme']);
  assert.ok(facts.scripts.some((s) => s.name === 'build' && s.invocation === 'npm run build'));
  assert.equal(facts.install.development?.command, 'npm install');
  assert.equal(facts.install.consumer?.command, 'npm install -g acme-tool');
  assert.equal(facts.usage?.command, 'acme --help');
  assert.deepEqual(facts.env.map((e) => e.name).sort(), ['ACME_API_URL', 'ACME_DEBUG', 'ACME_TOKEN']);
  assert.equal(facts.project.license?.spdx, 'MIT');
  assert.equal(facts.project.license?.file, 'LICENSE');
  assert.equal(facts.ci[0]?.name, 'CI');
  assert.ok(facts.buildCommands.some((b) => b.command === 'npm run build'));
  assert.equal(facts.community.contributingPath, 'CONTRIBUTING.md');
  assert.ok(facts.configFiles.some((c) => c.path === '.env.example'));
  assert.ok(facts.configFiles.some((c) => c.path === 'Dockerfile' && c.kind === 'docker'));
});

test('licence detection accepts single-quoted MIT warranty text', () => {
  const { root, cleanup } = tempDir();
  try {
    writeFileSync(path.join(root, 'LICENSE'), [
      'MIT License',
      '',
      'Copyright (c) 2026 Example',
      '',
      'Permission is hereby granted, free of charge, to any person obtaining a copy',
      'of this software and associated documentation files (the "Software"), to deal',
      'in the Software without restriction.',
      '',
      "THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND.",
    ].join('\n'));
    assert.equal(detectLicense(root)?.spdx, 'MIT');
  } finally {
    cleanup();
  }
});

test('python fixture reads PEP 621 metadata and console scripts', () => {
  const facts = scanFacts({ root: fixture('python-lib'), skipGit: true });
  assert.equal(facts.project.type, 'cli');
  assert.equal(facts.project.name, 'acme-py');
  assert.equal(facts.project.version, '1.2.0');
  assert.equal(facts.project.license?.spdx, 'Apache-2.0');
  assert.equal(facts.project.license?.file, undefined);
  assert.deepEqual(facts.binaries, ['acme-py']);
  assert.equal(facts.install.development?.command, 'pip install -e .');
  assert.equal(facts.install.consumer?.command, 'pipx install acme-py');
  assert.equal(facts.usage?.command, 'acme-py --help');
  assert.deepEqual(facts.env.map((e) => e.name), ['ACME_HOME']);
  assert.equal(facts.stats.runtimeDependencies, 1);
  assert.equal(facts.stats.developmentDependencies, 1);
});

test('rust fixture only treats a real binary target as a CLI', () => {
  const facts = scanFacts({ root: fixture('rust-cli'), skipGit: true });
  assert.equal(facts.project.type, 'cli');
  assert.deepEqual(facts.binaries, ['acme-rs']);
  assert.equal(facts.install.development?.command, 'cargo build');
  assert.equal(facts.install.consumer?.command, 'cargo install acme-rs');
  assert.equal(facts.usage?.command, 'acme-rs --help');
  assert.deepEqual(facts.env.map((e) => e.name), ['ACME_KEY']);
  assert.equal(facts.project.license?.spdx, 'MIT');
});

test('go fixture derives the binary from package main', () => {
  const facts = scanFacts({ root: fixture('go-service'), skipGit: true });
  assert.equal(facts.project.type, 'cli');
  assert.deepEqual(facts.binaries, ['service']);
  assert.equal(facts.install.consumer?.command, 'go install example.com/acme/service@latest');
  assert.deepEqual(facts.env.map((e) => e.name), ['ACME_PORT']);
  assert.equal(facts.project.version, null);
});

test('ruby fixture merges gemspec metadata and executables', () => {
  const facts = scanFacts({ root: fixture('ruby-gem'), skipGit: true });
  assert.equal(facts.project.type, 'cli');
  assert.equal(facts.project.name, 'acme-gem');
  assert.equal(facts.project.version, '2.0.1');
  assert.deepEqual(facts.binaries, ['acme']);
  assert.equal(facts.install.development?.command, 'bundle install');
  assert.equal(facts.install.consumer?.command, 'gem install acme-gem');
  assert.deepEqual(facts.env.map((e) => e.name), ['ACME_ENV']);
  assert.equal(facts.project.license?.spdx, 'MIT');
});

test('monorepo fixture exposes workspace package directories', () => {
  const facts = scanFacts({ root: fixture('monorepo'), skipGit: true });
  assert.equal(facts.project.type, 'monorepo');
  assert.deepEqual(facts.packages, ['packages/a', 'packages/b']);
  assert.equal(facts.install.consumer, null);
  assert.ok(facts.scripts.some((s) => s.name === 'build'));
});

test('web fixture uses the dev script for usage', () => {
  const facts = scanFacts({ root: fixture('web-app'), skipGit: true });
  assert.equal(facts.project.type, 'web');
  assert.equal(facts.usage?.command, 'npm run dev');
  assert.equal(facts.install.consumer, null);
  assert.equal(facts.install.development?.command, 'npm install');
});

test('dataset fixture is recognised by data files, not by code', () => {
  const facts = scanFacts({ root: fixture('dataset'), skipGit: true });
  assert.equal(facts.project.type, 'dataset');
  assert.deepEqual(facts.data, { files: 3, formats: ['csv'] });
  assert.equal(facts.project.license?.spdx, 'MIT');
  assert.deepEqual(facts.manifests, []);
});

test('unknown fixture reports the type instead of guessing', () => {
  const facts = scanFacts({ root: fixture('unknown'), skipGit: true });
  assert.equal(facts.project.type, 'unknown');
  assert.equal(facts.project.typeConfidence, 0);
  assert.ok(facts.warnings.some((w) => w.includes('Project type could not be identified')));
});

const GOLDEN_CASES = [
  'node-cli',
  'python-lib',
  'rust-cli',
  'go-service',
  'ruby-gem',
  'monorepo',
  'web-app',
  'dataset',
  'unknown',
];

for (const name of GOLDEN_CASES) {
  test(`facts golden: ${name}`, () => {
    const facts = scanFacts({ root: fixture(name), skipGit: true });
    const json = JSON.stringify(facts, null, 2) + '\n';
    const goldenPath = path.join(GOLDEN, `${name}.facts.json`);
    if (process.env.UPDATE_GOLDEN === '1') {
      mkdirSync(GOLDEN, { recursive: true });
      writeFileSync(goldenPath, json);
      return;
    }
    assert.equal(json, readFileSync(goldenPath, 'utf8'));
  });
}
