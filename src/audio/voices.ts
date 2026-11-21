// AI voice selection and Doppler (audio.md §5). Pure and allocation-free, shared by the live AudioSystem and the
// offline replay renderer so both pick the same voices: the up-to-8 nearest AI cars to the listener, re-ranked every
// 0.25 s of audio time with 15 % distance hysteresis (a held car keeps its slot unless a free car is > 15 % nearer).

export const MAX_AI_VOICES = 8;
export const RERANK_S = 0.25;
const HYST = 0.85;
const C_SOUND = 343;

export interface VoiceCar { px: number; py: number; pz: number; fx: number; fy: number; fz: number; speed: number; visible: boolean; isPlayer: boolean }
export interface VoiceListener { px: number; py: number; pz: number; vx: number; vy: number; vz: number }

export interface VoiceSelection {
  /** Car index per voice slot (−1 = free). */
  slot: Int32Array;
  /** Audio time of the last re-rank (s). */
  lastT: number;
  /** Scratch: squared distance per car. */
  d2: Float64Array;
}

export function newVoiceSelection(maxCars = 32): VoiceSelection {
  return { slot: new Int32Array(MAX_AI_VOICES).fill(-1), lastT: -1e9, d2: new Float64Array(maxCars) };
}

function held(sel: VoiceSelection, car: number): number {
  for (let k = 0; k < MAX_AI_VOICES; k++) if (sel.slot[k] === car) return k;
  return -1;
}

/** Re-ranks when 0.25 s have passed since the last re-rank; returns true when it did. */
export function selectVoices(sel: VoiceSelection, cars: readonly VoiceCar[], n: number, lis: VoiceListener, t: number): boolean {
  if (t - sel.lastT < RERANK_S) return false;
  sel.lastT = t;
  const d2 = sel.d2;
  for (let i = 0; i < n; i++) {
    const c = cars[i]!;
    if (c.isPlayer || !c.visible) {
      d2[i] = Infinity;
      continue;
    }
    const dx = c.px - lis.px;
    const dy = c.py - lis.py;
    const dz = c.pz - lis.pz;
    d2[i] = dx * dx + dy * dy + dz * dz;
  }
  // Drop held cars that are gone.
  for (let k = 0; k < MAX_AI_VOICES; k++) {
    const c = sel.slot[k]!;
    if (c >= n || (c >= 0 && d2[c] === Infinity)) sel.slot[k] = -1;
  }
  // Greedy: repeatedly take the nearest unheld car; it fills a free slot or replaces the farthest held car if it
  // is more than 15 % nearer (in distance: d2 < farthest·0.85²).
  for (let pass = 0; pass < MAX_AI_VOICES; pass++) {
    let best = -1;
    for (let i = 0; i < n; i++) if (d2[i]! < Infinity && held(sel, i) < 0 && (best < 0 || d2[i]! < d2[best]!)) best = i;
    if (best < 0) break;
    let free = -1;
    let far = -1;
    for (let k = 0; k < MAX_AI_VOICES; k++) {
      const c = sel.slot[k]!;
      if (c < 0) {
        if (free < 0) free = k;
      } else if (far < 0 || d2[c]! > d2[sel.slot[far]!]!) far = k;
    }
    if (free >= 0) sel.slot[free] = best;
    else if (far >= 0 && d2[best]! < d2[sel.slot[far]!]! * HYST * HYST) sel.slot[far] = best;
    else break;
  }
  return true;
}

export function activeVoices(sel: VoiceSelection): number {
  let n = 0;
  for (let k = 0; k < MAX_AI_VOICES; k++) if (sel.slot[k]! >= 0) n++;
  return n;
}

/** Doppler ratio for a source moving along its forward vector at `speed`, clamped to [0.6, 1.6]. */
export function dopplerRatio(c: VoiceCar, lis: VoiceListener): number {
  let nx = lis.px - c.px;
  let ny = lis.py - c.py;
  let nz = lis.pz - c.pz;
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (!(l > 1e-6)) return 1;
  nx /= l;
  ny /= l;
  nz /= l;
  const vS = (c.fx * nx + c.fy * ny + c.fz * nz) * c.speed;
  const vL = lis.vx * nx + lis.vy * ny + lis.vz * nz;
  const den = C_SOUND - vS;
  if (!(den > 1)) return 1.6;
  const r = (C_SOUND - vL) / den;
  return r < 0.6 ? 0.6 : r > 1.6 ? 1.6 : r === r ? r : 1;
}
