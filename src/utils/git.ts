import { execFileSync } from 'node:child_process';
import type { RepoInfo } from '../types.js';

/** Run git with a short timeout; never throws. Returns undefined on any failure. */
function git(root: string, args: string[]): string | undefined {
  try {
    const out = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    return out.trim();
  } catch {
    return undefined;
  }
}

/** `git@github.com:acme/widget.git` or `https://github.com/acme/widget.git` → parts. */
export function parseRemoteUrl(remote: string): Pick<RepoInfo, 'url' | 'host' | 'owner' | 'name' | 'slug' | 'sshUrl'> {
  let https: string | undefined;
  let ssh: string | undefined;
  let host = 'other' as RepoInfo['host'];
  let owner: string | undefined;
  let name: string | undefined;

  const scpLike = remote.match(/^git@([^:]+):(.+)$/);
  if (scpLike) {
    const [, h, p] = scpLike as unknown as [string, string, string];
    https = `https://${h}/${p.replace(/\.git$/, '')}`;
    ssh = remote;
    owner = p.split('/')[0];
    name = p.split('/').slice(1).join('/').replace(/\.git$/, '');
    host = hostOf(h);
  } else if (/^https?:\/\//.test(remote)) {
    https = remote.replace(/\.git$/, '');
    try {
      const u = new URL(https);
      host = hostOf(u.hostname);
      const parts = u.pathname.split('/').filter(Boolean);
      owner = parts[0];
      name = parts[1]?.replace(/\.git$/, '');
    } catch {
      /* ignore malformed URL */
    }
  } else if (/^ssh:\/\//.test(remote)) {
    ssh = remote;
    try {
      const u = new URL(remote);
      host = hostOf(u.hostname);
      const parts = u.pathname.split('/').filter(Boolean);
      owner = parts[0];
      name = parts[1]?.replace(/\.git$/, '');
      https = `https://${u.hostname}/${owner}/${name}`;
    } catch {
      /* ignore */
    }
  }

  return {
    ...(https ? { url: https } : {}),
    ...(ssh ? { sshUrl: ssh } : {}),
    host,
    ...(owner ? { owner } : {}),
    ...(name ? { name } : {}),
    ...(owner && name ? { slug: `${owner}/${name}` } : {}),
  };
}

function hostOf(hostname: string): RepoInfo['host'] {
  const h = hostname.toLowerCase();
  if (h === 'github.com' || h.endsWith('.github.com')) return 'github';
  if (h === 'gitlab.com' || h.endsWith('.gitlab.com')) return 'gitlab';
  if (h === 'bitbucket.org' || h.endsWith('.bitbucket.org')) return 'bitbucket';
  if (h.includes('gitea') || h.includes('forgejo')) return 'gitea';
  return 'other';
}

export function collectRepoInfo(root: string, fallbackName: string): RepoInfo {
  const info: RepoInfo = { isGit: false, defaultBranch: 'main' };

  if (!git(root, ['rev-parse', '--is-inside-work-tree'])) return info;
  info.isGit = true;

  // Prefer the symbolic ref of HEAD; fall back to the remote's default.
  const branch =
    git(root, ['symbolic-ref', '--short', 'HEAD']) ??
    git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) ??
    'main';
  info.defaultBranch = branch === 'HEAD' ? 'main' : branch;

  const remote =
    git(root, ['remote', 'get-url', 'origin']) ??
    git(root, ['config', '--get', 'remote.origin.url']);

  if (remote) Object.assign(info, parseRemoteUrl(remote));
  if (!info.name) info.name = fallbackName;

  return info;
}

/** Contributors from `git shortlog`, capped to keep the README readable. */
export function collectContributors(root: string, limit = 24): Array<{ login: string; contributions: number }> {
  const raw = git(root, ['shortlog', '-sne', '--all', 'HEAD']);
  if (!raw) return [];
  const out: Array<{ login: string; contributions: number }> = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.+?)\s*<([^>]+)>$/);
    if (!m) continue;
    const [, count, name, email] = m as unknown as [string, string, string, string];
    if (/\(bot\)|noreply@github|actions@github|dependabot/i.test(`${name} ${email}`)) continue;
    const login = email.split('@')[1] === 'users.noreply.github.com'
      ? email.split('@')[0]!.replace(/^\d+\+/, '')
      : name;
    out.push({ login, contributions: Number(count) });
    if (out.length >= limit) break;
  }
  return out;
}

export function latestTag(root: string): string | undefined {
  return git(root, ['describe', '--tags', '--abbrev=0']) ?? undefined;
}

export function commitCount(root: string): number | undefined {
  const n = git(root, ['rev-list', '--count', 'HEAD']);
  const parsed = n ? Number(n) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}
