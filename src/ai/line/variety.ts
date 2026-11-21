// Per-driver line variety (user request + QC2-05). Each AI car picks, for every corner it takes, one of five line
// options, drawn from a hash of (race seed, car, lap, corner) with weights shaped by its driver profile and tyres:
//   standard · early apex (tight entry, wide exit) · late apex (wide entry, tight exit) · inside (defensive cover) ·
//   kerb (deeper apex over the inside kerb)
// The option's lateral offset is a smooth bump around the corner (raised cosines, no snapping); a slow, lap-dependent
// drift and a per-car bias sit underneath. The same hash gives a per-corner commitment (corner-speed) factor, so
// neighbours trade time corner by corner (planner-report §6.9 "lap-to-lap noise", widened). The race seed is mixed
// in, so a driver's T4 on lap 1 differs from race to race, while the same seed replays identically (flashback,
// replay). Pure functions of static data + lap + quantised tyre wear: no RNG state. Sim layer, allocation-free.

import type { TrackQuery } from '../../contracts/track';

export const LINE_OPTIONS = ['standard', 'early', 'late', 'inside', 'kerb'] as const;
export type LineOption = 0 | 1 | 2 | 3 | 4;

export interface CornerWindows {
  count: number;
  apexS: Float64Array;
  /** Raised-cosine half-width (m) of the corner window around the apex. */
  halfW: Float64Array;
  /** +1 left / −1 right (inside = +d for a left turn). */
  dir: Float64Array;
}

export function buildCornerWindows(q: TrackQuery): CornerWindows {
  const cs = q.data.corners;
  const w: CornerWindows = { count: cs.length, apexS: new Float64Array(cs.length), halfW: new Float64Array(cs.length), dir: new Float64Array(cs.length) };
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!;
    w.apexS[i] = c.apexS;
    const span = q.deltaS(c.entryS, c.exitS);
    w.halfW[i] = Math.max(60, 0.5 * (span > 0 ? span : 0) + 40);
    w.dir[i] = c.dir === 'L' ? 1 : -1;
  }
  return w;
}

/** 32-bit integer hash of (a, b, c) → uniform in [−1, 1). */
export function hashU(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 2147483648 - 1;
}

/** Roughly normal (σ = 1, bounded at ±3) from three hashes. */
function hashN(a: number, b: number, c: number): number {
  return hashU(a, b, c) + hashU(a + 101, b, c) + hashU(a + 211, b, c);
}

/** Per-car hash seed: the race seed mixed with the car id (a new line every race, identical on replay). */
export function varietySeed(raceSeed: number, carId: number): number {
  return Math.floor(2147483647 * hashU(raceSeed, carId, 0x5eed)) | 0;
}

/** Static driver inputs of the option weights. */
export interface VarietyDriver {
  /** Per-car hash seed (race seed × car). */
  seed: number;
  /** Per-car lateral bias (m). */
  bias: number;
  consistency: number;
  aggression: number;
  tyreMgmt: number;
  /** Corner-commitment σ (fraction of corner speed). */
  sigmaV: number;
}

const W_TMP = new Float64Array(5);

/**
 * Option weights for one driver: consistency → more 'standard'; aggression → more late / kerb; worn tyres
 * (quantised to 0.1) with good tyre management → smoother, wider lines (late, fewer kerbs); a wet line (W ≥ 0.3)
 * leaves the rubbered line (late / wide entry). Writes W_TMP (sum 1).
 */
