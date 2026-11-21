// D-056 safety car, AI side: under the SC the AI cars follow the director's queue speed (race.scTargetSpeed), do not
// pass racing cars and do not touch each other. Ardennes seed 1234 (d55, 3 laps): the last car retires on track at 60 s
// (retireCar: it brakes to a stop where it is and the marshals clear it later), which brings the SC out.

import { describe, expect, it } from 'vitest';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { retireCar } from '../../race/penalties';
import { loadTrack } from '../../track/index';

function ready(): boolean {
  try {
    return loadTrack('ardennes').data.id === 'ardennes';
  } catch {
    return false;
  }
}

describe.skipIf(!ready())('AI under the safety car (D-056)', () => {
  it('queues behind the SC: no SC-overtake penalties, no car-to-car contact under the SC, the rest restart and finish', () => {
    const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 19, laps: 3, autodrive: true, trackId: 'ardennes', seed: 1234, difficulty: 55 }));
    const w = sim.world;
    let deployed = false;
    let scPen = 0;
    let contacts = 0;
    let finished = 0;
    let over = 0;
    let retired = -1;
    while (w.state.race.phase !== 'finished' && w.state.race.raceMs < 700_000) {
      sim.step();
      if (retired < 0 && w.state.race.raceMs >= 60_000) {
        retired = w.state.race.order[w.state.race.order.length - 1]!;
        retireCar(w, retired);
      }
      const sc = w.state.race.sc.phase;
      w.events.drain((e) => {
        if (e.type === 'penalty' && e.reason === 'safetyCar') scPen++;
        if (sc !== 'none' && e.type === 'collision' && e.b >= 0 && e.a !== retired && e.b !== retired) contacts++;
        if (e.type === 'finish') finished++;
      });
      if (sc === 'deployed') {
        deployed = true;
        for (const c of w.state.cars) {
          const t = c.race.scTargetSpeed;
          if (t >= 0 && c.vehicle.speed > t + 4) over++;
        }
      }
    }
    expect(deployed).toBe(true);
    expect(scPen).toBe(0);
    expect(contacts).toBe(0);
    expect(finished).toBe(19);
    // A few ticks right after the deployment / a target drop are expected (braking down); not a sustained overspeed.
    expect(over).toBeLessThan(240 * 20);
  }, 600_000);
});
