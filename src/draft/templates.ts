import type { FactSheet, FactScript, Lang, PresetId, ScriptKind } from '../types.js';
import { slugify } from '../readme/parse.js';

export interface DraftSection {
  title: string;
  body: string;
}

export interface FreshDraft {
  title: string;
  intro: string;
  sections: DraftSection[];
}

export interface Copy {
  contents: string;
  installation: string;
  usage: string;
  configuration: string;
  scripts: string;
  packages: string;
  data: string;
  development: string;
  contributing: string;
  license: string;
  fromRegistry: string;
  fromSource: string;
  variable: string;
  evidence: string;
  command: string;
  purpose: string;
  noDescription: string;
  noInstall: string;
  noUsage: string;
  noPackages: string;
  noData: string;
  noContributing: string;
  language: (name: string) => string;
  licensed: (name: string) => string;
  dataSummary: (files: number, formats: string) => string;
  testHint: (command: string) => string;
  scriptPurpose: Record<ScriptKind, string>;
}

const COPY: Record<Lang, Copy> = {
  en: {
    contents: 'Contents',
    installation: 'Installation',
    usage: 'Usage',
    configuration: 'Configuration',
    scripts: 'Scripts',
    packages: 'Packages',
    data: 'Data',
    development: 'Development',
    contributing: 'Contributing',
    license: 'License',
    fromRegistry: 'From the package registry',
    fromSource: 'From source',
    variable: 'Variable',
    evidence: 'Evidence',
    command: 'Command',
    purpose: 'Purpose',
    noDescription: '[verify] Describe in one sentence what this project does and who it is for.',
    noInstall: '[verify] Document how to install this project.',
    noUsage: '[verify] Add a minimal, runnable usage example.',
    noPackages: '[verify] List the workspace packages and what each one provides.',
    noData: '[verify] Describe the dataset, its provenance and how to load it.',
    noContributing: '[verify] Contribution guidelines have not been written yet.',
    language: (name) => `It is primarily written in ${name}.`,
    licensed: (name) => `It is licensed under the ${name} license.`,
    dataSummary: (files, formats) => `This repository contains ${files} data file(s) in ${formats}.`,
    testHint: (command) => `Run \`${command}\` to execute the test suite.`,
    scriptPurpose: {
      install: 'Install dependencies',
      build: 'Build the project',
      test: 'Run tests',
      lint: 'Lint the code',
      dev: 'Start the development server',
      start: 'Start the application',
      format: 'Format the code',
      other: 'Declared manifest script',
    },
  },
  zh: {
    contents: '目录',
    installation: '安装',
    usage: '使用',
    configuration: '配置',
    scripts: '脚本',
    packages: '项目结构',
    data: '数据',
    development: '开发',
    contributing: '贡献',
    license: '许可证',
    fromRegistry: '从发布源安装',
    fromSource: '从源码安装',
    variable: '变量',
    evidence: '证据',
    command: '命令',
    purpose: '用途',
    noDescription: '[verify] 用一句话说明这个项目做什么、面向谁。',
    noInstall: '[verify] 补充安装说明。',
    noUsage: '[verify] 补充一个最小可运行示例。',
    noPackages: '[verify] 列出工作区中的包及各自用途。',
    noData: '[verify] 说明数据集来源、结构以及加载方式。',
    noContributing: '[verify] 尚未编写贡献指南。',
    language: (name) => `项目主要使用 ${name} 编写。`,
    licensed: (name) => `本项目采用 ${name} 许可证。`,
    dataSummary: (files, formats) => `仓库包含 ${files} 个数据文件，格式为 ${formats}。`,
    testHint: (command) => `运行 \`${command}\` 执行测试。`,
    scriptPurpose: {
      install: '安装依赖',
      build: '构建项目',
      test: '运行测试',
      lint: '代码检查',
      dev: '启动开发服务',
      start: '启动应用',
      format: '格式化代码',
      other: '清单中声明的脚本',
    },
  },
};

export function copyFor(lang: Lang): Copy {
  return COPY[lang];
}

export function buildFreshDraft(facts: FactSheet, preset: PresetId, lang: Lang): FreshDraft {
  const copy = COPY[lang];
  const title = facts.project.name ?? facts.project.displayName ?? 'Project';
  const intro = buildIntro(facts, lang);
  const sections: DraftSection[] = [];

  const install = renderInstallation(facts, copy);
  if (install) sections.push({ title: copy.installation, body: install });
  sections.push({ title: copy.usage, body: renderUsage(facts, copy) });
  if (facts.env.length > 0) sections.push({ title: copy.configuration, body: renderEnvTable(facts, copy) });
  if (facts.scripts.length > 0) sections.push({ title: copy.scripts, body: renderScripts(facts.scripts, copy) });
  if (preset === 'monorepo') sections.push({ title: copy.packages, body: renderPackages(facts, copy) });
  if (preset === 'dataset') sections.push({ title: copy.data, body: renderData(facts, copy) });
  if (facts.install.development && facts.scripts.length > 0) {
    sections.push({ title: copy.development, body: renderDevelopment(facts, copy) });
  }
  if (facts.community.contributingPath) {
    sections.push({ title: copy.contributing, body: contributingBody(facts, lang) });
  } else if ((facts.git.contributors ?? 0) > 3) {
    sections.push({ title: copy.contributing, body: copy.noContributing });
  }
  if (facts.project.license) sections.push({ title: copy.license, body: licenseBody(facts, lang) });

  return { title, intro, sections };
}

