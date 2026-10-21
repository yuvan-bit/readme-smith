/**
 * Domain types for readme-smith.
 *
 * The fact sheet is the contract between the deterministic scanner, the README
 * analyser and the (optional) AI layer. Every field that cannot be proven from
 * the repository is `null` — never guessed.
 */

export type Lang = 'en' | 'zh';
export type LanguageSetting = Lang | 'auto';
export type PresetId = 'cli' | 'lib' | 'web' | 'monorepo' | 'dataset';
export type ProjectType = PresetId | 'unknown';
export type AiBackend = 'local' | 'openai' | 'off';

export interface LanguageStat {
  name: string;
  extensions: string[];
  files: number;
  bytes: number;
  lines: number;
  percent: number;
  color?: string;
}

export type PackageEcosystem =
  | 'npm'
  | 'pnpm'
  | 'yarn'
  | 'bun'
  | 'pip'
  | 'poetry'
  | 'uv'
  | 'cargo'
  | 'go'
  | 'gem'
  | 'composer'
  | 'nuget'
  | 'maven'
  | 'gradle';

export interface Dependency {
  name: string;
  version: string;
  dev: boolean;
}

export type ScriptKind = 'install' | 'build' | 'test' | 'lint' | 'dev' | 'start' | 'format' | 'other';

export interface ScriptInfo {
  name: string;
  command: string;
  kind: ScriptKind;
}

export interface FactScript {
  /** Script name as declared, e.g. `build`. */
  name: string;
  /** Raw command declared by the manifest. */
  command: string;
  /** The exact invocation a reader should type, e.g. `npm run build`. */
  invocation: string;
  kind: ScriptKind;
}

export interface RepoInfo {
  isGit: boolean;
  url?: string;
  sshUrl?: string;
  host?: 'github' | 'gitlab' | 'bitbucket' | 'gitea' | 'other';
  owner?: string;
  name?: string;
  defaultBranch?: string;
  slug?: string;
  /** True for shallow clones, where history-based freshness is unreliable. */
  shallow?: boolean;
}

export interface LicenseInfo {
  spdx?: string;
  family: string;
  file?: string;
}

export interface EnvFact {
  name: string;
  /** Where the evidence came from, e.g. `.env.example` or `src/config.ts`. */
  sources: string[];
}

export interface ConfigFileFact {
  path: string;
  kind: 'env' | 'eslint' | 'prettier' | 'tsconfig' | 'vite' | 'webpack' | 'docker' | 'compose' | 'other';
}

export interface CiJobFact {
  name: string;
  steps: string[];
  commands: string[];
}

export interface CiWorkflowFact {
  file: string;
  name: string | null;
  triggers: string[];
  jobs: CiJobFact[];
}

export interface BuildCommandFact {
  command: string;
  source: string;
}

export interface InstallFact {
  command: string;
  /** Where the command was derived from, e.g. `package.json (npm)`. */
  source: string;
}

export interface RecentCommit {
  hash: string;
  date: string;
  subject: string;
  files: string[];
}

export interface GitFacts {
  isGit: boolean;
  commits: number | null;
  lastCommit: { hash: string; date: string; subject: string } | null;
  contributors: number | null;
  recentCommits: RecentCommit[];
}

export interface ProjectFacts {
  /** Manifest-derived name, repository name, or directory name (last resort). */
  name: string | null;
  displayName: string | null;
  description: string | null;
  version: string | null;
  type: ProjectType;
  typeConfidence: number;
  typeEvidence: string[];
  languages: LanguageStat[];
  primaryLanguage: string | null;
  license: LicenseInfo | null;
  repository: RepoInfo | null;
}

export interface FactsSummary {
  files: number;
  directories: number;
  sourceBytes: number;
  sourceLines: number;
  runtimeDependencies: number;
  developmentDependencies: number;
}

export interface DatasetFacts {
  files: number;
  formats: string[];
}

