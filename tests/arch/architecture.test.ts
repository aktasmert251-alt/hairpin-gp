// S-AR-01: layer rules of docs/ARCHITECTURE.md §1.2, enforced over every `.ts` file under src/ with a regex import parser.
// The rules themselves live in tests/helpers/archRules.ts (and are proven against synthetic violations in
// tests/helpers/__tests__/archRules.test.ts). Failure messages list `file:line  what`, so the owner can fix them directly.
//
// Documented exceptions (each one must be removed when its reason disappears):
//   * src/track/stub/environment.ts imports `three`. The Sprint 0 stub environment lives in `track/stub/`, which §1.1 classes as
//     sim. Çevre deletes it at hand-off H3 (buildEnvironment moves to src/track/sky|scenery).

import { describe, expect, it } from 'vitest';
import {
  ruleContractImports, ruleContractsNoRuntime, ruleContractsTypeImportsOnly, ruleCrossModuleIndex, contractInterfaceNames, rulePackageHomes,
  ruleNoShadowInterfaces, ruleSimImports, ruleSimTokens, simFilesOf,
} from '../helpers/archRules';
import { loadSourceFiles, resolveRelative } from '../helpers/srcScan';

const files = loadSourceFiles();

const LAYER_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  ['track/stub/environment.ts', 'Sprint 0 stub environment (three) inside the sim-classified track/stub folder; removed at H3'],
]);

function report(rule: string, violations: string[]): void {
  expect(violations, `${rule}\n  ${violations.join('\n  ')}\n`).toEqual([]);
}

describe('S-AR-01 layer imports (ARCHITECTURE §1.2)', () => {
  it('scans a plausible number of files', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(simFilesOf(files, LAYER_EXCEPTIONS).length).toBeGreaterThan(10);
    expect(files.some((f) => f.srcPath === 'contracts/sim.ts')).toBe(true);
  });

  it('rule 1: sim files import neither three/postprocessing/n8ao/gsap/lil-gui nor any presentation/glue folder', () => {
    report('S-AR-01.1: the sim layer must not depend on presentation or glue code.', ruleSimImports(files, LAYER_EXCEPTIONS));
  });

  it('rule 2: sim files contain none of Math.random, Date.now, performance.now, window., document., localStorage (nor requestAnimationFrame)', () => {
    report('S-AR-01.2: sim code reads time only from state.time/state.tick and randomness only from the seeded RNG in SimState.', ruleSimTokens(files, LAYER_EXCEPTIONS));
  });

  it('rule 3: gsap only in src/ui and src/trailer; lil-gui only under **/sandbox/**', () => {
    report('S-AR-01.3: gsap belongs to the UI/trailer, lil-gui to sandbox scenes.', rulePackageHomes(files));
  });

  it('rule 4: contract imports are `import type`, except from frames.ts and sim.ts (constants)', () => {
    report('S-AR-01.4: src/contracts is types only; only frames.ts helpers and the SIM_HZ/SIM_DT constants of sim.ts exist at runtime.', ruleContractImports(files));
  });

  it('rule 5: no file outside src/contracts declares an interface/type named like a contract interface', () => {
    expect(contractInterfaceNames(files).size, 'contract interfaces found').toBeGreaterThan(40);
    report('S-AR-01.5: import the contract instead of declaring a local copy.', ruleNoShadowInterfaces(files));
  });
});

describe('S-AR-01b contracts stay types-only', () => {
  it('contract files only `import type` (frames.ts and sim.ts may also import constants from each other)', () => {
    report('Contracts import types only (ARCHITECTURE §1.1).', ruleContractsTypeImportsOnly(files));
  });

  it('only frames.ts and the two sim constants contain runtime declarations', () => {
    report('src/contracts may hold runtime code only in frames.ts and SIM_HZ/SIM_DT.', ruleContractsNoRuntime(files));
  });
});

describe('S-AR-06 cross-module imports go through index.ts (ARCHITECTURE §1.1 further rules)', () => {
  it('UI networking imports use the facade, including sandbox scenes', () => {
    const violations = files.filter((f) => f.srcPath.startsWith('ui/')).flatMap((f) => f.imports
      .filter((ref) => !ref.typeOnly)
      .filter((ref) => {
        const target = resolveRelative(f, ref.spec);
        return target?.startsWith('net/') && target !== 'net/index';
      })
      .map((ref) => `${f.path}:${ref.line} ${ref.spec}`));
    report('UI networking imports must use src/net/index.ts.', violations);
  });

  it("no file reaches into another owner's module except through its index", () => {
    report("S-AR-06: import other owners' modules through their index.ts (shared leaves core/math, core/rng, data/* and type-only imports excepted; sandbox scenes and unit tests exempt).", ruleCrossModuleIndex(files));
  });
});
