import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CLI, tempDir, tempFixture } from './helpers.js';

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): CliResult {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', CI: '', ...env },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`Expected JSON, got:\n${text}\n${(error as Error).message}`);
  }
}

function git(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
}

test('--version and --help are available', () => {
  const { root, cleanup } = tempDir();
  try {
    const version = run(['--version'], root);
    assert.equal(version.status, 0);
    assert.equal(version.stdout.trim(), '0.3.0');
    const help = run(['--help'], root);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage: readme-smith/);
    assert.match(help.stdout, /Local-first README health doctor/);
    assert.match(help.stdout, /draft/);
    assert.match(help.stdout, /check/);
  } finally {
    cleanup();
  }
});

test('scan emits deterministic facts as JSON and exits 0', () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    const result = run(['scan', '.', '--json'], root);
    assert.equal(result.status, 0);
    const facts = parseJson<{ project: { name: string; version: string; type: string }; scripts: unknown[] }>(result.stdout);
    assert.equal(facts.project.name, 'acme-tool');
    assert.equal(facts.project.version, '1.4.2');
    assert.equal(facts.project.type, 'cli');
    assert.ok(facts.scripts.length >= 4);
    assert.ok(!result.stdout.includes(root), 'facts must not leak absolute paths');
  } finally {
    cleanup();
  }
});

test('scan defaults to the current directory and accepts program-level flags', () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    const result = run(['--json', 'scan'], root);
    assert.equal(result.status, 0);
    const facts = parseJson<{ project: { name: string } }>(result.stdout);
    assert.equal(facts.project.name, 'acme-tool');
  } finally {
    cleanup();
  }
});

test('scan exits 2 and names missing manifests for an unknown project', () => {
  const { root, cleanup } = tempFixture('unknown');
  try {
    const result = run(['scan', '.', '--json'], root);
    assert.equal(result.status, 2);
    const error = parseJson<{ error: { code: string; expectedManifests: string[] } }>(result.stdout);
    assert.equal(error.error.code, 'unknown_project_type');
    assert.ok(error.error.expectedManifests.includes('package.json'));
    assert.ok(error.error.expectedManifests.some((m) => m.includes('Cargo.toml')));
  } finally {
    cleanup();
  }
});

test('--preset makes an unrecognised repository scannable', () => {
  const { root, cleanup } = tempFixture('unknown');
  try {
    const result = run(['scan', '.', '--preset', 'lib', '--json'], root);
    assert.equal(result.status, 0);
    const facts = parseJson<{ project: { type: string } }>(result.stdout);
    assert.equal(facts.project.type, 'lib');
  } finally {
    cleanup();
  }
});

test('doctor passes a complete README and fails a missing one', () => {
  const complete = tempFixture('node-cli');
  try {
    const result = run(['doctor', '.', '--json'], complete.root);
    assert.equal(result.status, 0);
    const report = parseJson<{ score: number; passed: boolean; missing: unknown[] }>(result.stdout);
    assert.equal(report.score, 100);
    assert.equal(report.passed, true);
    assert.deepEqual(report.missing, []);
  } finally {
    complete.cleanup();
  }

  const incomplete = tempFixture('node-cli');
  try {
    writeFileSync(path.join(incomplete.root, 'README.md'), '# acme-tool\n');
    const result = run(['doctor', '.', '--json'], incomplete.root);
    assert.equal(result.status, 1);
    const report = parseJson<{ score: number; passed: boolean }>(result.stdout);
    assert.equal(report.passed, false);
    assert.ok(report.score < 80);
  } finally {
    incomplete.cleanup();
  }
});

test('doctor is quiet on request and rejects invalid thresholds', () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    const quiet = run(['doctor', '.', '--quiet'], root);
    assert.equal(quiet.status, 0);
    assert.match(quiet.stdout, /README health: 100\/100 .* PASS/);

    const invalid = run(['doctor', '.', '--min-score', '101'], root);
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /--min-score/);
  } finally {
    cleanup();
  }
});

test('--json reports failures with a structured error code', () => {
  const { root, cleanup } = tempFixture('unknown');
  try {
    const draft = run(['draft', '.', '--json'], root);
    assert.equal(draft.status, 2);
    const error = parseJson<{ error: { code: string; message: string; exitCode: number } }>(draft.stdout);
    assert.equal(error.error.code, 'unknown_project_type');
    assert.equal(error.error.exitCode, 2);
    assert.match(error.error.message, /project type/i);

    const diff = run(['diff', '.', '--json'], root);
    assert.equal(diff.status, 2);
    const missing = parseJson<{ error: { code: string } }>(diff.stdout);
    assert.equal(missing.error.code, 'draft_missing');
  } finally {
    cleanup();
  }
});

