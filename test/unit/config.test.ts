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
  normalizeWeights,
} from '../../src/config.js';

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

test('normalizeWeights accepts relative values and always returns integers summing to 100', () => {
  assert.deepEqual(
    normalizeWeights({ completeness: 2, usability: 1, accuracy: 1, readability: 1, freshness: 1 }),
    { completeness: 33, usability: 17, accuracy: 17, readability: 17, freshness: 16 },
  );
  assert.deepEqual(
    normalizeWeights({ completeness: 1, usability: 1, accuracy: 1, readability: 1, freshness: 1 }),
    { completeness: 20, usability: 20, accuracy: 20, readability: 20, freshness: 20 },
  );
  assert.deepEqual(
    normalizeWeights({ completeness: 35, usability: 25, accuracy: 20, readability: 10, freshness: 10 }),
    { completeness: 35, usability: 25, accuracy: 20, readability: 10, freshness: 10 },
  );
  const fractional = normalizeWeights({ completeness: 1.5, usability: 1.5, accuracy: 1, readability: 1, freshness: 1 });
  assert.equal(Object.values(fractional ?? {}).reduce((sum, value) => sum + value, 0), 100);
  assert.equal(normalizeWeights({ completeness: 0, usability: 0, accuracy: 0, readability: 0, freshness: 0 }), null);
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

test('loadConfig normalizes relative weights instead of discarding the block', () => {
  const { root, cleanup } = tempDir();
  try {
    writeFileSync(path.join(root, '.readme-smith.yaml'), [
      'preset: cli',
      'weights:',
      '  completeness: 3',
      '  usability: 2',
      '  accuracy: 2',
      '  readability: 1',
      '  freshness: 1',
    ].join('\n'));
    const loaded = loadConfig(root);
    assert.deepEqual(loaded.warnings, []);
    assert.equal(loaded.weightsExplicit, true);
    assert.deepEqual(loaded.config.weights, {
      completeness: 34,
      usability: 22,
      accuracy: 22,
      readability: 11,
      freshness: 11,
    });
    assert.equal(Object.values(loaded.config.weights).reduce((sum, value) => sum + value, 0), 100);
  } finally {
    cleanup();
  }
});

test('loadConfig lets partial weights inherit preset defaults before normalization', () => {
  const { root, cleanup } = tempDir();
  try {
    writeFileSync(path.join(root, '.readme-smith.yaml'), [
      'preset: cli',
      'weights:',
      '  completeness: 50',
    ].join('\n'));
    const loaded = loadConfig(root);
    assert.deepEqual(loaded.warnings, []);
    assert.equal(loaded.weightsExplicit, true);
    assert.deepEqual(loaded.config.weights, {
      completeness: 43,
      usability: 22,
      accuracy: 17,
      readability: 9,
      freshness: 9,
    });
  } finally {
    cleanup();
  }
});

test('loadConfig falls back when every explicit weight is zero', () => {
  const { root, cleanup } = tempDir();
  try {
    writeFileSync(path.join(root, '.readme-smith.yaml'), [
      'preset: web',
      'weights:',
      '  completeness: 0',
      '  usability: 0',
      '  accuracy: 0',
      '  readability: 0',
      '  freshness: 0',
    ].join('\n'));
    const loaded = loadConfig(root);
    assert.equal(loaded.weightsExplicit, false);
    assert.deepEqual(loaded.config.weights, defaultWeights('web'));
    assert.ok(loaded.warnings.some((w) => /at least one positive/.test(w)));
  } finally {
    cleanup();
  }
});

test('loadConfig rejects invalid values with warnings and keeps scalar defaults', () => {
  const { root, cleanup } = tempDir();
  try {
    writeFileSync(path.join(root, '.readme-smith.yml'), [
      'preset: website',
      'language: fr',
      'minScore: 150',
      'ai:',
      '  backend: cloud',
      'weights:',
      '  completeness: -1',
      '  usability: 90',
    ].join('\n'));
    const loaded = loadConfig(root);
    assert.equal(loaded.config.preset, 'auto');
    assert.equal(loaded.config.language, 'auto');
    assert.equal(loaded.config.minScore, 80);
    assert.equal(loaded.config.ai.backend, 'local');
    assert.equal(loaded.weightsExplicit, true);
    assert.deepEqual(loaded.config.weights, { completeness: 21, usability: 55, accuracy: 12, readability: 6, freshness: 6 });
    assert.equal(loaded.warnings.length, 5);
    assert.ok(loaded.warnings.some((w) => /preset "website"/.test(w)));
    assert.ok(loaded.warnings.some((w) => /language must be/.test(w)));
    assert.ok(loaded.warnings.some((w) => /minScore/.test(w)));
    assert.ok(loaded.warnings.some((w) => /ai\.backend/.test(w)));
    assert.ok(loaded.warnings.some((w) => /weight "completeness"/.test(w)));
  } finally {
    cleanup();
  }
});

test('loadConfig ignores a weight block with no usable values', () => {
  const { root, cleanup } = tempDir();
  try {
    writeFileSync(path.join(root, '.readme-smith.yaml'), [
      'preset: cli',
      'weights:',
      '  completeness: -5',
      '  usability: heavy',
    ].join('\n'));
    const loaded = loadConfig(root);
    assert.equal(loaded.weightsExplicit, false);
    assert.deepEqual(loaded.config.weights, defaultWeights('cli'));
    assert.ok(loaded.warnings.some((w) => /no usable weights/.test(w)));
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
