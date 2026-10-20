import type { FactSheet, Lang, PresetId, ReadmeAnalysis } from '../types.js';
import type { ParsedReadme } from '../readme/parse.js';
import { copyFor, type FreshDraft } from './templates.js';

export interface MergeResult {
  markdown: string;
  addedSections: string[];
  warnings: string[];
}

/**
 * Preserve every existing section and append only what the preset requires but
 * the README lacks. An untouched README is returned byte-for-byte so `diff`
 * can honestly report "no changes".
 */
export function mergeDraft(
  existingText: string,
  parsed: ParsedReadme,
  analysis: ReadmeAnalysis,
  draft: FreshDraft,
  facts: FactSheet,
  preset: PresetId,
  lang: Lang,
): MergeResult {
  const copy = copyFor(lang);
  const warnings: string[] = [];
  const addedSections: string[] = [];
  const std = analysis.standard;
  let text = existingText;

  let introHandled = false;
  if (!std.title) {
    const body = text.replace(/^\s+/, '');
    text = `# ${draft.title}\n\n${draft.intro}\n\n${body}`;
    introHandled = true;
  } else if (!std.intro) {
    const h1 = parsed.headings.find((h) => h.level === 1);
    if (h1) {
      const lines = text.split(/\r?\n/);
      lines.splice(h1.line, 0, '', draft.intro);
      text = lines.join('\n');
      introHandled = true;
    }
  }
  if (!introHandled && !std.intro) warnings.push('Could not find a place to insert the introduction; add one manually.');

  const contributorThreshold = (facts.git.contributors ?? 0) > 3;
  const contributingRequired = facts.community.contributing || contributorThreshold;
  const needed: Array<{ required: boolean; title: string }> = [
    { required: preset !== 'dataset' && !std.install, title: copy.installation },
    { required: !std.usage, title: copy.usage },
    { required: preset === 'monorepo' && !std.packages, title: copy.packages },
    { required: contributingRequired && !std.contributing, title: copy.contributing },
    { required: !!facts.project.license && !std.license, title: copy.license },
  ];

  const chunks: string[] = [];
  for (const { required, title } of needed) {
    if (!required) continue;
    const section = draft.sections.find((s) => s.title === title);
    if (!section) continue;
    chunks.push(`## ${title}\n\n${section.body}`);
    addedSections.push(title);
  }

  if (chunks.length > 0) {
    text = text.trimEnd() + '\n\n' + chunks.join('\n\n') + '\n';
  }

  return { markdown: text, addedSections, warnings };
}