test('draft writes README.draft.md and never overwrites README.md', () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    const before = readFileSync(path.join(root, 'README.md'), 'utf8');
    const result = run(['draft', '.', '--ai', 'off', '--json'], root);
    assert.equal(result.status, 0);
    const meta = parseJson<{ path: string; language: string; aiUsed: boolean }>(result.stdout);
    assert.equal(meta.path, 'README.draft.md');
    assert.equal(meta.language, 'en');
    assert.equal(meta.aiUsed, false);
    assert.equal(readFileSync(path.join(root, 'README.md'), 'utf8'), before);
    assert.equal(readFileSync(path.join(root, 'README.draft.md'), 'utf8'), before);
  } finally {
    cleanup();
  }
});

test('draft creates a complete document for a new monorepo', () => {
  const { root, cleanup } = tempFixture('monorepo');
  try {
    const result = run(['draft', '.', '--ai', 'off', '--json'], root);
    assert.equal(result.status, 0);
    assert.ok(existsSync(path.join(root, 'README.draft.md')));
    assert.ok(!existsSync(path.join(root, 'README.md')));
    const markdown = readFileSync(path.join(root, 'README.draft.md'), 'utf8');
    assert.match(markdown, /^# acme-workspace/);
    assert.match(markdown, /## Installation/);
    assert.match(markdown, /## Packages/);
    assert.match(markdown, /`packages\/a`/);
  } finally {
    cleanup();
  }
});

test('draft honours --lang and rejects invalid languages', () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    const result = run(['draft', '.', '--ai', 'off', '--lang', 'zh', '--json'], root);
    assert.equal(result.status, 0);
    const meta = parseJson<{ language: string; warnings: string[] }>(result.stdout);
    assert.equal(meta.language, 'zh');
    assert.ok(meta.warnings.some((w) => /--lang zh differs/.test(w)));
    assert.match(readFileSync(path.join(root, 'README.draft.md'), 'utf8'), /## 安装/);

    const invalid = run(['draft', '.', '--lang', 'fr'], root);
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /--lang must be/);
  } finally {
    cleanup();
  }
});

test('draft refuses an unknown project type with actionable guidance', () => {
  const { root, cleanup } = tempFixture('unknown');
  try {
    const result = run(['draft', '.', '--ai', 'off'], root);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Could not recognise the project type/);
    assert.match(result.stderr, /package\.json/);
    assert.ok(!existsSync(path.join(root, 'README.draft.md')));
  } finally {
    cleanup();
  }
});

test('diff exit codes distinguish changes, no changes and a missing draft', () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    run(['draft', '.', '--ai', 'off'], root);
    const same = run(['diff', '.', '--json'], root);
    assert.equal(same.status, 0);
    const noChanges = parseJson<{ hasChanges: boolean }>(same.stdout);
    assert.equal(noChanges.hasChanges, false);

    writeFileSync(
      path.join(root, 'README.draft.md'),
      readFileSync(path.join(root, 'README.draft.md'), 'utf8') + '\n## Extra\n\nDetails.\n',
    );
    const changed = run(['diff', '.', '--json'], root);
    assert.equal(changed.status, 1);
    const diff = parseJson<{ hasChanges: boolean; changes: Array<{ kind: string; title: string }> }>(changed.stdout);
    assert.equal(diff.hasChanges, true);
    assert.deepEqual(diff.changes.map((c) => [c.kind, c.title]), [['added', 'Extra']]);

    const shown = run(['diff', '.', '--show'], root);
    assert.equal(shown.status, 1);
    assert.match(shown.stdout, /--- README\.md/);
    assert.match(shown.stdout, /\+## Extra/);

    const missing = tempFixture('node-cli');
    try {
      const result = run(['diff', '.'], missing.root);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /README\.draft\.md not found/);
    } finally {
      missing.cleanup();
    }
  } finally {
    cleanup();
  }
});

