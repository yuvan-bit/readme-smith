import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { CiJobFact, CiWorkflowFact } from '../types.js';
import { readTextSafe, type WalkedFile } from '../utils/fs.js';

interface WorkflowShape {
  name?: unknown;
  on?: unknown;
  jobs?: unknown;
}

interface JobShape {
  name?: unknown;
  steps?: unknown;
}

interface StepShape {
  name?: unknown;
  run?: unknown;
  uses?: unknown;
}

/**
 * Read `.github/workflows/*.yml` into the small, deterministic summary the SPEC
 * asks for: job names, triggers and the main steps. Nothing is inferred when a
 * key is absent.
 */
export function detectCiWorkflows(
  root: string,
  files: WalkedFile[],
): { workflows: CiWorkflowFact[]; warnings: string[] } {
  const warnings: string[] = [];
  const paths = files
    .map((f) => f.rel.replace(/\\/g, '/'))
    .filter((rel) => rel.startsWith('.github/workflows/') && /\.ya?ml$/i.test(rel))
    .sort();

  const workflows: CiWorkflowFact[] = [];
  for (const rel of paths) {
    const text = readTextSafe(path.join(root, rel), 512 * 1024);
    if (text === undefined) {
      warnings.push(`Could not read CI workflow ${rel}.`);
      continue;
    }
    let doc: WorkflowShape;
    try {
      doc = (parseYaml(text) ?? {}) as WorkflowShape;
    } catch (error) {
      warnings.push(`Could not parse CI workflow ${rel}: ${(error as Error).message.split('\n')[0]}`);
      continue;
    }
    if (!doc || typeof doc !== 'object') {
      warnings.push(`CI workflow ${rel} is empty.`);
      continue;
    }

    const triggers = normaliseTriggers(doc.on);
    const jobs: CiJobFact[] = [];
    if (doc.jobs && typeof doc.jobs === 'object') {
      for (const [id, raw] of Object.entries(doc.jobs as Record<string, unknown>)) {
        const job = (raw ?? {}) as JobShape;
        const name = typeof job.name === 'string' && job.name.trim() ? job.name.trim() : id;
        const steps: string[] = [];
        const commands: string[] = [];
        if (Array.isArray(job.steps)) {
          for (const rawStep of job.steps) {
            const step = (rawStep ?? {}) as StepShape;
            if (typeof step.run === 'string') {
              for (const line of step.run.split('\n')) {
                const clean = line.trim();
                if (clean && !clean.startsWith('#')) commands.push(clean);
              }
            }
            if (typeof step.name === 'string' && step.name.trim()) {
              steps.push(step.name.trim());
            } else if (typeof step.uses === 'string') {
              steps.push(step.uses);
            } else if (typeof step.run === 'string') {
              const first = step.run.split('\n').map((l) => l.trim()).find(Boolean);
              if (first) steps.push(first.length > 80 ? `${first.slice(0, 77)}...` : first);
            }
          }
        }
        jobs.push({ name, steps: steps.slice(0, 12), commands: commands.slice(0, 20) });
      }
    }

    workflows.push({
      file: rel,
      name: typeof doc.name === 'string' && doc.name.trim() ? doc.name.trim() : null,
      triggers,
      jobs: jobs.slice(0, 20),
    });
  }

  return { workflows, warnings };
}

function normaliseTriggers(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>);
  return [];
}
