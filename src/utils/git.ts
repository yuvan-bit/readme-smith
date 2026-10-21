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
  info.shallow = git(root, ['rev-parse', '--is-shallow-repository']) === 'true';

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

export interface GitCommit {
  hash: string;
  date: string;
  subject: string;
  files: string[];
}

/**
 * The most recent commits with the files each one touched.
 *
 * `--name-only` prints the file list after a blank line; the parser keeps the
 * order of `git log` (newest first) because freshness is an ordering question.
 */
export function recentCommits(root: string, count = 10): GitCommit[] {
  const raw = git(root, [
    'log',
    `-n${count}`,
    '--name-only',
    '--pretty=format:%H%x09%aI%x09%s',
  ]);
  if (!raw) return [];
  const commits: GitCommit[] = [];
  let current: GitCommit | null = null;
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      current = null;
      continue;
    }
    const m = line.match(/^([0-9a-f]{7,40})\t([^\t]+)\t(.*)$/);
    if (m) {
      current = { hash: m[1]!, date: m[2]!, subject: m[3]!, files: [] };
      commits.push(current);
    } else if (current) {
      current.files.push(line.trim().replace(/\\/g, '/'));
    }
  }
  return commits;
}

export function headCommitMessage(root: string): string | undefined {
  return git(root, ['log', '-1', '--pretty=format:%B']);
}

export function isFileDirty(root: string, file: string): boolean {
  const out = git(root, ['status', '--porcelain', '--', file]);
  return !!out && out.trim().length > 0;
}

/**
 * Files changed between `base` and HEAD, plus staged, unstaged and untracked
 * files. Returns null when the base revision cannot be resolved.
 */
export function changedFiles(root: string, base: string): string[] | null {
  if (!git(root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`])) return null;
  const collect = (args: string[]): string[] => {
    const out = git(root, args);
    if (!out) return [];
    return out
      .split('\n')
      .map((line) => line.trim().replace(/\\/g, '/'))
      .filter(Boolean);
  };
  return [...new Set([
    ...collect(['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`]),
    ...collect(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']),
    ...collect(['ls-files', '--others', '--exclude-standard']),
  ])].sort();
}


export function commitCount(root: string): number | undefined {
  const n = git(root, ['rev-list', '--count', 'HEAD']);
  const parsed = n ? Number(n) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}
