// Sim layer: TrackQuery over baked TrackData (1 m samples). Geometry model shared with the build:
// position is linear between samples and the left normal is the (normalised) linear blend of the sample normals,
// so worldFromSD and project are exact inverses (one quadratic per segment). Hot paths allocate nothing.

import type { SurfaceType, Vec3 } from '../../contracts/common';
import type { GroundHit, TrackBundle, TrackData, TrackFrame, TrackHint, TrackQuery, WallHit, WallKind } from '../../contracts/track';
import { getTrackExtras } from '../build/extras';
import { SURFACE_PROPS, SURFACE_TYPES } from './surfaces';

const LINE_W = 0.12;
const WINDOW = 40;
const CELL = 20;
const LIP = 2;
/** Hits deeper than this behind a barrier face are ignored (back-to-back barriers are ≥ 0.5 m apart). */
const MAX_BACK = 0.45; // lateral distance beyond the edge where the banked plane stops (run-offs are flat)

export function createTrackQuery(data: TrackData): TrackQuery {
  const N = data.count;
  const L = data.length;
  const X = data.x, Y = data.y, Z = data.z, TX = data.tx, TZ = data.tz;
  const HL = data.halfWidthL, HR = data.halfWidthR, CS = data.crossSlope, GR = data.grade, KA = data.curvature, VK = data.vCurvature;
  const BTL = data.bandTypeL, BOL = data.bandOuterL, BTR = data.bandTypeR, BOR = data.bandOuterR;
  const s2 = data.sectors[0];
  const s3 = data.sectors[1];
  const pit = data.pit;
  const PC = pit.count;
  const PX = pit.x, PY = pit.y, PZ = pit.z, PTX = pit.tx, PTZ = pit.tz, PHW = pit.halfWidth;
  const ex = getTrackExtras(data);
  const DSP = ex ? ex.pitDsp : PC > 1 ? pit.length / (PC - 1) : 1;
  const INV_DSP = 1 / DSP;
  const LINE_D = ex ? ex.lineD : null;
  const PIT_MAIN_S = ex ? ex.pitMainS : null;
  const MAIN_PIT_SP = ex ? ex.mainPitSp : null;
  /** +1 pit on the left of the main track, −1 on the right. */
  const PIT_SIDE = ex ? ex.pitSide : 1;
  const PUD = ex ? ex.puddles : [];
  const PUD_N = PUD.length;
  const BUMP = ex ? ex.bumps : [];
  const BUMP_N = BUMP.length;
  const FALL = ex ? ex.falls : [];
  const FALL_N = FALL.length;
  const ASH = ex ? ex.ash : [];
  const ASH_N = ASH.length;
  const boxFrom = pit.boxes.length ? pit.boxes[0]!.sp - 12 : 0;
  const boxTo = pit.boxes.length ? pit.boxes[pit.boxes.length - 1]!.sp + 12 : -1;
  /** Pit sp below which a main-track point may switch onto the pit ribbon (the entry side of the lane). */
  const ENTRY_MAX_SP = pit.boxes.length ? boxFrom : 0.5 * pit.length;

  const wrapS = (s: number): number => {
    const r = s % L;
    return r < 0 ? r + L : r;
  };
  const deltaS = (from: number, to: number): number => {
    const d = wrapS(to - from);
    return d > L / 2 ? d - L : d;
  };
  const sectorAt = (s: number): 0 | 1 | 2 => {
    const w = wrapS(s);
    return w < s2 ? 0 : w < s3 ? 1 : 2;
  };

  // ---- main-line projection --------------------------------------------------------------------
  // Result registers (no allocation): segment index, t, d.
  let rI = 0;
  let rT = 0;
  let rD = 0;

  /** Foot-point parameter on segment a→b (see build/project.ts). */
  const solve = (ax: number, az: number, bx: number, bz: number, l0x: number, l0z: number, l1x: number, l1z: number, x: number, z: number): number => {
    const Ax = x - ax;
    const Az = z - az;
    const Dx = bx - ax;
    const Dz = bz - az;
    const DLx = l1x - l0x;
    const DLz = l1z - l0z;
    const qa = -(Dx * DLz - Dz * DLx);
    const qb = Ax * DLz - Az * DLx - (Dx * l0z - Dz * l0x);
    const qc = Ax * l0z - Az * l0x;
    if (qa > -1e-12 && qa < 1e-12) return qb !== 0 ? -qc / qb : 0;
    const disc = qb * qb - 4 * qa * qc;
    if (disc < 0) return qb !== 0 ? -qc / qb : 0;
    const q = -0.5 * (qb + (qb >= 0 ? Math.sqrt(disc) : -Math.sqrt(disc)));
    return q !== 0 ? qc / q : 0;
  };

  const projMain = (x: number, z: number, sHint: number): void => {
    const h = Math.floor(wrapS(sHint));
    let off = 0;
    let lastDir = 0;
    let unit = false;
    let t = 0;
    for (let it = 0; it < 96; it++) {
      let i = h + off;
      i = i >= N ? i - N : i < 0 ? i + N : i;
      const j = i + 1 === N ? 0 : i + 1;
      t = solve(X[i]!, Z[i]!, X[j]!, Z[j]!, TZ[i]!, -TX[i]!, TZ[j]!, -TX[j]!, x, z);
      if (t >= 0 && t <= 1) break;
      const dir = t < 0 ? -1 : 1;
      if (lastDir !== 0 && dir !== lastDir) {
        // Overshot after a jump: continue in unit steps; a second reversal means a wedge between two segments.
        if (unit) {
          t = t < 0 ? 0 : 1;
          break;
        }
        unit = true;
      }
      lastDir = dir;
      // Extrapolated t is only a guide at large |d|·κ: jump at most 70 % of it, then walk one segment at a time.
      let step = unit ? dir : (t < 0 ? Math.ceil(t * 0.7) : Math.floor(t * 0.7));
      if (step === 0) step = dir;
      let next = off + step;
      if (next > WINDOW) next = WINDOW;
      else if (next < -WINDOW) next = -WINDOW;
      if (next === off) {
        t = t < 0 ? 0 : 1;
        break;
      }
      off = next;
    }
    let i = h + off;
    i = i >= N ? i - N : i < 0 ? i + N : i;
    const j = i + 1 === N ? 0 : i + 1;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = X[i]! + (X[j]! - X[i]!) * t;
    const pz = Z[i]! + (Z[j]! - Z[i]!) * t;
    const lx = TZ[i]! + (TZ[j]! - TZ[i]!) * t;
    const lz = -(TX[i]! + (TX[j]! - TX[i]!) * t);
    const inv = 1 / Math.sqrt(lx * lx + lz * lz);
    rI = i;
    rT = t;
    rD = ((x - px) * lx + (z - pz) * lz) * inv;
  };

  // ---- pit projection (open line, spacing DSP) ----------------------------------------------------
  let pI = 0;
  let pT = 0;
  let pD = 0;
  let pOut = 0; // distance beyond the ends along the line (0 inside)
  const projPit = (x: number, z: number, spHint: number): void => {
    const last = PC - 2;
    let h = Math.floor(spHint * INV_DSP);
    h = h < 0 ? 0 : h > last ? last : h;
    let i = h;
    let lastDir = 0;
    let unit = false;
    let t = 0;
    for (let it = 0; it < 96; it++) {
      t = solve(PX[i]!, PZ[i]!, PX[i + 1]!, PZ[i + 1]!, PTZ[i]!, -PTX[i]!, PTZ[i + 1]!, -PTX[i + 1]!, x, z);
      if (t >= 0 && t <= 1) break;
      const dir = t < 0 ? -1 : 1;
      if ((dir < 0 && i === 0) || (dir > 0 && i === last)) break;
      if (lastDir !== 0 && dir !== lastDir) {
        if (unit) break;
        unit = true;
      }
      lastDir = dir;
      let step = unit ? dir : (t < 0 ? Math.ceil(t * 0.7) : Math.floor(t * 0.7));
      if (step === 0) step = dir;
      let n = i + step;
      n = n < 0 ? 0 : n > last ? last : n;
      if (n < h - WINDOW) n = h - WINDOW < 0 ? 0 : h - WINDOW;
      if (n > h + WINDOW) n = h + WINDOW > last ? last : h + WINDOW;
      if (n === i) break;
      i = n;
    }
    pOut = t < 0 ? -t * DSP : t > 1 ? (t - 1) * DSP : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = PX[i]! + (PX[i + 1]! - PX[i]!) * t;
    const pz = PZ[i]! + (PZ[i + 1]! - PZ[i]!) * t;
    const lx = PTZ[i]! + (PTZ[i + 1]! - PTZ[i]!) * t;
    const lz = -(PTX[i]! + (PTX[i + 1]! - PTX[i]!) * t);
    const inv = 1 / Math.sqrt(lx * lx + lz * lz);
    pI = i;
    pT = t;
    pD = ((x - px) * lx + (z - pz) * lz) * inv;
  };

  // ---- frames ------------------------------------------------------------------------------------
  const frameAt = (s: number, out: TrackFrame): TrackFrame => {
    const sw = wrapS(s);
    const i = Math.floor(sw) % N;
    const j = i + 1 === N ? 0 : i + 1;
    const t = sw - Math.floor(sw);
    let tx = TX[i]! + (TX[j]! - TX[i]!) * t;
    let tz = TZ[i]! + (TZ[j]! - TZ[i]!) * t;
    const inv = 1 / Math.sqrt(tx * tx + tz * tz);
    tx *= inv;
    tz *= inv;
    out.s = sw;
    out.px = X[i]! + (X[j]! - X[i]!) * t;
    out.py = Y[i]! + (Y[j]! - Y[i]!) * t;
    out.pz = Z[i]! + (Z[j]! - Z[i]!) * t;
    out.tx = tx;
    out.tz = tz;
    out.lx = tz;
    out.lz = -tx;
    out.halfWidthL = HL[i]! + (HL[j]! - HL[i]!) * t;
    out.halfWidthR = HR[i]! + (HR[j]! - HR[i]!) * t;
    out.crossSlope = CS[i]! + (CS[j]! - CS[i]!) * t;
    out.curvature = KA[i]! + (KA[j]! - KA[i]!) * t;
    out.vCurvature = VK[i]! + (VK[j]! - VK[i]!) * t;
    out.grade = GR[i]! + (GR[j]! - GR[i]!) * t;
    out.sector = sw < s2 ? 0 : sw < s3 ? 1 : 2;
    return out;
  };

  const worldFromSD = (s: number, d: number, out: Vec3): Vec3 => {
    const sw = wrapS(s);
    const i = Math.floor(sw) % N;
    const j = i + 1 === N ? 0 : i + 1;
    const t = sw - Math.floor(sw);
    const lx = TZ[i]! + (TZ[j]! - TZ[i]!) * t;
    const lz = -(TX[i]! + (TX[j]! - TX[i]!) * t);
    const inv = 1 / Math.sqrt(lx * lx + lz * lz);
    const hl = HL[i]! + (HL[j]! - HL[i]!) * t;
    const hr = HR[i]! + (HR[j]! - HR[i]!) * t;
    const dc = d > hl + LIP ? hl + LIP : d < -hr - LIP ? -hr - LIP : d;
    out.x = X[i]! + (X[j]! - X[i]!) * t + lx * inv * d;
    out.y = Y[i]! + (Y[j]! - Y[i]!) * t + (CS[i]! + (CS[j]! - CS[i]!) * t) * dc;
    out.z = Z[i]! + (Z[j]! - Z[i]!) * t + lz * inv * d;
    return out;
  };

  const pitWorldFromSD = (sp: number, d: number, out: Vec3): Vec3 => {
    if (PC < 2) return worldFromSD(sp, d, out);
    let u = sp * INV_DSP;
    u = u < 0 ? 0 : u > PC - 1 ? PC - 1 : u;
    let i = Math.floor(u);
    if (i > PC - 2) i = PC - 2;
    const t = u - i;
    const lx = PTZ[i]! + (PTZ[i + 1]! - PTZ[i]!) * t;
    const lz = -(PTX[i]! + (PTX[i + 1]! - PTX[i]!) * t);
    const inv = 1 / Math.sqrt(lx * lx + lz * lz);
    out.x = PX[i]! + (PX[i + 1]! - PX[i]!) * t + lx * inv * d;
    out.y = PY[i]! + (PY[i + 1]! - PY[i]!) * t;
    out.z = PZ[i]! + (PZ[i + 1]! - PZ[i]!) * t + lz * inv * d;
    return out;
  };

  const project = (x: number, z: number, hint: TrackHint, out: { s: number; d: number }): void => {
    projMain(x, z, hint.s);
    out.s = wrapS(rI + rT);
    out.d = rD;
  };

  // ---- ground --------------------------------------------------------------------------------------
  const wetAt = (s: number, d: number, i: number): number => {
    for (let k = 0; k < PUD_N; k++) {
      const p = PUD[k]!;
      let ds = s - p.s;
      if (ds > L / 2) ds -= L;
      else if (ds < -L / 2) ds += L;
      const u = (2 * ds) / p.len;
      const v = (2 * (d - p.d)) / p.width;
      if (u * u + v * v <= 1) return 2;
    }
    if (!LINE_D) return 1;
    let off = d - LINE_D[i]!;
    if (off < 0) off = -off;
    return off <= 1.5 ? 0 : off >= 3 ? 1 : (off - 1.5) / 1.5;
  };

  const groundPit = (x: number, z: number, hint: TrackHint, out: GroundHit): void => {
    const i = pI;
    const t = pT;
    const sp = (i + t) * DSP;
    out.y = PY[i]! + (PY[i + 1]! - PY[i]!) * t;
    const g = (PY[i + 1]! - PY[i]!) * INV_DSP;
    const tx = PTX[i]! + (PTX[i + 1]! - PTX[i]!) * t;
    const tz = PTZ[i]! + (PTZ[i + 1]! - PTZ[i]!) * t;
    const nx = -g * tx;
    const nz = -g * tz;
    const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
    out.nx = nx * inv;
    out.ny = inv;
    out.nz = nz * inv;
    out.surface = PIT_SIDE * pD > 0.25 && sp >= boxFrom && sp <= boxTo ? 'concrete' : 'pitAsphalt';
    out.ribbon = 'pit';
    out.sp = sp;
    out.d = pD;
    out.inLimits = true;
    // Main-track s of this pit point.
    const sh = PIT_MAIN_S ? PIT_MAIN_S[i]! : hint.s;
    projMain(x, z, sh);
    out.s = wrapS(rI + rT);
    out.wetLocal = 1;
    hint.ribbon = 'pit';
    hint.sp = sp;
    hint.s = out.s;
  };

  const ground = (x: number, z: number, hint: TrackHint, out: GroundHit): GroundHit => {
    if (PC > 1 && hint.ribbon === 'pit') {
      projPit(x, z, hint.sp === hint.sp ? hint.sp : 0);
      const hw = PHW[pI]! + (PHW[pI + 1]! - PHW[pI]!) * pT;
      if (pOut === 0 && pD <= hw + 0.05 && pD >= -hw - 0.05) {
        groundPit(x, z, hint, out);
        return out;
      }
      if (PIT_MAIN_S) hint.s = PIT_MAIN_S[pI]!;
    }
    projMain(x, z, hint.s);
    const i = rI;
    const j = i + 1 === N ? 0 : i + 1;
    const t = rT;
    const d = rD;
    const s = wrapS(i + t);
    const hl = HL[i]! + (HL[j]! - HL[i]!) * t;
    const hr = HR[i]! + (HR[j]! - HR[i]!) * t;
    if ((PIT_SIDE > 0 ? d > hl : d < -hr) && MAIN_PIT_SP && PC > 1) {
      const k = t < 0.5 ? i : j;
      const spH = MAIN_PIT_SP[k]!;
      // main → pit only through the entry gate (the lane before the boxes). At the exit merge a main-track car running
      // wide onto the exit lane's tarmac was put on the pit ribbon, which the pit procedure reads as an unrequested
      // entry: limiter, then 'boxIn' toward a box behind it under pitAuto (player stuck in the pit exit at İstanbul
      // T1–T2, user bug 2026-10-13). Cars leaving the pit are already on the pit ribbon.
      if (spH === spH && spH < ENTRY_MAX_SP) {
        projPit(x, z, spH);
        const hw = PHW[pI]! + (PHW[pI + 1]! - PHW[pI]!) * pT;
        if (pOut === 0 && pD <= hw && pD >= -hw) {
          groundPit(x, z, hint, out);
          return out;
        }
      }
    }
    const k = t < 0.5 ? i : j;
    let surface: SurfaceType;
    let inLimits: boolean;
    if (d >= 0) {
      inLimits = d <= hl;
      if (d <= hl - LINE_W) surface = 'asphalt';
      else if (inLimits) surface = 'line';
      else {
        const b = k * 4;
        surface = SURFACE_TYPES[d <= BOL[b]! ? BTL[b]! : d <= BOL[b + 1]! ? BTL[b + 1]! : d <= BOL[b + 2]! ? BTL[b + 2]! : BTL[b + 3]!]!;
      }
    } else {
      const ad = -d;
      inLimits = ad <= hr;
      if (ad <= hr - LINE_W) surface = 'asphalt';
      else if (inLimits) surface = 'line';
      else {
        const b = k * 4;
        surface = SURFACE_TYPES[ad <= BOR[b]! ? BTR[b]! : ad <= BOR[b + 1]! ? BTR[b + 1]! : ad <= BOR[b + 2]! ? BTR[b + 2]! : BTR[b + 3]!]!;
      }
    }
    // Volcanic ash drifts (authoring ASH): the racing surface inside the limits is 'ash'.
    for (let a = 0; a < ASH_N; a++) {
      const ar = ASH[a]!;
      if (inLimits && s >= ar.from && s <= ar.to) surface = 'ash';
    }
    const c = CS[i]! + (CS[j]! - CS[i]!) * t;
    const flat = d > hl + LIP || d < -hr - LIP;
    const dc = d > hl + LIP ? hl + LIP : d < -hr - LIP ? -hr - LIP : d;
    out.y = Y[i]! + (Y[j]! - Y[i]!) * t + c * dc;
    let g = GR[i]! + (GR[j]! - GR[i]!) * t;
    // Fall zones (authoring FALLS): beyond the lip the ground drops away steeply (the car tips over the edge before the
    // collision system resets it 5 m past the lip line).
    for (let f = 0; f < FALL_N; f++) {
      const fz = FALL[f]!;
      if (s < fz.from - 20 || s > fz.to + 20) continue;
      const beyond = fz.side > 0 ? d - hl - fz.lip : -d - hr - fz.lip;
      if (beyond > 0) out.y -= beyond * beyond * 0.6 + beyond * 0.8;
    }
    // Bumpy sections (authoring BUMPS): height and slope of a two-harmonic washboard along s, faded over 10 m.
    for (let b = 0; b < BUMP_N; b++) {
      const bp = BUMP[b]!;
      if (s < bp.from || s > bp.to) continue;
      const fade = Math.min(1, (s - bp.from) / 10, (bp.to - s) / 10);
      const k1 = 6.283185307179586 / bp.wave, k2 = k1 * 2.37;
      const a = bp.amp * fade;
      out.y += a * (0.7 * Math.sin(k1 * s) + 0.3 * Math.sin(k2 * s + 1.3 + 0.4 * d));
      g += a * (0.7 * k1 * Math.cos(k1 * s) + 0.3 * k2 * Math.cos(k2 * s + 1.3 + 0.4 * d));
    }
    const tx = TX[i]!;
    const tz = TZ[i]!;
    const ce = flat ? 0 : c;
    // n ∝ (−∂y/∂x, 1, −∂y/∂z) with ∂y = g along t and ce along l = (tz, −tx).
    const nx = -(g * tx + ce * tz);
    const nz = -(g * tz - ce * tx);
    const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
    out.nx = nx * inv;
    out.ny = inv;
    out.nz = nz * inv;
    out.surface = surface;
    out.ribbon = 'main';
    out.s = s;
    out.d = d;
    out.sp = NaN;
    out.inLimits = inLimits;
    out.wetLocal = wetAt(s, d, k);
    hint.s = s;
    hint.ribbon = 'main';
    hint.sp = NaN;
    return out;
  };

  // ---- walls: 20 m spatial hash over every wall segment ----------------------------------------------
  let segCount = 0;
  for (const w of data.walls) segCount += Math.max(0, w.xz.length / 2 - 1);
  const SAX = new Float64Array(segCount), SAZ = new Float64Array(segCount), SBX = new Float64Array(segCount), SBZ = new Float64Array(segCount);
  const SNX = new Float64Array(segCount), SNZ = new Float64Array(segCount), SLEN = new Float64Array(segCount);
  const SWALL = new Int32Array(segCount);
  const WKIND: WallKind[] = data.walls.map((w) => w.kind);
  const WID: number[] = data.walls.map((w) => w.id);
  // Thin two-faced walls (pit wall): a point is only ever reported against the face on its own side.
  const PARTNER = new Int32Array(data.walls.length).fill(-1);
  if (ex) {
    const pm = ex.chains.find((c) => c.role === 'pitWallMain');
    const pp = ex.chains.find((c) => c.role === 'pitWallPit');
    if (pm && pp) pm.pieces.forEach((wi, k) => {
      const wj = pp.pieces[k];
      if (wj !== undefined) { PARTNER[wi] = wj; PARTNER[wj] = wi; }
    });
  }
  let gx0 = Infinity, gz0 = Infinity, gx1 = -Infinity, gz1 = -Infinity;
  {
    let k = 0;
    data.walls.forEach((w, wi) => {
      const n = w.xz.length / 2;
      for (let m = 0; m + 1 < n; m++) {
        const ax = w.xz[m * 2]!, az = w.xz[m * 2 + 1]!, bx = w.xz[m * 2 + 2]!, bz = w.xz[m * 2 + 3]!;
        const len = Math.hypot(bx - ax, bz - az) || 1e-9;
        const ux = (bx - ax) / len, uz = (bz - az) / len;
        SAX[k] = ax; SAZ[k] = az; SBX[k] = bx; SBZ[k] = bz; SLEN[k] = len;
        // Left of the segment direction = (uz, −ux); drivable side picks the sign.
        SNX[k] = w.drivableSide * uz;
        SNZ[k] = -w.drivableSide * ux;
        SWALL[k] = wi;
        gx0 = Math.min(gx0, ax, bx); gx1 = Math.max(gx1, ax, bx); gz0 = Math.min(gz0, az, bz); gz1 = Math.max(gz1, az, bz);
        k++;
      }
    });
  }
  if (segCount === 0) { gx0 = 0; gz0 = 0; gx1 = 1; gz1 = 1; }
  const GW = Math.floor((gx1 - gx0) / CELL) + 1;
  const GH = Math.floor((gz1 - gz0) / CELL) + 1;
  const cellStart = new Int32Array(GW * GH + 1);
  let cellItems = new Int32Array(0);
  {
    const counts = new Int32Array(GW * GH);
    const each = (k: number, fn: (c: number) => void): void => {
      const cx0 = Math.floor((Math.min(SAX[k]!, SBX[k]!) - gx0) / CELL), cx1 = Math.floor((Math.max(SAX[k]!, SBX[k]!) - gx0) / CELL);
      const cz0 = Math.floor((Math.min(SAZ[k]!, SBZ[k]!) - gz0) / CELL), cz1 = Math.floor((Math.max(SAZ[k]!, SBZ[k]!) - gz0) / CELL);
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) fn(cx + cz * GW);
    };
    for (let k = 0; k < segCount; k++) each(k, (c) => counts[c]!++);
    for (let c = 0; c < GW * GH; c++) cellStart[c + 1] = cellStart[c]! + counts[c]!;
    cellItems = new Int32Array(cellStart[GW * GH]!);
    const fill = cellStart.slice(0, GW * GH);
    for (let k = 0; k < segCount; k++) each(k, (c) => { cellItems[fill[c]!++] = k; });
  }
  const stamp = new Int32Array(segCount);
  let stampId = 0;

  const wallsNear = (x: number, z: number, radius: number, out: WallHit[], max: number): number => {
    let n = 0;
    if (segCount === 0 || max <= 0) return 0;
    stampId++;
    let cx0 = Math.floor((x - radius - gx0) / CELL), cx1 = Math.floor((x + radius - gx0) / CELL);
    let cz0 = Math.floor((z - radius - gz0) / CELL), cz1 = Math.floor((z + radius - gz0) / CELL);
    if (cx0 < 0) cx0 = 0;
    if (cz0 < 0) cz0 = 0;
    if (cx1 >= GW) cx1 = GW - 1;
    if (cz1 >= GH) cz1 = GH - 1;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cx + cz * GW;
        for (let m = cellStart[c]!; m < cellStart[c + 1]!; m++) {
          const k = cellItems[m]!;
          if (stamp[k] === stampId) continue;
          stamp[k] = stampId;
          const ax = SAX[k]!, az = SAZ[k]!;
          const len = SLEN[k]!;
          const ux = (SBX[k]! - ax) / len, uz = (SBZ[k]! - az) / len;
          let u = (x - ax) * ux + (z - az) * uz;
          u = u < 0 ? 0 : u > len ? len : u;
          const px = ax + ux * u;
          const pz = az + uz * u;
          let nx = SNX[k]!, nz = SNZ[k]!;
          let dist: number;
          if (u > 0 && u < len) dist = (x - px) * nx + (z - pz) * nz;
          else {
            // Past a segment end the closest feature is the end point: report its own normal (end point → query
            // point). The segment's infinite plane put a car beside the pit-wall nose 1.8 m "behind" the pit face, and
            // the collision push-out moved it 3 m through the wall into the pit lane (user bug 2026-10-13).
            const qx = x - px, qz = z - pz;
            dist = Math.sqrt(qx * qx + qz * qz);
            if (dist > 1e-9) { nx = qx / dist; nz = qz / dist; }
          }
          if (dist >= radius || dist <= -radius || dist < -MAX_BACK) continue;
          const wi = SWALL[k]!;
          const id = WID[wi]!;
          const pw = PARTNER[wi]!;
          const pid = pw >= 0 ? WID[pw]! : -1;
          let slot = -1;
          let replace = false;
          for (let q = 0; q < n; q++) {
            const o = out[q]!;
            if (o.wallId === id) {
              // Same wall: keep the closest segment.
              if ((dist < 0 ? -dist : dist) >= (o.dist < 0 ? -o.dist : o.dist)) { slot = -2; break; }
              slot = q;
              replace = true;
              break;
            }
            if (o.wallId === pid) {
              // Other face of a thin wall: keep only the face the point is on, i.e. the face it is in front of (the
              // nearer one if in front of both, e.g. one face reported at its end point; the shallower one inside).
              const keepOld = (o.dist >= 0) !== (dist >= 0) ? o.dist >= 0 : o.dist >= 0 ? o.dist <= dist : o.dist >= dist;
              if (keepOld) { slot = -2; break; }
              slot = q;
              replace = true;
              break;
            }
          }
          if (slot === -2) continue;
          if (!replace) {
            if (n >= max) continue;
            slot = n++;
          }
          const h = out[slot] ?? (out[slot] = { nx: 0, nz: 0, px: 0, pz: 0, dist: 0, wallId: 0, kind: 'armco' });
          h.nx = nx;
          h.nz = nz;
          h.px = px;
          h.pz = pz;
          h.dist = dist;
          h.wallId = id;
          h.kind = WKIND[wi]!;
        }
      }
    }
    return n;
  };

  return {
    data, length: L, frameAt, worldFromSD, pitWorldFromSD, project, ground, wallsNear,
    surfaceProps: (t) => SURFACE_PROPS[t], wrapS, deltaS, sectorAt,
  };
}

export function createTrackBundle(data: TrackData): TrackBundle {
  return { data, query: createTrackQuery(data) };
}
