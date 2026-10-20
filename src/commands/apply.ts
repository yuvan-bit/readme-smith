import path from 'node:path';
import { copyFileSync, existsSync } from 'node:fs';
import { readTextSafe, writeTextSafe } from '../utils/fs.js';
import { README_FILE } from '../readme/parse.js';
import { computeDiff } from '../diff/structured.js';
import { log } from '../utils/logger.js';
import {
  applyVerbosity,
  CliError,
  EXIT,
  prepare,
  printJson,
  type CliOptions,
} from './shared.js';

export interface ApplyOptions extends CliOptions {
  dryRun?: boolean;
}

export function runApply(rawPath: string | undefined, options: ApplyOptions): number {
  applyVerbosity(options);
  const prepared = prepare(rawPath, options);
  const draft = readTextSafe(path.join(prepared.root, 'README.draft.md'));
  if (draft === undefined) {
    throw new CliError(
      'README.draft.md not found; nothing to apply.',
      'draft_missing',
      EXIT.ERROR,
      'Run `rf draft` first.',
    );
  }

  const readmePath = path.join(prepared.root, README_FILE);
  const current = readTextSafe(readmePath) ?? '';
  if (current === draft) {
    if (options.json) printJson({ applied: false, unchanged: true, backup: null });
    else log.line('README.md already matches README.draft.md; nothing to do.');
    return EXIT.OK;
  }

  const diff = computeDiff(current, draft);
  if (options.dryRun) {
    if (options.json) printJson({ applied: false, dryRun: true, diff });
    else if (options.quiet) {
      log.line(`Dry run: ${diff.changes.length} section(s) would change; README.md was not modified.`);
    } else {
      log.line(diff.unified || 'No textual differences.');
      log.info('Dry run: README.md was not modified.');
    }
    return EXIT.OK;
  }

  let backup: string | null = null;
  if (existsSync(readmePath)) {
    backup = '.README.bak.md';
    try {
      copyFileSync(readmePath, path.join(prepared.root, backup));
    } catch (error) {
      throw new CliError(`Could not create backup: ${error instanceof Error ? error.message : String(error)}`, 'backup_failed', EXIT.ERROR);
    }
  }
  if (!writeTextSafe(readmePath, draft)) {
    throw new CliError('Could not write README.md.', 'write_failed', EXIT.ERROR);
  }

  if (options.json) {
    printJson({ applied: true, dryRun: false, backup, diff });
  } else {
    const message = `Applied README.draft.md → README.md${backup ? ` (backup: ${backup})` : ''}`;
    if (options.quiet) log.line(message);
    else log.success(message);
  }
  return EXIT.OK;
}
