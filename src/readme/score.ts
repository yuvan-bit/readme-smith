import path from 'node:path';
import { statSync } from 'node:fs';
import type {
  DimensionId,
  DimensionScore,
  DoctorReport,
  FactSheet,
  FreshnessResult,
  ParsedSection,
  PresetId,
  ReadmeAnalysis,
  ScoreIssue,
} from '../types.js';
import { README_FILE } from './parse.js';
import { isFileDirty } from '../utils/git.js';

export interface ScoreInput {
  facts: FactSheet;
  analysis: ReadmeAnalysis;
  root: string;
  weights: Record<DimensionId, number>;
  preset: PresetId;
  threshold: number;
}

interface Check {
  code: string;
  weight: number;
  passed: boolean;
  message: string;
  earned?: number;
  line?: number;
}

function sectionBody(analysis: ReadmeAnalysis, re: RegExp): ParsedSection | undefined {
  return analysis.sections.find((s) => re.test(s.title));
}

export function scoreReadme(input: ScoreInput): DoctorReport {
  const { facts, analysis, weights, preset } = input;
  const dimensions: DimensionScore[] = [
    completeness(facts, analysis, preset, weights.completeness),
    usability(facts, analysis, preset, weights.usability),
    accuracy(facts, analysis, weights.accuracy),
    readability(analysis, weights.readability),
    freshness(facts, analysis, weights.freshness, input.root),
  ];
  const score = dimensions.reduce((sum, d) => sum + d.score, 0);
  return {
    score,
    threshold: input.threshold,
    passed: score >= input.threshold,
    readme: {
      path: analysis.path ?? README_FILE,
      exists: analysis.exists,
      lines: analysis.lines,
      language: analysis.language,
    },
    dimensions,
    missing: dimensions.flatMap((d) => d.issues),
  };
}

function fromChecks(checks: Check[], max: number, label: string, id: DimensionId): DimensionScore {
  const applicable = checks.filter((c) => c.weight > 0);
  const totalWeight = applicable.reduce((s, c) => s + c.weight, 0);
  const earnedWeight = applicable.reduce((s, c) => {
    const raw = c.earned ?? (c.passed ? c.weight : 0);
    // Rounding must never turn a failing check into full credit.
    return s + (!c.passed && c.weight > 0 ? Math.min(raw, c.weight - 1) : raw);
  }, 0);
  const score = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * max) : max;
  const issues: ScoreIssue[] = checks
    .filter((c) => !c.passed && c.message)
    .map((c) => ({ code: c.code, message: c.message, ...(c.line ? { line: c.line } : {}) }));
  return { id, label, score: Math.min(max, Math.max(0, score)), max, issues };
}

function completeness(facts: FactSheet, analysis: ReadmeAnalysis, preset: PresetId, max: number): DimensionScore {
  const std = analysis.standard;
  const contributorThreshold = (facts.git.contributors ?? 0) > 3;
  const contributingRequired = facts.community.contributing || contributorThreshold;

  const checks: Check[] = [
    { code: 'missing_title', weight: 4, passed: std.title, message: 'README has no H1 title.' },
    { code: 'missing_intro', weight: 6, passed: std.intro, message: 'No introduction paragraph before the first section.' },
    {
      code: 'missing_install',
      weight: preset === 'dataset' ? 0 : 8,
      passed: std.install,
      message: 'No install or setup section.',
    },
    { code: 'missing_usage', weight: 8, passed: std.usage, message: 'No usage or example section.' },
    {
      code: 'missing_license_section',
      weight: facts.project.license ? 4 : 0,
      passed: std.license,
      message: `A ${facts.project.license?.spdx ?? facts.project.license?.family ?? ''} licence exists in the repository but the README has no licence section.`,
    },
    {
      code: 'missing_contributing',
      weight: contributingRequired ? 3 : 0,
      passed: std.contributing,
      message: contributorThreshold && !facts.community.contributing
        ? `The repository has ${facts.git.contributors} contributors but no CONTRIBUTING file and no contributing section.`
        : 'A CONTRIBUTING file exists but the README does not link to it.',
    },
    {
      code: 'missing_demo',
      weight: preset === 'cli' || preset === 'web' ? 2 : 0,
      passed: std.demo,
      message: 'A CLI/UI project should show a screenshot, GIF, terminal recording or console example.',
    },
    {
      code: 'missing_packages',
      weight: preset === 'monorepo' ? 4 : 0,
      passed: std.packages,
      message: 'A monorepo README should describe its packages or workspace layout.',
    },
  ];
  return fromChecks(checks.filter((c) => c.weight > 0), max, 'Completeness', 'completeness');
}