test('apply previews with --dry-run, then backs up and writes README.md', () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    const original = readFileSync(path.join(root, 'README.md'), 'utf8');
    writeFileSync(path.join(root, 'README.draft.md'), `${original}\n## Extra\n\nDetails.\n`);

    const dry = run(['apply', '.', '--dry-run', '--json'], root);
    assert.equal(dry.status, 0);
    const preview = parseJson<{ applied: boolean; dryRun: boolean; diff: { hasChanges: boolean } }>(dry.stdout);
    assert.equal(preview.applied, false);
    assert.equal(preview.dryRun, true);
    assert.equal(preview.diff.hasChanges, true);
    assert.equal(readFileSync(path.join(root, 'README.md'), 'utf8'), original);
    assert.ok(!existsSync(path.join(root, '.README.bak.md')));

    const applied = run(['apply', '.', '--json'], root);
    assert.equal(applied.status, 0);
    const result = parseJson<{ applied: boolean; backup: string }>(applied.stdout);
    assert.equal(result.applied, true);
    assert.equal(result.backup, '.README.bak.md');
    assert.equal(readFileSync(path.join(root, '.README.bak.md'), 'utf8'), original);
    assert.match(readFileSync(path.join(root, 'README.md'), 'utf8'), /## Extra/);
  } finally {
    cleanup();
  }
});

test('apply exits 2 when there is no draft', () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    const result = run(['apply', '.'], root);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /README\.draft\.md not found/);
  } finally {
    cleanup();
  }
});

test('init creates the config once and overwrites with --force', () => {
  const { root, cleanup } = tempDir();
  try {
    const first = run(['init', '.', '--json'], root);
    assert.equal(first.status, 0);
    assert.deepEqual(parseJson(first.stdout), { path: '.readme-smith.yaml', created: true });
    assert.match(readFileSync(path.join(root, '.readme-smith.yaml'), 'utf8'), /weights:/);

    const second = run(['init', '.', '--json'], root);
    assert.equal(second.status, 0);
    assert.deepEqual(parseJson(second.stdout), { path: '.readme-smith.yaml', created: false });

    writeFileSync(path.join(root, '.readme-smith.yaml'), 'preset: cli\n');
    const forced = run(['init', '.', '--force', '--json'], root);
    assert.equal(forced.status, 0);
    assert.deepEqual(parseJson(forced.stdout), { path: '.readme-smith.yaml', created: true });
    assert.match(readFileSync(path.join(root, '.readme-smith.yaml'), 'utf8'), /version: 1/);
  } finally {
    cleanup();
  }
});

test('check passes a complete repository and does not write a draft', () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    const result = run(['check', '.', '--json'], root);
    assert.equal(result.status, 0);
    const report = parseJson<{ passed: boolean; skipped: boolean; score: number; reasons: string[] }>(result.stdout);
    assert.equal(report.passed, true);
    assert.equal(report.skipped, false);
    assert.equal(report.score, 100);
    assert.deepEqual(report.reasons, []);
    assert.ok(!existsSync(path.join(root, 'README.draft.md')));
  } finally {
    cleanup();
  }
});

test('check fails with reasons when the README is incomplete', () => {
  const broken = tempFixture('node-cli');
  try {
    writeFileSync(path.join(broken.root, 'README.md'), '# acme-tool\n');
    const result = run(['check', '.', '--json'], broken.root);
    assert.equal(result.status, 1);
    const report = parseJson<{ passed: boolean; skipped: boolean; reasons: string[] }>(result.stdout);
    assert.equal(report.passed, false);
    assert.equal(report.skipped, false);
    assert.ok(report.reasons.some((r) => /below the threshold/.test(r)));
    assert.ok(report.reasons.some((r) => /differs from the deterministic draft/.test(r)));
  } finally {
    broken.cleanup();
  }
});

test('a #rf-skip commit message turns a failing check green', () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    writeFileSync(path.join(root, 'README.md'), '# acme-tool\n');
    git(root, ['init', '-q']);
    git(root, ['add', '-A']);
    git(root, ['-c', 'user.name=RF Test', '-c', 'user.email=rf@example.invalid', 'commit', '-q', '-m', 'chore: initial import #rf-skip']);

    const result = run(['check', '.', '--json'], root);
    assert.equal(result.status, 0);
    const report = parseJson<{ passed: boolean; skipped: boolean; reasons: string[] }>(result.stdout);
    assert.equal(report.skipped, true);
    assert.equal(report.passed, true);
    assert.ok(report.reasons.length > 0, 'findings are still reported even when skipped');
  } finally {
    cleanup();
  }
});

