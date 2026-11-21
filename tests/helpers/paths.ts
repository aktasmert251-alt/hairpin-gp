// Shared paths and file discovery for tests (Node side only: used by Vitest and Playwright specs).

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SRC = path.join(ROOT, 'src');
export const SCREENS_DIR = path.join(ROOT, 'test-results', 'screens');
export const PERF_DIR = path.join(ROOT, 'test-results', 'perf');

/** Dev server port of the Tester (TEAM-RULES §3). */
export const TEST_PORT = 5177;

/** Recursively lists files under `dir` (absolute paths, forward slashes), skipping `node_modules`. */
export function walkFiles(dir: string, accept: (file: string) => boolean = () => true): string[] {
  const out: string[] = [];
  const visit = (d: string): void => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    names.sort();
    for (const name of names) {
      if (name === 'node_modules' || name === '.git') continue;
      const full = path.join(d, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) visit(full);
      else {
        const normal = full.split(path.sep).join('/');
        if (accept(normal)) out.push(normal);
      }
    }
  };
  visit(dir);
  return out;
}

/** Project-relative path with forward slashes. */
export function rel(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

export interface SceneFile { id: string; file: string }

/**
 * Sandbox scene ids exactly as src/sandbox/router.ts discovers them (`/src/**\/sandbox/*.scene.ts`; id = file stem).
 * Hand-off H5: scenes appear here as soon as their files exist.
 */
export function listSceneFiles(): SceneFile[] {
  const files = walkFiles(SRC, (f) => /\/sandbox\/[^/]+\.scene\.ts$/.test(f));
  const scenes = files.map((file) => ({ id: /\/([^/]+)\.scene\.ts$/.exec(file)![1]!, file: rel(file) }));
  return scenes.sort((a, b) => a.id.localeCompare(b.id));
}

export function listSceneIds(): string[] {
  return listSceneFiles().map((s) => s.id);
}
