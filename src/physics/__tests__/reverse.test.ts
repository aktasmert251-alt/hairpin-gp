// D-049 / D-051 #7 reverse gear (player only; supersedes the D-040 control mapping): gear −1. At a standstill (< 2 km/h)
// holding the brake (S) 0.3 s or pressing gear-down (Q) in 1st engages R. In R the BRAKE key drives backwards (cap ≈ 25 km/h)
// and the throttle key (W) brakes; W at a standstill in R returns to 1st and drives forward; gear-up (E) also returns to 1st.
// The throttle never drives backwards. The AI never selects R.

import { describe, expect, it } from 'vitest';
import type { SimRunner } from '../../contracts/sim';
import { createSim, defaultSessionConfig } from '../../game/index';
import { MODULE_STATUS as TRACK_STATUS } from '../../track/index';

function ttSim(): SimRunner {
  return createSim(defaultSessionConfig({ mode: 'race', aiCount: 0 }), { skipLights: true });
}

function run(sim: SimRunner, s: number): void {
  for (let i = 0; i < Math.round(s * 240); i++) sim.step();
}

/** One tick with an edge-latched control (gear keys are per-tick presses). */
function press(sim: SimRunner, key: 'gearUpPressed' | 'gearDownPressed'): void {
  const c = sim.world.state.cars[0]!.controls;
  c[key] = true;
  sim.step();
  c[key] = false;
}

describe.skipIf(TRACK_STATUS === 'stub')('reverse gear (D-049)', () => {
  it('holding the brake at a standstill for 0.3 s engages R', () => {
    const sim = ttSim();
    const car = sim.world.state.cars[0]!;
    car.controls.brake = true;
    run(sim, 0.2);
    expect(car.vehicle.gear).toBe(1);
    run(sim, 0.2);
    expect(car.vehicle.gear).toBe(-1);
  });

  it('keep holding the brake: the car drives backwards, capped near 25 km/h, steerable', () => {
    const sim = ttSim();
    const car = sim.world.state.cars[0]!;
    const v = car.vehicle;
    const x0 = v.x, z0 = v.z, fx = Math.cos(v.yaw), fz = -Math.sin(v.yaw), yaw0 = v.yaw;
    car.controls.brake = true;
    run(sim, 2);
    expect(v.gear).toBe(-1);
    expect(v.vLong).toBeLessThan(-1);
    let vMax = 0;
    for (let i = 0; i < 240 * 6; i++) {
      sim.step();
      if (v.speed > vMax) vMax = v.speed;
      expect(v.vLong).toBeLessThan(0.3);
    }
    expect(vMax * 3.6).toBeGreaterThan(20);
    expect(vMax * 3.6).toBeLessThan(27);
    expect((v.x - x0) * fx + (v.z - z0) * fz).toBeLessThan(-20);
    expect(v.rpm).toBeGreaterThanOrEqual(3900);
    expect(v.rpm).toBeLessThan(12_600);
    car.controls.left = true;
    run(sim, 1);
    expect(Math.abs(v.yaw - yaw0)).toBeGreaterThan(0.1);
  });

  it('in R the throttle brakes, never drives backwards; at a standstill it returns to 1st and drives forward', () => {
    const sim = ttSim();
    const car = sim.world.state.cars[0]!;
    const v = car.vehicle;
    car.controls.brake = true;
    run(sim, 4);
    expect(v.vLong).toBeLessThan(-3);
    car.controls.brake = false;
    car.controls.throttle = true;
    let minV = 0;
    let t = 0;
    for (; t < 240 * 3 && v.gear < 0; t++) {
      sim.step();
      expect(v.vLong).toBeGreaterThan(-8); // braking, not accelerating backwards
    }
    expect(v.gear).toBe(1);
    expect(t / 240).toBeLessThan(2);
    run(sim, 1);
    expect(v.vLong).toBeGreaterThan(3);
    // The throttle alone from a standstill in R (via Q): no backwards motion at all.
    const sim2 = ttSim();
    const c2 = sim2.world.state.cars[0]!;
    press(sim2, 'gearDownPressed');
    expect(c2.vehicle.gear).toBe(-1);
    c2.controls.throttle = true;
    for (let i = 0; i < 240 * 2; i++) {
      sim2.step();
      if (c2.vehicle.vLong < minV) minV = c2.vehicle.vLong;
    }
    expect(minV).toBeGreaterThan(-0.3);
    expect(c2.vehicle.gear).toBe(1);
    expect(c2.vehicle.vLong).toBeGreaterThan(2);
  });

  it('gear-down in 1st at a standstill engages R at once; gear-up returns to 1st; not while moving', () => {
    const sim = ttSim();
    const car = sim.world.state.cars[0]!;
    press(sim, 'gearDownPressed');
    expect(car.vehicle.gear).toBe(-1);
    press(sim, 'gearUpPressed');
    expect(car.vehicle.gear).toBe(1);
    car.controls.throttle = true;
    run(sim, 0.5);
    expect(car.vehicle.speed * 3.6).toBeGreaterThan(2);
    press(sim, 'gearDownPressed');
    expect(car.vehicle.gear).toBeGreaterThanOrEqual(1);
  });

  it('braking from speed to a stop and releasing within 0.3 s stays in 1st', () => {
    const sim = ttSim();
    const car = sim.world.state.cars[0]!;
    car.controls.throttle = true;
    run(sim, 2);
    car.controls.throttle = false;
    car.controls.brake = true;
    let stoppedAt = -1;
    for (let i = 0; i < 240 * 5 && stoppedAt < 0; i++) {
      sim.step();
      if (car.vehicle.speed < 0.3) stoppedAt = i;
    }
    expect(stoppedAt).toBeGreaterThan(0);
    run(sim, 0.1);
    car.controls.brake = false;
    run(sim, 0.5);
    expect(car.vehicle.gear).toBe(1);
  });

  it('the AI never selects R (race start: every car holds its brakes on the grid, then races)', () => {
    const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 7, autodrive: true }));
    const cars = sim.world.state.cars;
    // The player car on autodrive is AI-driven too: give it the brake-hold and gear-down a player would use.
    let minGear = 99;
    for (let i = 0; i < 240 * 25; i++) {
      cars[0]!.controls.brake = true;
      cars[0]!.controls.gearDownPressed = true;
      sim.step();
      for (const c of cars) if (c.vehicle.gear < minGear) minGear = c.vehicle.gear;
    }
    expect(minGear).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('deterministic: the same reverse inputs give the same hash', () => {
    const h = (): string => {
      const sim = ttSim();
      const c = sim.world.state.cars[0]!.controls;
      c.brake = true;
      c.left = true;
      run(sim, 3);
      c.brake = false;
      c.throttle = true;
      run(sim, 2);
      return sim.hash();
    };
    expect(h()).toBe(h());
  });
});
