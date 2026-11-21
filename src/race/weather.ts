// Weather timeline (pit-weather §4.1–§4.3, sim layer, pure and seeded): presets, the `variable` Markov generator,
// rain interpolation and the derived cloud cover.

import type { WeatherPreset } from '../contracts/common';
import type { WeatherKeyframe } from '../contracts/conditions';
import { rngOut, rngStep } from '../core/rng';

/** §4.1 base rain of the constant presets (light / heavy get ±0.08 keyframes every 120 s). */
export const PRESET_RAIN: Readonly<Record<Exclude<WeatherPreset, 'variable'>, number>> = { dry: 0, light: 0.3, heavy: 0.85 };
export const BASE_CLOUD: Readonly<Record<WeatherPreset, number>> = { dry: 0.15, light: 0.85, heavy: 1, variable: 0.25 };

const PRESET_JITTER = 0.08;
const PRESET_STEP_S = 120;

/** Markov states DRY, DRIZZLE, RAIN, HEAVY: rain bands and transition rows (§4.2). */
const BANDS: readonly (readonly [number, number])[] = [[0, 0], [0.15, 0.25], [0.4, 0.6], [0.75, 0.95]];
const START: readonly number[] = [0.55, 0.3, 0.15, 0];
const NEXT: readonly (readonly number[])[] = [
  [0, 0.6, 0.3, 0.1],
  [0.45, 0, 0.4, 0.15],
  [0.3, 0.35, 0, 0.35],
  [0, 0.4, 0.6, 0],
];
const MAX_TRIES = 8;

/** Local mulberry32 (never touches state.rng). */
function makeRng(seed: number): () => number {
  let s = (seed ^ 0x5eed7a1e) | 0;
  return () => {
    s = rngStep(s);
    return rngOut(s);
  };
}

function pick(row: readonly number[], u: number): number {
  let acc = 0;
  for (let i = 0; i < row.length; i++) {
    acc += row[i]!;
    if (u < acc) return i;
  }
  return row.length - 1;
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const r2 = (x: number): number => Math.round(x * 100) / 100;

interface Segment { t0: number; t1: number; state: number; rain: number }

function variableSegments(seed: number, durationS: number): Segment[] {
  const rnd = makeRng(seed);
  const segs: Segment[] = [];
  let state = pick(START, rnd());
  let t = 0;
  while (t < durationS) {
    const len = clamp(durationS * (0.18 + 0.17 * rnd()), 90, 900);
    const [lo, hi] = BANDS[state]!;
    segs.push({ t0: t, t1: t + len, state, rain: r2(lo + (hi - lo) * rnd()) });
    t += len;
    state = pick(NEXT[state]!, rnd());
  }
  return segs;
}

function segmentsOk(segs: readonly Segment[], durationS: number): boolean {
  return segs.some((s) => s.rain >= 0.4 && s.t0 < 0.6 * durationS) && segs.some((s) => s.state === 0);
}

/** Keyframes with linear ramps of clamp(0.15·segment, 30, 120) s between segment levels. */
function toKeyframes(segs: readonly Segment[]): WeatherKeyframe[] {
  const out: WeatherKeyframe[] = [{ t: 0, rain: segs[0]!.rain }];
  for (let i = 1; i < segs.length; i++) {
    const s = segs[i]!;
    const ramp = clamp(0.15 * (s.t1 - s.t0), 30, 120);
    const half = Math.min(ramp / 2, (segs[i - 1]!.t1 - segs[i - 1]!.t0) / 2);
    out.push({ t: Math.round(s.t0 - half), rain: segs[i - 1]!.rain });
    out.push({ t: Math.round(s.t0 - half + ramp), rain: s.rain });
  }
  return out;
}

/** §4.2: rain keyframes (t in s from session start), deterministic for (preset, seed, durationS). */
export function generateWeatherTimeline(p: WeatherPreset, seed: number, durationS: number): WeatherKeyframe[] {
  const dur = Math.max(60, durationS);
  if (p === 'dry') return [{ t: 0, rain: 0 }];
  if (p !== 'variable') {
    const rnd = makeRng(seed);
    const base = PRESET_RAIN[p];
    const out: WeatherKeyframe[] = [];
    for (let t = 0; t <= dur + PRESET_STEP_S; t += PRESET_STEP_S) out.push({ t, rain: r2(clamp(base + (rnd() * 2 - 1) * PRESET_JITTER, 0, 1)) });
    return out;
  }
  for (let k = 0; k < MAX_TRIES; k++) {
    const segs = variableSegments(seed + k, dur);
    if (segmentsOk(segs, dur)) return toKeyframes(segs);
  }
  // Forced DRY → RAIN → DRY with changes at 25 % and 60 %.
  return toKeyframes([
    { t0: 0, t1: 0.25 * dur, state: 0, rain: 0 },
    { t0: 0.25 * dur, t1: 0.6 * dur, state: 2, rain: 0.5 },
    { t0: 0.6 * dur, t1: dur, state: 0, rain: 0 },
  ]);
}

/** Linear interpolation of the timeline at time t (constant outside). */
export function rainAt(timeline: readonly WeatherKeyframe[], t: number): number {
  const n = timeline.length;
  if (n === 0) return 0;
  if (t <= timeline[0]!.t) return timeline[0]!.rain;
  for (let i = 1; i < n; i++) {
    const b = timeline[i]!;
    if (t <= b.t) {
      const a = timeline[i - 1]!;
      return a.rain + ((b.rain - a.rain) * (t - a.t)) / Math.max(1e-6, b.t - a.t);
    }
  }
  return timeline[n - 1]!.rain;
}

/** Maximum of rain(t) over [t0, t1] (piecewise linear: the ends and any keyframe inside). */
export function maxRainIn(timeline: readonly WeatherKeyframe[], t0: number, t1: number): number {
  let m = Math.max(rainAt(timeline, t0), rainAt(timeline, t1));
  for (let i = 0; i < timeline.length; i++) {
    const k = timeline[i]!;
    if (k.t > t0 && k.t < t1 && k.rain > m) m = k.rain;
  }
  return m;
}

/** §4.3: clouds arrive 2 minutes before the rain. */
export function cloudAt(timeline: readonly WeatherKeyframe[], preset: WeatherPreset, t: number): number {
  const r = rainAt(timeline, t);
  return Math.max(BASE_CLOUD[preset], clamp(2.5 * rainAt(timeline, t + 120) + (r > 0 ? 0.1 : 0), 0, 1));
}
