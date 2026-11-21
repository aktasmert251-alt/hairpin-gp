// Static readers for `MODULE_STATUS` (D-016). They read the source text instead of importing the module, so they are safe in
// Playwright specs (no three.js, no import.meta.glob) and never execute module code.
//
// Readiness rules (sprint-1.md §1):
//   track     real  <=>  MODULE_STATUS === 'real'  AND  loadTrack().data.id === 'istanbul'   (second half: tests/helpers/readiness.ts)
//   physics / ai / graphics / audio / ui  real  <=>  own MODULE_STATUS === 'real'

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SRC } from './paths';

export type ModuleName = 'track' | 'physics' | 'ai' | 'audio' | 'graphics' | 'ui';
export const MODULE_NAMES: readonly ModuleName[] = ['track', 'physics', 'ai', 'audio', 'graphics', 'ui'];

/** The literal assigned to `MODULE_STATUS` in `src/<module>/index.ts`, or `'missing'` when it cannot be found. */
export function readModuleStatus(mod: ModuleName): string {
  const file = path.join(SRC, mod, 'index.ts');
  if (!existsSync(file)) return 'missing';
  const text = readFileSync(file, 'utf8');
  const m = /export\s+const\s+MODULE_STATUS\b[^=]*=\s*['"`]([^'"`]+)['"`]/.exec(text);
  return m ? m[1]! : 'missing';
}

export function isStatusReal(mod: ModuleName): boolean {
  return readModuleStatus(mod) === 'real';
}

export function moduleStatusSummary(): Record<ModuleName, string> {
  const out = {} as Record<ModuleName, string>;
  for (const m of MODULE_NAMES) out[m] = readModuleStatus(m);
  return out;
}
