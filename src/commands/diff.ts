import path from 'node:path';
import { readTextSafe } from '../utils/fs.js';
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

export interface DiffOptions extends CliOptions {
  show?: boolean;
}

export function runDiff(rawPath: string | undefined, options: DiffOptions): number {
  applyVerbosity(options);
  const prepared = prepare(rawPath, options);
  const draft = readTextSafe(path.join(prepared.root, 'README.draft.md'));
  if (draft === undefined) {
    throw new CliError(
      'README.draft.md not found.',
      'draft_missing',
      EXIT.ERROR,
      'Run `rf draft` first; it never modifies README.md.',
    );
  }
  const readme = readTextSafe(path.join(prepared.root, README_FILE)) ?? '';
  const diff = computeDiff(readme, draft);

  if (options.json) {
    printJson(diff);
  } else if (options.quiet) {
    log.line(diff.hasChanges
      ? `README.draft.md differs: ${diff.summary.added} added, ${diff.summary.removed} removed, ${diff.summary.changed} changed.`
      : 'No differences between README.md and README.draft.md.');
  } else if (!diff.hasChanges) {
    log.line('No differences between README.md and README.draft.md.');
  } else {
    log.line(
      `README.draft.md differs from README.md: ${diff.summary.added} added, ` +
      `${diff.summary.removed} removed, ${diff.summary.changed} changed.`,
    );
    for (const change of diff.changes) {
      const mark = change.kind === 'added' ? '+' : change.kind === 'removed' ? '-' : '~';
      log.line(`  ${mark} ${change.title} (+${change.added} -${change.removed})`);
      if (change.firstDifference) {
        log.line(`    line ${change.firstDifference.line}: -${change.firstDifference.actual}`);
        log.line(`    line ${change.firstDifference.line}: +${change.firstDifference.expected}`);
      }
    }
    if (options.show && diff.unified) {
      log.line('');
      log.line(diff.unified);
    }
  }

  return diff.hasChanges ? EXIT.OK : EXIT.FAIL;
}
