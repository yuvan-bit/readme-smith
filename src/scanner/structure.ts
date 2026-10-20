import path from 'node:path';
import { existsSync } from 'node:fs';
import type { Lang, TreeNode } from '../types.js';
import { readTextSafe, walk, type WalkedFile } from '../utils/fs.js';

/**
 * Conventional directory purposes, rendered as inline comments in the tree.
 *
 * Both languages live here rather than in `i18n/dict.ts` because these are
 * project *facts*, not template prose: they are attached to the tree once, and
 * the renderer picks the right one for the file being written.
 */
const DIR_NOTES: Record<string, { en: string; zh: string }> = {
  src: { en: 'source code', zh: '源码' },
  lib: { en: 'library code', zh: '库代码' },
  bin: { en: 'executables', zh: '可执行文件' },
  cmd: { en: 'command entrypoints', zh: '命令入口' },
  internal: { en: 'private implementation', zh: '内部实现' },
  pkg: { en: 'public packages', zh: '对外包' },
  api: { en: 'API layer', zh: '接口层' },
  app: { en: 'application code', zh: '应用代码' },
  components: { en: 'UI components', zh: '界面组件' },
  pages: { en: 'routes / pages', zh: '路由与页面' },
  views: { en: 'views', zh: '视图' },
  screens: { en: 'screens', zh: '页面' },
  hooks: { en: 'reusable hooks', zh: '可复用钩子' },
  utils: { en: 'helpers', zh: '工具函数' },
  helpers: { en: 'helpers', zh: '工具函数' },
  common: { en: 'shared code', zh: '公共代码' },
  shared: { en: 'shared code', zh: '公共代码' },
  core: { en: 'core logic', zh: '核心逻辑' },
  models: { en: 'data models', zh: '数据模型' },
  schemas: { en: 'schemas', zh: '数据模式' },
  types: { en: 'type definitions', zh: '类型定义' },
  assets: { en: 'static assets', zh: '静态资源' },
  public: { en: 'public static files', zh: '公开静态文件' },
  static: { en: 'static files', zh: '静态文件' },
  styles: { en: 'stylesheets', zh: '样式表' },
  css: { en: 'stylesheets', zh: '样式表' },
  test: { en: 'tests', zh: '测试' },
  tests: { en: 'tests', zh: '测试' },
  __tests__: { en: 'tests', zh: '测试' },
  spec: { en: 'tests', zh: '测试' },
  e2e: { en: 'end-to-end tests', zh: '端到端测试' },
  docs: { en: 'documentation', zh: '文档' },
  doc: { en: 'documentation', zh: '文档' },
  // Named so a reader of the tree knows where the human-written words live.
  '.readme-smith': { en: 'hand-written README sections', zh: '人工撰写的 README 章节' },
  examples: { en: 'usage examples', zh: '使用示例' },
  example: { en: 'usage examples', zh: '使用示例' },
  demo: { en: 'demo', zh: '演示' },
  scripts: { en: 'build / utility scripts', zh: '构建与工具脚本' },
  tools: { en: 'internal tooling', zh: '内部工具' },
  config: { en: 'configuration', zh: '配置' },
  configs: { en: 'configuration', zh: '配置' },
  migrations: { en: 'database migrations', zh: '数据库迁移' },
  packages: { en: 'workspace packages', zh: '工作区包' },
  apps: { en: 'workspace apps', zh: '工作区应用' },
  crates: { en: 'Rust crates', zh: 'Rust crate' },
  benches: { en: 'benchmarks', zh: '性能基准' },
  benchmarks: { en: 'benchmarks', zh: '性能基准' },
  fixtures: { en: 'test fixtures', zh: '测试夹具' },
  locales: { en: 'translations', zh: '多语言文案' },
  i18n: { en: 'translations', zh: '多语言文案' },
  workflows: { en: 'CI workflows', zh: 'CI 工作流' },
  dist: { en: 'build output', zh: '构建产物' },
  build: { en: 'build output', zh: '构建产物' },
  '.github': { en: 'GitHub config & CI', zh: 'GitHub 配置与 CI' },
  '.vscode': { en: 'editor settings', zh: '编辑器设置' },
  '.husky': { en: 'git hooks', zh: 'git 钩子' },
  '.changeset': { en: 'release notesets', zh: '版本发布说明' },
};

