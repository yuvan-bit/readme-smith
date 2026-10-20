/**
 * Glossary handling.
 *
 * Two jobs: (1) tell a model which terms must stay in their original form, and
 * (2) give statistical/free engines canonical equivalents so a document does
 * not translate "pull request" three different ways. For free providers the
 * terms are additionally placeholder-protected, because those engines happily
 * translate `README` into something unrecognisable.
 */

export interface GlossaryEntry {
  /** Source-language term. */
  term: string;
  /** Target-language rendering, or the same string to keep it verbatim. */
  translation: string;
  /** Never translate, even if the engine thinks it can. */
  preserve?: boolean;
}

/** Terms that stay in English in Chinese technical writing by convention. */
const PRESERVE_TERMS = [
  'README', 'README.zh-CN', 'CHANGELOG', 'CONTRIBUTING', 'LICENSE', 'CODE_OF_CONDUCT',
  'CLI', 'API', 'SDK', 'URL', 'URI', 'HTTP', 'HTTPS', 'JSON', 'YAML', 'TOML', 'XML',
  'CI', 'CD', 'CI/CD', 'PR', 'Pull Request', 'Issue', 'Merge Request', 'Commit', 'Repo',
  'Repository', 'Fork', 'Star', 'Badge', 'SemVer', 'SemVer', 'npm', 'npx', 'pnpm', 'yarn',
  'bun', 'pip', 'PyPI', 'Cargo', 'crates.io', 'Go', 'Rust', 'TypeScript', 'JavaScript',
  'Python', 'Node.js', 'Deno', 'Docker', 'Kubernetes', 'Mermaid', 'Markdown', 'MDX',
  'ESLint', 'Prettier', 'Vitest', 'Jest', 'Playwright', 'GitHub', 'GitLab', 'Bitbucket',
  'shields.io', 'monorepo', 'webhook', 'middleware', 'plugin', 'runtime', 'linter',
  'formatter', 'breakpoint', 'namespace', 'enum', 'interface', 'callback', 'Promise',
  'async', 'await', 'localhost', 'stdin', 'stdout', 'stderr', 'exit code', 'flag',
];

/** Canonical zh translations for prose that would otherwise drift. */
const EN_TO_ZH: Array<[string, string]> = [
  ['installation', '安装'],
  ['quick start', '快速开始'],
  ['features', '功能特性'],
  ['usage', '使用方法'],
  ['configuration', '配置'],
  ['contributing', '参与贡献'],
  ['contributors', '贡献者'],
  ['changelog', '更新日志'],
  ['license', '许可证'],
  ['requirements', '环境要求'],
  ['dependencies', '依赖'],
  ['development', '本地开发'],
  ['testing', '测试'],
  ['architecture', '架构设计'],
  ['project structure', '项目结构'],
  ['table of contents', '目录'],
  ['environment variables', '环境变量'],
  ['available scripts', '可用脚本'],
  ['documentation', '文档'],
  ['roadmap', '路线图'],
  ['faq', '常见问题'],
  ['acknowledgements', '致谢'],
  ['highlights', '项目亮点'],
  ['commands', '命令列表'],
  ['back to top', '回到顶部'],
  ['report a bug', '报告问题'],
  ['feature request', '功能建议'],
  ['open an issue', '提交 Issue'],
  ['submit a pull request', '提交 Pull Request'],
  ['give it a star', '给它一个 Star'],
  ['out of the box', '开箱即用'],
  ['zero config', '零配置'],
  ['zero-config', '零配置'],
  ['type-safe', '类型安全'],
  ['type safe', '类型安全'],
  ['cross-platform', '跨平台'],
  ['lightweight', '轻量'],
  ['production ready', '可用于生产环境'],
  ['breaking change', '破坏性变更'],
  ['backward compatible', '向后兼容'],
  ['command line', '命令行'],
  ['command-line', '命令行'],
  ['package manager', '包管理器'],
  ['source code', '源代码'],
  ['build output', '构建产物'],
  ['entry point', '入口'],
  ['code coverage', '代码覆盖率'],
  ['code style', '代码风格'],
  ['static site', '静态站点'],
  ['getting started', '快速上手'],
];

