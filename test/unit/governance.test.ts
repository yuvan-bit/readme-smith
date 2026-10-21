import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ROOT } from './helpers.js';
import { parseReadme, slugify } from '../../src/readme/parse.js';

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function yaml(rel: string): unknown {
  return parseYaml(read(rel));
}

test('package metadata exposes one CLI and GitHub as the primary repository', () => {
  const pkg = JSON.parse(read('package.json')) as {
    version: string;
    bin: Record<string, string>;
    repository: { url: string };
    homepage: string;
    bugs: { url: string };
    files: string[];
  };
  assert.equal(pkg.version, '0.3.0');
  assert.deepEqual(Object.keys(pkg.bin), ['readme-smith']);
  for (const target of Object.values(pkg.bin)) assert.ok(target.startsWith('./dist/'));
  assert.match(pkg.repository.url, /github\.com\/yuvan-bit\/readme-smith/);
  assert.match(pkg.homepage, /github\.com\/yuvan-bit\/readme-smith/);
  assert.match(pkg.bugs.url, /github\.com\/yuvan-bit\/readme-smith\/issues/);
  assert.ok(pkg.files.includes('dist'));
  assert.ok(pkg.files.includes('action.yml'));
  assert.ok(pkg.files.includes('README.md'));
  assert.ok(pkg.files.includes('CHANGELOG.md'));
  assert.ok(pkg.files.includes('SECURITY.md'));
});