/** Root-level files worth calling out. */
const FILE_NOTES: Record<string, { en: string; zh: string }> = {
  'package.json': { en: 'dependencies & scripts', zh: '依赖与脚本' },
  'package-lock.json': { en: 'locked dependency tree', zh: '依赖锁定' },
  'pnpm-lock.yaml': { en: 'locked dependency tree', zh: '依赖锁定' },
  'yarn.lock': { en: 'locked dependency tree', zh: '依赖锁定' },
  'tsconfig.json': { en: 'TypeScript config', zh: 'TypeScript 配置' },
  'pyproject.toml': { en: 'Python project config', zh: 'Python 项目配置' },
  'requirements.txt': { en: 'Python dependencies', zh: 'Python 依赖' },
  'cargo.toml': { en: 'Rust crate config', zh: 'Rust crate 配置' },
  'go.mod': { en: 'Go module definition', zh: 'Go 模块定义' },
  'composer.json': { en: 'PHP dependencies', zh: 'PHP 依赖' },
  'gemfile': { en: 'Ruby dependencies', zh: 'Ruby 依赖' },
  'makefile': { en: 'build targets', zh: '构建目标' },
  'dockerfile': { en: 'container image', zh: '容器镜像' },
  'docker-compose.yml': { en: 'local service stack', zh: '本地服务编排' },
  'compose.yaml': { en: 'local service stack', zh: '本地服务编排' },
  '.env.example': { en: 'environment variable template', zh: '环境变量模板' },
  '.gitignore': { en: 'git ignore rules', zh: 'git 忽略规则' },
  '.editorconfig': { en: 'editor style rules', zh: '编辑器风格规则' },
  'changelog.md': { en: 'release history', zh: '版本历史' },
  'contributing.md': { en: 'contribution guide', zh: '贡献指南' },
  'code_of_conduct.md': { en: 'community guidelines', zh: '社区准则' },
  'security.md': { en: 'vulnerability reporting', zh: '漏洞上报' },
  'license': { en: 'license terms', zh: '许可证条款' },
  'license.md': { en: 'license terms', zh: '许可证条款' },
  'readme.md': { en: 'project overview', zh: '项目说明' },
  'readme.zh-cn.md': { en: 'project overview (中文)', zh: '中文项目说明' },
  '.prettierrc': { en: 'formatting rules', zh: '格式化规则' },
  '.eslintrc.json': { en: 'lint rules', zh: '代码检查规则' },
  'eslint.config.js': { en: 'lint rules', zh: '代码检查规则' },
  'vitest.config.ts': { en: 'test config', zh: '测试配置' },
  'jest.config.js': { en: 'test config', zh: '测试配置' },
};

export interface BuildTreeOptions {
  maxDepth: number;
  /** Directories to skip entirely in the rendered tree. */
  skipDirs?: Iterable<string>;
  /** Maximum entries per directory before collapsing with an ellipsis. */
  maxChildren?: number;
  /** Prefer showing directories over files when trimming. */
  dirsFirst?: boolean;
}

const DEFAULT_SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__', '.venv', 'target']);

/**
 * Build a display tree from an already-walked file list.
 *
 * The tree is *curated*, not exhaustive: a README tree exists to orient a
 * reader, so wide directories are collapsed and entries are annotated with
 * their conventional purpose.
 */