export interface FactSheet {
  schemaVersion: 1;
  project: ProjectFacts;
  manifests: Array<{ kind: string; path: string }>;
  scripts: FactScript[];
  binaries: string[];
  entryPoints: string[];
  /** Workspace package names or directories, sorted. Empty for single projects. */
  packages: string[];
  install: { development: InstallFact | null; consumer: InstallFact | null };
  usage: InstallFact | null;
  env: EnvFact[];
  configFiles: ConfigFileFact[];
  ci: CiWorkflowFact[];
  buildCommands: BuildCommandFact[];
  data: DatasetFacts | null;
  community: {
    contributing: boolean;
    contributingPath: string | null;
    changelog: boolean;
    security: boolean;
    issueTemplates: boolean;
    pullRequestTemplate: boolean;
  };
  git: GitFacts;
  stats: FactsSummary;
  /** Fact paths that could not be proven, e.g. `project.description`. */
  missing: string[];
  warnings: string[];
}

/* ------------------------------------------------------------------ *
 * README parsing & scoring
 * ------------------------------------------------------------------ */

export interface Heading {
  level: number;
  text: string;
  slug: string;
  line: number;
}

export interface ParsedSection {
  title: string;
  level: number;
  startLine: number;
  endLine: number;
  /** File line of the first non-empty body line after trimming leading blanks. */
  bodyStartLine: number;
  headings: Heading[];
  body: string;
}

export interface CodeBlock {
  lang: string | null;
  content: string;
  line: number;
}

export interface CommandMention {
  raw: string;
  line: number;
  /** `script` means it was checked against a manifest script table. */
  kind: 'script' | 'bin';
  valid: boolean | null;
  detail?: string;
}

export interface EnvMention {
  name: string;
  line: number;
  known: boolean;
}

export interface StandardSections {
  title: boolean;
  intro: boolean;
  install: boolean;
  usage: boolean;
  license: boolean;
  contributing: boolean;
  demo: boolean;
  packages: boolean;
  configuration: boolean;
}

export interface ReadmeAnalysis {
  path: string | null;
  exists: boolean;
  lines: number;
  language: LanguageSetting;
  headings: Heading[];
  sections: ParsedSection[];
  codeBlocks: CodeBlock[];
  standard: StandardSections;
  commands: CommandMention[];
  envMentions: EnvMention[];
  hasToc: boolean;
  imageCount: number;
  h1Count: number;
  /** Heading levels that skip a level, e.g. H2 directly followed by H4. */
  headingJumps: number;
  unlabelledCodeBlocks: number;
  licenseStatement: string | null;
}

export type DimensionId = 'completeness' | 'usability' | 'accuracy' | 'readability' | 'freshness';

export interface ScoreIssue {
  code: string;
  message: string;
  line?: number;
}

export interface DimensionScore {
  id: DimensionId;
  label: string;
  score: number;
  max: number;
  issues: ScoreIssue[];
}

export interface DoctorReport {
  score: number;
  threshold: number;
  passed: boolean;
  readme: { path: string; exists: boolean; lines: number; language: LanguageSetting };
  dimensions: DimensionScore[];
  missing: ScoreIssue[];
}

export interface FreshnessResult {
  score: number;
  max: number;
  issues: ScoreIssue[];
}

/* ------------------------------------------------------------------ *
 * Diff
 * ------------------------------------------------------------------ */

export type SectionChangeKind = 'added' | 'removed' | 'changed';

export interface SectionChange {
  kind: SectionChangeKind;
  title: string;
  added: number;
  removed: number;
  firstDifference?: { line: number; expected: string; actual: string };
}

export interface StructuredDiff {
  hasChanges: boolean;
  changes: SectionChange[];
  summary: { added: number; removed: number; changed: number };
  /** Human-readable unified excerpt for `--show`. */
  unified: string;
}

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

export interface SmithConfig {
  version: 1;
  preset: PresetId | 'auto';
  language: LanguageSetting;
  minScore: number;
  ai: {
    backend: AiBackend;
    baseUrl: string | null;
    model: string | null;
  };
  weights: Record<DimensionId, number>;
}

export interface LoadedConfig {
  config: SmithConfig;
  path: string | null;
  warnings: string[];
  /** True when the file set `weights`, so preset defaults must not replace them. */
  weightsExplicit: boolean;
}

export type DraftLanguage = Lang;

export interface DraftResult {
  markdown: string;
  language: DraftLanguage;
  aiUsed: boolean;
  aiProvider: string | null;
  warnings: string[];
  /** Sections appended to an existing README (empty for a fresh document). */
  addedSections: string[];
}