test('the lockfile and changelog agree on the version', () => {
  const lock = JSON.parse(read('package-lock.json')) as {
    version: string;
    packages: Record<string, { version?: string; bin?: Record<string, string> }>;
  };
  assert.equal(lock.version, '0.3.0');
  assert.equal(lock.packages['']?.version, '0.3.0');
  assert.deepEqual(Object.keys(lock.packages['']?.bin ?? {}), ['readme-smith']);
  assert.match(read('CHANGELOG.md'), /## \[0\.3\.0\]/);
  assert.match(read('CHANGELOG.md'), /## \[0\.2\.0\]/);
});

test('action.yml is a composite action with check and proposal modes', () => {
  const action = yaml('action.yml') as {
    runs: { using: string; steps: Array<{ uses?: string }> };
    inputs: Record<string, { default?: string }>;
    outputs: Record<string, unknown>;
  };
  assert.equal(action.runs.using, 'composite');
  assert.ok(action.runs.steps.some((step) => step.uses === 'actions/setup-node@v4'));
  assert.ok(action.inputs.mode);
  assert.ok(action.inputs['min-score']);
  assert.equal(action.inputs.ai?.default, 'off');
  assert.equal(action.inputs['changed-only']?.default, 'false');
  assert.ok('base' in action.inputs);
  assert.ok(action.outputs.score);
  assert.ok(action.outputs['affected-packages']);
  assert.ok(action.outputs['draft-path']);
  const text = read('action.yml');
  assert.match(text, /check/);
  assert.match(text, /proposal/);
});

test('Gitee Go pipelines run the same local ci command on Node 22', () => {
  const files = ['.workflow/master-pipeline.yml', '.workflow/pr-pipeline.yml'];
  for (const file of files) {
    const pipeline = yaml(file) as {
      version: string;
      triggers: Record<string, unknown>;
      stages: Array<{ steps: Array<{ step: string; nodeVersion: string; commands: string[] }> }>;
    };
    assert.equal(pipeline.version, '1.0');
    const step = pipeline.stages[0]?.steps[0];
    assert.equal(step?.step, 'build@nodejs');
    assert.equal(step?.nodeVersion, '22.14.0');
    assert.deepEqual(step?.commands, ['npm ci', 'npm run ci']);
  }
  const master = yaml('.workflow/master-pipeline.yml') as { triggers: Record<string, unknown> };
  const pr = yaml('.workflow/pr-pipeline.yml') as { triggers: Record<string, unknown> };
  assert.ok(master.triggers.push);
  assert.ok(!('pr' in master.triggers));
  assert.ok(pr.triggers.pr);
  assert.ok(!('push' in pr.triggers));
});

test('the local ci script mirrors the main CI', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  const script = pkg.scripts.ci ?? '';
  assert.match(script, /npm run typecheck/);
  assert.match(script, /npm run test:coverage/);
  assert.match(script, /doctor \. --min-score 85/);
  assert.match(script, /check \. --min-score 85/);
});

test('Gitee issue forms and pull request template are present', () => {
  for (const file of ['bug_report.yml', 'feature_request.yml', 'docs.yml']) {
    const form = yaml(`.gitee/ISSUE_TEMPLATE/${file}`) as {
      name: string;
      description: string;
      body: unknown[];
    };
    assert.ok(form.name, `${file} needs a name`);
    assert.ok(form.description, `${file} needs a description`);
    assert.ok(Array.isArray(form.body) && form.body.length > 0, `${file} needs a body`);
  }
  assert.match(read('.gitee/pull_request_template.md'), /npm run ci/);
});

test('README documents GitHub Actions first and the Gitee Go mirror', () => {
  const text = read('README.md');
  assert.match(text, /GitHub Actions/);
  assert.match(text, /\.github\/workflows\//);
  assert.match(text, /ci\.yml/);
  assert.match(text, /Gitee Go/);
  assert.match(text, /\.workflow\//);
  assert.match(text, /pr-pipeline\.yml/);
  assert.match(text, /当前尚未开通/);
  assert.match(text, /npm run ci/);
});

test('every workflow, issue template and hook parses as YAML', () => {
  const files = [
    '.pre-commit-hooks.yaml',
    ...readdirSync(path.join(ROOT, '.workflow')).map((f) => `.workflow/${f}`),
    ...readdirSync(path.join(ROOT, '.github/workflows')).map((f) => `.github/workflows/${f}`),
    ...readdirSync(path.join(ROOT, '.github/ISSUE_TEMPLATE')).map((f) => `.github/ISSUE_TEMPLATE/${f}`),
    ...readdirSync(path.join(ROOT, '.gitee/ISSUE_TEMPLATE')).map((f) => `.gitee/ISSUE_TEMPLATE/${f}`),
  ];
  for (const rel of files) {
    const doc = yaml(rel);
    assert.notEqual(doc, null, `${rel} should not be empty`);
  }
  const hooks = yaml('.pre-commit-hooks.yaml') as Array<{ id: string; entry: string; args: string[] }>;
  assert.equal(hooks[0]?.id, 'readme-smith');
  assert.match(hooks[0]?.entry ?? '', /^readme-smith check$/);
  assert.deepEqual(hooks[0]?.args, ['--min-score', '80']);
});

test('README table-of-contents anchors resolve to real headings', () => {
  const text = read('README.md');
  const parsed = parseReadme(text);
  const anchors = [...text.matchAll(/^- \[[^\]]+\]\(#([^)]+)\)$/gm)].map((m) => m[1]!);
  assert.ok(anchors.length >= 5);
  const slugs = new Set(parsed.headings.map((h) => slugify(h.text)));
  for (const anchor of anchors) assert.ok(slugs.has(anchor), `missing heading for #${anchor}`);
});

test('README documents the required commands and never claims README edits by draft', () => {
  const text = read('README.md');
  for (const command of ['readme-smith scan', 'readme-smith draft', 'readme-smith diff', 'readme-smith doctor', 'readme-smith check', 'readme-smith apply', 'readme-smith init']) {
    assert.ok(text.includes(command), `README should document ${command}`);
  }
  assert.match(text, /绝不修改 `README\.md`/);
  assert.match(text, /#rf-skip/);
  assert.match(text, /\[CONTRIBUTING\.md\]\(CONTRIBUTING\.md\)/);
});

test('README makes npm the primary install and rf only an optional local alias', () => {
  const text = read('README.md');
  assert.match(text, /npm install -g readme-smith/);
  assert.match(text, /npx readme-smith/);
  assert.match(text, /alias rf='readme-smith'/);
  assert.doesNotMatch(text, /npm link` 会把 `readme-smith`（推荐）和短别名 `rf` 都暴露到 PATH/);
  assert.doesNotMatch(text, /项目尚未发布到 npm registry/);
});

test('README explains relative weight normalization instead of a hard 100 sum', () => {
  const text = read('README.md');
  assert.match(text, /权重可以是相对值/);
  assert.match(text, /最大余数法/);
  assert.match(text, /任意相对值/);
  assert.doesNotMatch(text, /权重必须合计为 `100`/);
});

test('README carries measured benchmark and before/after evidence', () => {
  const text = read('README.md');
  for (const repo of ['jonschlinkert/is-number', 'kentcdodds/cross-env', 'chalk/chalk', 'expressjs/express']) {
    assert.ok(text.includes(repo), `README should cite ${repo}`);
  }
  assert.match(text, /\*\*97\*\*/);
  assert.match(text, /\*\*92\*\*/);
  assert.match(text, /\*\*91\*\*/);
  assert.match(text, /\*\*79\*\*/);
  assert.match(text, /pallets\/click/);
  assert.match(text, /\*\*74\*\*/);
  assert.match(text, /\*\*99\*\*/);
});

test('SECURITY.md is real and linked through a private channel', () => {
  const security = read('SECURITY.md');
  assert.match(security, /0\.3\.x/);
  assert.match(security, /yuwan41064@gmail\.com/);
  assert.match(security, /不要.*公开 issue/s);
  assert.match(security, /\[readme-smith security\]/);
  const readme = read('README.md');
  assert.match(readme, /\[SECURITY\.md\]\(SECURITY\.md\)/);
  assert.match(readme, /mailto:yuwan41064@gmail\.com/);
  assert.doesNotMatch(security, /github\.com\/[^/\s]+\/[^/\s]+\/issues/);
});

test('the project contains no obviously committed secrets', () => {
  const files = [
    'README.md',
    'CONTRIBUTING.md',
    'CHANGELOG.md',
    'action.yml',
    '.pre-commit-hooks.yaml',
    'package.json',
  ];
  const secret = /\b(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/;
  for (const rel of files) assert.doesNotMatch(read(rel), secret, `${rel} contains a credential-like string`);
});
