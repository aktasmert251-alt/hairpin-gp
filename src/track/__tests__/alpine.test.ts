// Alpine Pass acceptance (docs/design/tracks-alpine.md §12): U-TR-01…12 through the shared suite, plus the tunnel.
import { expect, it } from 'vitest';
import { TUNNEL } from '../authoring/alpine-ctrl';
import { getTrackExtras } from '../build/extras';
import { loadTrack } from '../index';
import { trackSuite } from './trackSuite';

trackSuite('alpine', {
  length: [5600, 5700],
  sequence: 'R L R L R R L R L R L R L R R',
  minRadius: 20,
  minTurn: 15,
  heading: -360,
  pitLength: [800, 900],
  elevationRange: [75, 95],
  maxGrade: 0.12,
  attribution: /HAIRPIN GP/,
});

it('alpine tunnel: drivable main ribbon, walls at hw + 1.5 on both sides, no kerbs or run-off', () => {
  const { data, query: q } = loadTrack('alpine');
  const ex = getTrackExtras(data)!;
  const g = { y: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt', ribbon: 'main', s: 0, d: 0, sp: NaN, inLimits: true, wetLocal: 1 } as Parameters<typeof q.ground>[3];
  const p = { x: 0, y: 0, z: 0 };
  const s0 = TUNNEL.from * ex.sScale, s1 = TUNNEL.to * ex.sScale;
  for (let s = s0; s <= s1; s += 2) {
    const i = Math.round(s) % data.count;
    expect(data.wallL[i]! - data.halfWidthL[i]!, `wallL s ${s}`).toBeLessThanOrEqual(2);
    expect(data.wallR[i]! - data.halfWidthR[i]!, `wallR s ${s}`).toBeLessThanOrEqual(2);
    expect(ex.kerbL[i]! + ex.kerbR[i]!).toBe(0);
    for (const d of [-(data.halfWidthR[i]! - 1), 0, data.halfWidthL[i]! - 1]) {
      q.worldFromSD(s, d, p);
      expect(q.ground(p.x, p.z, { s, ribbon: 'main', sp: NaN }, g)).toMatchObject({ ribbon: 'main', inLimits: true, surface: 'asphalt' });
    }
  }
});
