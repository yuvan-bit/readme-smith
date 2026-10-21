import { mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const FIXTURES = fileURLToPath(new URL('../../../test/fixtures', import.meta.url));
export const GOLDEN = fileURLToPath(new URL('../../../test/golden', import.meta.url));
export const CLI = fileURLToPath(new URL('../../../dist/cli.js', import.meta.url));

const GENERATED_FILES = new Set(['README.draft.md', '.README.bak.md']);

export function fixture(name: string): string {
  return path.join(FIXTURES, name);
}

/** Copy a fixture into a throwaway directory so commands can write to it. */
export function tempFixture(name: string): { root: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), 'rf-test-'));
  cpSync(fixture(name), root, {
    recursive: true,
    // Manual CLI runs may leave drafts or backups inside the fixture.
    filter: (source) => !GENERATED_FILES.has(path.basename(source)),
  });
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Create an empty temporary directory. */
export function tempDir(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), 'rf-empty-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
