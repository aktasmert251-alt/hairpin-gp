// Volcano Rim acceptance (docs/design/tracks-volcano.md): U-TR-01…12 through the shared suite, plus the signatures:
// the two fall zones (no barrier, lip line at hw + 2.5, the ground drops beyond it), ash on the rim ('ash' surface
// inside the limits only), the bridge deck high over the lava river and the crests that lighten but never launch.
import { expect, it } from 'vitest';
import type { GroundHit, TrackHint } from '../../contracts/track';
import { volcanoSites, riverNear } from '../authoring/volcano-ctrl';
import { VOLC_BRIDGE } from '../authoring/volcano';
import { getTrackExtras } from '../build/extras';
import { loadTrack } from '../index';
import { trackSuite } from './trackSuite';

trackSuite('volcano', {
  length: [5400, 5900],
  sequence: 'R L R L R L R L R L R R L R R L R L R L R',
  minRadius: 20,
  minTurn: 15,
  heading: -360,
  pitLength: [450, 750],
  elevationRange: [150, 185],
  maxGrade: 0.13,
  attribution: /HAIRPIN GP/,
});

const hit = (): GroundHit => ({ y: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt', ribbon: 'main', s: 0, d: 0, sp: NaN, inLimits: true, wetLocal: 1 });

it('volcano fall zones: no barrier piece over them, lip line at hw + 2.5 m, the ground falls ≥ 8 m within 5 m of the lip', () => {
  const { data, query: q } = loadTrack('volcano');
  const ex = getTrackExtras(data)!;
  expect(ex.falls).toHaveLength(2);
  const p = { x: 0, y: 0, z: 0 };
  for (const f of ex.falls) {
    const mid = (f.from + f.to) / 2;
    const i = Math.round(mid);
    const hw = f.side > 0 ? data.halfWidthL[i]! : data.halfWidthR[i]!;
    const wall = f.side > 0 ? data.wallL[i]! : data.wallR[i]!;
    expect(wall - hw).toBeCloseTo(2.5, 1);
    // No wall segment within 6 m of the lip line at the zone's middle.
    q.worldFromSD(mid, f.side * wall, p);
    const hits = Array.from({ length: 8 }, () => ({ nx: 0, nz: 0, px: 0, pz: 0, dist: 0, wallId: 0, kind: 'concrete' as const }));
    expect(q.wallsNear(p.x, p.z, 6, hits, 8)).toBe(0);
    const h: TrackHint = { s: mid, ribbon: 'main', sp: NaN };
    q.worldFromSD(mid, f.side * (wall - 2), p);
    const yIn = q.ground(p.x, p.z, h, hit()).y;
    q.worldFromSD(mid, f.side * (wall + 5), p);
    const yOut = q.ground(p.x, p.z, h, hit()).y;
    expect(yIn - yOut).toBeGreaterThan(8);
  }
});

it('volcano ash: inside the limits only, on every ASH range', () => {
  const { data, query: q } = loadTrack('volcano');
  const ex = getTrackExtras(data)!;
  const p = { x: 0, y: 0, z: 0 };
  for (const a of ex.ash) {
    const s = (a.from + a.to) / 2;
    const h: TrackHint = { s, ribbon: 'main', sp: NaN };
    q.worldFromSD(s, 1, p);
    expect(q.ground(p.x, p.z, h, hit()).surface).toBe('ash');
    q.worldFromSD(s, data.halfWidthL[Math.round(s)]! + 1.5, p);
    expect(q.ground(p.x, p.z, h, hit()).surface).not.toBe('ash');
  }
  expect(q.surfaceProps('ash').mu).toBeCloseTo(0.85, 2);
});

it('volcano bridge: the deck stands ≥ 18 m over the lava river', () => {
  const { data } = loadTrack('volcano');
  const ex = getTrackExtras(data)!;
  let best = Infinity, deck = 0, lava = 0;
  for (let s = VOLC_BRIDGE.from * ex.sScale; s < VOLC_BRIDGE.to * ex.sScale; s += 2) {
    const i = Math.round(s);
    const r = riverNear((data.x[i]! / ex.reg.k) + ex.reg.cx, (data.z[i]! / ex.reg.k) + ex.reg.cz);
    if (r.d < best) { best = r.d; deck = data.y[i]!; lava = r.y; }
  }
  console.log(`volcano bridge: river ${best.toFixed(1)} m from the centreline, deck ${deck.toFixed(1)} m, lava ${lava.toFixed(1)} m`);
  expect(best).toBeLessThan(25);
  expect(deck - lava).toBeGreaterThan(18);
  expect(volcanoSites().crater.lake).toBeGreaterThan(100);
});
