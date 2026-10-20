import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectCliCommands } from './cli-detect.js';

/**
 * The extractor reads source from disk, so these tests write real files into a
 * temporary directory rather than feeding strings in. That also keeps the
 * promise the module makes: nothing the scanned project contains is executed,
 * only pattern-matched.
 */
function source(t: { after: (fn: () => void) => void }, name: string, text: string): Array<{ rel: string; abs: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-smith-detect-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, text, 'utf8');
  return [{ rel: name, abs }];
}

test('flags declared through new Option are part of the command surface', (t) => {
  const files = source(t, 'cli.ts', [
    `import { Command, Option } from 'commander';`,
    `const program = new Command();`,
    `program`,
    `  .command('serve')`,
    `  .description('start the server')`,
    `  .option('-p, --port <n>', 'port to listen on')`,
    `  .addOption(new Option('--log <level>', 'verbosity').choices(['info', 'debug']))`,
    `  .command('watch')`,
    `  .description('restart on change');`,
    `program.parse();`,
  ].join('\n'));

  const detection = detectCliCommands(files, ['taskflow']);
  assert.equal(detection.framework, 'commander');

  const serve = detection.commands.find((command) => command.name === 'serve');
  assert.ok(serve, `serve should be detected, got ${detection.commands.map((c) => c.name).join(', ')}`);
  assert.deepEqual(serve!.flags, ['-p, --port <n>', '--log <level>']);
  assert.deepEqual(detection.commands.map((command) => command.name), ['serve', 'watch']);
});

test('the scan keeps every flag, because the renderer decides what fits a table', (t) => {
  const declared = Array.from({ length: 25 }, (_, i) => `  .option('--flag-${i} <v>', 'option ${i}')`);
  const files = source(t, 'cli.ts', [
    `import { Command } from 'commander';`,
    `const program = new Command();`,
    `program`,
    `  .command('serve')`,
    `  .description('start the server')`,
    ...declared,
    `  .parse();`,
  ].join('\n'));

  const [command] = detectCliCommands(files, ['taskflow']).commands;
  assert.ok(command, 'serve should be detected');
  assert.equal(command!.flags?.length, 25, 'nothing may be dropped before rendering');
});

test('a project that uses no known CLI framework yields no commands', (t) => {
  const files = source(t, 'index.ts', 'export const value = 1;\n');
  const detection = detectCliCommands(files, ['taskflow']);
  assert.deepEqual(detection.commands, []);
  assert.equal(detection.framework, undefined);
});
