import test from 'node:test';
import assert from 'node:assert/strict';
import { affectedPackageTargets } from '../../src/ci/affected.js';
import { fixture } from './helpers.js';

test('affected targets include workspace manifests and package READMEs only', () => {
  const targets = affectedPackageTargets(fixture('monorepo'), [
    'package.json',
    'README.md',
    'packages/a/package.json',
    'packages/b/README.md',
    'docs/guide.md',
    'packages/a/node_modules/zod/package.json',
  ]);
  assert.deepEqual(targets, ['packages/a', 'packages/b']);
});

test('affected targets ignore manifests outside a package directory', () => {
  const targets = affectedPackageTargets(fixture('node-cli'), [
    'examples/demo/package.json',
    'package.json',
    'README.md',
  ]);
  assert.deepEqual(targets, []);
});
