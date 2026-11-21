// S-SM-15: one sim tick with 20 cars <= 0.6 ms mean in Node (testing-qc §2.3).

import { describe, expect, it } from 'vitest';
import { makeSim, stepSeconds } from '../helpers/sim';

describe('S-SM-15 sim tick cost', () => {
  it('20 cars: mean tick <= 0.6 ms after a 5 s warm-up (measured over 20 s)', () => {
    const sim = makeSim({ skipLights: true });
    stepSeconds(sim, 5);
    const ticks = 20 * 240;
    const t0 = performance.now();
    for (let i = 0; i < ticks; i++) {
      sim.step();
      sim.world.events.drain(() => {});
    }
    const mean = (performance.now() - t0) / ticks;
    expect(mean, `mean tick ${mean.toFixed(3)} ms`).toBeLessThanOrEqual(0.6);
  });
});
