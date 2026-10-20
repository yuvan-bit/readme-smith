import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildDiagrams } from './mermaid.js';
import { code, numbered } from './markdown.js';
import { collectBadges, shieldsEscape, shieldsUrl } from './badges.js';
import { defaultOptions, renderReadme } from './index.js';
import { segmentMarkdown, reassemble, repairListMarkers } from '../i18n/markdown.js';
import type { Lang, ProjectProfile } from '../types.js';

/**
 * Regression tests for bugs that shipped once and would ship again silently:
 * a broken diagram still renders as a code block, a wrong badge still renders
 * as an image, and a mangled README still looks like a README.
 */

function profile(overrides: Partial<ProjectProfile> = {}): ProjectProfile {
  const base: ProjectProfile = {
    schemaVersion: 1,
    name: 'taskflow',
    displayName: 'Taskflow',
    version: '2.4.1',
    description: 'A tiny task runner.',
    root: process.cwd(),
    generatedAt: new Date().toISOString(),
    languages: [{ name: 'TypeScript', extensions: ['.ts'], files: 3, bytes: 1200, lines: 90, percent: 100, color: '#3178c6' }],
    dependencies: [
      { name: 'commander', version: '^12.1.0' },
      { name: 'zod', version: '^3.23.8' },
      { name: 'picocolors', version: '^1.1.1' },
    ],
    devDependencies: [],
    engines: { node: '>=18.17' },
    scripts: [],
    features: {
      hasTests: false, testFrameworks: [], hasCI: false, ciProviders: [],
      hasDocker: false, dockerFiles: [], hasCompose: false,
      hasLinter: false, linters: [], hasFormatter: false, formatters: [],
      hasTypeCheck: true, hasChangelog: false, hasContributing: false,
      hasCodeOfConduct: false, hasSecurityPolicy: false, hasIssueTemplates: false,
      hasPullRequestTemplate: false, hasEnvSample: false, hasReleases: false,
      isMonorepo: false, workspacePackages: [],
      isLibrary: false, isCli: true, isApplication: false, hasApi: false,
      hasDocsSite: false, hasBenchmarks: false, hasStorybook: false, hasI18n: false,
      publishedToRegistry: false,
    },
    repo: { isGit: false, host: 'unknown', defaultBranch: 'main' },
    structure: {
      name: 'taskflow',
      path: '',
      type: 'dir',
      children: [
        {
          name: 'src', path: 'src', type: 'dir', note: 'source code', noteZh: '源码',
          children: [
            { name: 'commands', path: 'src/commands', type: 'dir', note: 'command entrypoints', noteZh: '命令入口' },
            { name: 'utils', path: 'src/utils', type: 'dir', note: 'helpers', noteZh: '工具函数' },
          ],
        },
      ],
    },
    envVars: ['TASKFLOW_TOKEN'],
    entryPoints: [],
    docs: [],
    warnings: [],
    stats: { totalFiles: 3, linesOfCode: 90, bytes: 1200, directories: 2 },
    ...overrides,
  } as ProjectProfile;
  return base;
}

