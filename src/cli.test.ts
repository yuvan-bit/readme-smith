import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * End-to-end tests for the `generate` command, run against the compiled CLI the
 * same way a user or a CI job would. The unit tests in `mermaid.test.ts` can
 * only prove the renderer is deterministic; whether `--check` agrees with what
 * `generate` leaves on disk depends on the scan feeding back through the file it
 * writes, and that only shows up when the two commands really touch a filesystem.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, 'cli.js');

interface Run { status: number; output: string }

function forge(t: { after: (fn: () => void) => void }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-smith-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'probe',
    version: '1.2.3',
    description: 'A probe package for CLI tests.',
    license: 'MIT',
  }), 'utf8');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'export const value = 1;\n', 'utf8');
  return root;
}

/** Run the CLI without letting a non-zero status throw. */
function run(args: string[]): Run {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const GENERATE = ['generate', '--lang', 'en', '--skip-git', '--unpublished'] as const;

function generate(root: string, extra: string[] = []): Run {
  return run([...GENERATE, root, ...extra]);
}

function check(root: string, extra: string[] = []): Run {
  return run([...GENERATE, root, '--check', ...extra]);
}

test('a README that was just generated passes --check without a second run', (t) => {
  const root = forge(t);
  const first = generate(root);
  assert.equal(first.status, 0, first.output);
  assert.ok(fs.existsSync(path.join(root, 'README.md')), 'generate should have written README.md');

  const result = check(root);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /README\.md is up to date/);
});

test('--check exits non-zero and quotes the line a hand edit changed', (t) => {
  const root = forge(t);
  assert.equal(generate(root).status, 0);

  const target = path.join(root, 'README.md');
  const text = fs.readFileSync(target, 'utf8');
  assert.ok(text.includes('A probe package for CLI tests.'), 'the manifest description is in the document');
  fs.writeFileSync(target, text.replace('A probe package for CLI tests.', 'Nothing here generates anything.'), 'utf8');

  const result = check(root);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /README\.md is out of date/);
  assert.match(result.output, /first difference at line \d+/);
  assert.match(result.output, /generated: .*A probe package for CLI tests/);
  assert.match(result.output, /on disk: .*Nothing here generates anything/);
  assert.match(result.output, /Re-run the same command without --check/);
});

test('a difference late in a long line is shown at the column where it happens', (t) => {
  const root = forge(t);
  assert.equal(generate(root).status, 0);

  const target = path.join(root, 'README.md');
  const lines = fs.readFileSync(target, 'utf8').split('\n');
  const index = lines.findIndex((line) => line.length > 140);
  assert.notEqual(index, -1, 'the badge block has a line long enough to test');
  // Editing the tail of a badge line used to print two identical-looking quotes,
  // because both sides were clipped to the same leading 96 characters.
  lines[index] = `${lines[index]!} hand-edited`;
  fs.writeFileSync(target, lines.join('\n'), 'utf8');

  const result = check(root);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, new RegExp(`first difference at line ${index + 1}, column ${lines[index]!.length - 11}`));

  const pair = /generated: (.*)\n      on disk:   (.*)/.exec(result.output);
  assert.ok(pair, 'both sides of the difference are quoted');
  assert.notEqual(pair![1], pair![2], 'the quoted windows have to differ where the lines do');
  assert.match(pair![2]!, /hand-edited/);
});

test('--check does not fail over line endings in a document the scan does not read', (t) => {
  const root = forge(t);
  // Written outside the scanned directory, so no byte statistic in the document
  // can depend on the endings of the file itself. What is left to test is the
  // comparison: CRLF and a stray trailing blank line are not drift, because git
  // with core.autocrlf would present the same commit either way.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-smith-out-'));
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

  assert.equal(generate(root, ['--out', outDir]).status, 0);
  const target = path.join(outDir, 'README.md');
  const text = fs.readFileSync(target, 'utf8');
  fs.writeFileSync(target, `${text.replace(/\r?\n/g, '\r\n')}\r\n\r\n`, 'utf8');

  const result = check(root, ['--out', outDir]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /is up to date/);
});

test('a repository with no README yet is reported as missing, not as matching', (t) => {
  const root = forge(t);
  const result = check(root);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /README\.md does not exist yet/);
});

test('a second generate writes nothing, so it leaves no backup of an unchanged file', (t) => {
  const root = forge(t);
  assert.equal(generate(root).status, 0);
  const target = path.join(root, 'README.md');
  const first = fs.readFileSync(target, 'utf8');

  const second = generate(root, ['--force']);
  assert.equal(second.status, 0, second.output);
  assert.equal(fs.readFileSync(target, 'utf8'), first);
  assert.match(second.output, /already matches what this command generates/);
  assert.ok(!/Re-rendering/.test(second.output), 'a stable repository needs no extra pass');
  assert.ok(!fs.existsSync(`${target}.bak`), 'rewriting identical content should not leave a backup');
});

test('--out writes there and --check compares against the same directory', (t) => {
  const root = forge(t);
  const outDir = path.join(root, 'docs');

  const result = generate(root, ['--out', outDir]);
  assert.equal(result.status, 0, result.output);
  assert.ok(fs.existsSync(path.join(outDir, 'README.md')), 'output went to --out');
  assert.ok(!fs.existsSync(path.join(root, 'README.md')), 'the project root stayed clean');

  // `docs/` did not exist when the first scan ran, so this is the same feedback
  // loop as a cold start and the stability passes have to settle it; `--check`
  // then reads the file from the directory it was written to, not the root.
  const checked = check(root, ['--out', outDir]);
  assert.equal(checked.status, 0, checked.output);
});

test('a stability pass keeps the notes the command added, not only the ones the scan found', (t) => {
  const root = forge(t);
  // No --unpublished, so the registry inference is reported. That note is what
  // puts the "this file is generated, edit .readme-smith/ instead" line in the
  // footer, and a re-scan for the fixed point cannot rediscover it.
  const result = run(['generate', '--lang', 'en', '--skip-git', root]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Registry badges and an install-from-registry step/);
  assert.ok(/Re-rendering/.test(result.output), 'this fixture needs a stability pass to test anything');

  const text = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(text, /This README is generated from the repository contents/);
  assert.match(text, /\.readme-smith\/<section>\.<lang>\.md/);

  const checked = run(['generate', '--lang', 'en', '--skip-git', root, '--check']);
  assert.equal(checked.status, 0, checked.output);
});

test('--check refuses the flags that mean "do not write a file to compare"', (t) => {
  const root = forge(t);
  const result = run([...GENERATE, root, '--check', '--stdout']);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /--check compares the README files on disk/);
  assert.match(result.output, /--stdout/);
});

test('the compiled CLI is what a user of the published package runs', () => {
  assert.ok(fs.existsSync(CLI), `expected a compiled CLI at ${CLI}`);
  assert.equal(path.extname(CLI), '.js', 'the entry point has to run on node, not on a TypeScript loader');

  const help = run(['generate', '--help']);
  assert.equal(help.status, 0, help.output);
  assert.match(help.output, /--check/);

  const sections = run(['sections']);
  assert.equal(sections.status, 0, sections.output);
  assert.match(sections.output, /highlights/);
});
