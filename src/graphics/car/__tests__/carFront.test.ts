import { describe, expect, it } from 'vitest';
import { buildFront, frontNoseRows } from '../carFront';
import { buildWheels, COVER_R, RIM_PART } from '../wheels';
import { CONCEPT_IDS, DETAIL, type Part, partCtx } from '../carParts';

const tris = (parts: Part[]): number => parts.reduce((s, p) => s + (p.g.index ? p.g.index.count : p.g.getAttribute('position').count) / 3, 0);

describe('car front (nose rows, front wing, endplates, deflectors)', () => {
  for (const c of CONCEPT_IDS) {
    it(`${c}: triangle budget 8k / 1.2k / 250, inside the car envelope, finite`, () => {
      const budget = [8000, 1200, 250] as const;
      for (const lod of [0, 1, 2] as const) {
        const parts: Part[] = [];
        buildFront(partCtx(DETAIL[lod], c, parts));
        const n = tris(parts);
        if (process.env['FRONT_TRIS']) console.log(c, lod, n);
        expect(n).toBeLessThanOrEqual(budget[lod]);
        for (const p of parts) {
          const a = p.g.getAttribute('position');
          for (let i = 0; i < a.count; i++) {
            expect(Number.isFinite(a.getX(i) + a.getY(i) + a.getZ(i))).toBe(true);
            expect(Math.abs(a.getX(i))).toBeLessThanOrEqual(1.0);
            expect(a.getY(i)).toBeGreaterThanOrEqual(0.025);
            expect(a.getZ(i)).toBeLessThan(3.16);
          }
        }
      }
    });
    it(`${c}: nose rows run from the tip back towards the monocoque (z > 2.0, descending)`, () => {
      const rows = frontNoseRows(c);
      for (let i = 1; i < rows.length; i++) expect(rows[i]![0]!).toBeLessThan(rows[i - 1]![0]!);
      expect(rows[rows.length - 1]![0]!).toBeGreaterThan(2.0);
      expect(rows[0]![0]!).toBeLessThan(3.16);
    });
  }
  it('rims are closed aero covers (no spokes): cover part spans the rim face, LOD0 wheel ≤ 5k tris', () => {
    for (const lod of [0, 1, 2] as const) {
      const w = buildWheels(lod);
      const part = w.rim.getAttribute('aPart');
      const pos = w.rim.getAttribute('position');
      let maxR = 0;
      const ids = new Set<number>();
      for (let i = 0; i < part.count; i++) {
        ids.add(part.getX(i));
        if (part.getX(i) === RIM_PART.cover) maxR = Math.max(maxR, Math.hypot(pos.getY(i), pos.getZ(i)));
      }
      expect(ids.has(RIM_PART.cover)).toBe(true);
      expect([...ids].every((id) => (Object.values(RIM_PART) as number[]).includes(id))).toBe(true);
      expect(maxR).toBeCloseTo(COVER_R, 3);
    }
    const w0 = buildWheels(0);
    const t = (g: typeof w0.rim): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    expect(t(w0.tyre) + t(w0.rim) + t(w0.hub)).toBeLessThanOrEqual(5000);
  });
});
