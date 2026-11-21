// Terrain never covers a driving surface (regression: the Ardennes paddock pad over the T1 descent, the İstanbul pit
// exit and the Ardennes pit-exit hairpin, where grass rose up to 2.7 m over the asphalt / concrete). The terrain mesh
// is a 10 m grid (terrain.ts INNER) sunk 0.35 m where the ground is covered; this reproduces its triangles exactly and
// samples the main road (out to 3 m past the edges: kerbs, shoulders) and the whole pit lane every 1 m.

import { describe, expect, it } from 'vitest';
import type { BuiltTrackId } from '../authoring/types';
import { getTrackExtras } from '../build/extras';
import { loadRaceTrack } from '../registry';
import { createGroundHeight } from '../terrain/height';

const STEP = 10;
const SINK = 0.35;
const TOL = 0.05;

function meshHeight(id: BuiltTrackId): (x: number, z: number) => number {
  const t = loadRaceTrack(id);
  const g = createGroundHeight(t, getTrackExtras(t.data)!);
  const info: { s: number; d: number; covered: boolean; nearTrack: number; below?: number } = { s: 0, d: 0, covered: false, nearTrack: 0 };
  const cache = new Map<number, number>();
  const V = (i: number, j: number): number => {
    const k = i * 100003 + j;
    let v = cache.get(k);
    if (v === undefined) {
      const y = g.height(i * STEP, j * STEP, info);
      v = info.covered && Number.isFinite(info.below) ? info.below! - SINK : y - (info.covered ? SINK : 0);
      cache.set(k, v);
    }
    return v;
  };
  return (x, z) => {
    const i = Math.floor(x / STEP), j = Math.floor(z / STEP);
    const fu = x / STEP - i, fv = z / STEP - j;
    const a = V(i, j), b = V(i + 1, j), c = V(i, j + 1), e = V(i + 1, j + 1);
    // Same diagonal choice as terrain.ts gridGeometry (grid origins are multiples of STEP).
    if ((i + j) & 1) return fu + fv < 1 ? a + (b - a) * fu + (c - a) * fv : e + (c - e) * (1 - fu) + (b - e) * (1 - fv);
    return fu > fv ? a + (b - a) * fu + (e - b) * fv : a + (c - a) * fv + (e - c) * fu;
  };
}

describe('terrain stays below the driving surfaces', () => {
  for (const id of ['istanbul', 'lombardia', 'bosphorus', 'ardennes', 'alpine', 'cliff', 'eifel', 'aegean', 'cappadocia', 'volcano'] as const) {
    it(`${id}: main road (+3 m) and pit lane`, () => {
      const t = loadRaceTrack(id);
      const { data, query: q } = t;
      const h = meshHeight(id);
      const P = { x: 0, y: 0, z: 0 };
      const hint = { s: 0, ribbon: 'main' as const, sp: NaN };
      const g = { y: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt', ribbon: 'main', s: 0, d: 0, sp: NaN, inLimits: true, wetLocal: 1 } as Parameters<typeof q.ground>[3];
      let worstMain = 0, worstPit = 0, at = '';
      for (let s = 0; s < data.count; s++) {
        // Out to 3 m past the edges, but not past the surface bands (they end 1 m before the barrier).
        const dR = Math.min(data.halfWidthR[s]! + 3, Math.max(data.halfWidthR[s]!, data.wallR[s]! - 1));
        const dL = Math.min(data.halfWidthL[s]! + 3, Math.max(data.halfWidthL[s]!, data.wallL[s]! - 1));
        for (let d = -dR; d <= dL; d += 1) {
          q.worldFromSD(s, d, P);
          // The surface actually driven on there (the pit ribbon where the lane runs inside the +3 m band).
          hint.s = s;
          const ex = h(P.x, P.z) - q.ground(P.x, P.z, hint, g).y;
          if (ex > worstMain) { worstMain = ex; at = `main s ${s} d ${d.toFixed(1)}`; }
        }
      }
      const pit = data.pit;
      const dsp = pit.length / (pit.count - 1);
      for (let sp = 0; sp <= pit.length; sp += 1) {
        const j = Math.min(pit.count - 1, Math.round(sp / dsp));
        for (let d = -pit.halfWidth[j]!; d <= pit.halfWidth[j]!; d += 1) {
          q.pitWorldFromSD(sp, d, P);
          const ex = h(P.x, P.z) - pit.y[j]!;
          if (ex > worstPit) { worstPit = ex; at = `pit sp ${sp} d ${d.toFixed(1)}`; }
        }
      }
      expect(worstMain, at).toBeLessThan(TOL);
      expect(worstPit, at).toBeLessThan(TOL);
    }, 300_000);
  }
});