export function buildIntro(facts: FactSheet, lang: Lang): string {
  const copy = COPY[lang];
  const parts: string[] = [];
  const description = facts.project.description?.trim();
  parts.push(description || copy.noDescription);

  const deterministic: string[] = [];
  if (facts.project.primaryLanguage) deterministic.push(copy.language(facts.project.primaryLanguage));
  const license = facts.project.license?.spdx ?? facts.project.license?.family;
  if (license) deterministic.push(copy.licensed(license));
  if (deterministic.length > 0) parts.push(deterministic.join(' '));
  return parts.join('\n\n');
}

function renderInstallation(facts: FactSheet, copy: Copy): string | null {
  const consumer = facts.install.consumer;
  const development = facts.install.development;
  if (!consumer && !development) return null;
  const blocks: string[] = [];

  if (consumer) {
    blocks.push(`### ${copy.fromRegistry}`, '', codeBlock('bash', [consumer.command]));
  }
  if (development) {
    const lines: string[] = [];
    if (facts.project.repository?.url) {
      lines.push(`git clone ${facts.project.repository.url}`);
      const dir = facts.project.repository.name ?? facts.project.name;
      if (dir) lines.push(`cd ${dir}`);
    }
    lines.push(development.command);
    if (blocks.length > 0) blocks.push('');
    blocks.push(`### ${copy.fromSource}`, '', codeBlock('bash', lines));
  }
  return blocks.join('\n');
}

function renderUsage(facts: FactSheet, copy: Copy): string {
  if (facts.usage) return codeBlock('bash', [facts.usage.command]);
  return copy.noUsage;
}

function renderEnvTable(facts: FactSheet, copy: Copy): string {
  const rows = facts.env.map((env) => {
    const sources = env.sources.slice(0, 3).map((s) => `\`${s}\``).join('<br>');
    return `| \`${env.name}\` | ${sources} |`;
  });
  return [`| ${copy.variable} | ${copy.evidence} |`, '| --- | --- |', ...rows].join('\n');
}

function renderScripts(scripts: FactScript[], copy: Copy): string {
  const rows = scripts.map((s) => `| \`${s.invocation}\` | ${copy.scriptPurpose[s.kind]} |`);
  return [`| ${copy.command} | ${copy.purpose} |`, '| --- | --- |', ...rows].join('\n');
}

function renderPackages(facts: FactSheet, copy: Copy): string {
  if (facts.packages.length === 0) return copy.noPackages;
  return facts.packages.map((p) => `- \`${p}\``).join('\n');
}

function renderData(facts: FactSheet, copy: Copy): string {
  if (!facts.data) return copy.noData;
  return copy.dataSummary(facts.data.files, facts.data.formats.map((f) => `\`${f}\``).join(', '));
}

function renderDevelopment(facts: FactSheet, copy: Copy): string {
  const development = facts.install.development;
  if (!development) return '';
  const blocks: string[] = [codeBlock('bash', [development.command])];
  const test = facts.scripts.find((s) => s.kind === 'test');
  if (test) blocks.push(copy.testHint(test.invocation));
  return blocks.join('\n\n');
}

function contributingBody(facts: FactSheet, lang: Lang): string {
  const path = facts.community.contributingPath;
  if (!path) return COPY[lang].noContributing;
  return lang === 'zh'
    ? `贡献指南见 [\`${path}\`](${path})。`
    : `See [\`${path}\`](${path}) for contribution guidelines.`;
}

function licenseBody(facts: FactSheet, lang: Lang): string {
  const license = facts.project.license;
  if (!license) return '';
  const name = license.spdx ?? license.family;
  if (license.file) {
    return lang === 'zh'
      ? `本项目采用 ${name} 许可证，全文见 [\`${license.file}\`](${license.file})。`
      : `Licensed under ${name}. See [\`${license.file}\`](${license.file}) for the full text.`;
  }
  return lang === 'zh'
    ? `本项目采用 ${name} 许可证，具体条款以项目清单中的声明为准。`
    : `Licensed under ${name}; see the project manifest for the canonical declaration.`;
}

export function codeBlock(lang: string, lines: string[]): string {
  return ['```' + lang, ...lines, '```'].join('\n');
}

/** Render a fresh document, including a table of contents once it is useful. */
export function renderFreshDraft(draft: FreshDraft, lang: Lang): string {
  const copy = COPY[lang];
  const needsToc = draft.sections.length > 5;
  const parts: string[] = [`# ${draft.title}`, '', draft.intro];

  if (needsToc) {
    const entries = draft.sections.map((s) => `- [${s.title}](#${slugify(s.title)})`);
    parts.push('', `## ${copy.contents}`, '', ...entries);
  }
  for (const section of draft.sections) {
    parts.push('', `## ${section.title}`, '', section.body);
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** Section titles that must exist for a preset, in the canonical order. */
export function requiredSectionTitles(preset: PresetId, lang: Lang): string[] {
  const copy = COPY[lang];
  const titles = [copy.installation, copy.usage];
  if (preset === 'monorepo') titles.push(copy.packages);
  titles.push(copy.contributing, copy.license);
  return titles;
}

export function sectionFor(draft: FreshDraft, title: string): DraftSection | undefined {
  return draft.sections.find((s) => s.title === title);
}

export { COPY, slugify };
