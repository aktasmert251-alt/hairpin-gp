// Sim layer: runtime build of a track's TrackData from its raw OSM/DEM file and authoring table (report §7.2–§7.8,
// tracks.md §1). The pit may be on either side (A.PIT.side): pit-side code works in q = side·d (q > 0 toward the pit).
// Deterministic, no three/DOM. Build-time code may allocate; target ≤ 150 ms.

import type { Side } from '../../contracts/common';
import type { PitLaneData, TrackData, WallKind } from '../../contracts/track';
import { TEAMS } from '../../data/teams';
import type { TrackAuthoring } from '../authoring/types';
import type { RawTrack } from '../data/raw';
import { SURFACE_CODE } from '../query/surfaces';
import { applyReg, buildMainLine, buildOpenLine, filletRaw, type Line } from './centreline';
import { setTrackExtras, type RunoffPaint, type TrackExtras, type WallChain } from './extras';
import { clamp, gaussianSmooth, interpTable, maxFilter, smoothstep, wrap } from './geometry';
import { projectOnLine, type SD } from './project';

const WALL_HEIGHT: Readonly<Record<WallKind, number>> = { armco: 0.9, concrete: 1.1, tyres: 1.0, tecpro: 1.2, pitwall: 1.2, fence: 3 };
const RUNOFF_NONE = 0, RUNOFF_ASPHALT = 1, RUNOFF_PAINTED = 2, RUNOFF_GRAVEL = 3;
const V_CMAX = 1 / 400; // compression
const V_CMIN = -1 / 700; // crest
const WALL_STEP = 2;

interface Side_ {
  kerb: Float64Array; kerbKind: Uint8Array; astro: Float64Array; runoff: Float64Array; runoffKind: Uint8Array;
  sausage: Uint8Array; wallT: Float64Array; wallKind: WallKind[]; base: Uint8Array;
}

/** Re-draws the first `joinSp` metres of the pit polyline as a cubic Hermite from `start` (main edge at main s `s0`,
 *  leaving along the main tangent) into the polyline at `joinSp` (along its tangent), sampled every ≈ 2 m. */
function redrawPitEntry(pts: [number, number][], joinSp: number, start: [number, number], line: Line, s0: number): [number, number][] {
  let cum = 0;
  let k = 1;
  for (; k < pts.length - 2; k++) {
    cum += Math.hypot(pts[k]![0] - pts[k - 1]![0], pts[k]![1] - pts[k - 1]![1]);
    if (cum >= joinSp) break;
  }
  const p1 = pts[k]!;
  let t1x = pts[k + 1]![0] - pts[k - 1]![0], t1z = pts[k + 1]![1] - pts[k - 1]![1];
  const l1 = Math.hypot(t1x, t1z) || 1;
  t1x /= l1; t1z /= l1;
  const i0 = Math.floor(s0) % line.count;
  const t0x = line.tx[i0]!, t0z = line.tz[i0]!;
  const ch = Math.hypot(p1[0] - start[0], p1[1] - start[1]);
  const n = Math.max(4, Math.ceil(ch / 2));
  const out: [number, number][] = [];
  for (let m = 0; m < n; m++) {
    const u = m / n, u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    out.push([h00 * start[0] + h10 * ch * t0x + h01 * p1[0] + h11 * ch * t1x, h00 * start[1] + h10 * ch * t0z + h01 * p1[1] + h11 * ch * t1z]);
  }
  return out.concat(pts.slice(k));
}

function newSide(n: number, hw: Float64Array, verge: number, wall: WallKind, base: number): Side_ {
  const wallT = new Float64Array(n);
  for (let i = 0; i < n; i++) wallT[i] = hw[i]! + verge;
  return {
    kerb: new Float64Array(n), kerbKind: new Uint8Array(n), astro: new Float64Array(n), runoff: new Float64Array(n),
    runoffKind: new Uint8Array(n), sausage: new Uint8Array(n), wallT, wallKind: new Array<WallKind>(n).fill(wall),
    base: new Uint8Array(n).fill(base),
  };
}

/** Smooth 0..1 membership of s in the loop range [from, to] (wrapping), edges blended over `blend` metres. */
function rangeW(s: number, from: number, to: number, blend: number, L: number): number {
  const len = wrap(to - from, L);
  const u = wrap(s - from, L);
  const m = u <= len ? Math.min(u, len - u) : -Math.min(L - u, u - len);
  return blend > 0 ? smoothstep(-blend / 2, blend / 2, m) : m >= 0 ? 1 : 0;
}

/** Same on an open interval. */
function openW(x: number, from: number, to: number, blend: number): number {
  return smoothstep(from - blend / 2, from + blend / 2, x) * (1 - smoothstep(to - blend / 2, to + blend / 2, x));
}

function inRange(s: number, from: number, to: number, L: number): boolean {
  return wrap(s - from, L) <= wrap(to - from, L);
}

/** Signed loop distance from a to b in (−L/2, L/2]. */
function loopDeltaN(a: number, b: number, L: number): number {
  const d = wrap(b - a, L);
  return d > L / 2 ? d - L : d;
}

/** Calls fn(i) for every sample index in the loop range [from − m, to + m] (wrapping). */
function forRange(from: number, to: number, m: number, N: number, fn: (i: number) => void): void {
  const len = wrap(to - from, N) + 2 * m;
  const a = Math.floor(from - m);
  for (let k = 0; k <= Math.ceil(len) + 1; k++) fn(((a + k) % N + N) % N);
}

