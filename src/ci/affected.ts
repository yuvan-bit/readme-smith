import path from 'node:path';
import { detectManifests } from '../facts/manifests.js';

const MANIFEST_FILES = new Set([
  'package.json',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'composer.json',
  'Gemfile',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Package.swift',
  'mix.exs',
  'pubspec.yaml',
]);

function isManifest(file: string): boolean {
  const base = path.posix.basename(file);
  return MANIFEST_FILES.has(base) ||
    base.endsWith('.gemspec') ||
    base.endsWith('.csproj') ||
    base.endsWith('.sln');
}

function isPackageReadme(file: string): boolean {
  return path.posix.basename(file).toLowerCase() === 'readme.md';
}

/**
 * Workspace directories whose manifest or package README changed.
 * The repository root is excluded because `readme-smith check` always evaluates it.
 */
export function affectedPackageTargets(root: string, files: string[]): string[] {
  const targets = new Set<string>();
  for (const raw of files) {
    const file = raw.replace(/\\/g, '/');
    if (file.split('/').includes('node_modules') || file.split('/').includes('.git')) continue;
    if (!isManifest(file) && !isPackageReadme(file)) continue;

    const dir = path.posix.dirname(file);
    if (dir === '.' || dir === '') continue;
    if (detectManifests(path.join(root, dir))[0] === 'none') continue;
    targets.add(dir);
  }
  return [...targets].sort((a, b) => a.localeCompare(b));
}
