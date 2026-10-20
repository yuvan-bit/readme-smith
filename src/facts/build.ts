import path from 'node:path';
import type { BuildCommandFact, CiWorkflowFact } from '../types.js';
import { readTextSafe, type WalkedFile } from '../utils/fs.js';

const MAX_COMMANDS = 24;

/**
 * Build/run commands proven by Dockerfiles, Makefiles and CI workflow steps.
 * Nothing is executed; this is static text extraction only, which is what makes
 * the command safe to run inside CI.
 */
export function detectBuildCommands(
  root: string,
  files: WalkedFile[],
  workflows: CiWorkflowFact[],
): BuildCommandFact[] {
  const commands: BuildCommandFact[] = [];
  const seen = new Set<string>();
  const add = (command: string, source: string): void => {
    const clean = command.trim();
    if (!clean || clean.startsWith('#')) return;
    const key = `${clean}\u0000${source}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (commands.length < MAX_COMMANDS) commands.push({ command: clean, source });
  };

  const rels = files.map((f) => f.rel.replace(/\\/g, '/'));
  for (const rel of rels.filter((r) => /(^|\/)(dockerfile[^/]*)$/i.test(r) || /^dockerfile/i.test(path.basename(r))).sort()) {
    const text = readTextSafe(path.join(root, rel), 256 * 1024);
    if (!text) continue;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      const m = line.match(/^(?:RUN|CMD|ENTRYPOINT)\s+(.+)$/i);
      if (!m) continue;
      // `CMD ["npm", "start"]` → `npm start`
      const exec = m[1]!.trim();
      if (exec.startsWith('[')) {
        try {
          const parts = JSON.parse(exec.replace(/'/g, '"')) as unknown;
          if (Array.isArray(parts)) add(parts.join(' '), rel);
        } catch {
          add(exec, rel);
        }
      } else {
        add(exec.replace(/^--[a-z-]+\s+/i, ''), rel);
      }
    }
  }

  for (const rel of rels.filter((r) => /(^|\/)(gnu)?makefile$/i.test(r)).sort()) {
    const text = readTextSafe(path.join(root, rel), 512 * 1024);
    if (!text) continue;
    for (const raw of text.split('\n')) {
      const m = raw.match(/^([A-Za-z0-9_.-]+)\s*:(?!=)/);
      if (!m) continue;
      const target = m[1]!;
      if (target.startsWith('.') || target === 'all') {
        add(`make ${target}`, rel);
        continue;
      }
      add(`make ${target}`, rel);
    }
  }

  for (const workflow of workflows) {
    for (const job of workflow.jobs) {
      for (const command of job.commands) add(command, workflow.file);
    }
  }

  return commands;
}
