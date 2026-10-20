import type { BadgeSpec, Lang, ProjectProfile } from '../types.js';

/**
 * Escape a shields.io path segment.
 *
 * The three substitutions are shields' own convention, verified against the
 * live service: `-`→`--`, `_`→`__`, space→`_`. Getting the space rule wrong is
 * invisible in code review and fatal in practice — `badge/code-style-prettier`
 * renders as a "404: badge not found" image, so every multi-word label silently
 * broke. Anything with URL meaning is percent-encoded instead of dropped;
 * stripping `>` turned the declared `>=18.17` Node engine into `=18.17`, which
 * states a different requirement.
 */
export function shieldsEscape(value: string): string {
  return value
    .replace(/%/g, '%25')
    .replace(/-/g, '--')
    .replace(/_/g, '__')
    .replace(/\s+/g, '_')
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F')
    .replace(/\//g, '%2F')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/\^/g, '%5E')
    .replace(/\|/g, '%7C')
    .replace(/[[\]{}`"\\]/g, '');
}

/** Build a static shields.io badge URL from label/message/colour. */
export function shieldsUrl(
  label: string,
  message: string,
  color = 'blue',
  opts: { logo?: string; logoColor?: string; style?: string } = {},
): string {
  const params = new URLSearchParams();
  if (opts.logo) params.set('logo', opts.logo);
  if (opts.logoColor) params.set('logoColor', opts.logoColor);
  if (opts.style) params.set('style', opts.style);
  const query = params.toString();
  return `https://img.shields.io/badge/${shieldsEscape(label)}-${shieldsEscape(message)}-${shieldsEscape(color)}${query ? `?${query}` : ''}`;
}

const LOCALE_FILE: Record<Lang, string> = { en: 'README.md', zh: 'README.zh-CN.md' };
const LOCALE_LABEL: Record<Lang, string> = { en: 'English', zh: '中文' };

export interface BadgeContext {
  profile: ProjectProfile;
  style: NonNullable<BadgeSpec['style']>;
  /** Language of the file being rendered — drives which switcher entry is bold. */
  lang: Lang;
  /** Every language the README is published in. */
  langs: Lang[];
  /**
   * Whether registry claims may appear. A manifest that merely *could* be
   * published is not proof that it was: an npm version badge on an
   * unpublished package renders as "this package does not exist", which is a
   * worse README than the one with no badge. Most scanned projects are
   * published, so this defaults on and `--unpublished` turns it off; the
   * scanner warns whenever a claim was made on inference alone.
   */
  allowRegistryClaims: boolean;
}

/** Convenience: is this a GitHub repo we can build live endpoints for? */
function githubSlug(profile: ProjectProfile): string | undefined {
  return profile.repo.host === 'github' ? profile.repo.slug : undefined;
}

function dedupe(badges: BadgeSpec[]): BadgeSpec[] {
  const seen = new Set<string>();
  return badges.filter((b) => {
    const key = `${b.label}:${b.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * Badge groups
 * ------------------------------------------------------------------ */

/** Release/distribution badges — only when the package is really published. */
function registryBadges(ctx: BadgeContext): BadgeSpec[] {
  const { profile, style } = ctx;
  const name = profile.name;
  if (!ctx.allowRegistryClaims || !profile.features.publishedToRegistry || !name) return [];

  switch (profile.ecosystem) {
    case 'npm':
    case 'pnpm':
    case 'yarn':
    case 'bun':
      return [
        {
          label: 'npm',
          message: 'version',
          url: `https://img.shields.io/npm/v/${encodeURIComponent(name)}?style=${style}&color=CB3837&logo=npm&logoColor=white`,
          href: `https://www.npmjs.com/package/${name}`,
        },
        {
          label: 'downloads',
          message: 'per month',
          url: `https://img.shields.io/npm/dm/${encodeURIComponent(name)}?style=${style}&color=green&logo=npm&logoColor=white`,
          href: `https://www.npmjs.com/package/${name}`,
        },
      ];
    case 'pip':
    case 'poetry':
    case 'uv':
      return [{
        label: 'PyPI',
        message: 'version',
        url: `https://img.shields.io/pypi/v/${encodeURIComponent(name)}?style=${style}&color=blue&logo=pypi&logoColor=white`,
        href: `https://pypi.org/project/${name}/`,
      }];
    case 'cargo':
      return [{
        label: 'crates.io',
        message: 'version',
        url: `https://img.shields.io/crates/v/${encodeURIComponent(name)}?style=${style}&color=F74C00&logo=rust&logoColor=white`,
        href: `https://crates.io/crates/${name}`,
      }];
    case 'go':
      return [{
        label: 'reference',
        message: 'pkg.go.dev',
        url: `https://img.shields.io/badge/Go%20Reference-pkg.go.dev-00ADD8?style=${style}&logo=go&logoColor=white`,
        href: `https://pkg.go.dev/${name}`,
      }];
    case 'composer':
      return [{
        label: 'Packagist',
        message: 'version',
        url: `https://img.shields.io/packagist/v/${encodeURIComponent(name)}?style=${style}&color=2675D9&logo=composer&logoColor=white`,
        href: `https://packagist.org/packages/${name}`,
      }];
    case 'nuget':
      return [{
        label: 'NuGet',
        message: 'version',
        url: `https://img.shields.io/nuget/v/${encodeURIComponent(name)}?style=${style}&color=004880&logo=nuget&logoColor=white`,
        href: `https://www.nuget.org/packages/${name}`,
      }];
    case 'gem':
      return [{
        label: 'Gem',
        message: 'version',
        url: `https://img.shields.io/gem/v/${encodeURIComponent(name)}?style=${style}&color=E9573F&logo=rubygems&logoColor=white`,
        href: `https://rubygems.org/gems/${name}`,
      }];
    default:
      return [];
  }
}

/** Quality gates: CI status, tests, coverage, types, lint/format. */
function qualityBadges(ctx: BadgeContext): BadgeSpec[] {
  const { profile, style } = ctx;
  const out: BadgeSpec[] = [];
  const slug = githubSlug(profile);

  if (slug && profile.features.ciWorkflowFile) {
    const workflowFile = profile.features.ciWorkflowFile.split('/').pop()!;
    out.push({
      label: 'CI',
      message: 'status',
      url: `https://img.shields.io/github/actions/workflow/status/${slug}/${encodeURIComponent(workflowFile)}?branch=${encodeURIComponent(profile.repo.defaultBranch)}&style=${style}&logo=githubactions&logoColor=white`,
      href: `https://github.com/${slug}/actions/workflows/${encodeURIComponent(workflowFile)}`,
    });
  } else if (profile.features.hasCI) {
    // Non-GitHub CI: we know it exists but cannot query a status endpoint.
    out.push({ label: 'CI', message: profile.features.ciProviders[0] ?? 'enabled', color: '2ea043' });
  }

  if (profile.features.testFrameworks.length > 0) {
    out.push({ label: 'tests', message: profile.features.testFrameworks[0]!, color: 'informational' });
  }

  // Only advertise coverage when there is evidence the project reports it.
  // A codecov badge on a repo that never uploads is a broken image at best
  // and a false claim at worst.
  const reportsCoverage =
    profile.features.ciProviders.includes('Codecov') ||
    profile.scripts.some((s) => /coverage|\bcov\b/i.test(`${s.name} ${s.command}`));
  if (slug && reportsCoverage) {
    out.push({
      label: 'coverage',
      message: 'codecov',
      url: `https://img.shields.io/codecov/c/github/${slug}?style=${style}&logo=codecov&logoColor=white`,
      href: `https://codecov.io/gh/${slug}`,
    });
  }

  if (profile.features.hasTypeCheck) {
    out.push({ label: 'types', message: 'included', color: '3178c6', logo: 'typescript', logoColor: 'white' });
  }
  for (const linter of profile.features.linters.slice(0, 1)) {
    if (linter === 'ESLint') out.push({ label: 'lint', message: 'ESLint', color: '4B32C3', logo: 'eslint', logoColor: 'white' });
    else if (linter === 'Ruff') out.push({ label: 'lint', message: 'Ruff', color: 'D7FF10', logo: 'ruff', logoColor: 'black' });
    else out.push({ label: 'lint', message: linter, color: '4B32C3' });
  }
  for (const formatter of profile.features.formatters.slice(0, 1)) {
    if (formatter === 'Prettier') out.push({ label: 'code style', message: 'prettier', color: 'F7B93E', logo: 'prettier', logoColor: 'black' });
    else if (formatter === 'Black') out.push({ label: 'code style', message: 'black', color: '000000' });
    else out.push({ label: 'code style', message: formatter, color: 'F7B93E' });
  }
  return dedupe(out);
}

/** Community and activity badges — GitHub-only, since they hit live endpoints. */
function communityBadges(ctx: BadgeContext): BadgeSpec[] {
  const { profile, style } = ctx;
  const slug = githubSlug(profile);
  if (!slug) return [];

  const contributingHref = profile.repo.url
    ? `${profile.repo.url}/blob/${profile.repo.defaultBranch}/CONTRIBUTING.md`
    : undefined;

  return [
    {
      label: 'stars',
      message: 'stars',
      url: `https://img.shields.io/github/stars/${slug}?style=${style}&logo=github&logoColor=white&color=gold`,
      href: `https://github.com/${slug}/stargazers`,
    },
    {
      label: 'forks',
      message: 'forks',
      url: `https://img.shields.io/github/forks/${slug}?style=${style}&logo=github&logoColor=white`,
      href: `https://github.com/${slug}/network/members`,
    },
    {
      label: 'issues',
      message: 'open issues',
      url: `https://img.shields.io/github/issues/${slug}?style=${style}&logo=github&logoColor=white`,
      href: `https://github.com/${slug}/issues`,
    },
    {
      label: 'last commit',
      message: 'last commit',
      url: `https://img.shields.io/github/last-commit/${slug}?style=${style}&logo=github&logoColor=white`,
      href: `https://github.com/${slug}/commits`,
    },
    { label: 'PRs', message: 'welcome', color: '2ea043', href: contributingHref },
  ];
}

/** Static project facts: licence, language, shape, container support. */
function factBadges(ctx: BadgeContext): BadgeSpec[] {
  const { profile } = ctx;
  const out: BadgeSpec[] = [];
  const slug = githubSlug(profile);

  if (profile.license) {
    const label = profile.license.spdx ?? profile.license.family;
    if (slug) {
      out.push({
        label: 'license',
        message: label,
        url: `https://img.shields.io/github/license/${slug}?style=${ctx.style}&color=blue`,
        href: profile.license.url ||
          (profile.repo.url ? `${profile.repo.url}/blob/${profile.repo.defaultBranch}/${profile.license.file ?? 'LICENSE'}` : undefined),
      });
    } else {
      out.push({ label: 'license', message: label, color: 'blue' });
    }
  }

  const primary = profile.languages[0];
  if (primary) {
    out.push({ label: 'language', message: primary.name, color: (primary.color ?? '#555555').replace('#', '') });
  }

  if (profile.features.isCli) out.push({ label: 'type', message: 'CLI', color: 'ff6f00', logo: 'gnubash', logoColor: 'white' });
  else if (profile.features.isLibrary) out.push({ label: 'type', message: 'library', color: '6f42c1' });
  else if (profile.features.isApplication) out.push({ label: 'type', message: 'application', color: '0969da' });

  if (profile.features.hasDocker) out.push({ label: 'docker', message: 'ready', color: '2496ED', logo: 'docker', logoColor: 'white' });
  if (profile.features.isMonorepo) out.push({ label: 'repo', message: 'monorepo', color: 'e10098' });
  if (profile.features.hasDocsSite) out.push({ label: 'docs', message: 'available', color: '0969da', logo: 'readthedocs', logoColor: 'white' });

  return dedupe(out);
}

/** Runtime requirement badges, from the manifest's declared engines. */
function runtimeBadges(ctx: BadgeContext): BadgeSpec[] {
  const { profile } = ctx;
  const out: BadgeSpec[] = [];
  const engines = profile.engines;

  // Keep semver comparators (`^`, `~`, `>=`) — they carry the actual meaning of
  // the range. `shieldsUrl` percent-encodes them for the badge path.
  const normalise = (range: string): string =>
    range.replace(/\s*\|\|\s*/g, ' | ').replace(/[()[\]{}`"\\]/g, '').replace(/\s+/g, ' ').trim() || range;

  if (engines.node) out.push({ label: 'node', message: normalise(engines.node), color: '339933', logo: 'nodedotjs', logoColor: 'white' });
  if (engines.npm) out.push({ label: 'npm', message: normalise(engines.npm), color: 'CB3837', logo: 'npm', logoColor: 'white' });
  if (engines.pnpm) out.push({ label: 'pnpm', message: normalise(engines.pnpm), color: 'F69220', logo: 'pnpm', logoColor: 'white' });
  if (engines.yarn) out.push({ label: 'yarn', message: normalise(engines.yarn), color: '2C8EBB', logo: 'yarn', logoColor: 'white' });

  const python = engines.python ?? engines['requires-python'];
  if (python) out.push({ label: 'python', message: normalise(python), color: '3776AB', logo: 'python', logoColor: 'white' });
  if (engines.go) out.push({ label: 'go', message: normalise(engines.go), color: '00ADD8', logo: 'go', logoColor: 'white' });
  if (engines.rust) out.push({ label: 'rust', message: normalise(engines.rust), color: 'DEA584', logo: 'rust', logoColor: 'white' });
  if (engines.php) out.push({ label: 'php', message: normalise(engines.php), color: '777BB4', logo: 'php', logoColor: 'white' });

  return dedupe(out);
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export interface BadgeGroup {
  id: 'facts' | 'quality' | 'community';
  badges: BadgeSpec[];
}

/**
 * Assemble every badge applicable to this project, grouped so the renderer can
 * lay them out on separate lines: facts, then quality gates, then community.
 */
export function collectBadges(ctx: BadgeContext): BadgeGroup[] {
  const groups: BadgeGroup[] = [
    { id: 'facts', badges: [...registryBadges(ctx), ...runtimeBadges(ctx), ...factBadges(ctx)] },
    { id: 'quality', badges: qualityBadges(ctx) },
    { id: 'community', badges: communityBadges(ctx) },
  ];
  return groups.filter((g) => g.badges.length > 0);
}

/** Render one badge as HTML-in-Markdown so it can carry a hyperlink. */
export function renderBadge(badge: BadgeSpec, style: NonNullable<BadgeSpec['style']>): string {
  const url = badge.url ?? shieldsUrl(badge.label, badge.message, badge.color ?? 'blue', {
    logo: badge.logo,
    logoColor: badge.logoColor,
    style,
  });
  const alt = `${badge.label}: ${badge.message}`;
  const img = `<img src="${url}" alt="${alt}" />`;
  return badge.href ? `<a href="${badge.href}">${img}</a>` : img;
}

/** Render a group of badges, wrapping to a new visual line every `perRow`. */
export function renderBadgeRow(badges: BadgeSpec[], style: NonNullable<BadgeSpec['style']>, perRow = 6): string {
  const rows: string[] = [];
  for (let i = 0; i < badges.length; i += perRow) {
    rows.push(badges.slice(i, i + perRow).map((b) => renderBadge(b, style)).join(' '));
  }
  return rows.join('\n<br/>\n');
}

/**
 * Language switcher for bilingual READMEs.
 * Relative links are used deliberately: they resolve both on disk and when
 * viewed through GitHub/GitLab's markdown renderer.
 */
export function renderLanguageSwitcher(current: Lang, langs: Lang[]): string {
  const unique = [...new Set(langs)];
  if (unique.length < 2) return '';
  return unique
    .map((lang) => (lang === current ? `**${LOCALE_LABEL[lang]}**` : `[${LOCALE_LABEL[lang]}](./${LOCALE_FILE[lang]})`))
    .join(' | ');
}
