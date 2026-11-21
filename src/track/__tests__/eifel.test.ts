// Eifel Forest Ring acceptance (docs/design/tracks-eifel.md §12): U-TR-01…12 through the shared suite (with the long
// track's own build budget), plus the narrow ring, the banked bowl, the vertical-curvature envelope (no launches, no
// hard bottoming), the clearances between neighbouring sections and the lazily built raw track.
import { describe, expect, it } from 'vitest';
import { eifelCorners, eifelPath } from '../authoring/eifel-ctrl';
import { EIFEL, RING_FROM } from '../authoring/eifel';
import { getTrackExtras } from '../build/extras';
import { loadTrack } from '../index';
import { trackSuite } from './trackSuite';

const SEQ = eifelCorners().map((a) => (a.turn > 0 ? 'L' : 'R')).join(' ');

trackSuite('eifel', {
  length: [19_000, 21_000],
  sequence: SEQ,
  minRadius: 22,
  minTurn: 10,
  heading: -360,
  pitLength: [800, 920],
  elevationRange: [270, 330],
  maxGrade: 0.15,
  attribution: /HAIRPIN GP/,
  buildMs: 400,
});

describe('eifel specifics', () => {
  const { data, query: q } = loadTrack('eifel');
  const ex = getTrackExtras(data)!;

  it('has 70+ numbered corners and the authored path closes on itself', () => {
    expect(data.corners.length).toBeGreaterThanOrEqual(70);
    const p = eifelPath();
    const last = p.pts[p.pts.length - 1]!;
    expect(Math.hypot(last[0], last[1])).toBeLessThan(1.5);
  });

  it('the ring is a narrow road (8–11 m) and the GP loop a full-width circuit', () => {
    const ring0 = RING_FROM * ex.sScale + 200;
    let lo = Infinity, hi = 0;
    for (let s = ring0; s < data.length - 2600; s += 5) {
      const i = Math.floor(s);
      const w = data.halfWidthL[i]! + data.halfWidthR[i]!;
      lo = Math.min(lo, w);
      hi = Math.max(hi, w);
    }
    expect(lo).toBeGreaterThanOrEqual(8);
    expect(hi).toBeLessThanOrEqual(11.2);
    expect(data.halfWidthL[300]! * 2).toBeGreaterThanOrEqual(14);
  });

  it('the bowl is banked into the corner (left turn: right edge higher)', () => {
    const bowl = EIFEL.CORNERS.find((c) => c.bankDeg > 10)!;
    const s = ((bowl.entry + bowl.exit) / 2) * ex.sScale;
    const f = q.frameAt(s, {} as Parameters<typeof q.frameAt>[1]);
    expect(bowl.dir).toBe('L');
    expect(-f.crossSlope).toBeGreaterThan(Math.tan((12 * Math.PI) / 180));
  });

  it('vertical curvature stays within the build envelope (crest R ≥ 650 m, compression R ≥ 380 m) and is used', () => {
    let crest = 0, sag = 0;
    for (let i = 0; i < data.count; i++) {
      crest = Math.min(crest, data.vCurvature[i]!);
      sag = Math.max(sag, data.vCurvature[i]!);
    }
    expect(crest).toBeGreaterThan(-1 / 650);
    expect(sag).toBeLessThan(1 / 380);
    // Real crests and a real compression exist (the track is not flattened out).
    expect(crest).toBeLessThan(-1 / 1400);
    expect(sag).toBeGreaterThan(1 / 800);
  });

  it('walls stay ≤ 9 m from the edge on the ring (country-road feel)', () => {
    const ring0 = RING_FROM * ex.sScale + 300;
    let n = 0, far = 0;
    for (let s = ring0; s < data.length - 2800; s += 4) {
      const i = Math.floor(s);
      n++;
      if (data.wallL[i]! - data.halfWidthL[i]! > 9 || data.wallR[i]! - data.halfWidthR[i]! > 9) far++;
    }
    expect(far / n).toBeLessThan(0.05);
  });
});
