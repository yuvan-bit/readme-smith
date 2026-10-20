import path from 'node:path';
import type { LanguageSetting } from '../types.js';
import { buildDraft, draftPath } from '../draft/index.js';
import { writeTextSafe } from '../utils/fs.js';
import { log } from '../utils/logger.js';
import {
  analyse,
  applyVerbosity,
  CliError,
  EXIT,
  logScanDetails,
  prepare,
  printJson,
  printWarnings,
  requireKnownType,
  scanRepository,
  type CliOptions,
} from './shared.js';

export interface DraftOptions extends CliOptions {
  lang?: string;
  force?: boolean;
}

export async function runDraft(rawPath: string | undefined, options: DraftOptions): Promise<number> {
  applyVerbosity(options);
  const prepared = prepare(rawPath, options);
  const facts = scanRepository(prepared.root, prepared.forcedPreset);
  logScanDetails(facts);
  const preset = requireKnownType(facts);

  let language: LanguageSetting = prepared.loaded.config.language;
  if (options.lang !== undefined) {
    if (options.lang !== 'auto' && options.lang !== 'en' && options.lang !== 'zh') {
      throw new CliError(`--lang must be auto, en or zh (got ${options.lang}).`, 'invalid_language', EXIT.ERROR);
    }
    language = options.lang;
  }

  const analysis = analyse(prepared.root, facts, preset);
  if (!options.quiet) log.info(`Drafting ${preset} README (${analysis.exists ? 'merge mode' : 'new document'})`);

  const draft = await buildDraft({
    root: prepared.root,
    facts,
    preset: preset,
    language,
    ai: prepared.ai,
    force: options.force === true,
  });

  const output = draftPath(prepared.root);
  if (!writeTextSafe(output, draft.markdown)) {
    throw new CliError(`Could not write ${path.relative(prepared.root, output) || 'README.draft.md'}.`, 'write_failed', EXIT.ERROR);
  }

  if (options.json) {
    printJson({
      path: 'README.draft.md',
      language: draft.language,
      aiUsed: draft.aiUsed,
      aiProvider: draft.aiProvider,
      addedSections: draft.addedSections,
      warnings: draft.warnings,
    });
  } else if (options.quiet) {
    log.line(`Wrote README.draft.md (${draft.language}${draft.aiUsed ? `, AI: ${draft.aiProvider}` : ', deterministic'})`);
  } else {
    printWarnings(draft.warnings);
    log.success(`Wrote README.draft.md (${draft.language}${draft.aiUsed ? `, AI: ${draft.aiProvider}` : ', deterministic'})`);
    if (draft.addedSections.length > 0) log.detail(`Added sections: ${draft.addedSections.join(', ')}`);
    log.detail('README.md was not modified. Review with `rf diff`, apply with `rf apply`.');
  }
  return EXIT.OK;
}
