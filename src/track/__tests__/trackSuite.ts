// Shared acceptance suite U-TR-01…12 (tracks.md §4) for a registered race track. Each <id>.test.ts calls trackSuite().
import { describe, expect, it } from 'vitest';
import type { GroundHit, TrackFrame, TrackHint } from '../../contracts/track';
import type { BuiltTrackId } from '../authoring/types';
import { buildTrackDataFull } from '../build/buildTrackData';
import { getTrackExtras } from '../build/extras';
import { hashArrays } from '../build/geometry';
import { loadTrack } from '../index';
import { createTrackQuery } from '../query/trackQuery';
import { TRACK_SOURCES } from '../registry';

export interface TrackExpect {
  length: [number, number];
  /** Corner directions, space separated. */
  sequence: string;
  minRadius: number;
  /** Minimum turn of every numbered corner, degrees (default 25; tracks with numbered flat-out kinks set less). */
  minTurn?: number;
  /** Net heading change, degrees (+360 anti-clockwise, −360 clockwise). */
  heading: 360 | -360;
  pitLength: [number, number];
  elevationRange: [number, number];
  maxGrade: number;
  /** Attribution check (default /OpenStreetMap/; authored tracks without map data name the team). */
  attribution?: RegExp;
  /** Warm build budget, ms (default 150; the ≈ 20 km Eifel ring has its own). */
  buildMs?: number;
}

/** tracks.md Ek A word list. Each word has one letter in a character class so the words never appear verbatim in src
 *  (the arch IP scan and Ek A allow them only in docs/ and scripts/). */
export const BANNED = new RegExp([
  'm[o]nza', 'autodr[o]mo nazionale', 'parab[o]lica', 'l[e]smo', '[a]scari', 'rettif[i]lo', 'spa-fr[a]ncorchamps', 'fr[a]ncorchamps',
  'eau r[o]uge', 'raid[i]llon', 'silv[e]rstone', 'istanbul p[a]rk', '\\bf[1]\\b', 'f[o]rmula 1', 'f[o]rmula one',
].join('|'), 'i');

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

