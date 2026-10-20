import { initConfig } from '../config.js';
import { log } from '../utils/logger.js';
import {
  applyVerbosity,
  CliError,
  EXIT,
  prepare,
  printJson,
  type CliOptions,
} from './shared.js';

export interface InitOptions extends CliOptions {
  force?: boolean;
}

export function runInit(rawPath: string | undefined, options: InitOptions): number {
  applyVerbosity(options);
  const prepared = prepare(rawPath, { ...options, preset: undefined, ai: undefined });
  let result;
  try {
    result = initConfig(prepared.root, options.force === true);
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error), 'init_failed', EXIT.ERROR);
  }

  if (options.json) printJson(result);
  else if (result.created) {
    if (options.quiet) log.line(`Created ${result.path}`);
    else log.success(`Created ${result.path}`);
  } else if (options.quiet) {
    log.line(`${result.path} already exists`);
  } else {
    log.info(`${result.path} already exists; use --force to overwrite it.`);
  }
  return EXIT.OK;
}
