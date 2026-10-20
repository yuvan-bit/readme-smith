/**
 * Shared domain types.
 *
 * `ProjectProfile` is the single source of truth produced by the scanner and
 * consumed by both the renderer and the badge/diagram generators. Keeping it
 * serialisable means `--json` gives users a stable, machine-readable contract.
 */

export type Lang = 'en' | 'zh';

export interface LanguageStat {
  /** Canonical language name, e.g. `TypeScript`. */
  name: string;
  /** File extensions that contributed, e.g. `['.ts', '.tsx']`. */
  extensions: string[];
  files: number;
  bytes: number;
  lines: number;
  /** 0–100, rounded to one decimal. */
  percent: number;
  /** GitHub linguist colour, used by the languages badge/bar. */
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
  | 'composer'
  | 'nuget'
  | 'maven'
  | 'gradle'
  | 'gem';

export interface Dependency {
  name: string;
  version: string;
  dev: boolean;
}

export interface ScriptInfo {
  name: string;
  command: string;
  /** Heuristic classification used to pick the "Quick Start" commands. */
  kind: 'install' | 'build' | 'test' | 'lint' | 'dev' | 'start' | 'format' | 'other';
}

export interface RepoInfo {
  isGit: boolean;
  /** Normalised HTTPS clone URL, when resolvable. */
  url?: string;
  host?: 'github' | 'gitlab' | 'bitbucket' | 'gitea' | 'other';
  owner?: string;
  name?: string;
  defaultBranch: string;
  /** `owner/name` shorthand for badge endpoints. */
  slug?: string;
  sshUrl?: string;
}

export interface LicenseInfo {
  /** SPDX identifier when recognised, otherwise the raw family name. */
  spdx?: string;
  family: string;
  file?: string;
  url?: string;
}

export interface TreeNode {
  name: string;
  /** Relative path from project root; empty for the root node. */
  path: string;
  type: 'dir' | 'file';
  children?: TreeNode[];
  /** One-line inferred purpose, rendered as a trailing comment in the tree. */
  note?: string;
  /** Same purpose in Chinese, used when rendering the zh README. */
  noteZh?: string;
}

export interface CliCommandInfo {
  name: string;
  description?: string;
  flags?: string[];
  subcommands?: string[];
}

export interface FeatureFlags {
  hasTests: boolean;
  testFrameworks: string[];
  testCommand?: string;
  hasCI: boolean;
  ciProviders: string[];
  /** Primary workflow file, used to build the CI status badge. */
  ciWorkflowFile?: string;
  ciWorkflowName?: string;
  hasDocker: boolean;
  dockerFiles: string[];
  hasCompose: boolean;
  hasLinter: boolean;
  linters: string[];
  hasFormatter: boolean;
  formatters: string[];
  hasTypeCheck: boolean;
  hasChangelog: boolean;
  hasContributing: boolean;
  hasCodeOfConduct: boolean;
  hasSecurityPolicy: boolean;
  hasIssueTemplates: boolean;
  hasPullRequestTemplate: boolean;
  hasEnvSample: boolean;
  hasReleases: boolean;
  isMonorepo: boolean;
  workspacePackages: string[];
  isLibrary: boolean;
  isCli: boolean;
  isApplication: boolean;
  hasApi: boolean;
  hasDocsSite: boolean;
  hasBenchmarks: boolean;
  hasStorybook: boolean;
  hasI18n: boolean;
  publishedToRegistry: boolean;
  registry?: string;
}

export interface Contributor {
  login: string;
  contributions?: number;
  avatarUrl?: string;
}

export interface ProjectStats {
  totalFiles: number;
  scannedFiles: number;
  ignoredFiles: number;
  linesOfCode: number;
  /** Total bytes of counted source files. */
  bytes: number;
  directories: number;
  scanDurationMs: number;
}

export interface DocReference {
  /** Relative path. */
  path: string;
  title?: string;
  kind: 'changelog' | 'contributing' | 'license' | 'security' | 'docs' | 'other';
}

export interface ProjectProfile {
  schemaVersion: 1;
  name: string;
  displayName: string;
  description: string;
  version: string;
  root: string;
  homepage?: string;
  bugsUrl?: string;
  keywords: string[];
  authors: string[];
  repo: RepoInfo;
  license?: LicenseInfo;
  languages: LanguageStat[];
  primaryLanguage?: string;
  ecosystem?: PackageEcosystem;
  installCommand?: string;
  usageCommand?: string;
  /** Runtime requirements declared by the manifest, e.g. `{ node: '>=18.17' }`. */
  engines: Record<string, string>;
  scripts: ScriptInfo[];
  dependencies: Dependency[];
  devDependencies: Dependency[];
  entryPoints: string[];
  structure: TreeNode;
  docs: DocReference[];
  features: FeatureFlags;
  envVars: string[];
  cli?: {
    binNames: string[];
    commands: CliCommandInfo[];
  };
  stats: ProjectStats;
  contributors: Contributor[];
  /** Notable framework/runtime detections, e.g. `React`, `Express`, `Fastify`. */
  frameworks: string[];
  generatedAt: string;
  /** Free-form warnings surfaced to the user at the end of a run. */
  warnings: string[];
}

/** A shields.io style badge spec. */
export interface BadgeSpec {
  label: string;
  message: string;
  /** shields.io colour name or hex without `#`. */
  color?: string;
  /** Pre-built URL that overrides label/message. */
  url?: string;
  href?: string;
  logo?: string;
  logoColor?: string;
  style?: 'flat' | 'flat-square' | 'for-the-badge' | 'plastic' | 'social';
}

export interface GenerateOptions {
  root: string;
  langs: Lang[];
  /** Emit the non-primary language into a separate `README.<locale>.md`. */
  separateFiles: boolean;
  sections: SectionId[];
  badges: boolean;
  diagrams: boolean;
  badgeStyle: NonNullable<BadgeSpec['style']>;
  maxTreeDepth: number;
  overwrite: boolean;
  /** Translate project-specific prose (description, custom docs) via a provider. */
  translateProse: boolean;
  /** Pin the provider used by `translateProse`; omitted means auto-select. */
  provider?: 'llm' | 'deepl' | 'free' | 'none';
  /**
   * Hand-written section bodies keyed `<sectionId>:<lang>`, loaded from
   * `.readme-smith/<sectionId>.<lang>.md`. This is what makes the generated
   * README safe to regenerate: the prose a human wrote survives `--force`,
   * while the heading, table of contents and language switcher stay generated.
   */
  sectionOverrides: Record<string, string>;
  /**
   * Allow claims that the package is installable from a registry (version and
   * downloads badges, an `npm install <name>` step). A manifest only proves the
   * package *could* be published, so this is turned off with `--unpublished`.
   */
  allowRegistryClaims: boolean;
  includeLanguageSwitcher: boolean;
  toc: boolean;
  tocMaxDepth: number;
}

export type SectionId =
  | 'title'
  | 'badges'
  | 'highlights'
  | 'toc'
  | 'features'
  | 'architecture'
  | 'quickstart'
  | 'installation'
  | 'usage'
  | 'cli'
  | 'config'
  | 'scripts'
  | 'structure'
  | 'dependencies'
  | 'languages'
  | 'development'
  | 'testing'
  | 'docs'
  | 'roadmap'
  | 'contributing'
  | 'contributors'
  | 'changelog'
  | 'faq'
  | 'license'
  | 'stats';

export interface TranslateOptions {
  from: Lang | 'auto';
  to: Lang;
  /** Explicit provider override; otherwise auto-selected from env. */
  provider?: 'llm' | 'deepl' | 'free' | 'none';
  glossary?: Record<string, string>;
  /** Extra do-not-translate terms. */
  preserveTerms?: string[];
  /** Free-form style instruction forwarded to LLM providers. */
  instruction?: string;
  concurrency: number;
  /**
   * Called after each batch of segments. A long README on a slow provider can
   * run for minutes, and silence is indistinguishable from a hang.
   */
  onProgress?: (completed: number, total: number) => void;
}