function usability(facts: FactSheet, analysis: ReadmeAnalysis, preset: PresetId, max: number): DimensionScore {
  const install = sectionBody(analysis, /install|installation|setup|getting started|安装/i);
  const usage = sectionBody(analysis, /usage|quick ?start|example|使用|示例|快速/i);
  const dev = facts.install.development?.command;
  const consumer = facts.install.consumer?.command;
  const installText = install?.body ?? '';
  const hasInstallEvidence =
    !!install &&
    ((!!dev && installText.includes(dev)) ||
      (!!consumer && installText.includes(consumer)) ||
      /```[\s\S]*?\b(install|bundle|cargo|npm|pnpm|yarn|bun|pip|poetry|uv|go get|go mod|composer)\b/i.test(installText));

  const usageHasCode =
    !!usage &&
    (usage.body.includes('```') ||
      analysis.codeBlocks.some((b) => b.line > usage.startLine && b.line <= usage.endLine));

  const checked = analysis.commands.filter((c) => c.kind === 'script' && c.valid !== null);
  const good = checked.filter((c) => c.valid === true).length;
  const commandWeight = checked.length > 0 ? 9 : 0;
  const commandEarned = checked.length > 0 ? Math.round((good / checked.length) * commandWeight) : 0;

  const checks: Check[] = [
    {
      code: 'missing_install',
      weight: preset === 'dataset' ? 0 : 8,
      passed: hasInstallEvidence,
      earned: !install ? 0 : hasInstallEvidence ? 8 : 5,
      message: !install ? 'No install section.' : 'Install section contains no runnable command derived from the manifest.',
    },
    {
      code: 'missing_usage_example',
      weight: 8,
      passed: usageHasCode,
      earned: !usage ? 0 : usageHasCode ? 8 : 4,
      message: !usage ? 'No usage section.' : 'Usage section has no code example.',
    },
    {
      code: 'command_drift',
      weight: commandWeight,
      passed: checked.length === 0 || good === checked.length,
      earned: commandEarned,
      message: checked.length === 0
        ? ''
        : `${checked.length - good} documented command(s) do not match the manifest scripts.`,
    },
  ];
  // Do not emit an empty command_drift issue when there is nothing to check.
  const visible = checks.filter((c) => c.weight > 0);
  return fromChecks(visible, max, 'Usability', 'usability');
}

