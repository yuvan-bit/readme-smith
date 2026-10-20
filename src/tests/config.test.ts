import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tempDir } from './helpers.js';
import {
  configTemplate,
  defaultConfig,
  defaultWeights,
  initConfig,
  loadConfig,
} from '../config.js';

test('default weights always sum to 100 and follow the preset', () => {
  for (const preset of ['auto', 'cli', 'lib', 'web', 'monorepo', 'dataset'] as const) {
    const weights = defaultWeights(preset);
    const sum = Object.values(weights).reduce((total, value) => total + value, 0);
    assert.equal(sum, 100, `weights for ${preset}`);
  }
  assert.equal(defaultWeights('web').completeness, 30);
  assert.equal(defaultWeights('web').usability, 30);
  assert.equal(defaultWeights('dataset').completeness, 40);
});

test('defaultConfig is explicit and reproducible', () => {
  assert.deepEqual(defaultConfig('cli'), {
    version: 1,
    preset: 'cli',
    language: 'auto',
    minScore: 80,
    ai: { backend: 'local', baseUrl: null, model: null },
    weights: defaultWeights('cli'),
  });
});

test('loadConfig falls back to defaults when no file exists', () => {
  const { root, cleanup } = tempDir();
  try {
    const loaded = loadConfig(root);
    assert.equal(loaded.path, null);
    assert.equal(loaded.weightsExplicit, false);
    assert.deepEqual(loaded.warnings, []);
    assert.equal(loaded.config.minScore, 80);
  } finally {
    cleanup();
  }
});

test('loadConfig reads scalar settings, AI options and explicit weights', () => {
  const { root, cleanup } = tempDir();
  try {
    writeFileSync(path.join(root, '.readme-smith.yaml'), [
      'preset: web',
      'language: zh',
      'minScore: 90',
      'ai:',
      '  backend: off',
      '  baseUrl: http://127.0.0.1:11434/v1',
      '  model: custom',
      'weights:',
      '  completeness: 20',
      '  usability: 20',
      '  accuracy: 20',
      '  readability: 20',
      '  freshness: 20',
    ].join('\n'));
    const loaded = loadConfig(root);
    assert.equal(loaded.path, '.readme-smith.yaml');
    assert.deepEqual(loaded.warnings, []);
    assert.equal(loaded.weightsExplicit, true);
    assert.deepEqual(loaded.config, {
      version: 1,
      preset: 'web',
      language: 'zh',
      minScore: 90,
      ai: { backend: 'off', baseUrl: 'http://127.0.0.1:11434/v1', model: 'custom' },
      weights: { completeness: 20, usability: 20, accuracy: 20, readability: 20, freshness: 20 },
    });
  } finally {
    cleanup();
  }
});

test('loadConfig rejects invalid values with warnings and keeps defaults', () => {
  const { root, cleanup } = tempDir();
  try {
    writeFileSync(path.join(root, '.readme-smith.yml'), [
      'preset: website',
      'language: fr',
      'minScore: 150',
      'ai:',
      '  backend: cloud',
      'weights:',
      '  completeness: 90',
      '  usability: 90',
    ].join('\n'));
    const loaded = loadConfig(root);
    assert.equal(loaded.config.preset, 'auto');
    assert.equal(loaded.config.language, 'auto');
    assert.equal(loaded.config.minScore, 80);
    assert.equal(loaded.config.ai.backend, 'local');
    assert.equal(loaded.weightsExplicit, false);
    assert.equal(loaded.warnings.length, 5);
    assert.ok(loaded.warnings.some((w) => /preset "website"/.test(w)));
    assert.ok(loaded.warnings.some((w) => /language must be/.test(w)));
    assert.ok(loaded.warnings.some((w) => /minScore/.test(w)));
    assert.ok(loaded.warnings.some((w) => /ai\.backend/.test(w)));
    assert.ok(loaded.warnings.some((w) => /weights must sum to 100/.test(w)));
  } finally {
    cleanup();
  }
});

test('loadConfig warns about a YAML syntax error instead of crashing', () => {
  const { root, cleanup } = tempDir();
  try {
    writeFileSync(path.join(root, '.readme-smith.yaml'), 'preset: [unclosed\n');
    const loaded = loadConfig(root);
    assert.equal(loaded.config.preset, 'auto');
    assert.ok(loaded.warnings.some((w) => /Could not parse/.test(w)));
  } finally {
    cleanup();
  }
});

test('the generated template parses back to the documented defaults', () => {
  const { root, cleanup } = tempDir();
  try {
    writeFileSync(path.join(root, '.readme-smith.yaml'), configTemplate());
    const loaded = loadConfig(root);
    assert.deepEqual(loaded.warnings, []);
    assert.equal(loaded.weightsExplicit, true);
    assert.equal(loaded.config.preset, 'auto');
    assert.equal(loaded.config.minScore, 80);
    assert.equal(loaded.config.ai.backend, 'local');
    assert.deepEqual(loaded.config.weights, defaultWeights('auto'));
  } finally {
    cleanup();
  }
});

test('initConfig creates once and overwrites only with force', () => {
  const { root, cleanup } = tempDir();
  try {
    const first = initConfig(root, false);
    assert.deepEqual(first, { path: '.readme-smith.yaml', created: true });
    assert.ok(existsSync(path.join(root, '.readme-smith.yaml')));

    writeFileSync(path.join(root, '.readme-smith.yaml'), 'preset: cli\n');
    const second = initConfig(root, false);
    assert.equal(second.created, false);
    assert.equal(readFileSync(path.join(root, '.readme-smith.yaml'), 'utf8'), 'preset: cli\n');

    const third = initConfig(root, true);
    assert.equal(third.created, true);
    assert.match(readFileSync(path.join(root, '.readme-smith.yaml'), 'utf8'), /version: 1/);
  } finally {
    cleanup();
  }
});