export function trackSuite(id: BuiltTrackId, X: TrackExpect): void {
  describe(`${id} track (U-TR-01…12)`, () => {
    const { data, query: q } = loadTrack(id);
    const ex = getTrackExtras(data)!;
    const src = TRACK_SOURCES[id]!;
    const L = q.length;
    const sg = ex.pitSide;

    it('is the requested track, with attribution', () => {
      expect(data.id).toBe(id);
      expect(data.count).toBe(L);
      expect(data.attribution.join(' ')).toMatch(X.attribution ?? /OpenStreetMap/);
    });

    it('U-TR-01 loop is closed: end gap < 0.5 m, tangent jump < 1°', () => {
      const a = q.frameAt(L - 1e-6, frame());
      const b = q.frameAt(0, frame());
      expect(Math.hypot(a.px - b.px, a.pz - b.pz)).toBeLessThan(0.5);
      const ang = (u: TrackFrame, v: TrackFrame): number => Math.acos(Math.min(1, u.tx * v.tx + u.tz * v.tz)) * (180 / Math.PI);
      expect(ang(q.frameAt(L - 0.5, frame()), q.frameAt(0.5, frame()))).toBeLessThan(1);
      expect(Math.hypot(b.px, b.pz)).toBeLessThan(1e-3);
    });

    it(`U-TR-02 length is ${X.length[0]}–${X.length[1]} m`, () => {
      expect(L).toBeGreaterThanOrEqual(X.length[0]);
      expect(L).toBeLessThanOrEqual(X.length[1]);
    });

    it(`U-TR-03 corner sequence ${X.sequence}, each > ${X.minTurn ?? 25}°, minRadius > ${X.minRadius} m`, () => {
      expect(data.corners.map((c) => c.dir).join(' ')).toBe(X.sequence);
      for (const c of data.corners) {
        let turn = 0;
        const len = q.wrapS(c.exitS - c.entryS);
        for (let k = 0; k < len; k++) turn += data.curvature[Math.floor(q.wrapS(c.entryS + k))]!;
        expect(Math.sign(turn), `T${c.n}`).toBe(c.dir === 'L' ? 1 : -1);
        expect(Math.abs(turn) * (180 / Math.PI), `T${c.n} turn`).toBeGreaterThan(X.minTurn ?? 25);
        expect(c.minRadius, `T${c.n} radius`).toBeGreaterThan(X.minRadius);
      }
    });

    it(`U-TR-04 net heading change is ${X.heading}° ± 1°`, () => {
      let h = 0;
      for (let i = 0; i < data.count; i++) {
        const j = (i + 1) % data.count;
        let d = Math.atan2(-data.tz[j]!, data.tx[j]!) - Math.atan2(-data.tz[i]!, data.tx[i]!);
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        h += d;
      }
      expect(Math.abs(h * (180 / Math.PI) - X.heading)).toBeLessThan(1);
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
        const back = q.worldFromSD(out.s, out.d, { x: 0, y: 0, z: 0 });
        const e = Math.max(Math.abs(q.deltaS(s, out.s)) * Math.max(0.05, 1 - f.curvature * d), Math.abs(out.d - d), Math.hypot(back.x - p.x, back.z - p.z));
        worst = Math.max(worst, e);
      }
      expect(worst).toBeLessThan(0.02);
    });

    it('U-TR-06 walls are continuous chains (gaps only at pit entry/exit) and ≥ 1 m outside the outermost band', () => {
      for (const ch of ex.chains) {
        const pieces = ch.pieces.map((i) => data.walls[i]!);
        expect(pieces.length).toBeGreaterThan(0);
        for (const w of pieces) {
          for (let m = 0; m + 3 < w.xz.length; m += 2) {
            expect(Math.hypot(w.xz[m + 2]! - w.xz[m]!, w.xz[m + 3]! - w.xz[m + 1]!), `${ch.role} step`).toBeLessThan(8);
          }
        }
        // Fall zones (authoring FALLS) leave deliberate gaps in the barrier chain.
        const inFall = (x: number, z: number): boolean => ex.falls.some((f) => {
          const pp = { x: 0, y: 0, z: 0 };
          for (let s = f.from - 30; s <= f.to + 30; s += 2) {
            const i = Math.round(q.wrapS(s)) % data.count;
            q.worldFromSD(q.wrapS(s), f.side * (f.side > 0 ? data.wallL[i]! : data.wallR[i]!), pp);
            if (Math.hypot(pp.x - x, pp.z - z) < 4) return true;
          }
          return false;
        });
        for (let k = 0; k + 1 < pieces.length; k++) {
          const a = pieces[k]!.xz;
          const b = pieces[k + 1]!.xz;
          if (inFall(a[a.length - 2]!, a[a.length - 1]!) && inFall(b[0]!, b[1]!)) continue;
          expect(Math.hypot(a[a.length - 2]! - b[0]!, a[a.length - 1]! - b[1]!), `${ch.role} joint`).toBeLessThan(0.5);
        }
        if (ch.closed) {
          const a = pieces[pieces.length - 1]!.xz;
          const b = pieces[0]!.xz;
          expect(Math.hypot(a[a.length - 2]! - b[0]!, a[a.length - 1]! - b[1]!), `${ch.role} closure`).toBeLessThan(0.5);
        }
      }
      expect(ex.chains.filter((c) => c.closed).length).toBe(2);
      expect(ex.chains.filter((c) => !c.closed).length).toBe(2);
      for (let i = 0; i < data.count; i++) {
        expect(data.wallL[i]! - data.bandOuterL[i * 4 + 3]!).toBeGreaterThanOrEqual(1 - 1e-3);
        expect(data.wallR[i]! - data.bandOuterR[i * 4 + 3]!).toBeGreaterThanOrEqual(1 - 1e-3);
      }
      // The closed chain away from the pit agrees with the per-sample offsets on its side.
      const away = ex.chains.find((c) => c.role === 'right')!;
      const o = { s: 0, d: 0 };
      const h = hint();
      for (const wi of away.pieces) {
        const w = data.walls[wi]!;
        for (let m = 0; m < w.xz.length; m += 8) {
          q.project(w.xz[m]!, w.xz[m + 1]!, h, o);
          // After a fall-zone gap the hint is up to ~100 m behind: search ahead for the projection that round-trips.
          if (m === 0 && ex.falls.length) {
            const pp = { x: 0, y: 0, z: 0 }, o2 = { s: 0, d: 0 };
            let best = Infinity, bs = o.s, bd = o.d;
            for (let k = 0; k <= 160; k += 20) {
              q.project(w.xz[m]!, w.xz[m + 1]!, hint(q.wrapS(h.s + k)), o2);
              q.worldFromSD(o2.s, o2.d, pp);
              const e = Math.hypot(pp.x - w.xz[m]!, pp.z - w.xz[m + 1]!) + Math.abs(o2.d) * 1e-3;
              if (e < best) { best = e; bs = o2.s; bd = o2.d; }
            }
            o.s = bs; o.d = bd;
          }
          h.s = o.s;
          expect(Math.sign(o.d), `away chain side at s=${o.s.toFixed(0)}`).toBe(-sg);
        }
      }
    });

    it('U-TR-07 grid inside limits on asphalt, pole side, pit joins the main edge on PIT.side, pit length, boxes', () => {
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
      expect(Math.sign(data.grid[0]!.d)).toBe(src.authoring.GRID.poleSide);
      const pit = data.pit;
      const edge = (s: number): number => (sg === 1 ? q.frameAt(s, f).halfWidthL : -q.frameAt(s, f).halfWidthR);
      const a = q.pitWorldFromSD(0, 0, { x: 0, y: 0, z: 0 });
      const b = q.worldFromSD(pit.mainSAtSplit, edge(pit.mainSAtSplit), { x: 0, y: 0, z: 0 });
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1);
      const c = q.pitWorldFromSD(pit.length, 0, { x: 0, y: 0, z: 0 });
      const d = q.worldFromSD(pit.mainSAtMerge, edge(pit.mainSAtMerge), { x: 0, y: 0, z: 0 });
      expect(Math.hypot(c.x - d.x, c.z - d.z)).toBeLessThan(1);
      expect(Math.abs(a.y - b.y)).toBeLessThan(0.1);
      expect(Math.abs(c.y - d.y)).toBeLessThan(0.1);
      expect(pit.length).toBeGreaterThan(X.pitLength[0]);
      expect(pit.length).toBeLessThan(X.pitLength[1]);
      expect(pit.boxes).toHaveLength(10);
      for (const box of pit.boxes) {
        expect(box.sp).toBeGreaterThan(pit.limitStartSp);
        expect(box.sp).toBeLessThan(pit.limitEndSp);
        q.pitWorldFromSD(box.sp, box.d, p);
        const gh = q.ground(p.x, p.z, { s: 0, ribbon: 'pit', sp: box.sp }, g);
        expect(gh.ribbon).toBe('pit');
        expect(gh.surface).toBe('concrete');
        // The working lane (boxes) is on the garage side of the pit lane.
        expect(Math.sign(box.d)).toBe(sg);
      }
      // Driving the pit lane from split to merge stays on the pit ribbon.
      const h: TrackHint = { s: pit.mainSAtSplit - 50, ribbon: 'main', sp: NaN };
      // Approach along the main line first (a car never jumps 50 m; a chicane before the split traps a stale hint).
      for (let u = -50; u < 0; u += 2) {
        q.worldFromSD(q.wrapS(pit.mainSAtSplit + u), 0, p);
        q.ground(p.x, p.z, h, g);
      }
      for (let sp = 0; sp <= pit.length; sp += 2) {
        q.pitWorldFromSD(sp, 0, p);
        q.ground(p.x, p.z, h, g);
        if (sp > 40 && sp < pit.length - 40) expect(g.ribbon, `sp ${sp}`).toBe('pit');
      }
    });

    it('U-TR-08 ground() ≤ 1 µs mean over 1 M calls along a lap', () => {
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
      const us = run(1_000_000);
      console.log(`${id} ground(): ${us.toFixed(3)} µs/call`);
      expect(us).toBeLessThan(1);
    });

    it(`U-TR-09 build is deterministic and takes ≤ ${X.buildMs ?? 150} ms`, () => {
      const hashOf = (d: typeof data): string => hashArrays([
        d.x, d.y, d.z, d.tx, d.tz, d.curvature, d.vCurvature, d.grade, d.crossSlope, d.halfWidthL, d.halfWidthR,
        d.bandTypeL, d.bandOuterL, d.bandTypeR, d.bandOuterR, d.wallL, d.wallR, d.pit.x, d.pit.y, d.pit.z, ...d.walls.map((w) => w.xz),
      ]);
      let b = buildTrackDataFull(src.raw, src.authoring).data;
      const wall: number[] = [];
      for (let k = 0; k < 7; k++) {
        const t0 = performance.now();
        b = buildTrackDataFull(src.raw, src.authoring).data;
        wall.push(performance.now() - t0);
      }
      expect(hashOf(data)).toBe(hashOf(b));
      expect(JSON.stringify(data.corners)).toBe(JSON.stringify(b.corners));
      wall.sort((x, y) => x - y);
      console.log(`${id} buildTrackData warm (sorted): ${wall.map((t) => t.toFixed(0)).join('/')} ms`);
      expect(wall[0]!).toBeLessThan(X.buildMs ?? 150);
      const q2 = createTrackQuery(b);
      expect(q2.worldFromSD(1234.5, 3, { x: 0, y: 0, z: 0 })).toEqual(q.worldFromSD(1234.5, 3, { x: 0, y: 0, z: 0 }));
    });

    it(`U-TR-10 elevation range ${X.elevationRange[0]}–${X.elevationRange[1]} m, max |grade| < ${X.maxGrade * 100} %`, () => {
      let lo = Infinity, hi = -Infinity, g = 0;
      for (let i = 0; i < data.count; i++) {
        lo = Math.min(lo, data.y[i]!);
        hi = Math.max(hi, data.y[i]!);
        g = Math.max(g, Math.abs(data.grade[i]!));
      }
      console.log(`${id} elevation ${lo.toFixed(1)}…${hi.toFixed(1)} m, max grade ${(g * 100).toFixed(2)} %`);
      expect(hi - lo).toBeGreaterThanOrEqual(X.elevationRange[0]);
      expect(hi - lo).toBeLessThanOrEqual(X.elevationRange[1]);
      expect(g).toBeLessThan(X.maxGrade);
    });

    it('U-TR-11 timing order: sectors, DRS and speed trap inside [0, L); DRS activation on a straight', () => {
      const [s2, s3] = data.sectors;
      expect(s2).toBeGreaterThan(0);
      expect(s3).toBeGreaterThan(s2);
      expect(s3).toBeLessThan(L);
      for (const t of data.timingLines) {
        expect(t.s).toBeGreaterThanOrEqual(0);
        expect(t.s).toBeLessThan(L);
      }
      for (const z of data.drsZones) {
        for (let k = -10; k <= 10; k++) {
          expect(Math.abs(data.curvature[Math.floor(q.wrapS(z.activateS + k))]!), `DRS ${z.id} activation`).toBeLessThan(1 / 400);
        }
      }
      expect(q.sectorAt(1)).toBe(0);
      expect(q.sectorAt(s2 + 1)).toBe(1);
      expect(q.sectorAt(s3 + 1)).toBe(2);
    });

    it('U-TR-12 no banned word in the name, attribution or raw features', () => {
      expect(JSON.stringify(data.name)).not.toMatch(BANNED);
      expect(data.attribution.join(' ')).not.toMatch(BANNED);
      expect(JSON.stringify(src.raw.features)).not.toMatch(BANNED);
      expect(src.raw.features.some((f) => 'name' in f)).toBe(false);
    });
  });
}