export function buildTree(rootName: string, files: WalkedFile[], options: BuildTreeOptions): TreeNode {
  const skipDirs = new Set([...DEFAULT_SKIP, ...(options.skipDirs ?? [])]);
  const maxChildren = options.maxChildren ?? 12;

  interface Dir {
    name: string;
    path: string;
    dirs: Map<string, Dir>;
    files: string[];
  }
  const rootDir: Dir = { name: rootName, path: '', dirs: new Map(), files: [] };

  for (const file of files) {
    const segments = file.rel.split('/');
    const fileName = segments.pop()!;
    let node = rootDir;
    let acc = '';
    let skipped = false;
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      if (skipDirs.has(seg)) { skipped = true; break; }
      let child = node.dirs.get(seg);
      if (!child) {
        child = { name: seg, path: acc, dirs: new Map(), files: [] };
        node.dirs.set(seg, child);
      }
      node = child;
    }
    if (skipped) continue;
    if (segments.length + 1 > options.maxDepth + 1) continue;
    if (!node.files.includes(fileName)) node.files.push(fileName);
  }

  const toNode = (dir: Dir, depth: number): TreeNode => {
    const children: TreeNode[] = [];
    const dirNames = [...dir.dirs.keys()].sort((a, b) => rankDir(a) - rankDir(b) || a.localeCompare(b));
    for (const name of dirNames) {
      if (depth + 1 > options.maxDepth) break;
      children.push(toNode(dir.dirs.get(name)!, depth + 1));
    }
    let fileNames = [...dir.files].sort((a, b) => rankFile(a) - rankFile(b) || a.localeCompare(b));
    const overflow = fileNames.length > maxChildren ? fileNames.length - maxChildren : 0;
    if (overflow > 0) fileNames = fileNames.slice(0, maxChildren);

    for (const name of fileNames) {
      const note = FILE_NOTES[name.toLowerCase()];
      children.push({
        name,
        path: dir.path ? `${dir.path}/${name}` : name,
        type: 'file',
        ...(note ? { note: note.en, noteZh: note.zh } : {}),
      });
    }
    if (overflow > 0) {
      const noun = overflow === 1 ? 'more file' : 'more files';
      children.push({
        name: '…',
        path: dir.path,
        type: 'file',
        note: `${overflow} ${noun}`,
        noteZh: `另有 ${overflow} 个文件`,
      });
    }

    const note = depth === 0 ? undefined : DIR_NOTES[dir.name.toLowerCase()];
    return {
      name: dir.name,
      path: dir.path,
      type: 'dir',
      children,
      ...(note ? { note: note.en, noteZh: note.zh } : {}),
    };
  };

  return toNode(rootDir, 0);
}

/** Sort well-known directories to the top so the tree reads like a map. */
function rankDir(name: string): number {
  const order = ['src', 'lib', 'cmd', 'internal', 'pkg', 'app', 'packages', 'apps', 'api', 'docs', 'examples', 'test', 'tests', 'scripts', 'config', '.github'];
  const i = order.indexOf(name.toLowerCase());
  return i === -1 ? order.length : i;
}

function rankFile(name: string): number {
  const lower = name.toLowerCase();
  if (lower.startsWith('readme')) return -3;
  if (['license', 'license.md', 'licence'].includes(lower)) return -2;
  if (['package.json', 'pyproject.toml', 'cargo.toml', 'go.mod', 'composer.json', 'gemfile', 'tsconfig.json'].includes(lower)) return -1;
  if (lower.startsWith('.')) return 2;
  return 0;
}

