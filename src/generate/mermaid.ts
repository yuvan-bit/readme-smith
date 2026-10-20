import type { Dependency, Lang, ProjectProfile, TreeNode } from '../types.js';
import type { T } from '../i18n/dict.js';

/**
 * Diagram generation.
 *
 * Every diagram here is *derived* from something real in the repository — the
 * directory layout, the dependency list, the CLI surface or the npm scripts.
 * A hand-wavy generic architecture box diagram would be worse than none at
 * all, because it looks authoritative while saying nothing true.
 */

/* ------------------------------------------------------------------ *
 * Mermaid primitives
 * ------------------------------------------------------------------ */

/** Mermaid node IDs must be alphanumeric; keep a stable mapping for reuse. */
function safeId(raw: string, prefix = 'n'): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');
  return `${prefix}_${cleaned}`;
}

/** Quote and neutralise a label so Mermaid cannot misparse it. */
function label(text: string): string {
  const cleaned = text
    .replace(/\\/g, '')
    .replace(/"/g, "'")
    .replace(/[{}|<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `"${cleaned}"`;
}

/**
 * Declare a rectangular node: `id["label"]`.
 *
 * Mermaid needs the brackets. Emitting `id"label"` — which is what happens if
 * you concatenate an id with a quoted string — is a parse error at diagram
 * render time, and GitHub only shows "Unable to render rich display", so the
 * mistake is easy to ship and easy to miss. Every node declaration goes
 * through this helper or one of the shape-specific ones below.
 */
function node(id: string, text: string): string {
  return `${id}[${label(text)}]`;
}

function fence(mermaid: string): string {
  return ['```mermaid', mermaid.trim(), '```'].join('\n');
}

/** Collect directory nodes from the profile tree, up to `depth` levels down. */
function collectDirs(node: TreeNode, depth: number, maxDepth: number, out: Array<{ name: string; path: string }>): void {
  if (depth > maxDepth) return;
  for (const child of node.children ?? []) {
    if (child.type !== 'dir') continue;
    // Hidden directories hold tooling configuration (`.github/workflows`,
    // `.vscode`, `.husky`), not architecture. Including them put "workflows"
    // in the application layer of a project whose only workflow is CI YAML.
    if (child.name.startsWith('.')) continue;
    out.push({ name: child.name, path: child.path });
    collectDirs(child, depth + 1, maxDepth, out);
  }
}

/* ------------------------------------------------------------------ *
 * 1. Architecture diagram
 * ------------------------------------------------------------------ */

type LayerId = 'entry' | 'interface' | 'application' | 'domain' | 'infrastructure' | 'output';

const LAYER_ORDER: LayerId[] = ['entry', 'interface', 'application', 'domain', 'infrastructure', 'output'];

const LAYER_PATTERNS: Array<{ layer: LayerId; re: RegExp }> = [
  { layer: 'entry', re: /^(bin|cmd|cli|main|entry|scripts|__main__)$/i },
  { layer: 'interface', re: /^(components|pages|views|screens?|ui|routes?|handlers?|controllers?|api|endpoints?|http|web|templates?|layouts?)$/i },
  { layer: 'application', re: /^(services?|use-?cases?|application|features?|modules?|commands?|jobs?|tasks?|workflows?|actions|interactors?)$/i },
  { layer: 'domain', re: /^(domain|core|lib|libs|models?|entities|types?|interfaces?|contracts?|rules?)$/i },
  { layer: 'infrastructure', re: /^(infra(structure)?|db|database|repositories|repository|adapters?|clients?|drivers?|storage|persistence|utils?|helpers?|common|shared|internal|config|plugins?)$/i },
  { layer: 'output', re: /^(dist|build|out|output|public|static|assets|target|artifacts?)$/i },
];

const LAYER_COLORS: Record<LayerId, { fill: string; stroke: string }> = {
  entry: { fill: '#e8f0fe', stroke: '#4285f4' },
  interface: { fill: '#e6f4ea', stroke: '#34a853' },
  application: { fill: '#fef7e0', stroke: '#f9ab00' },
  domain: { fill: '#fce8e6', stroke: '#ea4335' },
  infrastructure: { fill: '#f3e8fd', stroke: '#a142f4' },
  output: { fill: '#eceff1', stroke: '#607d8b' },
};

const LAYER_LABEL_KEY: Record<LayerId, 'diagram.layerEntry' | 'diagram.layerInterface' | 'diagram.layerApplication' | 'diagram.layerDomain' | 'diagram.layerInfrastructure' | 'diagram.layerOutput'> = {
  entry: 'diagram.layerEntry',
  interface: 'diagram.layerInterface',
  application: 'diagram.layerApplication',
  domain: 'diagram.layerDomain',
  infrastructure: 'diagram.layerInfrastructure',
  output: 'diagram.layerOutput',
};

/**
 * Build a layered architecture diagram from real directory names.
 * Returns `undefined` when fewer than two layers are recognised, since a
 * one-box "architecture" is decoration rather than information.
 */
export function architectureDiagram(profile: ProjectProfile, t: T): string | undefined {
  const dirs: Array<{ name: string; path: string }> = [];
  collectDirs(profile.structure, 0, 2, dirs);

  const buckets = new Map<LayerId, string[]>();
  for (const dir of dirs) {
    const hit = LAYER_PATTERNS.find((p) => p.re.test(dir.name));
    if (!hit) continue;
    const list = buckets.get(hit.layer) ?? [];
    if (!list.includes(dir.name)) list.push(dir.name);
    buckets.set(hit.layer, list);
  }

  const present = LAYER_ORDER.filter((l) => (buckets.get(l)?.length ?? 0) > 0);
  if (present.length < 2) return undefined;

  const lines: string[] = ['flowchart TD'];
  const layerAnchorIds: string[] = [];

  present.forEach((layer, idx) => {
    const names = (buckets.get(layer) ?? []).slice(0, 6);
    const subgraphId = `L${idx}`;
    lines.push(`    subgraph ${subgraphId}["${t(LAYER_LABEL_KEY[layer])}"]`);
    lines.push('        direction LR');
    names.forEach((name) => {
      const id = safeId(name, 'd');
      lines.push(`        ${node(id, name)}`);
    });
    lines.push('    end');
    layerAnchorIds.push(subgraphId);
  });

  // Chain layers top-down, which is how the directories actually depend on
  // each other in the overwhelmingly common layout this detects.
  for (let i = 0; i < layerAnchorIds.length - 1; i++) {
    lines.push(`    ${layerAnchorIds[i]} --> ${layerAnchorIds[i + 1]}`);
  }

  lines.push('');
  for (const [idx, layer] of present.entries()) {
    const { fill, stroke } = LAYER_COLORS[layer];
    lines.push(`    style L${idx} fill:${fill},stroke:${stroke},stroke-width:1px`);
  }

  return fence(lines.join('\n'));
}

/* ------------------------------------------------------------------ *
 * 2. Dependency overview
 * ------------------------------------------------------------------ */

const DEP_CATEGORIES: Array<{ id: string; label: { en: string; zh: string }; re: RegExp; color: string }> = [
  { id: 'cli', label: { en: 'CLI & TUI', zh: '命令行与终端' }, re: /^(commander|yargs|@oclif\/.*|clipanion|minimist|cac|inquirer|prompts|enquirer|chalk|picocolors|kleur|ora|listr2|cli-.*|boxen|@clack\/.*|typer|click|rich|textual|clap|crossterm|ratatui|colored|termcolor|cobra|bubbletea|colorama)$/, color: '#ff6f00' },
  { id: 'web', label: { en: 'Web & HTTP', zh: 'Web 与网络' }, re: /^(express|fastify|koa|hono|@nestjs\/.*|next|nuxt|astro|svelte|@sveltejs\/.*|vue|react|react-dom|@angular\/.*|axios|got|ky|undici|node-fetch|superagent|requests|httpx|aiohttp|urllib3|reqwest|hyper|gin-gonic\/.*|echo|fiber)$/, color: '#0969da' },
  { id: 'data', label: { en: 'Data & Storage', zh: '数据与存储' }, re: /^(prisma|@prisma\/.*|drizzle-.*|typeorm|sequelize|knex|mongoose|redis|ioredis|pg|mysql2|sqlite3|better-sqlite3|@tanstack\/.*|zod|yup|joi|valibot|ajv|superstruct|pydantic|sqlalchemy|django|serde|diesel|sqlx)$/, color: '#8250df' },
  { id: 'ai', label: { en: 'AI & LLM', zh: 'AI 与大模型' }, re: /^(openai|@anthropic-ai\/.*|langchain.*|llamaindex|@ai-sdk\/.*|@google\/generative-ai|cohere|ollama|tiktoken|transformers|torch|tensorflow)$/, color: '#10a37f' },
  { id: 'util', label: { en: 'Utilities', zh: '工具库' }, re: /^(lodash.*|ramda|date-fns|dayjs|luxon|moment|uuid|nanoid|glob|fast-glob|chokidar|debug|dotenv|execa|cross-env|tslib|radash|es-toolkit)$/, color: '#57606a' },
  { id: 'i18n', label: { en: 'i18n', zh: '国际化' }, re: /^(i18next|react-i18next|vue-i18n|@formatjs\/.*|react-intl|next-intl|.*lingui.*|polyglot|gettext|babel.*)$/, color: '#bf3989' },
];

function categorize(dep: Dependency): (typeof DEP_CATEGORIES)[number] | undefined {
  return DEP_CATEGORIES.find((cat) => cat.re.test(dep.name));
}

/**
 * Dependency map grouped by role. Falls back to a flat top-N fan-out when
 * nothing matches the known categories, so small projects still get a diagram.
 */
export function dependencyDiagram(profile: ProjectProfile, _t: T, lang: Lang): string | undefined {
  const runtime = profile.dependencies.filter((d) => !d.dev);
  if (runtime.length === 0) return undefined;

  const groups = new Map<string, { label: string; color: string; deps: Dependency[] }>();
  const uncategorized: Dependency[] = [];

  for (const dep of runtime) {
    const cat = categorize(dep);
    if (!cat) { uncategorized.push(dep); continue; }
    const entry = groups.get(cat.id) ?? {
      label: lang === 'zh' ? cat.label.zh : cat.label.en,
      color: cat.color,
      deps: [],
    };
    entry.deps.push(dep);
    groups.set(cat.id, entry);
  }

  // Keep the diagram legible: at most 6 groups, at most 5 packages each.
  const entries = [...groups.entries()]
    .sort((a, b) => b[1].deps.length - a[1].deps.length)
    .slice(0, 6);

  if (entries.length === 0) {
    if (uncategorized.length < 3) return undefined;
    const lines = ['flowchart LR', `    core(${label(profile.displayName)})`];
    for (const dep of uncategorized.slice(0, 8)) {
      const id = safeId(dep.name, 'p');
      lines.push(`    ${node(id, dep.name)}`);
      lines.push(`    core --> ${id}`);
    }
    lines.push('    style core fill:#24292f,stroke:#24292f,color:#fff');
    return fence(lines.join('\n'));
  }

  const lines = ['flowchart LR'];
  const coreId = 'core';
  lines.push(`    ${coreId}(${label(profile.displayName)})`);
  lines.push('');

  entries.forEach(([, group], idx) => {
    const gid = `g${idx}`;
    lines.push(`    subgraph ${gid}["${group.label}"]`);
    lines.push('        direction TB');
    for (const dep of group.deps.slice(0, 5)) {
      lines.push(`        ${node(safeId(dep.name, 'p'), dep.name)}`);
    }
    const remaining = group.deps.length - 5;
    if (remaining > 0) lines.push(`        ${node(`${gid}_more`, `+${remaining}`)}`);
    lines.push('    end');
    lines.push(`    ${coreId} --> ${gid}`);
    lines.push('');
    lines.push(`    style ${gid} fill:${group.color}1a,stroke:${group.color},stroke-width:1px`);
  });

  lines.push(`    style ${coreId} fill:#24292f,stroke:#24292f,color:#fff`);
  return fence(lines.join('\n'));
}

/* ------------------------------------------------------------------ *
 * 3. CLI command flow
 * ------------------------------------------------------------------ */

/**
 * For CLI projects: how an invocation travels from the shell to output.
 * Uses the real detected command list when available.
 */
export function cliFlowDiagram(profile: ProjectProfile, t: T, lang: Lang): string | undefined {
  if (!profile.features.isCli) return undefined;
  const bin = profile.cli?.binNames[0] ?? profile.name.replace(/^@[^/]+\//, '');
  const commands = (profile.cli?.commands ?? []).slice(0, 6);

  const lines = ['flowchart LR'];
  lines.push(`    user([${label(lang === 'zh' ? '用户' : 'User')}])`);
  lines.push(`    ${node('shell', '$ ' + bin)}`);
  lines.push('    user --> shell');

  if (commands.length > 0) {
    lines.push('');
    lines.push(`    subgraph cmds[${label(t('section.cliCommands'))}]`);
    lines.push('        direction TB');
    commands.forEach((cmd) => {
      const id = safeId(cmd.name, 'c');
      const text = cmd.description ? `${cmd.name} — ${cmd.description}` : cmd.name;
      lines.push(`        ${node(id, text)}`);
    });
    lines.push('    end');
    lines.push('    shell --> cmds');
  } else {
    lines.push(`    ${node('parse', lang === 'zh' ? '参数解析' : 'Argument parsing')}`);
    lines.push('    shell --> parse');
  }

  lines.push('');
  lines.push(`    ${node('core', t('diagram.coreRuntime'))}`);
  lines.push(`    out([${label(t('diagram.layerOutput'))}])`);
  lines.push(`    ${commands.length > 0 ? 'cmds' : 'parse'} --> core --> out`);

  if (profile.envVars.length > 0) {
    lines.push('');
    lines.push(`    env[[${label(t('section.environmentVariables'))}]]`);
    lines.push('    env -.-> core');
  }
  if (profile.features.hasDocker) {
    lines.push(`    docker[[Docker]]`);
    lines.push('    docker -.-> core');
  }

  lines.push('');
  lines.push('    style user fill:#e8f0fe,stroke:#4285f4');
  lines.push('    style core fill:#24292f,stroke:#24292f,color:#fff');
  lines.push('    style out fill:#e6f4ea,stroke:#34a853');

  return fence(lines.join('\n'));
}

/* ------------------------------------------------------------------ *
 * 4. Development workflow
 * ------------------------------------------------------------------ */

/**
 * Contributor workflow derived from the actual declared scripts/tasks.
 * This is the diagram a new contributor actually needs.
 */
export function workflowDiagram(profile: ProjectProfile, _t: T, lang: Lang): string | undefined {
  const scripts = profile.scripts;
  const steps: Array<{ id: string; labelKey: keyof typeof WORKFLOW_LABELS; command?: string }> = [];

  const byKind = (kind: string) => scripts.find((s) => s.kind === kind);

  if (profile.installCommand) steps.push({ id: 'install', labelKey: 'install', command: profile.installCommand });
  const dev = byKind('dev');
  if (dev) steps.push({ id: 'dev', labelKey: 'dev', command: scriptRunner(profile, dev.name) });
  const build = byKind('build');
  if (build) steps.push({ id: 'build', labelKey: 'build', command: scriptRunner(profile, build.name) });
  if (profile.features.hasTests) {
    steps.push({ id: 'test', labelKey: 'test', command: testRunner(profile) });
  }
  if (profile.features.hasLinter) {
    const lint = byKind('lint');
    steps.push({ id: 'lint', labelKey: 'lint', command: lint ? scriptRunner(profile, lint.name) : profile.features.linters[0] });
  }
  if (profile.features.hasCI) steps.push({ id: 'ci', labelKey: 'ci' });
  if (profile.features.hasReleases) steps.push({ id: 'release', labelKey: 'release' });

  if (steps.length < 3) return undefined;

  const lines = ['flowchart LR'];
  steps.forEach((step, idx) => {
    const text = WORKFLOW_LABELS[step.labelKey][lang];
    lines.push(`    ${node(step.id, step.command ? `${text} — ${step.command}` : text)}`);
    if (idx > 0) lines.push(`    ${steps[idx - 1]!.id} --> ${step.id}`);
  });

  lines.push('');
  // Only style nodes that exist. `style ci …` on a project without CI is a
  // dangling reference: it either does nothing or trips stricter renderers.
  const present = new Set(steps.map((step) => step.id));
  if (present.has('install')) lines.push('    style install fill:#e8f0fe,stroke:#4285f4');
  if (present.has('ci')) lines.push('    style ci fill:#fef7e0,stroke:#f9ab00');
  if (present.has('release')) lines.push('    style release fill:#e6f4ea,stroke:#34a853');

  return fence(lines.join('\n'));
}

const WORKFLOW_LABELS = {
  install: { en: 'Install', zh: '安装依赖' },
  dev: { en: 'Develop', zh: '本地开发' },
  build: { en: 'Build', zh: '构建' },
  test: { en: 'Test', zh: '测试' },
  lint: { en: 'Lint', zh: '代码检查' },
  ci: { en: 'CI', zh: '持续集成' },
  release: { en: 'Release', zh: '发布' },
} as const;

/** Render `<pkg-manager> run <script>` in the project's own idiom. */
function scriptRunner(profile: ProjectProfile, scriptName: string): string {
  switch (profile.ecosystem) {
    case 'pnpm': return `pnpm ${scriptName}`;
    case 'yarn': return `yarn ${scriptName}`;
    case 'bun': return `bun run ${scriptName}`;
    case 'npm': return `npm run ${scriptName}`;
    case 'poetry': return `poetry run ${scriptName}`;
    case 'cargo': return `cargo ${scriptName}`;
    case 'go': return `go ${scriptName}`;
    default: return scriptName;
  }
}

function testRunner(profile: ProjectProfile): string | undefined {
  const script = profile.scripts.find((s) => s.kind === 'test');
  if (script) return scriptRunner(profile, script.name);
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

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export interface DiagramSet {
  architecture?: string;
  dependencies?: string;
  cliFlow?: string;
  workflow?: string;
}

/**
 * Produce every diagram that is *justified* by what was detected.
 * Diagrams that would be vacuous are omitted rather than padded out.
 */
export function buildDiagrams(profile: ProjectProfile, t: T, lang: Lang): DiagramSet {
  return {
    architecture: architectureDiagram(profile, t),
    dependencies: dependencyDiagram(profile, t, lang),
    cliFlow: cliFlowDiagram(profile, t, lang),
    workflow: workflowDiagram(profile, t, lang),
  };
}