function accuracy(facts: FactSheet, analysis: ReadmeAnalysis, max: number): DimensionScore {
  const scriptMentions = analysis.commands.filter((c) => c.kind === 'script' && c.valid !== null);
  const badScripts = scriptMentions.filter((c) => c.valid === false);
  const commandChecks: Check[] = badScripts.map((c) => ({
    code: 'command_not_found',
    weight: 0,
    passed: false,
    message: `\`${c.raw}\` cannot run: ${c.detail ?? 'the script is not declared in the manifest'}.`,
    line: c.line,
  }));

  const mentionCount = analysis.envMentions.length;
  const unknownEnv = analysis.envMentions.filter((e) => !e.known);
  const envPassed = mentionCount === 0 || unknownEnv.length === 0;

  const licenseMention = analysis.licenseStatement;
  const licenseIssue = licenseProblem(facts, analysis, licenseMention);

  const commandWeight = scriptMentions.length > 0 ? 10 : 0;
  const commandEarned = scriptMentions.length > 0
    ? Math.round(((scriptMentions.length - badScripts.length) / scriptMentions.length) * 10)
    : 0;
  const envWeight = mentionCount > 0 ? 6 : 0;
  const envEarned = mentionCount > 0 ? Math.round(((mentionCount - unknownEnv.length) / mentionCount) * 6) : 0;
  // A licence claim with no repository evidence is an accuracy problem in its
  // own right, so it carries weight even when no licence was detected.
  const licenseWeight = licenseIssue && (analysis.standard.license || licenseMention) ? 4 : 0;

  const checks: Check[] = [
    {
      code: 'command_not_found',
      weight: commandWeight,
      passed: badScripts.length === 0,
      earned: commandEarned,
      message: `${badScripts.length} command(s) in the README do not exist in the manifest scripts.`,
    },
    {
      code: 'env_not_found',
      weight: envWeight,
      passed: envPassed,
      earned: envEarned,
      message: `${unknownEnv.length} environment variable(s) mentioned in the README were not found in the repository.`,
    },
    {
      code: licenseIssue?.code ?? 'license_ok',
      weight: licenseWeight,
      passed: !licenseIssue,
      earned: licenseIssue ? 0 : licenseWeight,
      message: licenseIssue?.message ?? '',
    },
  ];

  const dim = fromChecks(checks.filter((c) => c.weight > 0), max, 'Accuracy', 'accuracy');
  // Detailed line-level issues are more useful than the aggregate message.
  for (const check of commandChecks) dim.issues.push({ code: check.code, message: check.message, ...(check.line ? { line: check.line } : {}) });
  for (const env of unknownEnv) {
    dim.issues.push({
      code: 'env_not_found',
      message: `Environment variable \`${env.name}\` is mentioned but does not exist in repository sources.`,
      line: env.line,
    });
  }
  return dim;
}

function licenseProblem(
  facts: FactSheet,
  analysis: ReadmeAnalysis,
  mention: string | null,
): { code: string; message: string } | null {
  const detected = facts.project.license;
  if (!detected) {
    return mention ? { code: 'license_unbacked', message: `README claims ${mention}, but no LICENSE file or manifest licence field was found.` } : null;
  }
  if (!analysis.standard.license && !mention) return null;
  if (!mention) {
    return { code: 'license_unnamed', message: `A ${detected.spdx ?? detected.family} licence was detected, but the licence section does not name it.` };
  }
  const expected = (detected.spdx ?? detected.family).toLowerCase();
  const actual = mention.toLowerCase();
  const compatible = expected === actual ||
    expected.startsWith(actual) ||
    actual.startsWith(expected) ||
    (detected.family.toLowerCase() === actual);
  return compatible ? null : { code: 'license_mismatch', message: `README says ${mention}, but the repository licence is ${detected.spdx ?? detected.family}.` };
}

function readability(analysis: ReadmeAnalysis, max: number): DimensionScore {
  const h1Ok = analysis.h1Count === 1;
  const jumps = Math.min(3, analysis.headingJumps);
  const blocks = analysis.codeBlocks.length;
  const labelled = blocks - analysis.unlabelledCodeBlocks;
  const labelledEarned = blocks === 0 ? 3 : Math.round((labelled / blocks) * 3);
  const tocNeeded = analysis.sections.length > 5;
  const checks: Check[] = [
    { code: 'h1_count', weight: 2, passed: h1Ok, message: analysis.h1Count === 0 ? 'README has no H1.' : `README has ${analysis.h1Count} H1 headings; use exactly one.` },
    { code: 'heading_jump', weight: 3, passed: analysis.headingJumps === 0, earned: 3 - jumps, message: `Heading levels skip a level in ${analysis.headingJumps} place(s).` },
    { code: 'unlabelled_code', weight: 3, passed: labelled === blocks, earned: labelledEarned, message: `${analysis.unlabelledCodeBlocks} fenced code block(s) have no language tag.` },
    { code: 'missing_toc', weight: 2, passed: !tocNeeded || analysis.hasToc, message: tocNeeded ? 'README has more than five sections but no table of contents.' : '' },
  ];
  return fromChecks(checks, max, 'Readability', 'readability');
}