test('every mermaid node declaration has a bracketed shape', () => {
  const diagrams = buildDiagrams(profile(), ((key: string) => key) as never, 'en');
  const blocks = Object.values(diagrams).filter((value): value is string => typeof value === 'string');
  assert.ok(blocks.length >= 2, 'expected at least the architecture and CLI diagrams');

  for (const block of blocks) {
    for (const line of block.split('\n')) {
      const trimmed = line.trim();
      // The historical bug: `d_commands"commands"` — an id glued to a label.
      assert.doesNotMatch(trimmed, /^[A-Za-z_][\w]*"/, `node id glued to a label: ${trimmed}`);
    }
    // subgraph/end balance keeps the diagram parseable.
    const opens = block.match(/^\s*subgraph\b/gm)?.length ?? 0;
    const closes = block.match(/^\s*end$/gm)?.length ?? 0;
    assert.equal(opens, closes, `unbalanced subgraph in:\n${block}`);
  }
});

test('generated diagrams omit layers that are not there', () => {
  const diagrams = buildDiagrams(profile(), ((key: string) => key) as never, 'en');
  const workflow = diagrams.workflow;
  if (workflow) {
    const styled = [...workflow.matchAll(/^\s*style (\w+)/gm)].map((m) => m[1]!);
    for (const id of styled) {
      assert.match(workflow, new RegExp(`^\\s*${id}\\[`, 'm'), `style targets a missing node: ${id}`);
    }
  }
});

test('version ranges survive badge escaping', () => {
  assert.equal(shieldsEscape('>=18.17'), '%3E=18.17');
  assert.equal(shieldsEscape('^20.0.0'), '%5E20.0.0');
  assert.equal(shieldsEscape('1.0.0 - 2.0.0'), '1.0.0_--_2.0.0');
  const url = shieldsUrl('node', '>=18.17', '339933');
  assert.match(url, /node-%3E=18\.17-339933/);
  // A `>` or `^` must never be dropped: `=18.17` and `20.0.0` are different
  // requirements from `>=18.17` and `^20.0.0`.
  assert.doesNotMatch(url, /node-=18/);
  assert.match(shieldsUrl('node', '^20.0.0'), /node-%5E20\.0\.0-/);
});

test('multi-word badge labels use underscores, not extra separators', () => {
  // shields splits the path on `-`; a space therefore has to become `_`.
  // `badge/code-style-prettier` is answered with "404: badge not found".
  assert.equal(shieldsEscape('code style'), 'code_style');
  assert.equal(shieldsEscape('last commit'), 'last_commit');
  assert.equal(shieldsEscape('snake_case'), 'snake__case');
  assert.match(shieldsUrl('code style', 'prettier', 'F7B93E'), /\/badge\/code_style-prettier-F7B93E/);
});

test('heading markers survive a translation round trip', () => {
  const segmented = segmentMarkdown('# Demo Project\n\n## Section Two\n\n- item\n');
  const translated = new Map<number, string>();
  segmented.blocks.forEach((block, index) => {
    if (block.kind === 'translate') translated.set(index, '译文');
  });
  const output = reassemble(segmented, translated);
  assert.match(output, /^# 译文$/m, 'h1 marker was dropped');
  assert.match(output, /^## 译文$/m, 'h2 marker was dropped');
});

test('bold delimiters and list spacing survive translation', () => {
  const source = '> **Note** · keep it\n\n- first item with **bold** text\n';
  const segmented = segmentMarkdown(source);
  const translated = new Map<number, string>();
  segmented.blocks.forEach((block, index) => {
    if (block.kind !== 'translate') return;
    // Simulate a statistical engine: drops the space after `-`, keeps placeholders.
    translated.set(index, block.text.replace(/^- /, '-'));
  });
  const output = reassemble(segmented, translated);
  assert.match(output, /^> \*\*Note\*\* · keep it$/m, 'blockquote bold was rewritten');
  assert.match(output, /^- first item with \*\*bold\*\* text$/m, 'list marker spacing was lost');
});

test('a missing space after a list marker is restored, bold is not a bullet', () => {
  assert.equal(repairListMarkers('-item'), '- item');
  assert.equal(repairListMarkers('1.step'), '1. step');
  assert.equal(repairListMarkers('> -item'), '> - item');
  assert.equal(repairListMarkers('**Note** stays bold'), '**Note** stays bold');
});

test('a fenced block inside a numbered step stays inside its list item', () => {
  const steps = [
    `Clone it\n${code('bash', 'git clone https://example.com/x.git')}`,
    `Install it\n${code('bash', 'npm install')}`,
    `Build it\n${code('bash', 'npm run build')}`,
  ];
  const rendered = numbered(steps);
  const lines = rendered.split('\n');

  // The old shape put the opening fence at three spaces and left the body and
  // the closer at column zero. That closes the list, so GitHub restarts
  // numbering and the commands fall out of their step.
  for (const line of lines) {
    if (line.trim() === '') continue;
    assert.match(
      line,
      /^(\d+\. |\s{3,}\S)/,
      `line escaped the list item and would break numbering: ${JSON.stringify(line)}`,
    );
  }

  // One step's fence pair must agree on indentation, or the closer is not a
  // closer at all.
  for (const step of rendered.split(/\n\n(?=\d+\. )/)) {
    const indents = [...step.matchAll(/^( *)```/gm)].map((m) => m[1]!.length);
    if (indents.length === 0) continue;
    assert.equal(new Set(indents).size, 1, `inconsistent fence indent within a step: ${indents.join(',')}`);
    assert.equal(indents[0], 3, 'a single-digit step indents to its content column');
  }

  assert.deepEqual([...rendered.matchAll(/^(\d+)\./gm)].map((m) => Number(m[1])), [1, 2, 3]);
});

test('double-digit steps indent to their own content column', () => {
  const steps = Array.from({ length: 11 }, (_, i) => `Step ${i + 1}\n${code('bash', `npm run step${i + 1}`)}`);
  const rendered = numbered(steps);

  // "11. " is four characters wide, so step eleven's content column moves out
  // by one. The fence must move with it.
  const lastItem = rendered.slice(rendered.search(/^11\. /m));
  const indents = [...lastItem.matchAll(/^( *)```/gm)].map((m) => m[1]!.length);
  assert.deepEqual(indents, [4, 4], 'both fences of step 11 must sit at column four');
});

/** A repository-shaped profile: git remote present, publication set by caller. */
function gitProfile(published: boolean): ProjectProfile {
  return profile({
    ecosystem: 'npm',
    contributors: [],
    features: { ...profile().features, publishedToRegistry: published },
    repo: {
      isGit: true, host: 'github', owner: 'acme', name: 'taskflow',
      slug: 'acme/taskflow', url: 'https://github.com/acme/taskflow', defaultBranch: 'main',
    },
  });
}

function registryBadgeUrls(published: boolean, allowClaims: boolean): string {
  return collectBadges({
    profile: gitProfile(published), style: 'flat-square', lang: 'en', langs: ['en'],
    allowRegistryClaims: allowClaims,
  }).flatMap((group) => group.badges).map((badge) => `${badge.url ?? ''} ${badge.href ?? ''}`).join(' ');
}

test('registry badges need both a publishable manifest and the claim switch', () => {
  assert.match(registryBadgeUrls(true, true), /npmjs\.com\/package\/taskflow/);
  assert.doesNotMatch(registryBadgeUrls(true, false), /npmjs\.com/, '--unpublished must drop registry badges');
  assert.doesNotMatch(registryBadgeUrls(false, true), /npmjs\.com/, 'a private manifest is a hard signal, not a guess');
});

test('the registry install step disappears with --unpublished while the clone step stays', () => {
  const options = (allowClaims: boolean) => ({
    ...defaultOptions(process.cwd()), langs: ['en'] as Lang[], allowRegistryClaims: allowClaims,
  });
  const claimed = renderReadme(gitProfile(true), 'en', options(true));
  const sourceOnly = renderReadme(gitProfile(true), 'en', options(false));

  assert.match(claimed, /npm install -g taskflow/);
  assert.doesNotMatch(sourceOnly, /npm install -g taskflow/);
  assert.match(sourceOnly, /git clone https:\/\/github\.com\/acme\/taskflow/, 'installing from source must survive');
});

test('a section override keeps the generated heading and replaces only the body', () => {
  const options = {
    ...defaultOptions(process.cwd()),
    langs: ['en', 'zh'] as Lang[],
    sectionOverrides: { 'highlights:en': '- Written by a human, in English.' },
  };
  const en = renderReadme(gitProfile(false), 'en', options);
  const zh = renderReadme(gitProfile(false), 'zh', options);

  assert.match(en, /^## Highlights$/m, 'the heading must stay generated');
  assert.match(en, /^- Written by a human, in English\.$/m);
  assert.doesNotMatch(en, /Why it exists/, 'the generated body must not leak through');
  assert.match(en, /- \[Highlights\]\(#highlights\)/, 'the table of contents anchor must still resolve');

  // The other language keeps its own generated body until it is overridden too.
  assert.match(zh, /^## 项目亮点$/m);
  assert.match(zh, /为什么存在/);
});

test('an override for a section the generator does not write is reported, not applied', () => {
  const options = {
    ...defaultOptions(process.cwd()),
    langs: ['en'] as Lang[],
    sectionOverrides: { 'stats:en': '- a fact table is not prose', 'nope:en': '- typo' },
  };
  const rendered = renderReadme(gitProfile(false), 'en', options);
  assert.doesNotMatch(rendered, /not prose|typo/, 'fact-only and unknown sections must be ignored');
  assert.match(rendered, /^## Project Stats$/m, 'the real section must still render');
});

test('a command with more flags than a table cell holds counts what it left out', () => {
  const flags = Array.from({ length: 30 }, (_, i) => `--flag-${i} <v>`);
  const withCli = profile({ cli: { binNames: ['taskflow'], commands: [{ name: 'serve', description: 'start the server', flags }] } });
  const rendered = renderReadme(withCli, 'en', { ...defaultOptions(process.cwd()), langs: ['en'] as Lang[] });

  assert.match(rendered, /^## Commands$/m);
  assert.match(rendered, /`--flag-0 <v>`/, 'the first flags are shown');
  assert.match(rendered, /`--flag-23 <v>` \(\+6\)/, 'a truncated list has to say how much is missing');
  assert.doesNotMatch(rendered, /--flag-24/, 'flags past the page limit are not printed');
});
