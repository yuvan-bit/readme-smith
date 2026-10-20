import {
  applyVerbosity,
  EXIT,
  prepare,
  printJson,
  scanRepository,
  type CliOptions,
} from './shared.js';
import { EXPECTED_MANIFESTS } from '../facts/project-type.js';
import { log } from '../utils/logger.js';
import { humanBytes } from '../utils/fs.js';

export function runScan(rawPath: string | undefined, options: CliOptions): number {
  applyVerbosity(options);
  const prepared = prepare(rawPath, options);
  const facts = scanRepository(prepared.root, prepared.forcedPreset);

  if (facts.project.type === 'unknown') {
    const message = 'Could not recognise the project type.';
    if (options.json) {
      printJson({
        error: {
          code: 'unknown_project_type',
          message,
          expectedManifests: EXPECTED_MANIFESTS,
          exitCode: EXIT.ERROR,
        },
      });
    } else {
      log.error(message);
      log.detail(`Add one of: ${EXPECTED_MANIFESTS.join(', ')}`);
      log.detail('Or force a preset with --preset cli|lib|web|monorepo|dataset.');
    }
    return EXIT.ERROR;
  }

  printJson(facts);
  if (!options.quiet) {
    log.detail(`${facts.stats.files} files · ${humanBytes(facts.stats.sourceBytes)} · ${facts.stats.sourceLines} source lines`);
    log.detail(`Type: ${facts.project.type} (confidence ${facts.project.typeConfidence}) · ${facts.project.primaryLanguage ?? 'unknown language'}`);
    log.detail(`${facts.scripts.length} script(s) · ${facts.env.length} env var(s) · ${facts.ci.length} workflow(s)`);
    log.success(`Facts for ${facts.project.name ?? prepared.root}`);
  }
  return EXIT.OK;
}
