// Forecast (pit-weather §5, CR-10): a pure function of (timeline, seed, nowS), shared by the HUD presenter and the AI
// so both see the same numbers. Refreshes once per sim minute (seeded error per epoch and horizon).

import type { ConditionsState, ForecastEntry } from '../contracts/conditions';
import { rngOut } from '../core/rng';
import type { ConditionsStateX } from './conditions';
import { maxRainIn } from './weather';

/** Horizons in minutes (§5). */
export const FORECAST_MINUTES: readonly number[] = [5, 10, 15, 30];

/** Deterministic hash of (seed, epoch, h) to [0, 1). */
export function hash01(seed: number, epoch: number, h: number): number {
  let x = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(epoch | 0, 0x85ebca77) ^ Math.imul(h | 0, 0xc2b2ae3d);
  x = (x ^ (x >>> 16)) | 0;
  return rngOut(x);
}

/** Session length the timeline was generated for (s); 3,600 when unknown. */
export function conditionsDurationS(c: ConditionsState): number {
  return (c as Partial<ConditionsStateX>).cx?.durationS ?? 3600;
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
/** Nearest 0.05 (divide, so 0.95 stays 0.95). */
const round20 = (x: number): number => Math.round(x * 20) / 20;

/**
 * Fills `out[0, n)` and returns n (≤ out.length). Horizons beyond the remaining session + 5 min are dropped,
 * keeping at least two.
 */
export function forecast(c: ConditionsState, seed: number, nowS: number, out: ForecastEntry[]): number {
  const remainingMin = (conditionsDurationS(c) - nowS) / 60;
  let n = 0;
  const epoch = Math.floor(nowS / 60);
  for (let i = 0; i < FORECAST_MINUTES.length && n < out.length; i++) {
    const h = FORECAST_MINUTES[i]!;
    if (h > remainingMin + 5 && n >= 2) break;
    const trueRain = maxRainIn(c.timeline, nowS + 60 * h - 60, nowS + 60 * h + 60);
    const e = (hash01(seed, epoch, h) - 0.5) * 2 * (0.03 + 0.012 * h);
    const v = trueRain + e;
    const p = h <= 10 ? clamp(0.5 + 4 * (v - 0.1), 0.05, 0.95) : clamp(0.5 + 2.5 * (v - 0.1), 0.1, 0.9);
    const o = out[n++]!;
    o.inMin = h;
    o.rain = round20(clamp(v, 0, 1));
    o.probability = round20(p);
  }
  return n;
}