function weights(dv: VarietyDriver, wearQ: number, wet: number): Float64Array {
  const c = dv.consistency;
  const a = dv.aggression;
  const tm = wearQ >= 0.3 ? dv.tyreMgmt : 0;
  W_TMP[0] = 0.2 + 1.2 * (c - 0.75);
  W_TMP[1] = 0.2 - 0.1 * tm;
  W_TMP[2] = 0.15 + 0.15 * a + 0.2 * tm + (wet >= 0.3 ? 0.3 : 0);
  W_TMP[3] = 0.05 + 0.1 * a;
  W_TMP[4] = 0.1 + 0.2 * a - 0.1 * tm - (wet >= 0.3 ? 0.1 : 0);
  let sum = 0;
  for (let i = 0; i < 5; i++) sum += W_TMP[i]! > 0.02 ? W_TMP[i]! : (W_TMP[i] = 0.02);
  for (let i = 0; i < 5; i++) W_TMP[i] = W_TMP[i]! / sum;
  return W_TMP;
}

/** The option a driver takes at corner `c` on lap `lap`. */
export function pickOption(dv: VarietyDriver, lap: number, c: number, wearQ: number, wet: number): LineOption {
  const w = weights(dv, wearQ, wet);
  const u = 0.5 + 0.5 * hashU(dv.seed, lap, 3000 + c);
  let acc = 0;
  for (let i = 0; i < 5; i++) {
    acc += w[i]!;
    if (u < acc) return i as LineOption;
  }
  return 0;
}

function bump(x: number, x0: number, hw: number): number {
  const t = (x - x0) / hw;
  return t <= -1 || t >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * t);
}

/** Lateral offset (m, + = toward the inside) of option `o` at x = (s − apex) / halfWidth. */
function optionOffset(o: LineOption, x: number): number {
  switch (o) {
    case 1: return 1.1 * bump(x, -0.45, 0.45) - 1.0 * bump(x, 0.3, 0.55);
    case 2: return -1.1 * bump(x, -0.35, 0.55) + 0.6 * bump(x, 0.35, 0.4);
    case 3: return 1.2 * bump(x, -0.35, 0.65);
    case 4: return 0.5 * bump(x, 0, 0.35);
    default: return 0;
  }
}

/** Corner-speed factor of option `o` (inside cover and early apex cost a little; kerbs gain a little). */
const OPTION_V = [1, 0.996, 0.997, 0.985, 1.003];

export interface VarietyOut {
  /** Lateral offset (m) from the racing line, + = left. */
  dOff: number;
  /** Corner-speed factor. */
  vMul: number;
  /** Option of the corner the car is in (−1: none). */
  option: number;
}

/** Evaluated at main-track s on lap `lap` (laps completed); `wear` = worst tyre wear, `wet` = line wetness. */
export function variety(cw: CornerWindows, q: TrackQuery, dv: VarietyDriver, s: number, lap: number, wear: number, wet: number, out: VarietyOut): void {
  const L = q.length;
  const seed = dv.seed;
  const ph = 2 * Math.PI * hashU(seed, lap, 7);
  let d = dv.bias + 0.3 * Math.sin((2 * Math.PI * s) / 700 + ph) + 0.15 * Math.sin((2 * Math.PI * s) / 260 + 2.1 * ph);
  // Lap form: one corner-speed offset for the whole lap (half the per-corner σ).
  let v = 1 + 0.5 * dv.sigmaV * hashN(seed, lap, 5000);
  const wearQ = Math.floor(wear * 10) / 10;
  out.option = -1;
  for (let c = 0; c < cw.count; c++) {
    const a = cw.apexS[c]!;
    const W = cw.halfW[c]!;
    const da = q.deltaS(a, s);
    if (da >= W || da <= -W) continue;
    // The corner belongs to the lap in which its apex is passed (no jump at the S/F line).
    let k = lap;
    if (a - s > 0.5 * L) k -= 1;
    else if (s - a > 0.5 * L) k += 1;
    const o = pickOption(dv, k, c, wearQ, wet);
    const x = da / W;
    d += cw.dir[c]! * optionOffset(o, x);
    const wA = 0.5 + 0.5 * Math.cos(Math.PI * x);
    v += ((OPTION_V[o]! - 1) + dv.sigmaV * hashN(seed, k, 1000 + c)) * wA;
    if (wA > 0.5) out.option = o;
  }
  out.dOff = d;
  out.vMul = v;
}
