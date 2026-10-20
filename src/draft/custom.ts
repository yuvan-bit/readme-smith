import path from 'node:path';
import type { FactSheet, Lang, PresetId } from '../types.js';
import { exists, readTextSafe } from '../utils/fs.js';
import { copyFor, codeBlock } from './templates.js';

export const CUSTOM_TEMPLATE_DIR = '.readme-smith/templates';

export interface CustomTemplate {
  /** POSIX path relative to the repository root. */
  path: string;
  text: string;
}

/** Prefer `<preset>.<lang>.md`, then `<preset>.md`. */
export function findCustomTemplate(root: string, preset: PresetId, lang: Lang): CustomTemplate | null {
  for (const filename of [`${preset}.${lang}.md`, `${preset}.md`]) {
    const rel = `${CUSTOM_TEMPLATE_DIR}/${filename}`;
    if (!exists(root, rel)) continue;
    const text = readTextSafe(path.join(root, rel));
    if (text !== undefined) return { path: rel, text };
  }
  return null;
}

export interface RenderedTemplate {
  markdown: string;
  warnings: string[];
}

/**
 * Substitute fact-backed variables. Unknown variables are replaced with a
 * `[verify]` marker rather than silently disappearing.
 */
export function renderCustomTemplate(template: CustomTemplate, facts: FactSheet, preset: PresetId, lang: Lang): RenderedTemplate {
  const warnings: string[] = [];
  const variables = templateVariables(facts, preset, lang);
  const markdown = template.text.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (_match, name: string) => {
    const value = variables[name];
    if (value !== undefined) return value;
    warnings.push(`${template.path}: unknown variable {{${name}}}; replaced with [verify].`);
    return '[verify]';
  });
  return { markdown: markdown.trimEnd() + '\n', warnings };
}

export function templateVariables(facts: FactSheet, preset: PresetId, lang: Lang): Record<string, string> {
  const copy = copyFor(lang);
  const license = facts.project.license;
  const licenseName = license?.spdx ?? license?.family ?? '[verify]';
  const envNames = facts.env.map((e) => `- \`${e.name}\``).join('\n');
  const envTable = facts.env.length > 0
    ? [
      `| ${copy.variable} | ${copy.evidence} |`,
      '| --- | --- |',
      ...facts.env.map((e) => `| \`${e.name}\` | ${e.sources.slice(0, 3).map((s) => `\`${s}\``).join('<br>')} |`),
    ].join('\n')
    : '[verify]';
  const scriptsTable = facts.scripts.length > 0
    ? [
      `| ${copy.command} | ${copy.purpose} |`,
      '| --- | --- |',
      ...facts.scripts.map((s) => `| \`${s.invocation}\` | ${copy.scriptPurpose[s.kind]} |`),
    ].join('\n')
    : '[verify]';
  const test = facts.scripts.find((s) => s.kind === 'test');
  const build = facts.scripts.find((s) => s.kind === 'build');

  return {
    name: facts.project.name ?? '[verify]',
    displayName: facts.project.displayName ?? facts.project.name ?? '[verify]',
    description: facts.project.description ?? copy.noDescription,
    version: facts.project.version ?? '[verify]',
    type: facts.project.type,
    preset,
    primaryLanguage: facts.project.primaryLanguage ?? '[verify]',
    license: licenseName,
    licenseFile: license?.file ?? '',
    repository: facts.project.repository?.url ?? '',
    install: facts.install.consumer?.command ?? facts.install.development?.command ?? copy.noInstall,
    installConsumer: facts.install.consumer?.command ?? '[verify]',
    installDev: facts.install.development?.command ?? '[verify]',
    usage: facts.usage?.command ?? copy.noUsage,
    binaries: facts.binaries.join(', ') || '[verify]',
    entryPoints: facts.entryPoints.join(', ') || '[verify]',
    packages: facts.packages.map((p) => `- \`${p}\``).join('\n') || copy.noPackages,
    scripts: facts.scripts.map((s) => `- \`${s.invocation}\``).join('\n') || '[verify]',
    scriptsTable,
    env: envNames || '[verify]',
    envTable,
    data: facts.data ? copy.dataSummary(facts.data.files, facts.data.formats.map((f) => `\`${f}\``).join(', ')) : copy.noData,
    testCommand: test?.invocation ?? '[verify]',
    buildCommand: build?.invocation ?? '[verify]',
    contributing: facts.community.contributingPath
      ? `[\`${facts.community.contributingPath}\`](${facts.community.contributingPath})`
      : '[verify]',
    ci: facts.ci.map((w) => w.name ?? w.file).join(', ') || '[verify]',
    stats: `${facts.stats.files} files, ${facts.stats.sourceLines} source lines`,
    installBlock: codeBlock('bash', [facts.install.consumer?.command ?? facts.install.development?.command ?? '']),
  };
}
