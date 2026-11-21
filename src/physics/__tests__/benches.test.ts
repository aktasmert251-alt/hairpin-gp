// Physics benches, planner-report §5.11 Sprint 1 subset (U-PH-01…18, 21). Dry, Medium at optimum temperature,
// fuel 10 kg, ES full, flat straight test track (skidpad on the flat plane).

import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../contracts/sim';
import { createRng } from '../../core/rng';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { findNonFinite } from '../../game/sim/stateUtils';
import { createStraightTrack } from '../../track/index';
import { createBench } from './helpers/benchWorld';
import { accelTimes, braking, lateralG, topSpeed } from './helpers/measure';

const HZ = 240;

describe('§5.11 acceleration and top speed', () => {
  const a = accelTimes();
  it('0–100 km/h in 2.5–2.9 s (TC Full, auto)', () => {
    expect(a.t100).toBeGreaterThanOrEqual(2.5);
    expect(a.t100).toBeLessThanOrEqual(2.9);
  });
  it('0–200 km/h in 4.6–5.4 s', () => {
    expect(a.t200).toBeGreaterThanOrEqual(4.6);
    expect(a.t200).toBeLessThanOrEqual(5.4);
  });
  it('0–300 km/h in 10.0–12.5 s', () => {
    expect(a.t300).toBeGreaterThanOrEqual(10);
    expect(a.t300).toBeLessThanOrEqual(12.5);
  });
  const ers = topSpeed('ers');
  it('top speed with ERS deploying, DRS closed: 322–332 km/h', () => {
    expect(ers).toBeGreaterThanOrEqual(322);
    expect(ers).toBeLessThanOrEqual(332);
  });
  it('DRS open adds 9–15 km/h', () => {
    const d = topSpeed('drs') - ers;
    expect(d).toBeGreaterThanOrEqual(9);
    expect(d).toBeLessThanOrEqual(15);
  });
  it('top speed with ES empty: 300–310 km/h', () => {
    const e = topSpeed('empty');
    expect(e).toBeGreaterThanOrEqual(300);
    expect(e).toBeLessThanOrEqual(310);
  });
});

describe('§5.11 braking', () => {
  it('200→0 km/h (ABS on) in 50–65 m', () => {
    const r = braking(200, 0);
    expect(r.dist).toBeGreaterThanOrEqual(50);
    expect(r.dist).toBeLessThanOrEqual(65);
  });
  it('300→100 km/h in 70–95 m, peak deceleration 4.5–5.5 g', () => {
    const r = braking(300, 100);
    expect(r.dist).toBeGreaterThanOrEqual(70);
    expect(r.dist).toBeLessThanOrEqual(95);
    expect(r.peakG).toBeGreaterThanOrEqual(4.5);
    expect(r.peakG).toBeLessThanOrEqual(5.5);
  });
});

describe('§5.11 steady lateral acceleration (flat plane)', () => {
  it('80 km/h: 1.9–2.4 g, front axle saturates first', () => {
    const r = lateralG(80);
    expect(r.spun).toBe(false);
    expect(r.g).toBeGreaterThanOrEqual(1.9);
    expect(r.g).toBeLessThanOrEqual(2.4);
  });
  it('250 km/h: 4.3–5.2 g, no spin before the limit', () => {
    const r = lateralG(250);
    expect(r.spun).toBe(false);
    expect(r.g).toBeGreaterThanOrEqual(4.3);
    expect(r.g).toBeLessThanOrEqual(5.2);
    expect(r.rearA).toBeLessThan(r.frontA);
  });
});

describe('robustness', () => {
  it('standstill jitter < 1 mm/s over 10 s (U-PH-16)', () => {
    const b = createBench(createStraightTrack(2000), { s: 100 });
    let max = 0;
    for (let i = 0; i < 10 * HZ; i++) {
      b.step();
      if (b.car.vehicle.speed > max) max = b.car.vehicle.speed;
    }
    expect(max).toBeLessThan(0.001);
  });

  it('10 min of random keyboard input on the oval: no NaN, no reset loops (U-PH-17)', () => {
    const sim = createSim(defaultSessionConfig({ mode: 'timeTrial', aiCount: 0, seed: 7 }), { skipLights: true });
    const car = sim.world.state.cars[0]!;
    const rng = createRng(12345);
    const c = car.controls;
    let nan: string | null = null;
    for (let i = 0; i < 600 * HZ; i++) {
      if (i % 60 === 0) {
        c.throttle = rng.next() < 0.65;
        c.brake = rng.next() < 0.2;
        const s = rng.next();
        c.left = s < 0.3;
        c.right = s > 0.7;
        c.gearUpPressed = rng.next() < 0.05;
        c.gearDownPressed = rng.next() < 0.05;
        c.drsPressed = rng.next() < 0.05;
        c.ersOvertakeHeld = rng.next() < 0.1;
      } else {
        c.gearUpPressed = false;
        c.gearDownPressed = false;
        c.drsPressed = false;
      }
      sim.step();
      if (i % HZ === 0) {
        sim.world.events.drain(() => {});
        nan = findNonFinite(car.vehicle, 'vehicle');
        if (nan) break;
      }
    }
    expect(nan).toBeNull();
    // Resets may happen (stuck in the grass), but never in a loop.
    expect(car.vehicle.resetCount).toBeLessThan(60);
  });

  it('bitwise determinism: same seed and inputs give the same hash after 60 s (U-PH-18)', () => {
    const run = (): string => {
      const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 19, seed: 1234, autodrive: true }), { skipLights: true });
      for (let i = 0; i < 60 * HZ; i++) {
        sim.step();
        if (i % HZ === 0) sim.world.events.drain(() => {});
      }
      return sim.hash();
    };
    expect(run()).toBe(run());
  });

  it('snapshot → continue → restore → re-run gives the same state', () => {
    const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 7, seed: 99, autodrive: true }), { skipLights: true });
    for (let i = 0; i < 10 * HZ; i++) sim.step();
    sim.world.events.drain(() => {});
    const snap = sim.snapshot();
    for (let i = 0; i < 10 * HZ; i++) sim.step();
    const h1 = sim.hash();
    sim.restore(snap);
    for (let i = 0; i < 10 * HZ; i++) sim.step();
    expect(sim.hash()).toBe(h1);
  });
});

it('SIM_DT is 1/240', () => {
  expect(SIM_DT).toBeCloseTo(1 / 240, 12);
});
