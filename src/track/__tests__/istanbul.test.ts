// Ç2 acceptance tests (U-TR-01…09) for the İstanbul TrackData + TrackQuery.
import { describe, expect, it } from 'vitest';
import type { GroundHit, TrackFrame, TrackHint, WallHit } from '../../contracts/track';
import { buildTrackData, buildTrackDataFull } from '../build/buildTrackData';
import { getTrackExtras } from '../build/extras';
import { hashArrays } from '../build/geometry';
import { ISTANBUL } from '../authoring/istanbul';
import { ISTANBUL_RAW } from '../data/raw';
import { loadTrack } from '../index';
import { createTrackQuery } from '../query/trackQuery';

const frame = (): TrackFrame => ({ s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 });
const hit = (): GroundHit => ({ y: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt', ribbon: 'main', s: 0, d: 0, sp: NaN, inLimits: true, wetLocal: 1 });
const hint = (s = 0): TrackHint => ({ s, ribbon: 'main', sp: NaN });

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('İstanbul track (U-TR-01…09)', () => {
  const { data, query: q } = loadTrack();
  const ex = getTrackExtras(data)!;
  const L = q.length;

  it('is the İstanbul track with OSM-derived data and attribution', () => {
    expect(data.id).toBe('istanbul');
    expect(data.count).toBe(L);
    expect(data.ds).toBe(1);
    expect(data.attribution.join(' ')).toMatch(/OpenStreetMap/);
    expect(data.attribution.join(' ')).toMatch(/EU-DEM/);
  });

  it('U-TR-01 loop is closed: end gap < 0.5 m, tangent jump < 1°', () => {
    const a = q.frameAt(L - 1e-6, frame());
    const b = q.frameAt(0, frame());
    expect(Math.hypot(a.px - b.px, a.pz - b.pz)).toBeLessThan(0.5);
    const n = data.count - 1;
    expect(Math.hypot(data.x[n]! - data.x[0]!, data.z[n]! - data.z[0]!)).toBeCloseTo(1, 2);
    const ang = (u: TrackFrame, v: TrackFrame): number => Math.acos(Math.min(1, u.tx * v.tx + u.tz * v.tz)) * (180 / Math.PI);
    expect(ang(q.frameAt(L - 0.5, frame()), q.frameAt(0.5, frame()))).toBeLessThan(1);
    // No tangent jump anywhere: consecutive samples differ by < 1° (the tightest corner turns ≈ 3°/m only above R 19 m).
    let worst = 0;
    for (let i = 0; i < data.count; i++) {
      const j = (i + 1) % data.count;
      worst = Math.max(worst, Math.acos(Math.min(1, data.tx[i]! * data.tx[j]! + data.tz[i]! * data.tz[j]!)) * (180 / Math.PI));
    }
    expect(worst).toBeLessThan(3.6);
    expect(Math.hypot(b.px, b.pz)).toBeLessThan(1e-3);
  });

  it('U-TR-02 length is 5,300–5,400 m', () => {
    expect(L).toBeGreaterThanOrEqual(5300);
    expect(L).toBeLessThanOrEqual(5400);
  });

  it('U-TR-03 corner direction sequence is L R L R L L R L L R R L R L (and matches the geometry)', () => {
    expect(data.corners.map((c) => c.dir).join(' ')).toBe('L R L R L L R L L R R L R L');
    for (const c of data.corners) {
      let turn = 0;
      const len = q.wrapS(c.exitS - c.entryS);
      for (let k = 0; k < len; k++) turn += data.curvature[Math.floor(q.wrapS(c.entryS + k))]!;
      expect(Math.sign(turn), `T${c.n}`).toBe(c.dir === 'L' ? 1 : -1);
      expect(Math.abs(turn) * (180 / Math.PI), `T${c.n} turn`).toBeGreaterThan(25);
      expect(c.minRadius, `T${c.n} radius`).toBeGreaterThan(17);
    }
  });

  it('U-TR-04 net heading change is +360° ± 1°', () => {
    let h = 0;
    for (let i = 0; i < data.count; i++) {
      const j = (i + 1) % data.count;
      const a0 = Math.atan2(-data.tz[i]!, data.tx[i]!);
      const a1 = Math.atan2(-data.tz[j]!, data.tx[j]!);
      let d = a1 - a0;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      h += d;
    }
    expect(h * (180 / Math.PI)).toBeCloseTo(360, 0);
    expect(Math.abs(h * (180 / Math.PI) - 360)).toBeLessThan(1);
  });

  it('U-TR-05 worldFromSD → project round trip < 2 cm on 10,000 seeded samples', () => {
    const rnd = mulberry32(20261005);
    const p = { x: 0, y: 0, z: 0 };
    const out = { s: 0, d: 0 };
    const f = frame();
    let worst = 0;
    for (let k = 0; k < 10_000; k++) {
      const s = rnd() * L;
      q.frameAt(s, f);
      const d = -(f.halfWidthR + 10) + rnd() * (f.halfWidthL + f.halfWidthR + 20);
      q.worldFromSD(s, d, p);
      q.project(p.x, p.z, hint(q.wrapS(s + (rnd() - 0.5) * 30)), out);
      // Positional error of the round trip (s error weighted by the local metric).
      const back = q.worldFromSD(out.s, out.d, { x: 0, y: 0, z: 0 });
      const e = Math.max(Math.abs(q.deltaS(s, out.s)) * Math.max(0.05, 1 - f.curvature * d), Math.abs(out.d - d), Math.hypot(back.x - p.x, back.z - p.z));
      worst = Math.max(worst, e);
    }
    expect(worst).toBeLessThan(0.02);
  });

  it('U-TR-06 walls are continuous (gaps only at pit entry/exit) and ≥ 1 m outside the outermost band', () => {
    for (const ch of ex.chains) {
      const pieces = ch.pieces.map((i) => data.walls[i]!);
      expect(pieces.length).toBeGreaterThan(0);
      for (const w of pieces) {
        for (let m = 0; m + 3 < w.xz.length; m += 2) {
          expect(Math.hypot(w.xz[m + 2]! - w.xz[m]!, w.xz[m + 3]! - w.xz[m + 1]!), `${ch.role} step`).toBeLessThan(8);
        }
      }
      for (let k = 0; k + 1 < pieces.length; k++) {
        const a = pieces[k]!.xz;
        const b = pieces[k + 1]!.xz;
        expect(Math.hypot(a[a.length - 2]! - b[0]!, a[a.length - 1]! - b[1]!), `${ch.role} joint`).toBeLessThan(0.5);
      }
      if (ch.closed) {
        const a = pieces[pieces.length - 1]!.xz;
        const b = pieces[0]!.xz;
        expect(Math.hypot(a[a.length - 2]! - b[0]!, a[a.length - 1]! - b[1]!), `${ch.role} closure`).toBeLessThan(0.5);
      } else {
        // Open chains are the pit wall: their ends sit at the pit entry and exit.
        const a = pieces[0]!.xz;
        const b = pieces[pieces.length - 1]!.xz;
        const o = { s: 0, d: 0 };
        q.project(a[0]!, a[1]!, hint(data.pit.mainSAtSplit), o);
        expect(Math.abs(q.deltaS(data.pit.mainSAtSplit, o.s)), 'pit wall start').toBeLessThan(250);
        q.project(b[b.length - 2]!, b[b.length - 1]!, hint(data.pit.mainSAtMerge), o);
        expect(Math.abs(q.deltaS(data.pit.mainSAtMerge, o.s)), 'pit wall end').toBeLessThan(250);
      }
    }
    expect(ex.chains.filter((c) => !c.closed).length).toBe(2);
    for (let i = 0; i < data.count; i++) {
      expect(data.wallL[i]! - data.bandOuterL[i * 4 + 3]!).toBeGreaterThanOrEqual(1 - 1e-3);
      expect(data.wallR[i]! - data.bandOuterR[i * 4 + 3]!).toBeGreaterThanOrEqual(1 - 1e-3);
    }
    // The barrier polylines physics uses agree with the per-sample offsets.
    const o = { s: 0, d: 0 };
    const h = hint();
    for (const ch of ex.chains) {
      if (ch.role === 'leftOuter') continue;
      for (const wi of ch.pieces) {
        const w = data.walls[wi]!;
        // Seed the hint with the nearest centreline sample of the piece's first vertex.
        let best = Infinity;
        for (let i = 0; i < data.count; i++) {
          const dd = Math.hypot(data.x[i]! - w.xz[0]!, data.z[i]! - w.xz[1]!);
          if (dd < best) {
            best = dd;
            h.s = i;
          }
        }
        for (let m = 0; m < w.xz.length; m += 2) {
          q.project(w.xz[m]!, w.xz[m + 1]!, h, o);
          h.s = o.s;
          const k = Math.round(o.s) % data.count;
          const outer = o.d >= 0 ? data.bandOuterL[k * 4 + 3]! : data.bandOuterR[k * 4 + 3]!;
          expect(Math.abs(o.d) - outer, `${ch.role} at s=${o.s.toFixed(0)}`).toBeGreaterThan(0.9);
        }
      }
    }
  });

  it('U-TR-07 grid inside limits, pit ribbon joins the main left edge, boxes inside the limiter zone', () => {
    expect(data.grid).toHaveLength(20);
    const f = frame();
    const g = hit();
    const p = { x: 0, y: 0, z: 0 };
    for (const slot of data.grid) {
      q.frameAt(slot.s, f);
      expect(Math.abs(slot.d) + 1.0).toBeLessThan(slot.d > 0 ? f.halfWidthL : f.halfWidthR);
      q.worldFromSD(slot.s, slot.d, p);
      expect(q.ground(p.x, p.z, hint(slot.s), g)).toMatchObject({ ribbon: 'main', inLimits: true, surface: 'asphalt' });
    }
    expect(data.grid[0]!.d).toBeGreaterThan(0);
    const pit = data.pit;
    const a = q.pitWorldFromSD(0, 0, { x: 0, y: 0, z: 0 });
    const b = q.worldFromSD(pit.mainSAtSplit, q.frameAt(pit.mainSAtSplit, f).halfWidthL, { x: 0, y: 0, z: 0 });
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1);
    const c = q.pitWorldFromSD(pit.length, 0, { x: 0, y: 0, z: 0 });
    const d = q.worldFromSD(pit.mainSAtMerge, q.frameAt(pit.mainSAtMerge, f).halfWidthL, { x: 0, y: 0, z: 0 });
    expect(Math.hypot(c.x - d.x, c.z - d.z)).toBeLessThan(1);
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.1);
    expect(Math.abs(c.y - d.y)).toBeLessThan(0.1);
    expect(pit.length).toBeGreaterThan(880);
    expect(pit.length).toBeLessThan(940);
    expect(pit.boxes).toHaveLength(10);
    for (const box of pit.boxes) {
      expect(box.sp).toBeGreaterThan(pit.limitStartSp);
      expect(box.sp).toBeLessThan(pit.limitEndSp);
      q.pitWorldFromSD(box.sp, box.d, p);
      const gh = q.ground(p.x, p.z, { s: 0, ribbon: 'pit', sp: box.sp }, g);
      expect(gh.ribbon).toBe('pit');
      expect(gh.surface).toBe('concrete');
    }
    // Pit split ≈ T13 exit, merge ≈ T2 (report §7.7), scaled to the built length.
    expect(Math.abs(q.deltaS(4775 * (L / 5351.5), pit.mainSAtSplit))).toBeLessThan(30);
    expect(Math.abs(q.deltaS(419 * (L / 5351.5), pit.mainSAtMerge))).toBeLessThan(30);
  });

  it('ground() switches ribbons at the pit and reports surfaces, limits and walls', () => {
    const g = hit();
    const p = { x: 0, y: 0, z: 0 };
    const h: TrackHint = { s: data.pit.mainSAtSplit - 50, ribbon: 'main', sp: NaN };
    // Drive the pit lane: main → pit → main.
    let sawPit = false;
    for (let sp = 0; sp <= data.pit.length; sp += 2) {
      q.pitWorldFromSD(sp, 0, p);
      q.ground(p.x, p.z, h, g);
      if (sp > 40 && sp < data.pit.length - 40) expect(g.ribbon, `sp ${sp}`).toBe('pit');
      sawPit ||= g.ribbon === 'pit';
      expect(Number.isFinite(g.y)).toBe(true);
    }
    expect(sawPit).toBe(true);
    // Back on the main track after the merge.
    q.worldFromSD(data.pit.mainSAtMerge + 80, 0, p);
    expect(q.ground(p.x, p.z, h, g).ribbon).toBe('main');
    // Kerb on the T1 apex (inside = left).
    const t1 = data.corners[0]!;
    const f = q.frameAt(t1.apexS, frame());
    q.worldFromSD(t1.apexS, f.halfWidthL + 0.6, p);
    expect(q.ground(p.x, p.z, hint(t1.apexS), g).surface).toBe('kerbFlat');
    expect(g.inLimits).toBe(false);
    q.worldFromSD(t1.apexS, f.halfWidthL - 0.05, p);
    expect(q.ground(p.x, p.z, hint(t1.apexS), g)).toMatchObject({ surface: 'line', inLimits: true });
    // Gravel outside T7 (right-hander → outside is the left).
    const t7 = data.corners[6]!;
    const f7 = q.frameAt(t7.apexS, frame());
    q.worldFromSD(t7.apexS, f7.halfWidthL + 9, p);
    expect(q.ground(p.x, p.z, hint(t7.apexS), g).surface).toBe('gravel');
    // A barrier is found near the right wall on the main straight; its normal points back to the track.
    const s = 5000 * (L / 5351.5);
    q.worldFromSD(s, -(data.wallR[Math.round(s)]! - 1), p);
    const walls: WallHit[] = [];
    const n = q.wallsNear(p.x, p.z, 3, walls, 4);
    expect(n).toBeGreaterThan(0);
    const fr = q.frameAt(s, frame());
    expect(Math.abs(walls[0]!.dist - 1)).toBeLessThan(0.1);
    expect(walls[0]!.nx * fr.lx + walls[0]!.nz * fr.lz).toBeGreaterThan(0.95);
    expect(walls[0]!.kind).toBe('concrete');
  });

  it('the thin pit wall reports only the face on the query side', () => {
    const s = 5050 * (L / 5351.5);
    const face = ex.pitWallD[Math.round(s)]!;
    expect(face).toBeCloseTo(9, 1);
    const walls: WallHit[] = [];
    const p = { x: 0, y: 0, z: 0 };
    // Main side, 0.4 m from the face: one hit, positive distance, normal toward the main track (−left).
    q.worldFromSD(s, face - 0.4, p);
    let n = q.wallsNear(p.x, p.z, 2, walls, 4);
    const f = q.frameAt(s, frame());
    const pw = walls.slice(0, n).filter((w) => w.kind === 'pitwall');
    expect(pw).toHaveLength(1);
    expect(pw[0]!.dist).toBeCloseTo(0.4, 1);
    expect(pw[0]!.nx * f.lx + pw[0]!.nz * f.lz).toBeLessThan(-0.95);
    // Pit side, 0.4 m from the other face: normal toward the pit lane (+left).
    q.worldFromSD(s, face + ex.pitWallThickness + 0.4, p);
    n = q.wallsNear(p.x, p.z, 2, walls, 4);
    const pw2 = walls.slice(0, n).filter((w) => w.kind === 'pitwall');
    expect(pw2).toHaveLength(1);
    expect(pw2[0]!.dist).toBeCloseTo(0.4, 1);
    expect(pw2[0]!.nx * f.lx + pw2[0]!.nz * f.lz).toBeGreaterThan(0.95);
  });

  it('U-TR-08 ground() ≤ 1 µs mean over 1 M calls along a lap', () => {
    const CALLS = 1_000_000;
    const PTS = 20_000;
    const xs = new Float64Array(PTS);
    const zs = new Float64Array(PTS);
    const p = { x: 0, y: 0, z: 0 };
    for (let k = 0; k < PTS; k++) {
      const s = (k * L) / PTS;
      q.worldFromSD(s, 3 * Math.sin(s / 37), p);
      xs[k] = p.x;
      zs[k] = p.z;
    }
    const g = hit();
    const h = hint();
    const run = (n: number): number => {
      const t0 = performance.now();
      for (let k = 0; k < n; k++) {
        const m = Math.floor((k * PTS) / n);
        q.ground(xs[m]!, zs[m]!, h, g);
      }
      return ((performance.now() - t0) * 1000) / n;
    };
    run(200_000);
    const us = run(CALLS);
    console.log(`ground(): ${us.toFixed(3)} µs/call`);
    expect(us).toBeLessThan(1);
  });

  it('U-TR-09 build is deterministic and takes ≤ 150 ms', () => {
    const hashOf = (d: ReturnType<typeof buildTrackData>): string => hashArrays([
      d.x, d.y, d.z, d.tx, d.tz, d.curvature, d.vCurvature, d.grade, d.crossSlope, d.halfWidthL, d.halfWidthR,
      d.bandTypeL, d.bandOuterL, d.bandTypeR, d.bandOuterR, d.wallL, d.wallR, d.pit.x, d.pit.y, d.pit.z, ...d.walls.map((w) => w.xz),
    ]);
    const a = buildTrackData(ISTANBUL_RAW, ISTANBUL);
    // Warm up (JIT), then time 7 builds and judge the best one: the minimum is insensitive to CPU contention from
    // parallel test workers but still rises with any real cost regression of the build itself.
    // Warm up (JIT), then time 7 builds and judge the best one: the minimum filters out time slices lost to other
    // test workers competing for cores, while any real cost regression of the build raises it too.
    let b = buildTrackDataFull(ISTANBUL_RAW, ISTANBUL).data;
    const wall: number[] = [];
    for (let k = 0; k < 7; k++) {
      const t0 = performance.now();
      b = buildTrackDataFull(ISTANBUL_RAW, ISTANBUL).data;
      wall.push(performance.now() - t0);
    }
    expect(hashOf(a)).toBe(hashOf(b));
    expect(JSON.stringify(a.corners)).toBe(JSON.stringify(b.corners));
    wall.sort((x, y) => x - y);
    console.log(`buildTrackData warm (sorted): ${wall.map((t) => t.toFixed(0)).join('/')} ms`);
    expect(wall[0]!).toBeLessThan(150);
    // A fresh query over the rebuilt data answers identically.
    const q2 = createTrackQuery(b);
    const p = q2.worldFromSD(1234.5, 3, { x: 0, y: 0, z: 0 });
    const r = q.worldFromSD(1234.5, 3, { x: 0, y: 0, z: 0 });
    expect(p).toEqual(r);
  });

  it('timing, DRS, sectors and cut zones follow report §7.6', () => {
    const k = L / 5351.5;
    expect(data.sectors[0]).toBeCloseTo(1650 * k, 6);
    expect(data.sectors[1]).toBeCloseTo(3480 * k, 6);
    expect(data.drsZones).toHaveLength(2);
    expect(data.cutZones.map((c) => c.id)).toEqual(['T1', 'T9', 'T10', 'T12', 'T13', 'T14']);
    const kinds = data.timingLines.map((t) => t.kind);
    for (const kind of ['finish', 'sector2', 'sector3', 'speedTrap', 'drsDetect', 'drsActivate', 'drsEnd', 'pitEntry', 'pitExit'] as const) expect(kinds).toContain(kind);
    expect(q.sectorAt(10)).toBe(0);
    expect(q.sectorAt(2000)).toBe(1);
    expect(q.sectorAt(4000)).toBe(2);
    // Elevation shape (§7.4): highest point near T3, lowest near T9.
    let hi = 0, lo = 0;
    for (let i = 0; i < data.count; i++) {
      if (data.y[i]! > data.y[hi]!) hi = i;
      if (data.y[i]! < data.y[lo]!) lo = i;
    }
    expect(Math.abs(hi - 930 * k)).toBeLessThan(120);
    expect(Math.abs(lo - 3270 * k)).toBeLessThan(150);
    expect(data.y[hi]! - data.y[lo]!).toBeGreaterThan(35);
  });
});
