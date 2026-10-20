import path from 'node:path';
import type { ConfigFileFact } from '../types.js';
import type { WalkedFile } from '../utils/fs.js';

const MAX_CONFIG_FILES = 30;

const RULES: Array<{ kind: ConfigFileFact['kind']; test: (rel: string) => boolean }> = [
  { kind: 'env', test: (r) => /^\.env\.(example|sample|template)$/i.test(path.basename(r)) },
  { kind: 'eslint', test: (r) => /^eslint\.config\.|^\.eslintrc/i.test(path.basename(r)) },
  { kind: 'prettier', test: (r) => /^\.prettierrc|^prettier\.config\./i.test(path.basename(r)) },
  { kind: 'tsconfig', test: (r) => /^tsconfig(\..+)?\.json$/i.test(path.basename(r)) },
  { kind: 'vite', test: (r) => /^vite\.config\./i.test(path.basename(r)) },
  { kind: 'webpack', test: (r) => /^webpack\.config\./i.test(path.basename(r)) },
  { kind: 'docker', test: (r) => /^dockerfile/i.test(path.basename(r)) },
  { kind: 'compose', test: (r) => /^(docker-)?compose(\.override)?\.ya?ml$/i.test(path.basename(r)) },
  {
    kind: 'other',
    test: (r) => {
      const base = path.basename(r).toLowerCase();
      if (!/^(config|settings)\.[a-z0-9]+$/.test(base) && !/^\.?[a-z0-9-]+rc(\.[a-z0-9]+)?$/.test(base)) return false;
      // A source file called `config.ts` belongs to the app, not to its config surface.
      return !/\.(ts|tsx|js|jsx|py|rs|go|rb|php)$/i.test(base) || /rc(\.|$)/.test(base);
    },
  },
];

export function detectConfigFiles(files: WalkedFile[]): ConfigFileFact[] {
  const out: ConfigFileFact[] = [];
  const seen = new Set<string>();
  for (const file of [...files].sort((a, b) => a.rel.localeCompare(b.rel))) {
    const rel = file.rel.replace(/\\/g, '/');
    if (rel.split('/').some((part) => part === 'node_modules' || part === '.git')) continue;
    const rule = RULES.find((r) => r.test(rel));
    if (!rule || seen.has(rel)) continue;
    seen.add(rel);
    out.push({ path: rel, kind: rule.kind });
    if (out.length >= MAX_CONFIG_FILES) break;
  }
  return out;
}