function freshness(facts: FactSheet, analysis: ReadmeAnalysis, max: number, root: string): DimensionScore {
  const result = computeFreshness(facts, analysis, root, max);
  return { id: 'freshness', label: 'Freshness', score: result.score, max: result.max, issues: result.issues };
}

export function computeFreshness(facts: FactSheet, analysis: ReadmeAnalysis, root: string, max = 10): FreshnessResult {
  if (!analysis.exists) {
    return { score: 0, max, issues: [{ code: 'missing_readme', message: 'README.md does not exist.' }] };
  }
  if (!facts.git.isGit) {
    return { score: max, max, issues: [] };
  }
  const manifestPaths = new Set(facts.manifests.map((m) => m.path.toLowerCase()));
  if (manifestPaths.size === 0) {
    return { score: max, max, issues: [] };
  }
  const readmePath = analysis.path ?? README_FILE;
  const readmeName = path.posix.basename(readmePath.replace(/\\/g, '/')).toLowerCase();
  const commits = facts.git.recentCommits;
  // Git reports the committed case (readme.md, Readme.md); comparing exact
  // strings made every lowercase README look permanently stale.
  const readmeIndex = commits.findIndex((c) => c.files.some((f) => path.posix.basename(f.replace(/\\/g, '/')).toLowerCase() === readmeName));
  const isManifest = (f: string): boolean => manifestPaths.has(f.toLowerCase()) || /(^|\/)(package\.json|pyproject\.toml|setup\.py|setup\.cfg|Cargo\.toml|go\.mod|Gemfile|.*\.gemspec)$/i.test(f);
  // A version bump or dependency refresh changes the manifest without making
  // the README wrong; only substantive manifest edits imply staleness.
  const releaseOnly = /^(?:v?\d+\.\d+\.\d+(?:[-+].*)?|release(?:d)?\b.*|publish(?:ed)?\b.*|bump\b.*|chore(?:\([^)]*\))?!?:\s*(?:release|publish|bump|update (?:deps|dependencies)|upgrade).*)$/i;
  const manifestIndex = commits.findIndex((c) => c.files.some(isManifest) && !releaseOnly.test(c.subject.trim()));

  if (manifestIndex < 0) return { score: max, max, issues: [] };
  // A shallow clone cannot see whether the README changed before the cut-off.
  if (readmeIndex < 0 && facts.project.repository?.shallow) return { score: max, max, issues: [] };
  if (readmeIndex >= 0) {
    if (manifestIndex > readmeIndex) {
      return { score: max, max, issues: [] };
    }
    if (manifestIndex === readmeIndex) return { score: max, max, issues: [] };
    return {
      score: 0,
      max,
      issues: [{
        code: 'readme_stale',
        message: `Manifest changed in ${commits[manifestIndex]!.hash.slice(0, 7)} ("${commits[manifestIndex]!.subject}") after the README was last updated.`,
      }],
    };
  }

  // An untracked or uncommitted README can legitimately be newer than the last
  // manifest commit; checkout timestamps are not evidence, working-tree status is.
  try {
    if (isFileDirty(root, readmePath)) {
      const mtime = statSync(path.join(root, readmePath)).mtimeMs;
      const commitTime = Date.parse(commits[manifestIndex]!.date);
      if (Number.isFinite(commitTime) && mtime > commitTime) return { score: max, max, issues: [] };
    }
  } catch {
    /* unreadable README is already handled by analysis.exists */
  }
  return {
    score: 0,
    max,
    issues: [{
      code: 'readme_stale',
      message: `Manifest changed in ${commits[manifestIndex]!.hash.slice(0, 7)} ("${commits[manifestIndex]!.subject}") but ${readmePath} was not updated in the last ${commits.length} commits.`,
    }],
  };
}
