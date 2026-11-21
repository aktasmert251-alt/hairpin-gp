import { describe, expect, it } from 'vitest';
import { layerOf, packageOf, parseImports, stripComments } from '../srcScan';

describe('srcScan.stripComments', () => {
  it('removes line and block comments but keeps strings, templates and regex literals', () => {
    const src = [
      "const a = 'http://example.com'; // Math.random()",
      '/* window.foo\n document.bar */ const b = "x // y";',
      'const c = `tpl ${1 + 2} // not a comment`;',
      "const re = /['\"]\\/\\//g; const d = 1; // trailing",
    ].join('\n');
    const out = stripComments(src);
    expect(out).toContain("'http://example.com'");
    expect(out).not.toContain('Math.random');
    expect(out).not.toContain('window.foo');
    expect(out).toContain('"x // y"');
    expect(out).toContain('// not a comment');
    expect(out).toContain("const d = 1;");
    expect(out.split('\n')).toHaveLength(src.split('\n').length);
  });
});

describe('srcScan.parseImports', () => {
  const parse = (s: string) => parseImports(stripComments(s));

  it('finds static, type-only, inline-type, re-export, side-effect and dynamic imports', () => {
    const refs = parse([
      "import { a } from '../a';",
      "import type { B } from '../b';",
      "import { type C, type D } from '../c';",
      "import E, { F } from 'three';",
      "import * as G from 'gsap';",
      "export { h } from './h';",
      "export type { I } from './i';",
      "export * from './j';",
      "import './side';",
      "const m = await import('./dyn');",
      "import {",
      "  K,",
      "  L,",
      "} from '../multi';",
    ].join('\n'));
    const bySpec = new Map(refs.map((r) => [r.spec, r]));
    expect(refs.map((r) => r.spec).sort()).toEqual(['../a', '../b', '../c', '../multi', './dyn', './h', './i', './j', './side', 'gsap', 'three']);
    expect(bySpec.get('../a')!.typeOnly).toBe(false);
    expect(bySpec.get('../b')!.typeOnly).toBe(true);
    expect(bySpec.get('../c')!.inlineTypesOnly).toBe(true);
    expect(bySpec.get('three')!.kind).toBe('import');
    expect(bySpec.get('./h')!.kind).toBe('export-from');
    expect(bySpec.get('./i')!.typeOnly).toBe(true);
    expect(bySpec.get('./side')!.kind).toBe('side-effect');
    expect(bySpec.get('./dyn')!.kind).toBe('dynamic');
    expect(bySpec.get('../multi')!.line).toBe(11);
  });

  it('does not mistake exports without `from`, or text inside comments, for imports', () => {
    const refs = parse("// import x from 'nope'\nexport const a = 1;\nexport function f() {\n  return 2;\n}\nexport { a as b };\n");
    expect(refs).toEqual([]);
  });
});

describe('srcScan layers', () => {
  it('classifies the folders of ARCHITECTURE §1.1', () => {
    expect(layerOf('contracts/sim.ts')).toBe('contracts');
    expect(layerOf('physics/vehicle/x.ts')).toBe('sim');
    expect(layerOf('ai/index.ts')).toBe('sim');
    expect(layerOf('race/director.ts')).toBe('sim');
    expect(layerOf('game/sim/teleport.ts')).toBe('sim');
    expect(layerOf('game/createSim.ts')).toBe('glue');
    expect(layerOf('track/query/trackQuery.ts')).toBe('sim');
    expect(layerOf('track/stub/oval.ts')).toBe('sim');
    expect(layerOf('track/mesh/ribbon.ts')).toBe('presentation');
    expect(layerOf('track/index.ts')).toBe('neutral');
    expect(layerOf('core/math/vec3.ts')).toBe('sim');
    expect(layerOf('core/rng.ts')).toBe('sim');
    expect(layerOf('core/loop.ts')).toBe('glue');
    expect(layerOf('data/teams.ts')).toBe('sim');
    expect(layerOf('graphics/index.ts')).toBe('presentation');
    expect(layerOf('ui/stub/ui.ts')).toBe('presentation');
    expect(layerOf('main.ts')).toBe('glue');
  });

  it('extracts package names from specifiers', () => {
    expect(packageOf('three/examples/jsm/environments/RoomEnvironment.js')).toBe('three');
    expect(packageOf('@scope/pkg/deep')).toBe('@scope/pkg');
    expect(packageOf('./x')).toBeNull();
    expect(packageOf('node:fs')).toBeNull();
  });
});