const ZH_TO_EN: Array<[string, string]> = [
  ['安装', 'Installation'],
  ['快速开始', 'Quick Start'],
  ['快速上手', 'Getting Started'],
  ['功能特性', 'Features'],
  ['使用方法', 'Usage'],
  ['配置', 'Configuration'],
  ['参与贡献', 'Contributing'],
  ['贡献者', 'Contributors'],
  ['更新日志', 'Changelog'],
  ['许可证', 'License'],
  ['环境要求', 'Requirements'],
  ['依赖', 'Dependencies'],
  ['本地开发', 'Development'],
  ['测试', 'Testing'],
  ['架构设计', 'Architecture'],
  ['项目结构', 'Project Structure'],
  ['目录', 'Table of Contents'],
  ['环境变量', 'Environment Variables'],
  ['可用脚本', 'Available Scripts'],
  ['文档', 'Documentation'],
  ['路线图', 'Roadmap'],
  ['常见问题', 'FAQ'],
  ['致谢', 'Acknowledgements'],
  ['项目亮点', 'Highlights'],
  ['命令列表', 'Commands'],
  ['回到顶部', 'Back to Top'],
  ['报告问题', 'Report a Bug'],
  ['功能建议', 'Feature Request'],
  ['开箱即用', 'out of the box'],
  ['零配置', 'zero-config'],
  ['类型安全', 'type-safe'],
  ['跨平台', 'cross-platform'],
  ['命令行', 'command-line'],
  ['包管理器', 'package manager'],
  ['源代码', 'source code'],
  ['构建产物', 'build output'],
  ['入口', 'entry point'],
  ['代码覆盖率', 'code coverage'],
  ['代码风格', 'code style'],
  ['破坏性变更', 'breaking change'],
  ['向后兼容', 'backward compatible'],
  ['提交记录', 'commit history'],
];

export interface Glossary {
  entries: GlossaryEntry[];
  /** Compact instruction line for LLM prompts. */
  promptHint(target: 'zh' | 'en'): string;
}

/** Build the glossary for a direction, merged with user-supplied overrides. */
export function buildGlossary(target: 'zh' | 'en', overrides: Record<string, string> = {}, extraPreserve: string[] = []): Glossary {
  const entries: GlossaryEntry[] = [];
  const seen = new Set<string>();

  for (const term of [...PRESERVE_TERMS, ...extraPreserve]) {
    if (seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    entries.push({ term, translation: term, preserve: true });
  }

  const pairs = target === 'zh' ? EN_TO_ZH : ZH_TO_EN;
  for (const [term, translation] of pairs) {
    if (seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    entries.push({ term, translation });
  }

  for (const [term, translation] of Object.entries(overrides)) {
    const existing = entries.find((e) => e.term.toLowerCase() === term.toLowerCase());
    if (existing) existing.translation = translation;
    else entries.push({ term, translation });
  }

  return {
    entries,
    promptHint(lang) {
      const preserve = entries.filter((e) => e.preserve).slice(0, 40).map((e) => e.term);
      const mapped = entries.filter((e) => !e.preserve && e.term.toLowerCase() !== e.translation.toLowerCase()).slice(0, 40);
      const lines = [
        lang === 'zh'
          ? 'Keep these technical terms in English verbatim: '
          : '保留以下术语的英文原文：',
        preserve.join(', '),
        lang === 'zh' ? 'Use these fixed translations: ' : '使用以下固定译法：',
        mapped.map((e) => `${e.term} → ${e.translation}`).join('; '),
      ];
      return lines.filter((l) => l.trim()).join('\n');
    },
  };
}

/**
 * Replace glossary terms with placeholders so a low-quality engine cannot
 * translate them. Returns the masked text and a restore function.
 */
export function maskGlossary(text: string, glossary: Glossary): { masked: string; restore: (text: string) => string } {
  const preserved = glossary.entries
    .filter((e) => e.preserve)
    .map((e) => e.term)
    .sort((a, b) => b.length - a.length); // longest first so `README.zh-CN` wins over `README`

  const tokens: string[] = [];
  let masked = text;
  for (const term of preserved) {
    if (!masked.includes(term)) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    masked = masked.replace(new RegExp(escaped, 'g'), () => {
      tokens.push(term);
      return `\u0000${tokens.length - 1}\u0001`;
    });
  }

  return {
    masked,
    restore: (value: string) =>
      value.replace(/\u0000(\d+)\u0001/g, (match, rawIndex: string) => {
        const index = Number(rawIndex);
        return tokens[index] ?? match;
      }),
  };
}
