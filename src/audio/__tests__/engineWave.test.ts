// Engine-cycle wavetable (audio realism pass): one 4-stroke cycle of six uneven exhaust pulses. Harmonic k of the
// cycle frequency (rpm/120) is engine order k/2, so harmonic 6 = 3rd order (firing) must dominate, the half orders
// (odd harmonics) must be present but weaker, and the narrow load pulses must be brighter than the overrun ones.

import { describe, expect, it } from 'vitest';
import { engineCycleWave } from '../engine/engineVoice';

type Coefs = { r: Float32Array; i: Float32Array };
const fakeCtx = { createPeriodicWave: (r: Float32Array, i: Float32Array) => ({ r, i }) } as unknown as BaseAudioContext;
const mags = (width: number, spread: number): number[] => {
  const w = engineCycleWave(fakeCtx, width, spread) as unknown as Coefs;
  return Array.from(w.r, (re, k) => Math.hypot(re, w.i[k]!));
};
const db = (x: number): number => 20 * Math.log10(x);

describe('engineCycleWave', () => {
  const load = mags(0.42, 1);
  const over = mags(0.75, 2.2);

  it('3rd engine order (harmonic 6) is the strongest component', () => {
    const top = load.indexOf(Math.max(...load));
    expect(top).toBe(6);
    expect(over.indexOf(Math.max(...over))).toBe(6);
  });

  it('half orders are present 8–40 dB below the firing order, more so on overrun', () => {
    for (const k of [1, 3, 9]) {
      const rel = db(load[k]! / load[6]!);
      expect(rel).toBeLessThan(-8);
      expect(rel).toBeGreaterThan(-40);
    }
    const halfSum = (m: number[]): number => m[1]! + m[3]! + m[5]! + m[7]!;
    expect(halfSum(over) / over[6]!).toBeGreaterThan(halfSum(load) / load[6]!);
  });

  it('load pulses are brighter than overrun pulses (energy above the 12th order)', () => {
    const hf = (m: number[]): number => m.slice(25).reduce((a, x) => a + x * x, 0) / m.reduce((a, x) => a + x * x, 0);
    expect(hf(load)).toBeGreaterThan(2 * hf(over));
  });
});