test('check --changed evaluates workspace packages touched by the diff', () => {
  const { root, cleanup } = tempFixture('monorepo');
  try {
    assert.equal(run(['draft', '.', '--ai', 'off'], root).status, 0);
    assert.equal(run(['apply', '.'], root).status, 0);
    assert.equal(run(['draft', 'packages/a', '--ai', 'off'], root).status, 0);
    assert.equal(run(['apply', 'packages/a'], root).status, 0);

    git(root, ['init', '-q']);
    git(root, ['add', '-A']);
    git(root, ['-c', 'user.name=RF Test', '-c', 'user.email=rf@example.invalid', 'commit', '-q', '-m', 'chore: baseline']);
    writeFileSync(
      path.join(root, 'packages/a/package.json'),
      readFileSync(path.join(root, 'packages/a/package.json'), 'utf8').replace('1.0.0', '1.0.1'),
    );
    git(root, ['add', '-A']);
    git(root, ['-c', 'user.name=RF Test', '-c', 'user.email=rf@example.invalid', 'commit', '-q', '-m', 'chore: bump widget-a']);

    const result = run(['check', '.', '--changed', '--base', 'HEAD^', '--min-score', '0', '--json'], root);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = parseJson<{
      passed: boolean;
      base: string;
      affected: Array<{ path: string; passed: boolean }>;
    }>(result.stdout);
    assert.equal(report.passed, true);
    assert.equal(report.base, 'HEAD^');
    assert.deepEqual(report.affected.map((target) => [target.path, target.passed]), [['packages/a', true]]);

    writeFileSync(path.join(root, 'packages/a/README.md'), '# broken widget\n');
    const broken = run(['check', '.', '--changed', '--base', 'HEAD^', '--min-score', '0', '--json'], root);
    assert.equal(broken.status, 1);
    const failed = parseJson<{ passed: boolean; reasons: string[]; affected: Array<{ path: string; passed: boolean }> }>(broken.stdout);
    assert.equal(failed.passed, false);
    assert.equal(failed.affected[0]?.passed, false);
    assert.ok(failed.reasons.some((reason) => reason.startsWith('[packages/a] ')));
  } finally {
    cleanup();
  }
});

test('check --changed reports an unusable git base', () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    git(root, ['init', '-q']);
    git(root, ['add', '-A']);
    git(root, ['-c', 'user.name=RF Test', '-c', 'user.email=rf@example.invalid', 'commit', '-q', '-m', 'chore: baseline']);

    const result = run(['check', '.', '--changed', '--base', 'does-not-exist', '--json'], root);
    assert.equal(result.status, 2);
    const error = parseJson<{ error: { code: string } }>(result.stdout);
    assert.equal(error.error.code, 'git_base_not_found');
  } finally {
    cleanup();
  }
});

test('check writes a GitHub step summary when configured', () => {
  const { root, cleanup } = tempFixture('node-cli');
  const summaryDir = tempDir();
  try {
    const summary = path.join(summaryDir.root, 'summary.md');
    const result = run(['check', '.'], root, { GITHUB_STEP_SUMMARY: summary });
    assert.equal(result.status, 0);
    const text = readFileSync(summary, 'utf8');
    assert.match(text, /## readme-smith check: passed/);
    assert.match(text, /Score: \*\*100\/100\*\*/);
  } finally {
    summaryDir.cleanup();
    cleanup();
  }
});

test('quiet commands still print their conclusion', () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    const check = run(['check', '.', '--quiet'], root);
    assert.equal(check.status, 0);
    assert.match(check.stdout, /README check: PASS .*100\/100/);

    const draft = run(['draft', '.', '--quiet', '--ai', 'off'], root);
    assert.equal(draft.status, 0);
    assert.match(draft.stdout, /^Wrote README\.draft\.md/m);

    const diff = run(['diff', '.', '--quiet'], root);
    assert.equal(diff.status, 0);
    assert.match(diff.stdout, /No differences/);
  } finally {
    cleanup();
  }
});

test('--verbose narrates the extracted facts', () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    const result = run(['doctor', '.', '--verbose', '--quiet'], root);
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stderr, /Manifests:/);
    const verbose = run(['doctor', '.', '--verbose'], root);
    assert.equal(verbose.status, 0);
    assert.match(verbose.stderr, /Manifests: package\.json/);
    assert.match(verbose.stderr, /Environment variables: .*ACME_TOKEN/);
  } finally {
    cleanup();
  }
});

test('invalid presets exit 2 with an actionable message', () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    const result = run(['doctor', '.', '--preset', 'website'], root);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unknown preset "website"/);
    assert.match(result.stderr, /cli, lib, web, monorepo, dataset/);
  } finally {
    cleanup();
  }
});

test('scan --quiet keeps machine-readable stdout but suppresses narration', () => {
  const { root, cleanup } = tempFixture('node-cli');
  try {
    const result = run(['scan', '.', '--quiet'], root);
    assert.equal(result.status, 0);
    const facts = parseJson<{ project: { name: string } }>(result.stdout);
    assert.equal(facts.project.name, 'acme-tool');
    assert.equal(result.stderr.trim(), '');
  } finally {
    cleanup();
  }
});