/** Render a TreeNode as an ASCII tree suitable for a fenced code block. */
export function renderTree(node: TreeNode, opts: { showNotes?: boolean; lang?: Lang } = {}): string {
  const showNotes = opts.showNotes ?? true;
  const lines: string[] = [];
  // Notes are stored bilingually on the node, so the same scanned profile can
  // back both README languages without rescanning.
  const noteOf = (n: TreeNode): string | undefined =>
    (opts.lang === 'zh' ? n.noteZh ?? n.note : n.note) ?? undefined;
  const noteSuffix = (n: TreeNode): string => {
    const note = showNotes ? noteOf(n) : undefined;
    return note ? `   # ${note}` : '';
  };

  lines.push(
    `${node.name}${node.type === 'dir' ? '/' : ''}${noteSuffix(node)}`,
  );
  const walkChildren = (n: TreeNode, prefix: string) => {
    const children = n.children ?? [];
    children.forEach((child, idx) => {
      const isLast = idx === children.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      lines.push(`${prefix}${connector}${child.name}${child.type === 'dir' ? '/' : ''}${noteSuffix(child)}`);
      if (child.type === 'dir' && child.children?.length) {
        walkChildren(child, prefix + (isLast ? '    ' : '│   '));
      }
    });
  };
  walkChildren(node, '');
  return lines.join('\n');
}

/** Guess the entry points a reader should open first. */
export function findEntryPoints(files: WalkedFile[], root: string, declared: string[]): string[] {
  const rels = new Set(files.map((f) => f.rel.replace(/\\/g, '/')));
  const found: string[] = [];
  const add = (p: string) => {
    const norm = p.replace(/^\.\//, '').replace(/\\/g, '/');
    if (!norm || found.includes(norm)) return;
    found.push(norm);
  };

  // Declared package entries (`main`/`types`/`bin`) are authoritative, but a
  // project that has not been built yet points at `dist/` files that do not
  // exist. Listing those sends the reader to a dead end, so verify on disk.
  for (const declaredEntry of declared) {
    const norm = declaredEntry.replace(/^\.\//, '').replace(/\\/g, '/');
    if (norm && existsSync(path.join(root, norm))) add(norm);
  }

  const candidates = [
    'src/index.ts', 'src/index.tsx', 'src/index.js', 'src/main.ts', 'src/main.tsx', 'src/main.js',
    'src/cli.ts', 'src/cli.js', 'src/lib.rs', 'src/main.rs', 'main.go', 'cmd/main.go',
    'app.py', 'main.py', 'manage.py', 'src/App.tsx', 'src/App.vue', 'src/app/page.tsx',
    'index.html', 'Program.cs', 'src/Program.cs',
  ];
  for (const candidate of candidates) {
    if (rels.has(candidate)) add(candidate);
  }

  return found.slice(0, 6);
}

/** Pull the first meaningful paragraph out of an existing README for reuse. */
export function extractReadmeSummary(root: string): { description?: string; badges: string[]; body?: string } {
  const candidates = ['README.md', 'README.MD', 'readme.md', 'README.markdown', 'README.rst'];
  const filename = candidates.find((c) => readTextSafe(path.join(root, c)) !== undefined);
  if (!filename) return { badges: [] };

  const text = readTextSafe(path.join(root, filename));
  if (!text) return { badges: [] };

  const lines = text.split('\n');
  const badges: string[] = [];
  let description: string | undefined;
  const bodyLines: string[] = [];
  let seenH1 = false;

  for (const line of lines) {
    const badgeMatches = [...line.matchAll(/!?\[[^\]]*\]\((?:https:\/\/img\.shields\.io|https:\/\/badge)[^)]*\)/g)];
    if (badgeMatches.length > 0) badges.push(...badgeMatches.map((m) => m[0]));

    if (/^#\s+/.test(line)) { seenH1 = true; continue; }
    if (!description && seenH1 && line.trim() && !/^[#<|`]/.test(line.trim()) && !badgeMatches.length) {
      const cleaned = line.replace(/^\s*>+\s*/, '').trim();
      if (cleaned.length > 3 && !/^\[!\[/.test(cleaned)) description = cleaned;
    }
    bodyLines.push(line);
  }

  return {
    ...(description ? { description } : {}),
    badges: [...new Set(badges)].slice(0, 20),
    body: bodyLines.join('\n').trim() || undefined,
  };
}
