// Proves that every architecture rule detects a synthetic violation and accepts the compliant form (so a green S-AR-01 means something).

import { describe, expect, it } from 'vitest';
import {
  ruleContractImports, ruleContractsNoRuntime, ruleContractsTypeImportsOnly, ruleCrossModuleIndex, rulePackageHomes, ruleNoShadowInterfaces,
  ruleSimImports, ruleSimTokens, virtualFile,
} from '../archRules';

const contracts = [
  virtualFile('contracts/common.ts', 'export interface Vec3 { x: number }\nexport type Lang = "tr" | "en";\n'),
  virtualFile('contracts/sim.ts', 'export const SIM_HZ = 240;\nexport const SIM_DT = 1 / 240;\nexport interface SimState { tick: number }\n'),
];

describe('archRules: rule 1 (sim imports)', () => {
  it('flags three, gsap and presentation/glue folders; accepts contracts and sim siblings', () => {
    const v = ruleSimImports([
      virtualFile('physics/a.ts', "import * as THREE from 'three';\nimport { gsap } from 'gsap';\nimport { x } from '../graphics/index';\nimport { y } from '../core/loop';\n"),
      virtualFile('physics/b.ts', "import type { Vec3 } from '../contracts/common';\nimport { z } from '../core/rng';\nimport { q } from '../ai/index';\n"),
      virtualFile('physics/sandbox/p.scene.ts', "import * as THREE from 'three';\nimport GUI from 'lil-gui';\n"),
    ]);
    expect(v).toHaveLength(4);
    expect(v.join('\n')).toMatch(/physics\/a\.ts:1.*"three"/);
    expect(v.join('\n')).toMatch(/physics\/a\.ts:2.*"gsap"/);
    expect(v.join('\n')).toMatch(/physics\/a\.ts:3.*presentation/);
    expect(v.join('\n')).toMatch(/physics\/a\.ts:4.*glue/);
  });

  it('honours documented exceptions', () => {
    const f = virtualFile('track/stub/environment.ts', "import * as THREE from 'three';\n");
    expect(ruleSimImports([f])).toHaveLength(1);
    expect(ruleSimImports([f], new Map([['track/stub/environment.ts', 'documented']]))).toEqual([]);
  });
});

describe('archRules: rule 2 (forbidden tokens)', () => {
  it('flags each token in code but not in comments; ignores sandbox and test files', () => {
    const body = 'const a = Math.random();\nconst b = Date.now();\nconst c = performance.now();\nwindow.x = 1;\ndocument.body;\nlocalStorage.getItem("k");\nrequestAnimationFrame(f);\n// Math.random() in a comment is fine\n';
    const v = ruleSimTokens([
      virtualFile('ai/x.ts', body),
      virtualFile('ai/sandbox/y.scene.ts', body),
      virtualFile('ai/__tests__/z.test.ts', body),
    ]);
    expect(v).toHaveLength(7);
    expect(v.every((l) => l.startsWith('src/ai/x.ts'))).toBe(true);
  });
});

describe('archRules: rule 3 (gsap and lil-gui homes)', () => {
  it('allows gsap in ui/trailer and lil-gui in sandbox only', () => {
    const v = rulePackageHomes([
      virtualFile('ui/a.ts', "import { gsap } from 'gsap';"),
      virtualFile('trailer/a.ts', "import { gsap } from 'gsap';"),
      virtualFile('graphics/a.ts', "import { gsap } from 'gsap';"),
      virtualFile('graphics/sandbox/a.scene.ts', "import GUI from 'lil-gui';"),
      virtualFile('graphics/b.ts', "import GUI from 'lil-gui';"),
    ]);
    expect(v).toHaveLength(2);
    expect(v[0]).toMatch(/graphics\/a\.ts.*gsap/);
    expect(v[1]).toMatch(/graphics\/b\.ts.*lil-gui/);
  });
});

describe('archRules: rule 4 (contract imports)', () => {
  it('requires `import type` except for frames and sim', () => {
    const v = ruleContractImports([
      ...contracts,
      virtualFile('game/a.ts', "import { SIM_DT } from '../contracts/sim';\nimport { helper } from '../contracts/frames';\nimport type { Vec3 } from '../contracts/common';\n"),
      virtualFile('game/b.ts', "import { Vec3 } from '../contracts/common';\nimport { type Lang } from '../contracts/common';\nexport { x } from '../contracts/common';\n"),
    ]);
    expect(v).toHaveLength(3);
    expect(v.join('\n')).toMatch(/game\/b\.ts:2.*inline `type`/);
  });
});

describe('archRules: rule 5 (shadow interfaces)', () => {
  it('flags local interfaces and object type aliases that reuse a contract name', () => {
    const v = ruleNoShadowInterfaces([
      ...contracts,
      virtualFile('ai/a.ts', 'interface Vec3 { x: number; y: number }\nexport interface SimState { a: 1 }\nexport interface Other { b: 2 }\n'),
      virtualFile('ai/b.ts', "import type { Vec3 } from '../contracts/common';\ntype Local = Vec3;\nexport type SimState = { shadow: true };\n"),
    ]);
    expect(v).toHaveLength(3);
    expect(v.join('\n')).toMatch(/ai\/a\.ts:1.*"Vec3"/);
    expect(v.join('\n')).toMatch(/ai\/a\.ts:2.*"SimState"/);
    expect(v.join('\n')).toMatch(/ai\/b\.ts:3.*"SimState"/);
  });
});

describe('archRules: contracts stay types-only', () => {
  it('flags runtime code and runtime imports inside contracts', () => {
    const files = [
      virtualFile('contracts/common.ts', 'export interface Vec3 { x: number }\n'),
      virtualFile('contracts/sim.ts', 'export const SIM_HZ = 240;\nexport const SIM_DT = 1 / 240;\n'),
      virtualFile('contracts/bad.ts', "import { foo } from './common';\nimport type { Vec3 } from './common';\nexport const LIMIT = 3;\nexport function f() {}\nexport enum E { A }\n"),
    ];
    expect(ruleContractsTypeImportsOnly(files)).toHaveLength(1);
    expect(ruleContractsNoRuntime(files)).toHaveLength(3);
  });
});

describe('archRules: S-AR-06 (cross-module index)', () => {
  it('allows same-owner deep imports, index imports, type imports and shared leaves; flags other deep imports', () => {
    const v = ruleCrossModuleIndex([
      virtualFile('ai/a.ts', "import { t } from '../physics/tyre/wetTable';\nimport { c } from '../track/index';\nimport { r } from '../core/rng';\nimport { s } from '../core/settings/defaults';\n"),
      virtualFile('game/a.ts', "import { t } from '../track/stub/oval';\nimport type { T } from '../graphics/stub/x';\nimport { g } from '../graphics/index';\nimport { r } from '../race/director';\n"),
    ]);
    expect(v).toHaveLength(2);
    expect(v.join('\n')).toMatch(/ai\/a\.ts:4.*core/);
    expect(v.join('\n')).toMatch(/game\/a\.ts:1.*track/);
  });
});
