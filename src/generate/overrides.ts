import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Lang, SectionId } from '../types.js';
import { OVERRIDE_DIR } from '../utils/fs.js';
import { OVERRIDABLE_SECTION_IDS } from './sections.js';

/**
 * Hand-written section bodies.
 *
 * The tool's promise is a README a human is willing to own. That broke on the
 * second run: `generate --force` overwrote every rewrite of Highlights, Roadmap
 * or FAQ, so the honest choice was between stale prose and lost edits. Files in
 * `.readme-smith/` move the human's words outside the generated document, which
 * makes regeneration safe.
 *
 * Only the body is taken over. The heading, the table of contents and the
 * language switcher stay generated, so an override cannot desynchronise the two
 * files from each other.
 */
export { OVERRIDE_DIR };

/** File name language codes are too cryptic to put in a sentence. */
const LANGUAGE_NAMES: Record<string, string> = { en: 'English', zh: 'Simplified Chinese' };

/** `<sectionId>.<lang>.md`, e.g. `highlights.zh.md`. */
const OVERRIDE_FILE = /^(.+)\.([a-z][a-z-]*)\.md$/i;

export interface LoadedOverrides {
  /** Keyed `<sectionId>:<lang>`, exactly as `GenerateOptions.sectionOverrides`. */
  values: Record<string, string>;
  /** Problems the user has to fix by hand: typos, empty files, missing counterpart. */
  warnings: string[];
}

function key(section: SectionId, lang: Lang): string {
  return `${section}:${lang}`;
}

export function loadSectionOverrides(root: string, langs: Lang[]): LoadedOverrides {
  const dir = path.join(root, OVERRIDE_DIR);
  const warnings: string[] = [];
  const values: Record<string, string> = {};
  if (!existsSync(dir)) return { values, warnings };

  const wanted = new Set<SectionId>(OVERRIDABLE_SECTION_IDS);
  const requested = new Set<Lang>(langs);
  const overriddenPairs = new Set<string>();

  for (const entry of readdirSync(dir)) {
    const file = path.join(dir, entry);
    if (!statSync(file).isFile()) continue;

    const match = OVERRIDE_FILE.exec(entry);
    if (!match) {
      warnings.push(`${OVERRIDE_DIR}/${entry} is not a section override: name it <section>.<lang>.md, for example highlights.zh.md.`);
      continue;
    }
    const sectionName = match[1]!.toLowerCase();
    const langName = match[2]!.toLowerCase();

    if (!wanted.has(sectionName as SectionId)) {
      warnings.push(
        `${OVERRIDE_DIR}/${entry} targets "${sectionName}", which this generator does not write. ` +
        `Override one of: ${OVERRIDABLE_SECTION_IDS.join(', ')}.`,
      );
      continue;
    }
    const lang = langName as Lang;
    if (!requested.has(lang)) {
      const language = LANGUAGE_NAMES[langName] ?? `an unsupported language ("${langName}")`;
      warnings.push(`${OVERRIDE_DIR}/${entry} is written for ${language}, but no README in that language is being generated.`);
      continue;
    }

    const body = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
    if (body === '') {
      warnings.push(`${OVERRIDE_DIR}/${entry} is empty, so that section keeps the generated wording.`);
      continue;
    }
    values[key(sectionName as SectionId, lang)] = body;
    overriddenPairs.add(sectionName);
  }

  // A one-language override is the half-translated README this tool exists to
  // prevent, so say which file is still missing rather than let the reader
  // notice it later.
  if (langs.length > 1) {
    for (const sectionName of overriddenPairs) {
      const missing = langs
        .filter((lang) => values[key(sectionName as SectionId, lang)] === undefined)
        .map((lang) => `${OVERRIDE_DIR}/${sectionName}.${lang}.md`);
      if (missing.length > 0 && missing.length < langs.length) {
        warnings.push(`${sectionName} is overridden in one language only; add ${missing.join(' and ')} or the two READMEs will word that section differently.`);
      }
    }
  }

  return { values, warnings };
}
