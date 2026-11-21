// S-SM-11 race start (testing-qc §2.3): lights 5 x 1 s, hold 0.2-3.0 s (seeded), no AI jump start, no first-lap pile-up
// (<= 2 collisions above 5 kN*s). KNOWN RED at Sprint 2 start (owner Surus: AI start racecraft).

import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../src/contracts/sim';
import { SEEDS, makeSim, stepSeconds } from '../helpers/sim';

describe('S-SM-11 race start', () => {
  for (const seed of [SEEDS.field, SEEDS.other, 99]) {
    it(`seed ${seed}: no jump start by AI, <= 2 big collisions during the first 25 s after lights out, hold in 0.2..3.0 s`, () => {
      const sim = makeSim({ cfg: { seed, laps: 3, autodrive: true } });
      let lightsOutAt = -1;
      let fifth = -1;
      const big: { a: number; b: number; imp: number; t: number }[] = [];
      let jump = 0;
      const sink = (e: SimEvent): void => {
        const t = sim.world.state.time;
        if (e.type === 'lightsOn' && e.count === 5) fifth = t;
        if (e.type === 'lightsOut') lightsOutAt = t;
        if (e.type === 'jumpStart') jump++;
        if (e.type === 'collision' && lightsOutAt >= 0 && e.impulse > 5000) big.push({ a: e.a, b: e.b, imp: e.impulse, t: t - lightsOutAt });
      };
      for (let i = 0; i < 40 * 240 && !(lightsOutAt >= 0 && sim.world.state.time > lightsOutAt + 25); i++) {
        sim.step();
        sim.world.events.drain(sink);
      }
      expect(lightsOutAt, 'lights out happened').toBeGreaterThan(0);
      expect(lightsOutAt - fifth, 'hold').toBeGreaterThanOrEqual(0.2 - 0.01);
      expect(lightsOutAt - fifth).toBeLessThanOrEqual(3.0 + 0.01);
      expect(jump, 'jump starts').toBe(0);
      expect(big.length, `collisions > 5 kN*s in first lap start (seed ${seed}): ${JSON.stringify(big.slice(0, 6))}`).toBeLessThanOrEqual(2);
      void stepSeconds;
    });
  }
});