/** Periodic Catmull-Rom sample of a uniformly spaced table at fractional index u. */
function cubicPeriodic(v: ArrayLike<number>, u: number): number {
  const n = v.length;
  const i = Math.floor(u);
  const t = u - i;
  const p0 = v[(((i - 1) % n) + n) % n]!;
  const p1 = v[((i % n) + n) % n]!;
  const p2 = v[(((i + 1) % n) + n) % n]!;
  const p3 = v[(((i + 2) % n) + n) % n]!;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

export interface BuildResult { data: TrackData; extras: TrackExtras }

export function buildTrackData(raw: RawTrack, A: TrackAuthoring): TrackData {
  return buildTrackDataFull(raw, A).data;
}

export function buildTrackDataFull(raw: RawTrack, A: TrackAuthoring): BuildResult {
  /** Pit side sign and side indices (sides[0] = left, sides[1] = right). */
  const sg = A.PIT.side;
  const ps = sg === 1 ? 0 : 1;
  const op = 1 - ps;
  // ---- 1. Centreline -------------------------------------------------------------------------
  const { line, reg } = buildMainLine(A.CENTRE_FILLETS ? filletRaw(raw.main.xz, A.CENTRE_FILLETS) : raw.main.xz);
  const N = line.count;
  const L = line.length;
  const sc = L / A.OSM_LENGTH;
  const S = (s: number): number => wrap(s * sc, L);
  const sd: SD = { s: 0, d: 0, i: 0 };

  /** Build-time world point at (s, d) on the main line (linear position, interpolated normal). */
  const mainAt = (s: number, d: number): [number, number] => {
    const sw = wrap(s, L);
    const i = Math.floor(sw);
    const j = (i + 1) % N;
    const t = sw - i;
    const px = line.x[i]! + (line.x[j]! - line.x[i]!) * t;
    const pz = line.z[i]! + (line.z[j]! - line.z[i]!) * t;
    let lx = line.tz[i]! + (line.tz[j]! - line.tz[i]!) * t;
    let lz = -(line.tx[i]! + (line.tx[j]! - line.tx[i]!) * t);
    const ll = Math.hypot(lx, lz) || 1;
    lx /= ll;
    lz /= ll;
    return [px + lx * d, pz + lz * d];
  };
  const at = (arr: ArrayLike<number>, s: number): number => {
    const sw = wrap(s, L);
    const i = Math.floor(sw);
    const t = sw - i;
    return arr[i]! + (arr[(i + 1) % N]! - arr[i]!) * t;
  };

  // ---- 2. Elevation (raw arc length → final s through the raw vertices) ------------------------
  const rv = raw.main.xz.map((p) => applyReg(reg, p[0], p[1]));
  const rawCum: number[] = [0];
  for (let v = 0; v < rv.length; v++) {
    const a = rv[v]!;
    const b = rv[(v + 1) % rv.length]!;
    rawCum.push(rawCum[v]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const vS: number[] = [];
  let prevI = 0;
  for (let v = 0; v < rv.length; v++) {
    projectOnLine(line, true, rv[v]![0], rv[v]![1], prevI, v === 0 ? 20 : 120, sd);
    let s = sd.s;
    if (v > 0) {
      while (s < vS[v - 1]! - L / 2) s += L;
      s = Math.max(s, vS[v - 1]!);
    } else if (s > L / 2) s -= L;
    vS.push(s);
    prevI = sd.i;
  }
  vS.push(vS[0]! + L);
  const rawToFinal = (r: number): number => wrap(interpTable(rawCum, vS, r), L);

  const eS: number[] = [];
  const eY: number[] = [];
  // Optional running median over the raw samples (removes canopy dips in the DEM before the Gaussian).
  const ey = raw.elevation.y;
  const hm = A.ELEVATION_MEDIAN;
  const yMed = hm > 0 ? ey.map((_, k) => {
    const w: number[] = [];
    for (let m = -hm; m <= hm; m++) w.push(ey[(k + m + ey.length) % ey.length]!);
    return w.sort((a, b) => a - b)[hm]!;
  }) : ey;
  const pairs = raw.elevation.s.map((r, k) => [rawToFinal(r), yMed[k]!] as [number, number]).sort((a, b) => a[0] - b[0]);
  for (const [s, y] of pairs) {
    if (eS.length && s - eS[eS.length - 1]! < 1e-6) continue;
    eS.push(s);
    eY.push(y);
  }
  const y1: number[] = new Array<number>(N);
  for (let i = 0; i < N; i++) y1[i] = interpTable(eS, eY, i, L);
  const ys = gaussianSmooth(y1, A.ELEVATION_SIGMA, true);
  // Vertical-curvature clamp on a ≈4 m grid (Gauss-Seidel), then periodic cubic back to 1 m.
  const M = Math.round(L / 4);
  const h = L / M;
  const yv = new Float64Array(M);
  for (let j = 0; j < M; j++) yv[j] = at(ys, j * h);
  for (let sweep = 0; sweep < 600; sweep++) {
    let worst = 0;
    for (let j = 0; j < M; j++) {
      const a = yv[(j - 1 + M) % M]!;
      const b = yv[(j + 1) % M]!;
      const c2 = (a - 2 * yv[j]! + b) / (h * h);
      if (c2 > V_CMAX) {
        yv[j] = yv[j]! + ((c2 - V_CMAX) * h * h) / 2;
        worst = Math.max(worst, c2 - V_CMAX);
      } else if (c2 < V_CMIN) {
        yv[j] = yv[j]! - ((V_CMIN - c2) * h * h) / 2;
        worst = Math.max(worst, V_CMIN - c2);
      }
    }
    if (worst < 1e-7) break;
  }
  const yArr = new Float64Array(N);
  for (let i = 0; i < N; i++) yArr[i] = cubicPeriodic(yv, i / h);
  const y0 = yArr[0]!;
  for (let i = 0; i < N; i++) yArr[i] = yArr[i]! - y0;

  // ---- 3. Widths, banking --------------------------------------------------------------------
  const hw = new Float64Array(N).fill(A.WIDTHS[0]!.hw);
  for (let r = 1; r < A.WIDTHS.length; r++) {
    const row = A.WIDTHS[r]!;
    const f = S(row.from);
    const t = S(row.to);
    forRange(f, t, A.WIDTH_BLEND, N, (i) => {
      const w = rangeW(i, f, t, A.WIDTH_BLEND, L);
      if (w > 0) hw[i] = hw[i]! + (row.hw - hw[i]!) * w;
    });
  }
  const cs = new Float64Array(N);
  for (const c of A.CORNERS) {
    const sign = c.dir === 'L' ? 1 : -1;
    const slope = -sign * Math.tan((c.bankDeg * Math.PI) / 180);
    const f = S(c.entry);
    const t = S(c.exit);
    forRange(f, t, 40, N, (i) => {
      const w = rangeW(i, f, t, 40, L);
      if (w > 0) cs[i] = cs[i]! + (slope - cs[i]!) * w;
    });
  }
  // Fold limit on the inside of corners: max |κ| within ±15 m.
  const kAbs = new Array<number>(N);
  for (let i = 0; i < N; i++) kAbs[i] = Math.abs(line.kappa[i]!);
  const kMax = maxFilter(kAbs, 15, true);
  const kSign = gaussianSmooth(Array.from(line.kappa), 10, true);

  // ---- 4. Pit split/merge estimate (for the pit-side layout) ----------------------------------
  let pitRaw = raw.pit.xz.map((p) => applyReg(reg, p[0], p[1]));
  if (A.PIT.entryRedraw) pitRaw = redrawPitEntry(pitRaw, A.PIT.entryRedraw.joinSp, mainAt(S(A.PIT.entryRedraw.fromS), sg * at(hw, S(A.PIT.entryRedraw.fromS))), line, S(A.PIT.entryRedraw.fromS));
  projectOnLine(line, true, pitRaw[0]![0], pitRaw[0]![1], -1, 0, sd);
  const splitEst = sd.s;
  projectOnLine(line, true, pitRaw[pitRaw.length - 1]![0], pitRaw[pitRaw.length - 1]![1], -1, 0, sd);
  const mergeEst = sd.s;

  // ---- 5. Side layout: kerbs, run-offs, wall targets --------------------------------------------
  const wall0 = A.DEFAULT_WALL ?? 'armco';
  const base0 = A.VERGE.base === 'concrete' ? SURFACE_CODE.concrete : SURFACE_CODE.grass;
  const sides: [Side_, Side_] = [newSide(N, hw, A.VERGE.straight, wall0, base0), newSide(N, hw, A.VERGE.straight, wall0, base0)];
  const paint: RunoffPaint[] = [];
  for (let i = 0; i < N; i++) {
    if (inRange(i, S(A.VERGE.mainStraightFrom), S(A.VERGE.mainStraightTo), L)) sides[op].wallT[i] = hw[i]! + A.VERGE.mainStraightOpp;
  }
  for (const c of A.CORNERS) {
    const si = c.dir === 'L' ? 0 : 1;
    const so = 1 - si;
    const sideOut: Side = so === 0 ? 1 : -1;
    const e = S(c.entry);
    const x = S(c.exit);
    const la = ((c.exit - c.entry) * sc) / c.apexes.length;
    const W = c.runoffW ?? clamp(0.12 * c.vApex, 10, 45);
    const roF = wrap(e - 60, L);
    const roT = wrap(x + 60, L);
    const lastApex = S(c.apexes[c.apexes.length - 1]!);
    const exF = wrap(lastApex + 0.2 * la, L);
    const exT = wrap(x + 30 * sc, L);
    const gravelF = c.gravelFrom !== undefined ? S(c.gravelFrom) : -1;
    forRange(roF, roT, 40, N, (i) => {
      for (const ap of c.apexes) {
        const a = S(ap);
        if (inRange(i, wrap(a - 0.4 * la, L), wrap(a + 0.4 * la, L), L)) {
          sides[si].kerb[i] = Math.max(sides[si].kerb[i]!, A.KERB.inside);
          if (sides[si].kerbKind[i] === 0) sides[si].kerbKind[i] = 1;
          sides[si].astro[i] = A.KERB.astroturf;
        }
      }
      if (inRange(i, exF, exT, L)) {
        sides[so].kerb[i] = Math.max(sides[so].kerb[i]!, A.KERB.exit);
        sides[so].kerbKind[i] = 2;
        if (c.sausage) sides[so].sausage[i] = 1;
      }
      const w = rangeW(i, roF, roT, 40, L);
      if (w > 0.01) {
        const o = sides[so];
        o.runoff[i] = Math.max(o.runoff[i]!, W * w);
        let kind = c.runoff === 'gravel' ? RUNOFF_GRAVEL : c.runoff === 'painted' ? RUNOFF_PAINTED : RUNOFF_ASPHALT;
        if (gravelF >= 0 && inRange(i, gravelF, roT, L)) kind = RUNOFF_GRAVEL;
        o.runoffKind[i] = kind;
        const target = hw[i]! + (c.wallD ?? Math.max(c.minClear, A.KERB.exit + W + 3));
        o.wallT[i] = Math.max(o.wallT[i]!, hw[i]! + A.VERGE.straight + (target - hw[i]! - A.VERGE.straight) * w);
        if (inRange(i, wrap(e - 30, L), wrap(x + 30, L), L)) o.wallKind[i] = c.outsideWall;
      }
    });
    if (c.runoff === 'painted') paint.push({ fromS: roF, toS: gravelF >= 0 ? gravelF : roT, side: sideOut });
  }
  for (const xw of A.EXTRA_WALLS) {
    const o = sides[xw.side === 1 ? 0 : 1];
    for (let i = 0; i < N; i++) if (inRange(i, S(xw.from), S(xw.to), L)) o.wallKind[i] = xw.kind;
  }
  for (const e of A.ESCAPES ?? []) {
    const o = sides[e.side === 1 ? 0 : 1];
    const f = S(e.from);
    const t = S(e.to);
    forRange(f, t, 20, N, (i) => {
      const w = rangeW(i, f, t, 20, L);
      if (w <= 0) return;
      o.wallT[i] = Math.max(o.wallT[i]!, hw[i]! + e.depth * w);
      o.runoff[i] = Math.max(o.runoff[i]!, (e.depth - 2) * w);
      o.runoffKind[i] = RUNOFF_ASPHALT;
      o.wallKind[i] = e.kind;
    });
  }
  for (const sw of A.SPECTATOR_WALLS) {
    const o = sides[sw.side === 1 ? 0 : 1];
    for (let i = 0; i < N; i++) if (inRange(i, S(sw.from), S(sw.to), L)) o.wallKind[i] = 'concrete';
  }
  // Tunnels (Alpine): walls close on both sides, no kerbs, run-off or verge grass (± 20 m past the portals).
  const closeWalls = [...(A.TUNNELS ?? []), ...(A.DECKS ?? []).filter((d) => d.wallD !== undefined).map((d) => ({ from: d.from, to: d.to, wallD: d.wallD!, kind: d.kind ?? 'concrete' }))];
  for (const tn of closeWalls) {
    const f = wrap(S(tn.from) - 20, L);
    const t = wrap(S(tn.to) + 20, L);
    for (const o of sides) {
      for (let i = 0; i < N; i++) {
        if (!inRange(i, f, t, L)) continue;
        o.kerb[i] = 0; o.kerbKind[i] = 0; o.astro[i] = 0; o.sausage[i] = 0;
        o.runoff[i] = 0; o.runoffKind[i] = RUNOFF_NONE;
        o.wallT[i] = hw[i]! + tn.wallD; o.wallKind[i] = tn.kind; o.base[i] = SURFACE_CODE.concrete;
      }
    }
  }

  // Fall zones (Volcano Rim): the lip line at hw + lip on that side, no run-off beyond the kerb (the drop is there).
  for (const fz of A.FALLS ?? []) {
    const o = sides[fz.side === 1 ? 0 : 1];
    const f = S(fz.from), t = S(fz.to);
    for (let i = 0; i < N; i++) {
      if (!inRange(i, wrap(f - 20, L), wrap(t + 20, L), L)) continue;
      o.runoff[i] = 0; o.runoffKind[i] = RUNOFF_NONE; o.astro[i] = 0; o.sausage[i] = 0;
      o.wallT[i] = hw[i]! + fz.lip;
    }
  }

  // Pit side beside the pit lane: no outside run-off or exit kerbs (the pit lane is there).
  const pitFrom = wrap(splitEst - 40, L);
  const pitTo = wrap(mergeEst + 40, L);
  const left = sides[ps];
  for (let i = 0; i < N; i++) {
    const w = rangeW(i, pitFrom, pitTo, 60, L);
    if (w > 0) {
      left.runoff[i] = left.runoff[i]! * (1 - w);
      if (w > 0.5) left.runoffKind[i] = RUNOFF_NONE;
    }
    if (inRange(i, wrap(splitEst - 10, L), wrap(mergeEst + 10, L), L) && left.kerbKind[i] === 2) {
      left.kerb[i] = 0;
      left.kerbKind[i] = 0;
      left.sausage[i] = 0;
    }
  }
  // Outermost non-grass offset on the pit side (pit wall must clear it by ≥ 1 m).
  const outerL = new Float64Array(N);
  for (let i = 0; i < N; i++) outerL[i] = hw[i]! + left.kerb[i]! + left.astro[i]!;

  // ---- 6. Pit lane ---------------------------------------------------------------------------
  const P = A.PIT;
  const pit0 = buildOpenLine(pitRaw);
  const pitWin = P.projectWindow ?? 60;
  const dsp0 = pit0.length / (pit0.count - 1);
  const hwPitAt = (sp: number): number => P.narrowHalfWidth + (P.wideHalfWidth - P.narrowHalfWidth) * openW(sp, P.limitStartSp - 20, P.limitEndSp + 20, 30);
  const strF = S(P.straightFrom);
  const strT = S(P.straightTo);
  const pts: [number, number][] = [];
  prevI = Math.round(splitEst);
  for (let j = 0; j < pit0.count; j++) {
    const sp = j * dsp0;
    const x = pit0.x[j]!;
    const z = pit0.z[j]!;
    projectOnLine(line, true, x, z, prevI, pitWin, sd);
    prevI = sd.i;
    const s = sd.s;
    const d = sg * sd.d;
    const hwP = hwPitAt(sp);
    let dc = d;
    if (Math.abs(d) < 30) {
      const wStr = rangeW(s, strF, strT, 40, L);
      dc = d + (P.pitWallFaceMainD + P.pitWallThickness + hwP - d) * wStr;
      const gap = 1.5 * smoothstep(0, 70, sp) * smoothstep(0, 70, pit0.length - sp);
      dc = Math.max(dc, at(outerL, s) + gap + hwP);
    }
    const wEnd = Math.max(1 - smoothstep(0, P.endBlend, sp), 1 - smoothstep(0, P.endBlend, pit0.length - sp));
    const df = dc + (at(hw, s) - dc) * wEnd;
    pts.push(Math.abs(df - d) > 1e-3 ? mainAt(s, sg * df) : [x, z]);
  }
  const pitLine: Line = buildOpenLine(pts);
  const Pc = pitLine.count;
  const Lp = pitLine.length;
  const dsp = Lp / (Pc - 1);
  /** Pit samples closer than this to the main centreline run beside it (İstanbul 18 m: lane centre + 3.25 m). */
  const pitNearD = P.pitWallFaceMainD + P.pitWallThickness + P.wideHalfWidth + 3.25;
  const pitMainS = new Float32Array(Pc);
  const pitMainD = new Float32Array(Pc);
  const pitValid = new Uint8Array(Pc);
  prevI = Math.round(splitEst);
  for (let j = 0; j < Pc; j++) {
    projectOnLine(line, true, pitLine.x[j]!, pitLine.z[j]!, prevI, pitWin, sd);
    prevI = sd.i;
    pitMainS[j] = sd.s;
    pitMainD[j] = sd.d;
    pitValid[j] = Math.abs(sd.d) < pitNearD ? 1 : 0;
  }
  const mainSAtSplit = pitMainS[0]!;
  const mainSAtMerge = pitMainS[Pc - 1]!;
  // Pit elevation: main surface at the projection, bridged across the far excursions, smoothed away from the ends.
  const pyRaw = new Array<number>(Pc).fill(NaN);
  for (let j = 0; j < Pc; j++) {
    if (!pitValid[j]) continue;
    const s = pitMainS[j]!;
    pyRaw[j] = at(yArr, s) + at(cs, s) * clamp(pitMainD[j]!, -at(hw, s) - 2, at(hw, s) + 2);
  }
  for (let j = 0; j < Pc; j++) {
    if (Number.isFinite(pyRaw[j])) continue;
    let a = j - 1;
    while (a >= 0 && !Number.isFinite(pyRaw[a])) a--;
    let b = j + 1;
    while (b < Pc && !Number.isFinite(pyRaw[b])) b++;
    const ya = a >= 0 ? pyRaw[a]! : pyRaw[b]!;
    const yb = b < Pc ? pyRaw[b]! : ya;
    pyRaw[j] = a >= 0 && b < Pc ? ya + ((yb - ya) * (j - a)) / (b - a) : a >= 0 ? ya : yb;
  }
  const pySm = gaussianSmooth(pyRaw, 10, false);
  const pit: PitLaneData = {
    length: Lp, count: Pc,
    x: Float32Array.from(pitLine.x), y: new Float32Array(Pc), z: Float32Array.from(pitLine.z),
    tx: Float32Array.from(pitLine.tx), tz: Float32Array.from(pitLine.tz), halfWidth: new Float32Array(Pc),
    mainSAtSplit, mainSAtMerge, limitStartSp: P.limitStartSp, limitEndSp: P.limitEndSp, speedLimitKmh: P.speedLimitKmh,
    fastLaneD: sg * (P.fastLaneMainD - (P.pitWallFaceMainD + P.pitWallThickness + P.wideHalfWidth)),
    workingLaneD: sg * (P.workingLaneMainD - (P.pitWallFaceMainD + P.pitWallThickness + P.wideHalfWidth)),
    boxes: [],
  };
  const pitOuterWallD = new Float32Array(Pc);
  for (let j = 0; j < Pc; j++) {
    const sp = j * dsp;
    const w = smoothstep(0, 40, sp) * smoothstep(0, 40, Lp - sp);
    pit.y[j] = pyRaw[j]! + (pySm[j]! - pyRaw[j]!) * w;
    const hwP = hwPitAt(sp);
    pit.halfWidth[j] = hwP;
    const ww = openW(sp, P.limitStartSp - 20, P.limitEndSp + 20, 30);
    pitOuterWallD[j] = sg * (hwP + 2.5 - 0.5 * ww);
  }
  TEAMS.forEach((t, k) => pit.boxes.push({ teamId: t.id, sp: P.firstBoxSp + P.boxSpacing * k, d: pit.workingLaneD }));
  const boxMainS = pit.boxes.map((b) => pitMainS[Math.min(Pc - 1, Math.round(b.sp / dsp))]!);

  // Main ↔ pit mappings over the pit-adjacent range.
  const pitRange = { from: wrap(mainSAtSplit - 10, L), to: wrap(mainSAtMerge + 10, L) };
  const mainPitSp = new Float32Array(N).fill(NaN);
  const pitDAtMain = new Float64Array(N).fill(NaN);
  const hwPAtMain = new Float64Array(N).fill(NaN);
  for (let j = 0; j < Pc; j++) {
    if (!pitValid[j]) continue;
    const i = Math.round(pitMainS[j]!) % N;
    mainPitSp[i] = j * dsp;
    pitDAtMain[i] = sg * pitMainD[j]!;
    hwPAtMain[i] = pit.halfWidth[j]!;
  }
  // Fill gaps inside the range by linear interpolation along s.
  const rangeLen = wrap(pitRange.to - pitRange.from, L);
  const r0 = Math.floor(pitRange.from);
  let lastK = -1;
  for (let k = 0; k <= Math.ceil(rangeLen); k++) {
    const i = (r0 + k) % N;
    if (Number.isNaN(mainPitSp[i]!)) continue;
    if (lastK >= 0 && k - lastK > 1) {
      const ia = (r0 + lastK) % N;
      for (let m = lastK + 1; m < k; m++) {
        const t = (m - lastK) / (k - lastK);
        const im = (r0 + m) % N;
        mainPitSp[im] = mainPitSp[ia]! + (mainPitSp[i]! - mainPitSp[ia]!) * t;
        // The far excursions (inside T14 / T1) stay NaN for pitDAtMain: no pit wall offset derived from them.
      }
    }
    lastK = k;
  }

  // ---- 7. Clearance against other parts of the loop -------------------------------------------
  const CELL = 30;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < N; i++) {
    minX = Math.min(minX, line.x[i]!); maxX = Math.max(maxX, line.x[i]!);
    minZ = Math.min(minZ, line.z[i]!); maxZ = Math.max(maxZ, line.z[i]!);
  }
  const gx = Math.ceil((maxX - minX) / CELL) + 3;
  const gz = Math.ceil((maxZ - minZ) / CELL) + 3;
  const cells: number[][] = Array.from({ length: gx * gz }, () => []);
  const cellOf = (x: number, z: number): number => (Math.floor((x - minX) / CELL) + 1) + (Math.floor((z - minZ) / CELL) + 1) * gx;
  for (let i = 0; i < N; i += 2) cells[cellOf(line.x[i]!, line.z[i]!)]!.push(i);
  const clearLim: [Float64Array, Float64Array] = [new Float64Array(N).fill(1e9), new Float64Array(N).fill(1e9)];
  for (let i = 0; i < N; i += 2) {
    const px = line.x[i]!;
    const pz = line.z[i]!;
    const lx = line.tz[i]!;
    const lz = -line.tx[i]!;
    const cx = Math.floor((px - minX) / CELL) + 1;
    const cz = Math.floor((pz - minZ) / CELL) + 1;
    for (let oz = -2; oz <= 2; oz++) for (let ox = -2; ox <= 2; ox++) {
      const ci = cx + ox + (cz + oz) * gx;
      if (ci < 0 || ci >= cells.length) continue;
      for (const j of cells[ci]!) {
        const dij = i > j ? i - j : j - i;
        if (dij < 150 || dij > L - 150) continue;
        const vx = line.x[j]! - px;
        const vz = line.z[j]! - pz;
        const along = vx * line.tx[i]! + vz * line.tz[i]!;
        if (Math.abs(along) > 10) continue;
        const lat = vx * lx + vz * lz;
        const k = lat > 0 ? 0 : 1;
        const mid = hw[i]! + (Math.abs(lat) - hw[i]! - hw[j]!) / 2 - 0.5;
        clearLim[k][i] = Math.min(clearLim[k][i]!, Math.max(hw[i]! + 1.5, mid));
      }
    }
  }

  for (let i = 1; i < N; i += 2) {
    const b = (i + 1) % N;
    clearLim[0][i] = Math.min(clearLim[0][i - 1]!, clearLim[0][b]!);
    clearLim[1][i] = Math.min(clearLim[1][i - 1]!, clearLim[1][b]!);
  }
  // ---- 8. Pit wall (between the ribbons, q frame) and the pit-side wall targets in the pit range --
  const pitWallD = new Float32Array(N).fill(NaN);
  /** Minimum pit-wall gap to the outermost band (İstanbul 1 m; street circuits 1.5 m wall–edge clearance). */
  const gapW = P.minWallGap ?? 1;
  const foldLim = (i: number, side: 0 | 1): number => {
    const inside = side === 0 ? kSign[i]! > 0 : kSign[i]! < 0;
    return inside ? 0.85 / Math.max(kMax[i]!, 1e-6) : 1e9;
  };
  for (let k = 0; k <= Math.ceil(rangeLen); k++) {
    const i = (r0 + k) % N;
    if (!inRange(i, pitRange.from, pitRange.to, L)) continue;
    const dp = pitDAtMain[i]!;
    let face: number;
    if (Number.isFinite(dp)) {
      const avail = dp - hwPAtMain[i]! - outerL[i]!;
      if (avail < gapW + 0.45) continue;
      face = outerL[i]! + gapW + Math.max(0, (avail - gapW - 0.5) / 2);
    } else {
      face = outerL[i]! + 1.5;
    }
    pitWallD[i] = Math.min(face, foldLim(i, ps) - 0.6, clearLim[ps][i]!);
  }
  // No pit wall hugging the outside of a tight lane bend: where the lane turns away from the main line (Ardennes: the
  // exit hairpin behind T1, R ≈ 21 m) the wall run carried on 2 m off the lane edge and cars leaving the pits scraped it.
  for (let k = 0; P.wallClearOfBends && k <= Math.ceil(rangeLen); k++) {
    const i = (r0 + k) % N;
    if (!Number.isFinite(pitWallD[i]!)) continue;
    const [wx, wz] = mainAt(i, sg * (pitWallD[i]! + P.pitWallThickness));
    for (let j = 2; j < Pc - 2; j += 2) {
      const dx = pitLine.x[j]! - wx, dz = pitLine.z[j]! - wz;
      const r = pit.halfWidth[j]! + 3;
      if (dx * dx + dz * dz >= r * r) continue;
      const cr = pitLine.tx[j - 2]! * pitLine.tz[j + 2]! - pitLine.tz[j - 2]! * pitLine.tx[j + 2]!;
      if (Math.abs(Math.asin(clamp(cr, -1, 1))) / (4 * dsp) > 1 / 35) { pitWallD[i] = NaN; break; }
    }
  }
  // Keep only the longest contiguous pit-wall run.
  let bestA = -1, bestLen = 0, curA = -1, curLen = 0;
  for (let k = 0; k <= Math.ceil(rangeLen); k++) {
    const i = (r0 + k) % N;
    if (Number.isFinite(pitWallD[i]!)) {
      if (curA < 0) { curA = k; curLen = 0; }
      curLen++;
      if (curLen > bestLen) { bestLen = curLen; bestA = curA; }
    } else curA = -1;
  }
  for (let k = 0; k <= Math.ceil(rangeLen); k++) {
    const i = (r0 + k) % N;
    if (k < bestA || k >= bestA + bestLen) pitWallD[i] = NaN;
  }
  const pwFrom = (r0 + bestA) % N;
  const pwTo = (r0 + bestA + bestLen - 1) % N;
  // Light smoothing of the pit wall line (within its run).
  {
    const idx: number[] = [];
    for (let k = 0; k < bestLen; k++) idx.push((r0 + bestA + k) % N);
    const v = gaussianSmooth(idx.map((i) => pitWallD[i]!), 3, false);
    idx.forEach((i, k) => (pitWallD[i] = Math.max(outerL[i]! + gapW, Math.min(v[k]!, foldLim(i, ps) - 0.6))));
  }
  const pitStraightBase = (i: number): boolean => rangeW(i, strF, strT, 0, L) > 0;
  const joinD = (s: number): number => at(hw, s) + P.narrowHalfWidth + 2.5;
  for (let i = 0; i < N; i++) {
    const wSplit = rangeW(i, wrap(mainSAtSplit - 60, L), mainSAtSplit, 40, L);
    const wMerge = rangeW(i, mainSAtMerge, wrap(mainSAtMerge + 60, L), 40, L);
    const w = Math.max(wSplit, wMerge);
    if (w > 0) left.wallT[i] = left.wallT[i]! + (joinD(i) - left.wallT[i]!) * w;
    if (pitStraightBase(i)) left.base[i] = SURFACE_CODE.concrete;
  }

  // ---- 9. Final wall offsets ------------------------------------------------------------------
  const wallArr: [Float64Array, Float64Array] = [new Float64Array(N), new Float64Array(N)];
  for (let k = 0; k < 2; k++) {
    const o = sides[k]!;
    let a = maxFilter(Array.from(o.wallT), 25, true);
    a = gaussianSmooth(a, 12, true);
    const lim = new Array<number>(N);
    for (let i = 0; i < N; i++) lim[i] = Math.max(hw[i]! + 1.5, Math.min(foldLim(i, k as 0 | 1), clearLim[k]![i]!));
    for (let i = 0; i < N; i++) a[i] = Math.min(a[i]!, lim[i]!);
    a = gaussianSmooth(a, 3, true);
    for (let i = 0; i < N; i++) wallArr[k]![i] = Math.max(hw[i]! + 1.2, Math.min(a[i]!, lim[i]!));
  }
  // Tunnel walls at exactly hw + wallD from portal to portal (the max filter above widens them near the ends).
  for (const tn of closeWalls) {
    const f = wrap(S(tn.from) - 20, L);
    const t = wrap(S(tn.to) + 20, L);
    forRange(f, t, 30, N, (i) => {
      const w = rangeW(i, f, t, 30, L);
      for (const wa of wallArr) wa[i] = wa[i]! + (hw[i]! + tn.wallD - wa[i]!) * w;
    });
  }
  // Fall-zone lip lines at exactly hw + lip (the filters above widen them near the ends).
  for (const fz of A.FALLS ?? []) {
    const f = S(fz.from), t = S(fz.to);
    const wa = wallArr[fz.side === 1 ? 0 : 1];
    forRange(wrap(f - 20, L), wrap(t + 20, L), 30, N, (i) => {
      const w = rangeW(i, wrap(f - 20, L), wrap(t + 20, L), 30, L);
      wa[i] = wa[i]! + (hw[i]! + fz.lip - wa[i]!) * w;
    });
  }
  // The main pit-side barrier joins the pit lane's outer barrier at the split and the merge.
  for (let i = 0; i < N; i++) {
    const wS = smoothstep(-60, 0, loopDeltaN(mainSAtSplit, i, L)) * (loopDeltaN(mainSAtSplit, i, L) <= 0 ? 1 : 0);
    const wM = smoothstep(-60, 0, -loopDeltaN(mainSAtMerge, i, L)) * (loopDeltaN(mainSAtMerge, i, L) >= 0 ? 1 : 0);
    const w = Math.max(wS, wM);
    if (w > 0) wallArr[ps][i] = wallArr[ps][i]! + (joinD(i) - wallArr[ps][i]!) * w;
  }
  // In the pit range the pit-side barrier is the pit wall (or, at the noses, the pit lane's outer wall).
  for (let i = 0; i < N; i++) {
    if (!inRange(i, pitRange.from, pitRange.to, L)) continue;
    if (Number.isFinite(pitWallD[i]!)) wallArr[ps][i] = pitWallD[i]!;
    else if (Number.isFinite(pitDAtMain[i]!)) wallArr[ps][i] = Math.max(hw[i]! + 1.2, pitDAtMain[i]! + hwPAtMain[i]! + 2.5);
  }

  // ---- 10. Bands -------------------------------------------------------------------------------
  const bandType: [Uint8Array, Uint8Array] = [new Uint8Array(N * 4), new Uint8Array(N * 4)];
  const bandOuter: [Float32Array, Float32Array] = [new Float32Array(N * 4), new Float32Array(N * 4)];
  const C = SURFACE_CODE;
  const list: [number, number][] = [];
  for (let k = 0; k < 2; k++) {
    const o = sides[k]!;
    for (let i = 0; i < N; i++) {
      const w = hw[i]!;
      const lim = Math.max(w, wallArr[k]![i]! - 1);
      list.length = 0;
      let off = w;
      if (o.kerb[i]! > 0) { off += o.kerb[i]!; list.push([C.kerbFlat, off]); }
      if (o.astro[i]! > 0) { off += o.astro[i]!; list.push([C.astroturf, off]); }
      const ro = o.runoff[i]!;
      const kind = o.runoffKind[i]!;
      if (ro > 0.5 && kind !== RUNOFF_NONE) {
        const end = w + o.kerb[i]! + ro;
        if (o.sausage[i]) {
          list.push([C.runoffAsphalt, off + A.KERB.sausageGap]);
          list.push([C.kerbSausage, off + A.KERB.sausageGap + A.KERB.sausage]);
          off += A.KERB.sausageGap + A.KERB.sausage;
        } else if (kind === RUNOFF_GRAVEL) {
          off += A.KERB.gravelAsphalt;
          list.push([C.runoffAsphalt, off]);
        }
        list.push([kind === RUNOFF_GRAVEL ? C.gravel : C.runoffAsphalt, Math.max(off, end)]);
      }
      if (list.length < 4) list.push([o.base[i]!, lim]);
      let prev = w;
      for (let b = 0; b < 4; b++) {
        const e = list[Math.min(b, list.length - 1)]!;
        const outer = Math.max(prev, Math.min(e[1], lim));
        bandType[k][i * 4 + b] = e[0];
        bandOuter[k][i * 4 + b] = outer;
        prev = outer;
      }
      // The last band always reaches the wall-1 limit (its type continues to the barrier).
      bandOuter[k][i * 4 + 3] = Math.max(prev, lim);
    }
  }

  // ---- 11. Racing-line approximation (elastic band, 4 m) ---------------------------------------
  const lineD = (() => {
    const Mm = Math.round(L / 4);
    const hh = L / Mm;
    const d = new Float64Array(Mm);
    const cxs = new Float64Array(Mm), czs = new Float64Array(Mm), lxs = new Float64Array(Mm), lzs = new Float64Array(Mm), lim = new Float64Array(Mm);
    for (let k = 0; k < Mm; k++) {
      const s = k * hh;
      const [x0, z0] = mainAt(s, 0);
      const [x1, z1] = mainAt(s, 1);
      cxs[k] = x0; czs[k] = z0; lxs[k] = x1 - x0; lzs[k] = z1 - z0;
      lim[k] = at(hw, s) - 1.6;
    }
    for (let it = 0; it < 250; it++) {
      for (let k = 0; k < Mm; k++) {
        const a = (k - 3 + Mm) % Mm;
        const b = (k + 3) % Mm;
        const mx = 0.5 * (cxs[a]! + lxs[a]! * d[a]! + cxs[b]! + lxs[b]! * d[b]!);
        const mz = 0.5 * (czs[a]! + lzs[a]! * d[a]! + czs[b]! + lzs[b]! * d[b]!);
        const target = (mx - cxs[k]!) * lxs[k]! + (mz - czs[k]!) * lzs[k]!;
        d[k] = clamp(d[k]! + 0.6 * (target - d[k]!), -lim[k]!, lim[k]!);
      }
    }
    const out = new Array<number>(N);
    for (let i = 0; i < N; i++) out[i] = cubicPeriodic(d, i / hh);
    return Float32Array.from(gaussianSmooth(out, 6, true));
  })();

  // ---- 12. Walls (polylines) -------------------------------------------------------------------
  const walls: TrackData['walls'] = [];
  const chains: WallChain[] = [];
  /** Per chain vertex: true where the barrier is absent (fall zone on this chain's side). */
  let gapAt: ((k: number) => boolean) | null = null;
  const pushChain = (pts: [number, number][], kinds: WallKind[], closed: boolean, side: Side, role: WallChain['role']): void => {
    // Merge kind runs shorter than 10 vertices into the previous run.
    const k2 = kinds.slice();
    let runStart = 0;
    for (let i = 1; i <= k2.length; i++) {
      if (i < k2.length && k2[i] === k2[runStart]) continue;
      if (i - runStart < 10 && runStart > 0) for (let m = runStart; m < i; m++) k2[m] = k2[runStart - 1]!;
      runStart = i;
    }
    const chain: WallChain = { pieces: [], closed, role };
    let a = 0;
    const n = pts.length;
    for (let i = 1; i <= n; i++) {
      if (i < n && k2[i] === k2[a]) continue;
      const end = i < n ? i : closed ? 0 : n - 1;
      const seg: number[] = [];
      const flush = (): void => {
        if (seg.length >= 4) {
          chain.pieces.push(walls.length);
          walls.push({ id: walls.length, kind: k2[a]!, height: WALL_HEIGHT[k2[a]!], xz: Float32Array.from(seg), drivableSide: side });
        }
        seg.length = 0;
      };
      for (let m = a; m < i; m++) {
        // Fall zones: the barrier stops (the piece ends at the last vertex before the gap and restarts after it).
        if (gapAt && gapAt(m)) { flush(); continue; }
        seg.push(pts[m]![0], pts[m]![1]);
      }
      if ((i < n || closed) && !(gapAt && gapAt(end))) seg.push(pts[end]![0], pts[end]![1]);
      flush();
      a = i;
    }
    chains.push(chain);
  };
  {
    const pts: [number, number][] = [];
    const kinds: WallKind[] = [];
    const sv: number[] = [];
    for (let s = 0; s < L; s += WALL_STEP) {
      pts.push(mainAt(s, -sg * at(wallArr[op], s)));
      kinds.push(sides[op].wallKind[Math.round(s) % N]!);
      sv.push(s);
    }
    const opSide = (op === 0 ? 1 : -1) as 1 | -1;
    const fz = (A.FALLS ?? []).filter((f) => f.side === opSide).map((f) => [S(f.from), S(f.to)] as const);
    gapAt = fz.length ? (k) => fz.some(([f, t]) => inRange(sv[k]!, f, t, L)) : null;
    pushChain(pts, kinds, true, sg, 'right');
    gapAt = null;
  }
  {
    const pts: [number, number][] = [];
    const kinds: WallKind[] = [];
    const len = wrap(mainSAtSplit - mainSAtMerge, L);
    const steps = Math.max(1, Math.round(len / WALL_STEP));
    const sv: number[] = [];
    for (let k = 0; k <= steps; k++) {
      const s = wrap(mainSAtMerge + (len * k) / steps, L);
      pts.push(mainAt(s, sg * at(wallArr[ps], s)));
      kinds.push(sides[ps].wallKind[Math.round(s) % N]!);
      sv.push(s);
    }
    const psSide = (ps === 0 ? 1 : -1) as 1 | -1;
    const fz = (A.FALLS ?? []).filter((f) => f.side === psSide).map((f) => [S(f.from), S(f.to)] as const);
    gapAt = fz.length ? (k) => k < sv.length && fz.some(([f, t]) => inRange(sv[k]!, f, t, L)) : null;
    const pn = Math.max(1, Math.round(Lp / WALL_STEP));
    for (let k = 0; k <= pn; k++) {
      const sp = (Lp * k) / pn;
      const j = Math.min(Pc - 1, Math.round(sp / dsp));
      const dd = pitOuterWallD[j]!;
      pts.push([pit.x[j]! + pit.tz[j]! * dd, pit.z[j]! - pit.tx[j]! * dd]);
      kinds.push(openW(sp, P.firstBoxSp - 40, P.firstBoxSp + P.boxSpacing * 9 + 40, 0) > 0 ? 'concrete' : 'armco');
    }
    pushChain(pts, kinds, true, (-sg) as Side, 'leftOuter');
    gapAt = null;
  }
  {
    const runLen = wrap(pwTo - pwFrom, L);
    const ptsM: [number, number][] = [];
    const ptsP: [number, number][] = [];
    const steps = Math.max(1, Math.round(runLen / WALL_STEP));
    for (let k = 0; k <= steps; k++) {
      const s = wrap(pwFrom + (runLen * k) / steps, L);
      const dd = pitWallD[Math.round(s) % N]!;
      const d = Number.isFinite(dd) ? dd : pitWallD[pwFrom]!;
      ptsM.push(mainAt(s, sg * d));
      ptsP.push(mainAt(s, sg * (d + P.pitWallThickness)));
    }
    pushChain(ptsM, ptsM.map(() => 'pitwall'), false, (-sg) as Side, 'pitWallMain');
    pushChain(ptsP, ptsP.map(() => 'pitwall'), false, sg, 'pitWallPit');
  }

  // ---- 13. Assemble TrackData ------------------------------------------------------------------
  const f32 = (a: ArrayLike<number>): Float32Array => Float32Array.from(a as ArrayLike<number>);
  const grade = new Float32Array(N);
  const vCurv = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = yArr[(i - 1 + N) % N]!;
    const b = yArr[(i + 1) % N]!;
    grade[i] = (b - a) / 2;
    vCurv[i] = a - 2 * yArr[i]! + b;
  }
  const corners: TrackData['corners'] = A.CORNERS.map((c) => {
    const e = S(c.entry);
    const x = S(c.exit);
    let km = 0;
    const len = wrap(x - e, L);
    for (let k = 0; k <= len; k++) km = Math.max(km, Math.abs(line.kappa[Math.floor(wrap(e + k, L))]!));
    return { n: c.n, dir: c.dir, entryS: e, apexS: S(c.apexes[Math.floor(c.apexes.length / 2)]!), exitS: x, minRadius: km > 0 ? 1 / km : 1e6 };
  });
  const cutZones: TrackData['cutZones'] = A.CORNERS.filter((c) => c.cutZone).map((c) => ({
    id: `T${c.n}`, side: (c.dir === 'L' ? 1 : -1) as Side, fromS: S(c.entry), toS: S(c.exit), gates: c.apexes.map(S),
  }));
  const timingLines: TrackData['timingLines'] = [
    { kind: 'finish', s: 0, ref: 0 },
    { kind: 'sector2', s: S(A.SECTOR2_S), ref: 0 },
    { kind: 'sector3', s: S(A.SECTOR3_S), ref: 0 },
    { kind: 'speedTrap', s: S(A.SPEED_TRAP_S), ref: 0 },
  ];
  for (const z of A.DRS_ZONES) {
    timingLines.push({ kind: 'drsDetect', s: S(z.detect), ref: z.id }, { kind: 'drsActivate', s: S(z.activate), ref: z.id }, { kind: 'drsEnd', s: S(z.end), ref: z.id });
  }
  timingLines.push({ kind: 'pitEntry', s: mainSAtSplit, ref: 0 }, { kind: 'pitExit', s: mainSAtMerge, ref: 0 });
  const grid: TrackData['grid'] = [];
  for (let k = 0; k < A.GRID.slots; k++) grid.push({ s: L - A.GRID.first - A.GRID.spacing * k, d: (k % 2 === 0 ? 1 : -1) * A.GRID.poleSide * A.GRID.d });

  const data: TrackData = {
    id: A.id as TrackData['id'], // 'ardennes' pending CR-TRK-6
    name: { ...A.name },
    length: L, ds: 1, count: N,
    x: f32(line.x), y: f32(yArr), z: f32(line.z), tx: f32(line.tx), tz: f32(line.tz),
    curvature: f32(line.kappa), vCurvature: vCurv, grade, crossSlope: f32(cs),
    halfWidthL: f32(hw), halfWidthR: f32(hw),
    bandTypeL: bandType[0], bandOuterL: bandOuter[0], bandTypeR: bandType[1], bandOuterR: bandOuter[1],
    wallL: f32(wallArr[0]), wallR: f32(wallArr[1]),
    sectors: [S(A.SECTOR2_S), S(A.SECTOR3_S)],
    timingLines,
    drsZones: A.DRS_ZONES.map((z) => ({ id: z.id, detectS: S(z.detect), activateS: S(z.activate), endS: S(z.end) })),
    corners, cutZones, grid, pit, walls,
    startGantryS: 0,
    attribution: raw.attribution.slice(),
  };
  const kerbL = Uint8Array.from(sides[0].kerbKind);
  const kerbR = Uint8Array.from(sides[1].kerbKind);
  const extras: TrackExtras = {
    lineD, pitMainS, pitMainD, pitDsp: dsp, mainPitSp, pitWallD: pitWallD.map((v) => sg * v), pitWallThickness: P.pitWallThickness, pitSide: sg, pitNearD,
    pitRange, pitOuterWallD, paint, kerbL, kerbR, wallKindL: sides[0].wallKind, wallKindR: sides[1].wallKind, chains,
    bumps: (A.BUMPS ?? []).map((b) => ({ from: S(b.from), to: S(b.to), amp: b.amp, wave: b.wave })),
    falls: (A.FALLS ?? []).map((f) => ({ from: S(f.from), to: S(f.to), side: f.side, lip: f.lip })),
    ash: (A.ASH ?? []).map((a) => ({ from: S(a.from), to: S(a.to) })),
    puddles: A.PUDDLES.map((p) => ({ s: S(p.s), d: p.d, len: p.len, width: p.width })),
    reg, sScale: sc, features: raw.features.filter((f) => !A.HIDE_FEATURES.includes(f.id)), terrain: raw.terrain, source: raw.source, local: raw.local ?? null, boxMainS,
    authoring: A,
  };
  setTrackExtras(data, extras);
  return { data, extras };
}
