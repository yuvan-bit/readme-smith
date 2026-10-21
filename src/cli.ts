#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { runScan } from './commands/scan.js';
import { runDoctor } from './commands/doctor.js';
import { runDraft, type DraftOptions } from './commands/draft.js';
import { runDiff, type DiffOptions } from './commands/diff.js';
import { runCheck } from './commands/check.js';
import { runApply, type ApplyOptions } from './commands/apply.js';
import { runInit, type InitOptions } from './commands/init.js';
import { CliError, EXIT, type CliOptions } from './commands/shared.js';
import { log } from './utils/logger.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

const program = new Command();

program
  .name('rf')
  .description('Local-first README health doctor: deterministic facts, reviewable drafts, CI gates.')
  .version(pkg.version, '-v, --version', 'print the version')
  .helpOption('-h, --help', 'display help');

program
  .option('--json', 'machine-readable JSON on stdout')
  .option('--quiet', 'suppress human-readable logs')
  .option('--verbose', 'show debug details')
  .option('--preset <preset>', 'force a project preset: cli|lib|web|monorepo|dataset')
  .option('--ai <backend>', 'AI backend: local|openai|off')
  .option('--min-score <n>', 'minimum score for doctor and check', (value) => Number(value));

function common(command: Command): Command {
  return command
    .option('--json', 'machine-readable JSON on stdout')
    .option('--quiet', 'suppress human-readable logs')
    .option('--verbose', 'show debug details')
    .option('--preset <preset>', 'force a project preset: cli|lib|web|monorepo|dataset')
    .option('--ai <backend>', 'AI backend: local|openai|off')
    .option('--min-score <n>', 'minimum score for doctor and check', (value) => Number(value));
}

function optionsFor(programOptions: object, commandOptions: object): CliOptions {
  const merged: Record<string, unknown> = { ...(programOptions as Record<string, unknown>) };
  for (const [key, value] of Object.entries(commandOptions as Record<string, unknown>)) {
    if (value !== undefined) merged[key] = value;
  }
  return {
    ...(merged.json === true ? { json: true } : {}),
    ...(merged.quiet === true ? { quiet: true } : {}),
    ...(merged.verbose === true ? { verbose: true } : {}),
    ...(typeof merged.preset === 'string' ? { preset: merged.preset } : {}),
    ...(typeof merged.ai === 'string' ? { ai: merged.ai } : {}),
    ...(typeof merged.minScore === 'number' ? { minScore: merged.minScore } : {}),
  };
}

common(
  program
    .command('scan')
    .description('Extract deterministic project facts and print them as JSON.')
    .argument('[path]', 'repository path', '.'),
).action((pathArg: string, commandOptions: Record<string, unknown>) => {
  process.exitCode = runScan(pathArg, optionsFor(program.opts(), commandOptions));
});

common(
  program
    .command('draft')
    .description('Write README.draft.md from facts, preserving the existing README.')
    .argument('[path]', 'repository path', '.')
    .option('--lang <lang>', 'draft language: auto|en|zh')
    .option('--force', 'regenerate the draft, allowing AI to rewrite existing prose'),
).action(async (pathArg: string, commandOptions: DraftOptions) => {
  process.exitCode = await runDraft(pathArg, { ...optionsFor(program.opts(), commandOptions), ...commandOptions });
});

common(
  program
    .command('diff')
    .description('Compare README.md with README.draft.md section by section. Exits 0 when identical, 1 when different.')
    .argument('[path]', 'repository path', '.')
    .option('--show', 'print a unified line excerpt'),
).action((pathArg: string, commandOptions: DiffOptions) => {
  process.exitCode = runDiff(pathArg, { ...optionsFor(program.opts(), commandOptions), ...commandOptions });
});

common(
  program
    .command('doctor')
    .description('Score README health; exits 1 when the score is below the threshold.')
    .argument('[path]', 'repository path', '.'),
).action((pathArg: string, commandOptions: Record<string, unknown>) => {
  process.exitCode = runDoctor(pathArg, optionsFor(program.opts(), commandOptions));
});

common(
  program
    .command('check')
    .description('CI gate: doctor plus a deterministic draft diff. Honours #rf-skip.')
    .argument('[path]', 'repository path', '.')
    .option('--changed', 'also check workspace packages whose manifest or README changed')
    .option('--base <ref>', 'git revision for --changed (default HEAD^)'),
).action(async (pathArg: string, commandOptions: Record<string, unknown>) => {
  process.exitCode = await runCheck(pathArg, {
    ...optionsFor(program.opts(), commandOptions),
    ...(commandOptions.changed === true ? { changed: true } : {}),
    ...(typeof commandOptions.base === 'string' ? { base: commandOptions.base } : {}),
  });
});

common(
  program
    .command('apply')
    .description('Copy README.draft.md into README.md, creating .README.bak.md first.')
    .argument('[path]', 'repository path', '.')
    .option('--dry-run', 'preview the change without writing anything'),
).action((pathArg: string, commandOptions: ApplyOptions) => {
  process.exitCode = runApply(pathArg, { ...optionsFor(program.opts(), commandOptions), ...commandOptions });
});

common(
  program
    .command('init')
    .description('Write a commented .readme-smith.yaml configuration file.')
    .argument('[path]', 'repository path', '.')
    .option('--force', 'overwrite an existing configuration'),
).action((pathArg: string, commandOptions: InitOptions) => {
  process.exitCode = runInit(pathArg, { ...optionsFor(program.opts(), commandOptions), ...commandOptions });
});

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const exitCode = error instanceof CliError ? error.exitCode : EXIT.ERROR;
  const code = error instanceof CliError ? error.code : 'internal_error';
  const message = error instanceof Error ? error.message : String(error);
  const hint = error instanceof CliError ? error.hint : undefined;

  // Scripts that asked for JSON must be able to parse failures too.
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({
      error: {
        code,
        message,
        ...(hint ? { hint } : {}),
        exitCode,
      },
    }, null, 2) + '\n');
  } else {
    log.error(message);
    if (hint) log.detail(hint);
  }
  process.exitCode = exitCode;
}
