import type { GenerateOptions, Lang, ProjectProfile, SectionId } from '../types.js';
import type { DictKey, T } from '../i18n/dict.js';
import { collectBadges, renderBadgeRow, renderLanguageSwitcher, type BadgeGroup } from './badges.js';
import { buildDiagrams, type DiagramSet } from './mermaid.js';
import {
  bullets, code, details, heading, inline, joinBlocks, link, note, numbered,
  section, sub, table, warning,
} from './markdown.js';
import { humanBytes, humanCount } from '../utils/fs.js';
import { renderTree } from '../scanner/structure.js';

export interface RenderContext {
  profile: ProjectProfile;
  lang: Lang;
  langs: Lang[];
  t: T;
  options: GenerateOptions;
  diagrams: DiagramSet;
  badgeGroups: BadgeGroup[];
}

/**
 * Placeholder replaced with the real table of contents once every other
 * section has rendered. Two passes are unavoidable: the TOC can only list
 * headings that already exist.
 */
export const TOC_SENTINEL = '<!--readme-smith:toc-->';

export function makeContext(
  profile: ProjectProfile,
  lang: Lang,
  langs: Lang[],
  t: T,
  options: GenerateOptions,
): RenderContext {
  return {
    profile,
    lang,
    langs,
    t,
    options,
    diagrams: buildDiagrams(profile, t, lang),
    badgeGroups: options.badges
      ? collectBadges({ profile, style: options.badgeStyle, lang, langs, allowRegistryClaims: options.allowRegistryClaims })
      : [],
  };
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const zh = (ctx: RenderContext) => ctx.lang === 'zh';

/** `@scope/name` → `name`; used for CLI binary names and clone directories. */
function bareName(profile: ProjectProfile): string {
  return profile.name.replace(/^@[^/]+\//, '');
}

/** The shell command a consumer runs to install this package. */
function consumerInstallCommand(ctx: RenderContext): string | undefined {
  const { profile } = ctx;
  const name = profile.name;
  // `publishedToRegistry` is an inference from the manifest, not proof of a
  // publish, so `--unpublished` has to be able to overrule it here too — a
  // `npm install -g X` step for an unpublished package is an instruction that
  // fails with a 404 in the reader's terminal. A manifest that says the
  // package is private is the one hard signal, and it always wins.
  if (!name || !profile.features.publishedToRegistry || !ctx.options.allowRegistryClaims) return undefined;
  switch (profile.ecosystem) {
    case 'npm': return profile.features.isCli ? `npm install -g ${name}` : `npm install ${name}`;
    case 'pnpm': return profile.features.isCli ? `pnpm add -g ${name}` : `pnpm add ${name}`;
    case 'yarn': return profile.features.isCli ? `yarn global add ${name}` : `yarn add ${name}`;
    case 'bun': return profile.features.isCli ? `bun add -g ${name}` : `bun add ${name}`;
    case 'pip': return `pip install ${name}`;
    case 'poetry': return `poetry add ${name}`;
    case 'uv': return `uv add ${name}`;
    case 'cargo': return `cargo install ${name}`;
    case 'go': return `go install ${name}@latest`;
    case 'composer': return `composer require ${name}`;
    case 'gem': return `gem install ${name}`;
    case 'nuget': return `dotnet add package ${name}`;
    // Maven and Gradle need `groupId:artifactId` coordinates, which the
    // manifest scan does not capture, so no one-liner is offered rather than
    // printing a command that would fail.
    default: return undefined;
  }
}

/** Registry display name for prose. */
function registryName(ctx: RenderContext): string {
  switch (ctx.profile.ecosystem) {
    case 'npm': case 'pnpm': case 'yarn': case 'bun': return 'npm';
    case 'pip': case 'poetry': case 'uv': return 'PyPI';
    case 'cargo': return 'crates.io';
    case 'go': return 'pkg.go.dev';
    case 'composer': return 'Packagist';
    case 'gem': return 'RubyGems';
    case 'nuget': return 'NuGet';
    case 'maven': return 'Maven Central';
    case 'gradle': return 'Gradle Plugin Portal';
    default: return zh(ctx) ? '软件仓库' : 'the registry';
  }
}

function cloneCommand(ctx: RenderContext): string {
  const url = ctx.profile.repo.url;
  return url ? `git clone ${url}.git` : `git clone <${zh(ctx) ? '仓库地址' : 'repository-url'}>`;
}

/** A language-appropriate "import the library" snippet. */
function importSnippet(ctx: RenderContext): string | undefined {
  const { profile } = ctx;
  const name = profile.name;
  if (!name || profile.features.isCli) return undefined;
  const lang = profile.primaryLanguage;
  const bare = name.replace(/^@[^/]+\//, '').replace(/-/g, '_');

  switch (lang) {
    case 'TypeScript':
    case 'JavaScript':
    case 'TSX':
    case 'JSX':
      return `import { /* ${zh(ctx) ? '导出的 API' : 'exported API'} */ } from '${name}';`;
    case 'Python':
      return `from ${bare} import *  # or: import ${bare}`;
    case 'Rust':
      return `use ${bare}::prelude::*;`;
    case 'Go':
      return `import "${name}"`;
    case 'Java':
    case 'Kotlin':
      return `import com.example.${bare.replace(/_/g, '')}.*;`;
    case 'Ruby':
      return `require '${name}'`;
    case 'PHP':
      return `use Vendor\\${bare.replace(/_/g, '')}\\Client;`;
    case 'C#':
      return `using ${bare.replace(/_/g, '')};`;
    default:
      return undefined;
  }
}

function codeFenceLang(ctx: RenderContext): string {
  switch (ctx.profile.primaryLanguage) {
    case 'TypeScript': case 'TSX': return 'ts';
    case 'JavaScript': case 'JSX': return 'js';
    case 'Python': return 'python';
    case 'Rust': return 'rust';
    case 'Go': return 'go';
    case 'Ruby': return 'ruby';
    case 'PHP': return 'php';
    case 'Java': return 'java';
    case 'Kotlin': return 'kotlin';
    case 'C#': return 'csharp';
    case 'C': case 'C++': return 'cpp';
    default: return 'text';
  }
}

/* ------------------------------------------------------------------ *
 * Sections
 * ------------------------------------------------------------------ */

function renderTitle(ctx: RenderContext): string {
  const { profile, t, options } = ctx;
  const parts: string[] = [];
  parts.push(heading(1, profile.displayName));

  const switcher = options.includeLanguageSwitcher ? renderLanguageSwitcher(ctx.lang, ctx.langs) : '';
  if (switcher) {
    parts.push(`<p align="center">${switcher}</p>`);
  }

  const description = profile.description || t('meta.placeholderDescription');
  parts.push(`<p align="center">${description}${profile.description ? '' : ` _(${t('meta.editMe')})_`}</p>`);

  return parts.join('\n\n');
}

function renderBadges(ctx: RenderContext): string | undefined {
  if (ctx.badgeGroups.length === 0) return undefined;
  const all = ctx.badgeGroups.flatMap((g) => g.badges);
  return `<p align="center">${renderBadgeRow(all, ctx.options.badgeStyle, 6)}</p>`;
}

function renderHighlights(ctx: RenderContext): string | undefined {
  const { profile, t } = ctx;
  if (!profile.description) return undefined;
  const items = [
    t('highlights.what', { description: profile.description }),
    t('highlights.why'),
    t('highlights.when'),
  ];
  return section(t('section.highlights')) + bullets(items);
}

function renderFeatures(ctx: RenderContext): string | undefined {
  const { profile, t } = ctx;
  const items: string[] = [];

  if (profile.features.isCli && profile.cli && profile.cli.commands.length > 0) {
    items.push(t('feature.cliSurface', { n: profile.cli.commands.length }));
  }
  if (profile.features.hasTypeCheck && profile.primaryLanguage === 'TypeScript') {
    items.push(t('feature.typed', { lang: 'TypeScript' }));
  } else if (profile.features.hasTypeCheck) {
    items.push(t('feature.typed', { lang: profile.primaryLanguage ?? 'the project' }));
  }
  if (profile.features.hasTests && profile.features.testFrameworks.length > 0) {
    items.push(t('feature.tested', { framework: profile.features.testFrameworks.slice(0, 2).join(' + ') }));
  }
  if (profile.features.hasCI && profile.features.ciProviders.length > 0) {
    items.push(t('feature.ci', { provider: profile.features.ciProviders[0]! }));
  }
  if (profile.features.hasDocker) items.push(t('feature.containerised'));
  if (profile.features.isMonorepo) items.push(t('feature.monorepo', { n: profile.features.workspacePackages.length }));
  if (profile.features.hasI18n) items.push(t('feature.i18n'));
  if (profile.features.hasDocsSite || profile.docs.some((d) => d.kind === 'docs')) items.push(t('feature.docs'));
  if (profile.features.hasLinter && profile.features.linters.length > 0) {
    items.push(t('feature.linted', { tool: profile.features.linters.slice(0, 2).join(' + ') }));
  }
  if (profile.features.hasBenchmarks) items.push(t('feature.benchmarks'));
  if (profile.ecosystem === 'npm' || profile.ecosystem === 'cargo' || profile.ecosystem === 'go') {
    items.push(t('feature.crossPlatform'));
  }

  // Surface detected frameworks as a fact, not a marketing claim.
  if (profile.frameworks.length > 0) {
    items.push(zh(ctx)
      ? `技术栈：**${profile.frameworks.slice(0, 6).join('、')}**`
      : `Built on **${profile.frameworks.slice(0, 6).join(', ')}**`);
  }

  if (items.length === 0) return undefined;
  return section(t('section.features')) + bullets(items);
}

function renderArchitecture(ctx: RenderContext): string | undefined {
  const { t, diagrams } = ctx;
  const parts = joinBlocks([diagrams.architecture, diagrams.cliFlow]);
  if (!parts) return undefined;
  return section(t('section.architecture')) + parts;
}

function renderQuickStart(ctx: RenderContext): string | undefined {
  const { profile, t } = ctx;
  const steps: string[] = [];

  const install = consumerInstallCommand(ctx);
  if (install) {
    steps.push(`${t('quick.install')}\n${code('bash', install)}`);
  }

  if (profile.features.isCli) {
    const bin = profile.cli?.binNames[0] ?? bareName(profile);
    const firstCommand = profile.cli?.commands[0]?.name;
    const usage = firstCommand ? `${bin} ${firstCommand}` : `${bin} --help`;
    steps.push(`${t('quick.run')}\n${code('bash', usage)}`);
  } else if (profile.usageCommand) {
    steps.push(`${t('quick.start')}\n${code('bash', profile.usageCommand)}`);
  } else {
    const snippet = importSnippet(ctx);
    if (snippet) steps.push(`${t('quick.useInCode')}\n${code(codeFenceLang(ctx), snippet)}`);
  }

  if (steps.length === 0) return undefined;
  return section(t('section.quickStart')) + numbered(steps);
}

function renderInstallation(ctx: RenderContext): string | undefined {
  const { profile, t } = ctx;
  const blocks: string[] = [];

  // Requirements, when the manifest declares any.
  const engineEntries = Object.entries(profile.engines);
  if (engineEntries.length > 0) {
    blocks.push(sub(t('section.requirements')) + table({
      headers: [zh(ctx) ? '运行时' : 'Runtime', zh(ctx) ? '版本要求' : 'Version'],
      rows: engineEntries.map(([k, v]) => [inline(k), inline(v)]),
    }));
  }

  const consumer = consumerInstallCommand(ctx);
  if (consumer) {
    blocks.push(
      sub(t('install.headingRegistry', { registry: registryName(ctx) })) +
      code('bash', consumer) + '\n\n' +
      note(profile.features.isCli ? t('install.globally') : t('install.asDependency'), ctx.lang),
    );
  }

  // From source — always available once the project is a git repository.
  if (profile.installCommand || profile.repo.isGit) {
    const sourceSteps = [cloneCommand(ctx)];
    const dirName = profile.repo.name ?? bareName(profile);
    sourceSteps.push(`cd ${dirName}`);
    if (profile.installCommand) sourceSteps.push(profile.installCommand);
    blocks.push(sub(t('install.headingSource')) + code('bash', sourceSteps.join('\n')));
  }

  if (blocks.length === 0) return undefined;
  return section(t('section.installation')) + joinBlocks(blocks);
}

function renderUsage(ctx: RenderContext): string | undefined {
  const { profile, t } = ctx;
  const blocks: string[] = [];

  if (profile.features.isCli) {
    const bin = profile.cli?.binNames[0] ?? bareName(profile);
    // `--help` on its own makes for a thin Usage section, and a note that just
    // repeats it reads like filler. Pair it with the first real command.
    const examples = [`${bin} --help`];
    const primary = (profile.cli?.commands ?? []).find((cmd) => cmd.description);
    if (primary) examples.push(`${bin} ${primary.name} --help`);
    blocks.push(t('usage.cli') + '\n\n' + code('bash', examples.join('\n')));
  }

  const snippet = importSnippet(ctx);
  if (snippet) {
    blocks.push(t('usage.importExample') + '\n\n' + code(codeFenceLang(ctx), snippet));
  }

  if (!profile.features.isCli && profile.usageCommand) {
    blocks.push(t('usage.app') + '\n\n' + code('bash', profile.usageCommand));
  }

  if (blocks.length === 0) return undefined;
  return section(t('section.usage')) + joinBlocks(blocks);
}

/**
 * Flags per table cell before the row stops being readable.
 *
 * This bound, not the scanner, is what decides how much of a CLI's surface a
 * reader sees: the profile carries every flag that was found, so the table can
 * say how many were left out instead of implying the command is smaller than it
 * is. `git` and `docker` are why a bound exists at all.
 */
const FLAG_CELL_LIMIT = 24;

function flagCell(flags: string[]): string {
  const shown = flags.slice(0, FLAG_CELL_LIMIT).map((flag) => inline(flag)).join(' ');
  const hidden = flags.length - FLAG_CELL_LIMIT;
  return hidden > 0 ? `${shown} (+${hidden})` : shown;
}

function renderCliCommands(ctx: RenderContext): string | undefined {
  const { profile, t } = ctx;
  const commands = profile.cli?.commands ?? [];
  if (commands.length === 0) return undefined;

  const rows = commands.map((cmd) => [
    inline(cmd.name),
    cmd.description ?? '—',
    cmd.flags?.length ? flagCell(cmd.flags) : '—',
  ]);

  return section(t('section.cliCommands')) + table({
    headers: [t('table.command'), t('table.description'), t('table.flags')],
    rows,
    align: ['left', 'left', 'left'],
  });
}

function renderConfiguration(ctx: RenderContext): string | undefined {
  const { profile, t } = ctx;
  if (profile.envVars.length === 0) return undefined;

  const rows = profile.envVars.map((name) => [
    inline(name),
    '—',
    t('label.optional'),
  ]);

  const body = joinBlocks([
    zh(ctx)
      ? '以下环境变量可通过 shell 环境或 `.env` 文件设置：'
      : 'The following environment variables can be set in your shell or a `.env` file:',
    table({
      headers: [t('table.variable'), t('table.description'), t('table.required')],
      rows,
    }),
    note(zh(ctx)
      ? '「说明」一列留空，请补充每个变量的含义与默认值。'
      : 'The description column is intentionally blank — fill in what each variable does and its default.', ctx.lang),
  ]);

  return section(t('section.environmentVariables')) + body;
}

function renderScripts(ctx: RenderContext): string | undefined {
  const { profile, t } = ctx;
  if (profile.scripts.length === 0) return undefined;

  const KIND_LABEL: Record<string, { en: string; zh: string }> = {
    install: { en: 'Setup', zh: '安装' },
    build: { en: 'Build', zh: '构建' },
    test: { en: 'Test', zh: '测试' },
    lint: { en: 'Lint', zh: '检查' },
    dev: { en: 'Development', zh: '开发' },
    start: { en: 'Start', zh: '启动' },
    format: { en: 'Format', zh: '格式化' },
    other: { en: 'Other', zh: '其他' },
  };

  const rows = profile.scripts.slice(0, 25).map((s) => [
    inline(scriptRunner(ctx, s.name)),
    KIND_LABEL[s.kind]?.[ctx.lang] ?? s.kind,
    inline(s.command.length > 70 ? `${s.command.slice(0, 67)}…` : s.command),
  ]);

  return section(t('section.availableScripts')) + table({
    headers: [t('table.command'), t('table.category'), zh(ctx) ? '实际命令' : 'Underlying command'],
    rows,
  });
}

function scriptRunner(ctx: RenderContext, scriptName: string): string {
  switch (ctx.profile.ecosystem) {
    case 'pnpm': return `pnpm ${scriptName}`;
    case 'yarn': return `yarn ${scriptName}`;
    case 'bun': return `bun run ${scriptName}`;
    case 'poetry': return `poetry run ${scriptName}`;
    default: return `npm run ${scriptName}`;
  }
}

function renderStructure(ctx: RenderContext): string | undefined {
  const { profile, t } = ctx;
  const tree = renderTree(profile.structure, { showNotes: true, lang: ctx.lang });
  if (tree.split('\n').length < 3) return undefined;

  const entryNote = profile.entryPoints.length > 0
    ? `\n\n${zh(ctx) ? '主要入口文件：' : 'Key entry points:'}\n\n${bullets(profile.entryPoints.map((p) => inline(p)))}`
    : '';

  return section(t('section.projectStructure')) + code('text', tree) + entryNote;
}

function renderDependencies(ctx: RenderContext): string | undefined {
  const { profile, t } = ctx;
  if (profile.dependencies.length === 0 && profile.devDependencies.length === 0) return undefined;

  const runtime = profile.dependencies.filter((d) => !d.dev);
  const blocks: string[] = [];

  if (runtime.length > 0) {
    const shown = runtime.slice(0, 20);
    blocks.push(details(
      `${t('label.runtimeDeps')} (${runtime.length})`,
      table({
        headers: [t('table.package'), t('table.version')],
        rows: shown.map((d) => [inline(d.name), inline(d.version || '*')]),
      }) + (runtime.length > shown.length ? `\n\n_${t('label.andMore', { n: runtime.length - shown.length })}_` : ''),
      runtime.length <= 10,
    ));
  }

  const dev = [...profile.dependencies.filter((d) => d.dev), ...profile.devDependencies];
  if (dev.length > 0) {
    const shown = dev.slice(0, 20);
    blocks.push(details(
      `${t('label.devDeps')} (${dev.length})`,
      table({
        headers: [t('table.package'), t('table.version')],
        rows: shown.map((d) => [inline(d.name), inline(d.version || '*')]),
      }) + (dev.length > shown.length ? `\n\n_${t('label.andMore', { n: dev.length - shown.length })}_` : ''),
    ));
  }

  return section(t('section.dependencies')) + joinBlocks(blocks);
}

function renderLanguages(ctx: RenderContext): string | undefined {
  const { profile, t } = ctx;
  if (profile.languages.length === 0) return undefined;
  return section(t('section.languages')) + table({
    headers: [t('table.language'), t('table.share'), t('table.files'), t('table.lines')],
    rows: profile.languages.map((l) => [
      l.name,
      `${l.percent.toFixed(1)}%`,
      String(l.files),
      l.lines > 0 ? humanCount(l.lines) : '—',
    ]),
    align: ['left', 'right', 'right', 'right'],
  });
}

function renderDevelopment(ctx: RenderContext): string | undefined {
  const { profile, t, diagrams } = ctx;
  const blocks: string[] = [];

  if (diagrams.workflow) blocks.push(diagrams.workflow);

  const steps: string[] = [];
  steps.push(`${t('dev.stepClone')}\n${code('bash', cloneCommand(ctx))}`);
  if (profile.installCommand) {
    steps.push(`${t('dev.stepInstall')}\n${code('bash', profile.installCommand)}`);
  }
  const devScript = profile.scripts.find((s) => s.kind === 'dev');
  if (devScript) steps.push(`${t('dev.stepDevelop')}\n${code('bash', scriptRunner(ctx, devScript.name))}`);
  const buildScript = profile.scripts.find((s) => s.kind === 'build');
  if (buildScript) steps.push(`${t('dev.stepBuild')}\n${code('bash', scriptRunner(ctx, buildScript.name))}`);
  // The workflow diagram above shows install → build → test → lint, so the
  // written steps have to include the test step or they contradict the picture.
  if (profile.features.hasTests) {
    const command = testCommand(ctx);
    if (command) steps.push(`${t('dev.stepTest')}\n${code('bash', command)}`);
  }
  if (profile.features.hasLinter) {
    const lintScript = profile.scripts.find((s) => s.kind === 'lint');
    steps.push(`${t('dev.stepLint')}\n${code('bash', lintScript ? scriptRunner(ctx, lintScript.name) : profile.features.linters[0]!)}`);
  }
  if (steps.length > 0) blocks.push(t('dev.setupSteps') + '\n\n' + numbered(steps));
  blocks.push(t('dev.branchNote'));

  return section(t('section.development')) + joinBlocks(blocks);
}

function testCommand(ctx: RenderContext): string | undefined {
  const testScript = ctx.profile.scripts.find((s) => s.kind === 'test');
  return testScript ? scriptRunner(ctx, testScript.name) : fallbackTestCommand(ctx.profile);
}

function renderTesting(ctx: RenderContext): string | undefined {
  const { profile, t } = ctx;
  if (!profile.features.hasTests) return undefined;

  const blocks: string[] = [];
  const frameworks = profile.features.testFrameworks;
  blocks.push(
    frameworks.length > 0
      ? t('test.frameworks', { frameworks: frameworks.slice(0, 3).join(zh(ctx) ? '、' : ', ') })
      : t('test.suite'),
  );

  const command = testCommand(ctx);
  if (command) blocks.push(t('test.runAll') + '\n\n' + code('bash', command));

  if (profile.features.hasCI) {
    blocks.push(note(zh(ctx)
      ? `测试在 ${profile.features.ciProviders.join('、')} 上自动运行。`
      : `Tests run automatically on ${profile.features.ciProviders.join(' and ')}.`, ctx.lang));
  }

  return section(t('section.testing')) + joinBlocks(blocks);
}

function fallbackTestCommand(profile: ProjectProfile): string | undefined {
  switch (profile.ecosystem) {
    case 'cargo': return 'cargo test';
    case 'go': return 'go test ./...';
    case 'poetry': return 'poetry run pytest';
    case 'pip': case 'uv': return 'pytest';
    case 'composer': return 'composer test';
    case 'gem': return 'bundle exec rspec';
    case 'maven': return 'mvn test';
    case 'gradle': return './gradlew test';
    default: return undefined;
  }
}

function renderDocumentation(ctx: RenderContext): string | undefined {
  const { profile, t } = ctx;
  const docs = profile.docs.filter((d) => d.kind !== 'license' && d.path.toLowerCase() !== 'readme.md');
  if (docs.length === 0 && !profile.homepage) return undefined;

  const rows = docs.slice(0, 20).map((d) => [link(d.title ?? d.path, `./${d.path}`), kindLabel(ctx, d.kind)]);
  const blocks: string[] = [];
  if (profile.homepage) {
    blocks.push(link(zh(ctx) ? '完整文档站点' : 'Full documentation site', profile.homepage));
  }
  if (rows.length > 0) {
    blocks.push(table({ headers: [t('table.document'), t('table.category')], rows }));
  }
  return section(t('section.documentation')) + joinBlocks(blocks);
}

function kindLabel(ctx: RenderContext, kind: string): string {
  const map: Record<string, { en: string; zh: string }> = {
    changelog: { en: 'Release history', zh: '发布历史' },
    contributing: { en: 'Contribution guide', zh: '贡献指南' },
    security: { en: 'Security policy', zh: '安全策略' },
    docs: { en: 'Documentation', zh: '文档' },
    other: { en: 'Reference', zh: '参考资料' },
    license: { en: 'License', zh: '许可证' },
  };
  return map[kind]?.[ctx.lang] ?? kind;
}

function renderContributing(ctx: RenderContext): string | undefined {
  const { profile, t } = ctx;
  const blocks: string[] = [t('contributing.intro')];

  const ways = [t('contributing.wayIssue'), t('contributing.wayPR'), t('contributing.wayDiscussion'), t('contributing.wayDocs')];
  blocks.push(t('contributing.waysToHelp') + '\n\n' + bullets(ways));

  const guide = profile.docs.find((d) => d.kind === 'contributing');
  if (guide) {
    blocks.push(zh(ctx) ? `详细流程请阅读 ${link(guide.title ?? guide.path, `./${guide.path}`)}。` : `See ${link(guide.title ?? guide.path, `./${guide.path}`)} for the full process.`);
  } else {
    blocks.push(warning(t('contributing.noGuide'), ctx.lang));
  }

  if (profile.bugsUrl || profile.repo.slug) {
    const href = profile.bugsUrl ?? (profile.repo.url ? `${profile.repo.url}/issues` : undefined);
    if (href) blocks.push(link(zh(ctx) ? '报告问题 / 提出建议' : 'Report a bug / request a feature', href));
  }

  return section(t('section.contributing')) + joinBlocks(blocks);
}

function renderContributors(ctx: RenderContext): string | undefined {
  const { profile, t } = ctx;
  if (profile.contributors.length === 0) return undefined;

  const slug = profile.repo.slug;
  // The contributors-img widget only works for GitHub-hosted repos.
  if (slug && profile.repo.host === 'github') {
    const avatarBlock =
      `<a href="https://github.com/${slug}/graphs/contributors">\n` +
      `  <img src="https://contrib.rocks/image?repo=${slug}&max=${Math.min(profile.contributors.length, 24)}" alt="${t('section.contributors')}" />\n` +
      `</a>`;
    return section(t('section.contributors')) + t('contributors.thanks') + '\n\n' + avatarBlock;
  }

  return section(t('section.contributors')) + t('contributors.thanks') + '\n\n' + table({
    headers: [t('table.contributor'), t('table.commits')],
    rows: profile.contributors.slice(0, 20).map((c) => [c.login, String(c.contributions ?? '—')]),
    align: ['left', 'right'],
  });
}

function renderChangelog(ctx: RenderContext): string | undefined {
  const { profile, t } = ctx;
  const changelog = profile.docs.find((d) => d.kind === 'changelog');
  if (changelog) {
    return section(t('section.changelog')) + t('changelog.seeFile', { file: changelog.path, path: `./${changelog.path}` });
  }
  if (!profile.features.hasReleases) return undefined;
  return section(t('section.changelog')) + t('changelog.noFile');
}

function renderFaq(ctx: RenderContext): string | undefined {
  const { t, options } = ctx;
  if (!options.sections.includes('faq')) return undefined;
  return section(t('section.faq')) + joinBlocks([
    sub(t('faq.title1')) + `_${t('faq.body1')}_`,
    sub(t('faq.title2')) + `_${t('faq.body2')}_`,
  ]);
}

function renderLicense(ctx: RenderContext): string | undefined {
  const { profile, t } = ctx;
  if (!profile.license) {
    return section(t('section.license')) + warning(t('license.none'), ctx.lang);
  }
  const label = profile.license.spdx ?? profile.license.family;
  const file = profile.license.file ?? 'LICENSE';
  return section(t('section.license')) + t('license.statement', {
    license: label,
    file,
    path: profile.license.url || `./${file}`,
  });
}

function renderStats(ctx: RenderContext): string | undefined {
  const { profile, t } = ctx;
  const rows: Array<[string, string]> = [
    [t('stat.files'), humanCount(profile.stats.totalFiles)],
    [t('stat.lines'), humanCount(profile.stats.linesOfCode)],
    [t('stat.size'), humanBytes(profile.stats.bytes)],
    [t('stat.directories'), humanCount(profile.stats.directories)],
    [t('stat.dependencies'), String(profile.dependencies.length + profile.devDependencies.length)],
  ];
  if (profile.contributors.length > 0) rows.push([t('stat.contributors'), String(profile.contributors.length)]);
  if (profile.languages.length > 0) {
    rows.push([t('section.languages'), profile.languages.slice(0, 4).map((l) => `${l.name} ${l.percent.toFixed(0)}%`).join(' · ')]);
  }

  return section(t('section.stats')) +
    details(t('meta.projectStatsFor', { name: profile.name }), table({
      headers: [t('table.metric'), t('table.value')],
      rows,
      align: ['left', 'right'],
    }));
}

function renderRoadmap(ctx: RenderContext): string | undefined {
  if (!ctx.options.sections.includes('roadmap')) return undefined;
  const lines = zh(ctx)
    ? ['- [ ] 补充此处：下一阶段计划\n- [ ] 补充此处：已知限制\n- [ ] 补充此处：欢迎认领的方向']
    : ['- [ ] Add this: what ships next\n- [ ] Add this: known limitations\n- [ ] Add this: areas where help is welcome'];
  return section(ctx.t('section.roadmap')) + lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Registry of sections, in canonical order
 * ------------------------------------------------------------------ */

/**
 * Sections whose body a human may take over.
 *
 * `titleKey` is the heading the generator would have used, so an override keeps
 * the same heading and the table of contents anchors still resolve. It is
 * deliberately absent on the fact-only sections (`structure`, `dependencies`,
 * `languages`, `stats`, `contributors`): replacing those with prose is how a
 * README ends up contradicting the repository it describes.
 */
const SECTION_RENDERERS: Array<{
  id: SectionId;
  titleKey?: DictKey;
  render: (ctx: RenderContext) => string | undefined;
}> = [
  { id: 'title', render: renderTitle },
  { id: 'badges', render: renderBadges },
  { id: 'highlights', titleKey: 'section.highlights', render: renderHighlights },
  { id: 'toc', render: (ctx) => (ctx.options.toc ? TOC_SENTINEL : undefined) },
  { id: 'features', titleKey: 'section.features', render: renderFeatures },
  { id: 'architecture', titleKey: 'section.architecture', render: renderArchitecture },
  { id: 'quickstart', titleKey: 'section.quickStart', render: renderQuickStart },
  { id: 'installation', titleKey: 'section.installation', render: renderInstallation },
  { id: 'usage', titleKey: 'section.usage', render: renderUsage },
  { id: 'cli', titleKey: 'section.cliCommands', render: renderCliCommands },
  { id: 'config', titleKey: 'section.environmentVariables', render: renderConfiguration },
  { id: 'scripts', titleKey: 'section.availableScripts', render: renderScripts },
  { id: 'structure', render: renderStructure },
  { id: 'dependencies', render: renderDependencies },
  { id: 'languages', render: renderLanguages },
  { id: 'development', titleKey: 'section.development', render: renderDevelopment },
  { id: 'testing', titleKey: 'section.testing', render: renderTesting },
  { id: 'docs', titleKey: 'section.documentation', render: renderDocumentation },
  { id: 'roadmap', titleKey: 'section.roadmap', render: renderRoadmap },
  { id: 'contributing', titleKey: 'section.contributing', render: renderContributing },
  { id: 'contributors', render: renderContributors },
  { id: 'changelog', titleKey: 'section.changelog', render: renderChangelog },
  { id: 'faq', titleKey: 'section.faq', render: renderFaq },
  { id: 'license', titleKey: 'section.license', render: renderLicense },
  { id: 'stats', render: renderStats },
];

/** Every section this generator knows how to render, in canonical order. */
export const SECTION_IDS: SectionId[] = SECTION_RENDERERS.map((s) => s.id);

/** Section ids a `.readme-smith/<id>.<lang>.md` file may replace the body of. */
export const OVERRIDABLE_SECTION_IDS: SectionId[] = SECTION_RENDERERS
  .filter((entry) => entry.titleKey !== undefined)
  .map((entry) => entry.id);

export function renderSections(ctx: RenderContext): string {
  const enabled = new Set(ctx.options.sections);
  const blocks = SECTION_RENDERERS
    .filter((entry) => enabled.has(entry.id))
    .map((entry) => {
      const titleKey = entry.titleKey;
      const overridden = titleKey ? ctx.options.sectionOverrides[`${entry.id}:${ctx.lang}`] : undefined;
      if (titleKey && overridden !== undefined && overridden.trim() !== '') {
        // The human owns the body; the generator still owns the heading, so
        // anchors, the TOC and the language switcher keep working.
        return section(ctx.t(titleKey)) + overridden.trim();
      }
      try {
        return entry.render(ctx);
      } catch (error) {
        // A failing section must not abort the whole README.
        return `<!-- readme-smith: failed to render "${entry.id}" (${(error as Error).message}) -->`;
      }
    });
  return joinBlocks(blocks);
}
