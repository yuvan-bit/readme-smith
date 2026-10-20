import path from 'node:path';
import type { LanguageStat, PresetId, ProjectType } from '../types.js';

export interface TypeInput {
  forced?: PresetId;
  hasManifest: boolean;
  isMonorepo: boolean;
  binNames: string[];
  dependencyNames: string[];
  languages: LanguageStat[];
  rels: string[];
  ecosystem: string | undefined;
}

export interface TypeResult {
  type: ProjectType;
  confidence: number;
  evidence: string[];
}

const WEB_DEPS = new Set([
  'next', 'nuxt', 'react', 'react-dom', 'vue', '@sveltejs/kit', 'svelte', 'astro',
  '@angular/core', 'solid-js', 'express', 'fastify', 'koa', 'hono', '@nestjs/core',
  'django', 'flask', 'fastapi', 'starlette', 'rails', 'sinatra', 'laravel/framework',
  'spring-boot-starter-web', 'actix-web', 'axum', 'rocket',
]);

const DATA_EXTS = new Set(['.csv', '.tsv', '.parquet', '.jsonl', '.ndjson', '.arrow', '.feather']);

/** SPEC §4.3: monorepo → main manifest → language distribution. */
export function detectProjectType(input: TypeInput): TypeResult {
  if (input.forced) {
    return { type: input.forced, confidence: 1, evidence: [`--preset ${input.forced}`] };
  }

  if (input.isMonorepo) {
    return { type: 'monorepo', confidence: 0.95, evidence: ['multiple package directories or workspaces declared'] };
  }

  const deps = input.dependencyNames.map((d) => d.toLowerCase());
  const webDeps = deps.filter((d) => WEB_DEPS.has(d));
  const hasWebEntry = input.rels.some((r) => /(^|\/)(index\.html|next\.config\.|nuxt\.config\.|vite\.config\.|astro\.config\.)/i.test(r));
  const hasBin = input.binNames.length > 0;
  const hasCliSource = input.rels.some((r) => /(^|\/)(cli|cmd|bin)\/(?:[^/]+\.)?(ts|js|py|rs|go|rb)$/i.test(r));
  const cliFramework = deps.some((d) => ['commander', 'yargs', 'oclif', '@oclif/core', 'clap', 'cobra', 'typer', 'click', 'thor'].includes(d));

  if (hasBin || hasCliSource || cliFramework) {
    const evidence: string[] = [];
    if (hasBin) evidence.push(`declared executable(s): ${input.binNames.slice(0, 4).join(', ')}`);
    if (hasCliSource) evidence.push('CLI source layout (cli/, cmd/ or bin/)');
    if (cliFramework) evidence.push(`CLI framework dependency: ${deps.find((d) => ['commander', 'yargs', 'oclif', '@oclif/core', 'clap', 'cobra', 'typer', 'click', 'thor'].includes(d))}`);
    return { type: 'cli', confidence: hasBin ? 0.9 : 0.7, evidence };
  }

  if (webDeps.length > 0 || hasWebEntry) {
    return {
      type: 'web',
      confidence: 0.85,
      evidence: webDeps.length > 0 ? [`web framework dependency: ${webDeps[0]}`] : ['web entry files (index.html / framework config)'],
    };
  }

  const dataFiles = input.rels.filter((r) => DATA_EXTS.has(path.extname(r).toLowerCase()));
  const notebooks = input.rels.filter((r) => r.endsWith('.ipynb'));
  if (dataFiles.length >= 3 && input.rels.filter((r) => /\.(py|r|jl|sql|ts|js)$/i.test(r)).length <= 3) {
    return {
      type: 'dataset',
      confidence: 0.75,
      evidence: [`${dataFiles.length} data files and little executable code`],
    };
  }
  if (notebooks.length >= 2 && dataFiles.length >= 1) {
    return { type: 'dataset', confidence: 0.65, evidence: [`${notebooks.length} notebooks with data files`] };
  }

  if (input.hasManifest || input.languages.length > 0) {
    return {
      type: 'lib',
      confidence: 0.55,
      evidence: input.hasManifest ? ['manifest present, no executable or web entry'] : ['source files without a manifest'],
    };
  }

  return { type: 'unknown', confidence: 0, evidence: ['no manifest and no recognised source files'] };
}

/** The manifest filenames a user could add when the type is unrecognisable. */
export const EXPECTED_MANIFESTS = [
  'package.json',
  'pyproject.toml / setup.py / setup.cfg',
  'Cargo.toml',
  'go.mod',
  'Gemfile / *.gemspec',
];
