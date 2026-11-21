// STUB (Sprint 0, Yönetici): replaced by Çevre in Sprint 1
import { describe, expect, it } from 'vitest';
import type { GroundHit, TrackFrame, TrackHint, WallHit } from '../../../contracts/track';
import { createOvalTrack, OVAL_LENGTH, OVAL_RADIUS } from '../oval';
import { createStraightTrack } from '../straight';

const frame = (): TrackFrame => ({ s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 });
const hit = (): GroundHit => ({ y: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt', ribbon: 'main', s: 0, d: 0, sp: NaN, inLimits: true, wetLocal: 1 });

describe('placeholder oval TrackQuery', () => {
  const { data, query: q } = createOvalTrack();

  it('has the documented shape', () => {
    expect(q.length).toBe(OVAL_LENGTH);
    expect(OVAL_RADIUS).toBeCloseTo(95.0155, 3);
    expect(data.count).toBe(1397);
    expect(data.ds).toBe(1);
    expect(data.grid).toHaveLength(20);
    expect(data.sectors[0]).toBeCloseTo(OVAL_LENGTH / 3, 9);
    expect(data.drsZones).toHaveLength(1);
    expect(data.pit.count).toBe(0);
    // Closed loop: the last sample is 1 m from the first.
    const n = data.count - 1;
    expect(Math.hypot(data.x[n]! - data.x[0]!, data.z[n]! - data.z[0]!)).toBeCloseTo(1, 4);
  });

  it('round-trips worldFromSD -> project with < 2 cm error', () => {
    const p = { x: 0, y: 0, z: 0 };
    const out = { s: 0, d: 0 };
    const hint: TrackHint = { s: 0, ribbon: 'main', sp: NaN };
    let worst = 0;
    for (let s = 0; s < OVAL_LENGTH; s += 3.7) {
      for (let d = -17; d <= 17; d += 1.7) {
        q.worldFromSD(s, d, p);
        q.project(p.x, p.z, hint, out);
        const ds = Math.abs(q.deltaS(s, out.s));
        worst = Math.max(worst, ds, Math.abs(out.d - d));
      }
    }
    expect(worst).toBeLessThan(0.02);
  });

  it('gives a continuous frame with +left curvature on the anti-clockwise bends', () => {
    const a = frame();
    const b = frame();
    for (let s = 0; s < OVAL_LENGTH; s += 0.5) {
      q.frameAt(s, a);
      q.frameAt(s + 0.5, b);
      expect(Math.hypot(b.px - a.px, b.pz - a.pz)).toBeCloseTo(0.5, 3);
      expect(Math.hypot(a.tx, a.tz)).toBeCloseTo(1, 9);
      expect(a.tx * a.lx + a.tz * a.lz).toBeCloseTo(0, 9);
    }
    expect(q.frameAt(300, a).curvature).toBeCloseTo(1 / OVAL_RADIUS, 9);
    expect(q.frameAt(100, a).curvature).toBe(0);
    expect(q.frameAt(0, a).sector).toBe(0);
    expect(q.sectorAt(OVAL_LENGTH * 0.5)).toBe(1);
    expect(q.sectorAt(OVAL_LENGTH - 1)).toBe(2);
  });

  it('wraps s and gives the shortest signed difference', () => {
    expect(q.wrapS(-10)).toBeCloseTo(OVAL_LENGTH - 10, 9);
    expect(q.wrapS(OVAL_LENGTH + 5)).toBeCloseTo(5, 9);
    expect(q.deltaS(OVAL_LENGTH - 10, 10)).toBeCloseTo(20, 9);
    expect(q.deltaS(10, OVAL_LENGTH - 10)).toBeCloseTo(-20, 9);
  });

  it('reports surfaces, limits and walls', () => {
    const p = { x: 0, y: 0, z: 0 };
    const hint: TrackHint = { s: 0, ribbon: 'main', sp: NaN };
    const h = hit();
    q.worldFromSD(600, 0, p);
    expect(q.ground(p.x, p.z, hint, h)).toMatchObject({ surface: 'asphalt', inLimits: true, y: 0 });
    expect(hint.s).toBeCloseTo(600, 6);
    q.worldFromSD(600, 6.95, p);
    expect(q.ground(p.x, p.z, hint, h)).toMatchObject({ surface: 'line', inLimits: true });
    q.worldFromSD(600, -9, p);
    expect(q.ground(p.x, p.z, hint, h)).toMatchObject({ surface: 'grass', inLimits: false });
    expect(q.surfaceProps('gravel').dragDecel).toBeCloseTo(0.25 * 9.81, 6);

    const walls: WallHit[] = [];
    q.worldFromSD(350, 16, p);
    const n = q.wallsNear(p.x, p.z, 4, walls, 4);
    expect(n).toBe(1);
    expect(walls[0]!.dist).toBeCloseTo(2, 6);
    // The normal points back to the drivable side (toward -d = right of the driving direction).
    const f = q.frameAt(350, frame());
    expect(walls[0]!.nx * f.lx + walls[0]!.nz * f.lz).toBeCloseTo(-1, 6);
    q.worldFromSD(350, 0, p);
    expect(q.wallsNear(p.x, p.z, 4, walls, 4)).toBe(0);
  });

  it('places every grid slot inside the track limits behind the S/F line', () => {
    for (const g of data.grid) {
      expect(Math.abs(g.d)).toBeLessThan(7 - 1);
      expect(g.s).toBeGreaterThan(OVAL_LENGTH / 2);
    }
  });

  it('answers ground() well under the 1 µs budget order of magnitude', () => {
    const h = hit();
    const hint: TrackHint = { s: 0, ribbon: 'main', sp: NaN };
    const N = 200_000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) q.ground(data.x[i % data.count]!, data.z[i % data.count]!, hint, h);
    const usPerCall = ((performance.now() - t0) * 1000) / N;
    expect(usPerCall).toBeLessThan(5);
  });
});

describe('straight test track', () => {
  it('is an open straight along +X that extrapolates beyond its ends', () => {
    const { data, query: q } = createStraightTrack(3000);
    expect(data.id).toBe('straight');
    const out = { s: 0, d: 0 };
    const hint: TrackHint = { s: 0, ribbon: 'main', sp: NaN };
    q.project(1234.5, -3, hint, out);
    expect(out.s).toBeCloseTo(1234.5, 9);
    expect(out.d).toBeCloseTo(3, 9);
    q.project(3100, 0, hint, out);
    expect(out.s).toBeCloseTo(3100, 9);
    q.project(-20, 0, hint, out);
    expect(out.s).toBeCloseTo(-20, 9);
  });
});
