// S-AR-03: dependency resolution (PLAN "Üst dizin sızıntısı").
//   <home>\node_modules exists and packages resolve from there. These tests prove that:
//   * three, postprocessing, n8ao and gsap (and every other pinned package) resolve INSIDE the project's node_modules;
//   * exactly one `three` copy exists (node_modules, nested node_modules of dependencies, parent directories, lock file);
//   * installed versions and package.json specifiers equal PLAN.md's pinned table.
// Node's own algorithm is replicated (walk up from the project root, first `node_modules/<pkg>/package.json` wins), so the test
// does not depend on `import.meta.resolve` support inside Vitest.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../helpers/paths';

const CORE_PACKAGES = ['three', 'postprocessing', 'n8ao', 'gsap'] as const;

interface PackageJson { name?: string; version?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** The package.json Node would find for `pkg` when resolving from the project root (walks up directories). */
function resolvePackageJson(pkg: string, from = ROOT): string | null {
  let dir = from;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', ...pkg.split('/'), 'package.json');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function insideProject(file: string): boolean {
  const r = path.relative(path.join(ROOT, 'node_modules'), file);
  return !r.startsWith('..') && !path.isAbsolute(r);
}

/** Pinned packages from PLAN.md's "Sabitlenmiş yığın" table: `| \`name\` | version | note |`. */
function pinnedFromPlan(): Map<string, string> {
  const text = readFileSync(path.join(ROOT, 'docs', 'sprints', 'PLAN.md'), 'utf8');
  const start = text.indexOf('Sabitlenmiş yığın');
  expect(start, 'PLAN.md has the pinned stack table').toBeGreaterThan(-1);
  const out = new Map<string, string>();
  for (const line of text.slice(start).split('\n').slice(1, 40)) {
    const m = /^\|\s*`([^`]+)`\s*\|\s*([0-9][0-9A-Za-z.\-+]*)\s*\|/.exec(line);
    if (m) out.set(m[1]!, m[2]!);
    else if (out.size > 0 && !line.startsWith('|')) break;
  }
  return out;
}

describe('S-AR-03 dependency resolution', () => {
  it('three, postprocessing, n8ao and gsap resolve inside the project node_modules', () => {
    const problems: string[] = [];
    for (const pkg of CORE_PACKAGES) {
      const file = resolvePackageJson(pkg);
      if (!file) problems.push(`${pkg}: not installed (no node_modules/${pkg}/package.json from ${ROOT} upwards)`);
      else if (!insideProject(file)) problems.push(`${pkg}: resolves OUTSIDE the project: ${file}`);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('every package of package.json dependencies/devDependencies resolves inside the project', () => {
    const pkgJson = readJson<PackageJson>(path.join(ROOT, 'package.json'));
    const names = [...Object.keys(pkgJson.dependencies ?? {}), ...Object.keys(pkgJson.devDependencies ?? {})];
    expect(names.length).toBeGreaterThan(5);
    const problems: string[] = [];
    for (const name of names) {
      const file = resolvePackageJson(name);
      if (!file) problems.push(`${name}: not installed`);
      else if (!insideProject(file)) problems.push(`${name}: resolves OUTSIDE the project: ${file}`);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('exactly one `three` copy: project root, nested node_modules, parent directories and the lock file', () => {
    const copies: string[] = [];
    const isThree = (file: string): boolean => existsSync(file) && readJson<PackageJson>(file).name === 'three';
    // Parent chain, including the project's own node_modules.
    let dir = ROOT;
    for (;;) {
      const f = path.join(dir, 'node_modules', 'three', 'package.json');
      if (isThree(f)) copies.push(f);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    // One level of nested node_modules below every top-level package (and scoped package).
    const nm = path.join(ROOT, 'node_modules');
    const tops = readdirSync(nm).filter((n) => !n.startsWith('.'));
    for (const top of tops) {
      const base = path.join(nm, top);
      let st;
      try { st = statSync(base); } catch { continue; }
      if (!st.isDirectory()) continue;
      const holders = top.startsWith('@') ? readdirSync(base).map((s) => path.join(base, s)) : [base];
      for (const h of holders) {
        const f = path.join(h, 'node_modules', 'three', 'package.json');
        if (isThree(f)) copies.push(f);
      }
    }
    expect(copies.length, `three copies found:\n${copies.join('\n')}`).toBe(1);
    expect(insideProject(copies[0]!)).toBe(true);

    const lock = readJson<{ packages?: Record<string, unknown> }>(path.join(ROOT, 'package-lock.json'));
    const lockCopies = Object.keys(lock.packages ?? {}).filter((k) => k === 'node_modules/three' || k.endsWith('/node_modules/three'));
    expect(lockCopies, `package-lock.json three entries: ${lockCopies.join(', ')}`).toEqual(['node_modules/three']);
  });

  it('installed versions and package.json specifiers equal the pinned table of PLAN.md', () => {
    const pins = pinnedFromPlan();
    for (const must of ['three', '@types/three', 'postprocessing', 'n8ao', 'gsap', 'vite', 'typescript', 'vitest', '@playwright/test']) {
      expect(pins.has(must), `PLAN.md pins ${must}`).toBe(true);
    }
    const pkgJson = readJson<PackageJson>(path.join(ROOT, 'package.json'));
    const declared = { ...(pkgJson.dependencies ?? {}), ...(pkgJson.devDependencies ?? {}) };
    const problems: string[] = [];
    for (const [name, version] of pins) {
      // "24" (major only, @types/node) matches 24.x; everything else is an exact version.
      const exact = version.split('.').length >= 3;
      const matches = (actual: string): boolean => (exact ? actual === version : actual === version || actual.startsWith(`${version}.`));
      const spec = declared[name];
      if (spec === undefined) problems.push(`${name}: pinned in PLAN.md (${version}) but missing from package.json`);
      else if (!matches(spec.replace(/^[\^~]/, '')) || /^[\^~]/.test(spec)) problems.push(`${name}: package.json says "${spec}", PLAN.md pins ${version} (exact, no ^ or ~)`);
      const file = resolvePackageJson(name);
      if (!file) problems.push(`${name}: not installed`);
      else {
        const installed = readJson<PackageJson>(file).version ?? '?';
        if (!matches(installed)) problems.push(`${name}: installed ${installed}, PLAN.md pins ${version}`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('the parent-directory leak is not used: nothing the game imports comes from outside the project', () => {
    // The parent node_modules is known to hold framer-motion/tslib (PLAN). The game must not import them.
    const pkgJson = readJson<PackageJson>(path.join(ROOT, 'package.json'));
    const declared = new Set([...Object.keys(pkgJson.dependencies ?? {}), ...Object.keys(pkgJson.devDependencies ?? {})]);
    expect(declared.has('framer-motion')).toBe(false);
    expect(declared.has('tslib')).toBe(false);
  });
});
