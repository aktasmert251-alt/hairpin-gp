// Tyre thermal targets (planner-report §5.4 (a)–(e), U-PH-19) and wear life on İstanbul with the perfect-AI driver
// (S2-S4 calibration: report bands; (d) "about +15 °C" is asserted at ±3 °C, wear life at ±1 lap).

import { describe, expect, it } from 'vitest';
import type { Compound } from '../../contracts/common';
import { MODULE_STATUS as TRACK_STATUS } from '../../track/index';
import { localWetness, tempGrip, tyreForce, wearGrip, type TyreForceOut } from '../tyre/grip';
import { defaultCompounds } from '../params';
import { tcDriveTorque } from '../assists/wheelAssists';
import { thermalRun } from './helpers/thermalRun';

describe('grip curves', () => {
  it('temperature grip: 1 at optimum, −25 % max cold, −30 % max hot', () => {
    const m = defaultCompounds().medium;
    expect(tempGrip(m, m.tOptC)).toBe(1);
    expect(tempGrip(m, m.tOptC - 100)).toBeCloseTo(0.75, 6);
    expect(tempGrip(m, m.tOptC + 100)).toBeCloseTo(0.7, 6);
  });
  it('wear grip: −10 % at 0.7, cliff to −45 % at 1', () => {
    expect(wearGrip(0)).toBe(1);
    expect(wearGrip(0.7)).toBeCloseTo(0.9, 6);
    expect(wearGrip(1)).toBeCloseTo(0.55, 6);
  });
  it('per-wheel wetness (pit-weather §4.4): lerp(line, track, wetLocal); puddles only add water above W 0.65', () => {
    // D-040 bug: the physics used W·wetLocal, so the racing line was bone dry in any rain (sudden grip steps
    // crossing it) and a puddle doubled W (Inters at W 0.5 dropped to the W 1 grip, then aquaplaned).
    expect(localWetness(0.5, 0.4, 0)).toBeCloseTo(0.4, 9);
    expect(localWetness(0.5, 0.4, 0.5)).toBeCloseTo(0.45, 9);
    expect(localWetness(0.5, 0.4, 1)).toBeCloseTo(0.5, 9);
    expect(localWetness(0.5, 0.4, 2)).toBeCloseTo(0.5, 9);
    expect(localWetness(0.7, 0.6, 2)).toBe(1);
    expect(localWetness(0, 0, 2)).toBe(0);
  });
  it('slide drop: only the force past the peak is scaled (D-040 progressive wet tyres)', () => {
    const o: TyreForceOut = { fx: 0, fy: 0, sigma: 0, dfxdk: 0 };
    const t = Math.tan(0.1);
    const base = (s: number, drop: number): number => Math.abs(tyreForce(0, s * t, 1000, 0.11, t, 1.35, o, drop).fy);
    expect(base(0.6, 0.5)).toBeCloseTo(base(0.6, 1), 9);
    expect(base(1, 0.5)).toBeCloseTo(base(1, 1), 6);
    const lost = 1000 - base(10, 1);
    expect(lost).toBeGreaterThan(100);
    expect(1000 - base(10, 0.5)).toBeCloseTo(lost * 0.5, 6);
  });
  it('wet TC keeps the rear inside its friction circle (D-040: no power oversteer at the wet limit)', () => {
    const tA = Math.tan(0.1);
    const tc = (sy: number, wet: number): number => tcDriveTorque(3000, 0.16, 0, sy * tA, 4000, 0.13, tA, 1.3, 1.4, 0, 20, 0.36, wet);
    // Dry and straight-line unchanged.
    expect(tc(0.7, 0)).toBe(tcDriveTorque(3000, 0.16, 0, 0.7 * tA, 4000, 0.13, tA, 1.3, 1.4, 0, 20, 0.36));
    // Wet, cornering at σy 0.7: the slip budget keeps combined σ ≤ 0.9 → much less drive than the dry target allows.
    expect(tc(0.7, 1)).toBeLessThan(0.85 * tc(0.7, 0));
    // Wet at σy ≥ 0.9: drive torque is down to rolling resistance.
    expect(tc(0.95, 1)).toBeLessThanOrEqual(20 + 1e-9);
  });
});

describe.skipIf(TRACK_STATUS === 'stub')('thermal targets (İstanbul push laps)', () => {
  it('(a) Medium blanket → 95–105 °C core in one push lap; (b) in window on push laps; (c) slow lap cools 10–15 °C', () => {
    const r = thermalRun('medium');
    r.lap();
    // The out-lap from the TT start counts as the first push lap.
    expect(r.core()).toBeGreaterThanOrEqual(95);
    expect(r.core()).toBeLessThanOrEqual(105);
    r.lap();
    r.lap();
    // (b) every tyre inside the Medium window (105 ± 20 °C).
    for (const t of r.sim.world.state.cars[0]!.vehicle.tyres) {
      expect(Math.abs(t.coreC - 105)).toBeLessThanOrEqual(20);
      expect(Math.abs(t.surfC - 105)).toBeLessThanOrEqual(20);
    }
    const c0 = r.core();
    r.pace(0.6);
    r.lap();
    const drop = c0 - r.core();
    expect(drop).toBeGreaterThanOrEqual(10);
    expect(drop).toBeLessThanOrEqual(15);
  }, 300_000);
  it('(d) Soft overheats by about +15 °C after three push laps', () => {
    const r = thermalRun('soft');
    r.lap();
    r.lap();
    r.lap();
    const over = r.core() - 100;
    expect(over).toBeGreaterThanOrEqual(12);
    expect(over).toBeLessThanOrEqual(18);
  }, 300_000);
  it('(e) a slick drops to about 60 °C within one lap at W > 0.5', () => {
    const r = thermalRun('medium');
    r.lap();
    r.setWet(0.6);
    r.pace(0.6);
    r.lap(250);
    // "About 60 °C": W = line W = rain = 0.6 held (the L9 ConditionsSystem would dry a dry-preset track), the AI on
    // its rebuilt wet profile: 65.8 °C.
    expect(r.core()).toBeGreaterThanOrEqual(53);
    expect(r.core()).toBeLessThanOrEqual(67);
  }, 300_000);
});

describe.skipIf(TRACK_STATUS === 'stub')('wear life (wearScale 1, d = 100)', () => {
  /** Laps (interpolated) until the most worn tyre reaches 0.7. */
  const lapsTo07 = (c: Compound): number => {
    const r = thermalRun(c);
    const tyres = r.sim.world.state.cars[0]!.vehicle.tyres;
    const maxWear = (): number => Math.max(tyres[0].wear, tyres[1].wear, tyres[2].wear, tyres[3].wear);
    let prev = 0;
    for (let k = 1; k <= 50; k++) {
      r.lap();
      const w = maxWear();
      if (w >= 0.7) return k - 1 + (0.7 - prev) / (w - prev);
      prev = w;
    }
    return Infinity;
  };
  it.each([['soft', 18], ['medium', 28], ['hard', 38]] as [Compound, number][])('%s reaches 0.7 at %i laps (± 1)', (c, n) => {
    const laps = lapsTo07(c);
    console.log(`wear 0.7: ${c} ${laps.toFixed(1)} laps`);
    expect(Math.abs(laps - n)).toBeLessThanOrEqual(1);
  }, 300_000);
});
