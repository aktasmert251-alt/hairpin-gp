// S2-S6 wet compounds (testing-qc S-SM-07): lap-time deltas of the perfect AI on İstanbul against the dry Medium
// (second lap of a Time Trial run, wetness held: W = line W = rain). Inters at W 0.5 +8–13 %, Wets at W 1 +15–22 %,
// slicks at W 0.6 at least +25 %; Inters and Wets within 1 % of each other at the 0.62 crossover.

import { describe, expect, it } from 'vitest';
import type { Compound } from '../../contracts/common';
import { MODULE_STATUS as TRACK_STATUS } from '../../track/index';
import { thermalRun } from './helpers/thermalRun';

function lap2(c: Compound, w: number): number {
  const r = thermalRun(c);
  if (w > 0) r.setWet(w);
  r.lap(250);
  const t = r.lap(250);
  expect(r.sim.world.state.cars[0]!.vehicle.resetCount).toBe(0);
  return t;
}

describe.skipIf(TRACK_STATUS === 'stub')('wet compounds (S-SM-07)', () => {
  it('Inters W 0.5 +8–13 %, Wets W 1 +15–22 %, slicks W 0.6 ≥ +25 %, inter/wet crossover ≈ 0.62', () => {
    const dry = lap2('medium', 0);
    const d = (t: number): number => (100 * (t - dry)) / dry;
    const inter = d(lap2('inter', 0.5));
    const wet = d(lap2('wet', 1));
    const slick = d(lap2('medium', 0.6));
    const xi = lap2('inter', 0.62);
    const xw = lap2('wet', 0.62);
    console.log(`S-SM-07: dry ${dry.toFixed(2)} s; inter W0.5 +${inter.toFixed(1)} %, wet W1 +${wet.toFixed(1)} %, slick W0.6 +${slick.toFixed(1)} %; W0.62 inter ${xi.toFixed(2)} / wet ${xw.toFixed(2)} s`);
    expect(inter).toBeGreaterThanOrEqual(8);
    expect(inter).toBeLessThanOrEqual(13);
    expect(wet).toBeGreaterThanOrEqual(15);
    expect(wet).toBeLessThanOrEqual(22);
    expect(slick).toBeGreaterThanOrEqual(25);
    expect(Math.abs(xi - xw) / xw).toBeLessThan(0.01);
  }, 600_000);
});
