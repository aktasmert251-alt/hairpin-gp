// S1 keyboard filter (planner-report §5.7, U-PH-20) and PlayerInputSystem.

import { describe, expect, it } from 'vitest';
import type { KeyboardFilterState } from '../../contracts/vehicle';
import { SIM_DT } from '../../contracts/sim';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { airDensity } from '../constants';
import { brakeLimiterScale, filterBrake, filterSteer, filterThrottle, shapeSteer } from '../input/keyboardFilter';
import { createPlayerInputSystem } from '../input/playerInputSystem';
import { wetGrip } from '../tyre/grip';
import { frontWindowK } from '../assists/driverAssists';
import { defaultVehicleParams } from '../params';
import { brakeLockPedal, steerLimit } from '../vehicle/estimates';

const kb = (): KeyboardFilterState => ({ steerU: 0, throttle: 0, brake: 0 });

function timeToFullLock(v: number): number {
  const s = kb();
  let t = 0;
  while (s.steerU < 1 && t < 5) {
    filterSteer(s, true, false, v, 1, SIM_DT);
    t += SIM_DT;
  }
  return t;
}

describe('steering ramp', () => {
  it('full lock in 0.25 s at 0 km/h (±5 %)', () => {
    const t = timeToFullLock(0);
    expect(t).toBeGreaterThanOrEqual(0.25 * 0.95);
    expect(t).toBeLessThanOrEqual(0.25 * 1.05);
  });
  it('full lock in 0.62 s at ≥ 288 km/h (±5 %)', () => {
    for (const kmh of [288, 330]) {
      const t = timeToFullLock(kmh / 3.6);
      expect(t).toBeGreaterThanOrEqual(0.62 * 0.95);
      expect(t).toBeLessThanOrEqual(0.62 * 1.05);
    }
  });
  it('release centres at 6/s', () => {
    const s = kb();
    s.steerU = 1;
    let t = 0;
    while (s.steerU > 0) {
      filterSteer(s, false, false, 30, 1, SIM_DT);
      t += SIM_DT;
    }
    expect(t).toBeCloseTo(1 / 6, 2);
  });
  it('a reversal passes through exactly 0 before ramping the other way', () => {
    const s = kb();
    s.steerU = 0.8;
    const seen: number[] = [];
    for (let i = 0; i < 120; i++) seen.push(filterSteer(s, false, true, 40, 1, SIM_DT));
    const firstNeg = seen.findIndex((u) => u < 0);
    expect(firstNeg).toBeGreaterThan(0);
    expect(seen[firstNeg - 1]).toBe(0);
    // Monotonic: never bounces back up while the right key is held.
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeLessThanOrEqual(seen[i - 1]!);
    expect(seen[seen.length - 1]).toBeLessThan(-0.5);
  });
  it('|u|^1.4 shaping is odd and maps ±1 to ±1', () => {
    expect(shapeSteer(1)).toBe(1);
    expect(shapeSteer(-1)).toBe(-1);
    expect(shapeSteer(0.5)).toBeCloseTo(Math.pow(0.5, 1.4), 12);
    expect(shapeSteer(-0.5)).toBeCloseTo(-Math.pow(0.5, 1.4), 12);
  });
});

describe('pedal ramps', () => {
  it('throttle in 6/s, out 10/s; brake in 8/s, out 12/s', () => {
    const s = kb();
    let n = 0;
    while (s.throttle < 1) { filterThrottle(s, true, SIM_DT); n++; }
    expect(n * SIM_DT).toBeCloseTo(1 / 6, 2);
    n = 0;
    while (s.throttle > 0) { filterThrottle(s, false, SIM_DT); n++; }
    expect(n * SIM_DT).toBeCloseTo(1 / 10, 2);
    n = 0;
    while (s.brake < 1) { filterBrake(s, true, SIM_DT); n++; }
    expect(n * SIM_DT).toBeCloseTo(1 / 8, 2);
    n = 0;
    while (s.brake > 0) { filterBrake(s, false, SIM_DT); n++; }
    expect(n * SIM_DT).toBeCloseTo(1 / 12, 2);
  });
});

describe('PlayerInputSystem', () => {
  const setup = (kmh: number) => {
    const sim = createSim(defaultSessionConfig({ mode: 'timeTrial', aiCount: 0 }), { skipLights: true });
    const world = sim.world;
    const car = world.state.cars[0]!;
    const v = car.vehicle;
    v.speed = kmh / 3.6;
    v.vLong = v.speed;
    for (const t of v.tyres) t.gripMul = 1;
    return { world, car, sys: createPlayerInputSystem() };
  };

  it('keyboard brake limiter: full key = 1.05 × the estimated lock threshold', () => {
    const { world, car, sys } = setup(120);
    car.controls.brake = true;
    for (let i = 0; i < 60; i++) sys.step(world, SIM_DT);
    const p = world.static.params[0]!;
    const v = car.vehicle;
    const comp = p.compounds[v.compound];
    const muBase = comp.mu * wetGrip(comp, 0) * 1 * 1;
    const lock = brakeLockPedal(p, muBase, v.speed, v.massKg, airDensity(p.airDensity, world.state.conditions.airC), p.brakeBiasDefault);
    expect(lock).toBeLessThan(1 / 1.05);
    expect(car.input.brake).toBeCloseTo(brakeLimiterScale(lock), 6);
    expect(car.input.brake).toBeCloseTo(1.05 * lock, 6);
  });

  it('holding a steering key settles at δmax(v), clamped by the front-slip window of the steering assist', () => {
    const { world, car, sys } = setup(150);
    car.controls.left = true;
    for (let i = 0; i < 240; i++) sys.step(world, SIM_DT);
    const p = world.static.params[0]!;
    const v = car.vehicle;
    const dMax = steerLimit(p, v.compound, 0, v.speed, v.massKg, airDensity(p.airDensity, world.state.conditions.airC), true);
    // Car not yet rotating (θf = 0): the window caps the fronts at 0.9·αpk.
    const win = 0.9 * p.compounds[v.compound].slipAnglePeak;
    expect(car.kb.steerU).toBe(1);
    expect(car.input.steer * p.maxSteerRad).toBeCloseTo(Math.min(dMax, win), 6);
  });

  it('assist off: holding a key settles exactly at δmax(v) with k = 1.25', () => {
    const { world, car, sys } = setup(150);
    world.static.config.assists.steering = false;
    car.controls.left = true;
    for (let i = 0; i < 240; i++) sys.step(world, SIM_DT);
    const p = world.static.params[0]!;
    const v = car.vehicle;
    const dMax = steerLimit(p, v.compound, 0, v.speed, v.massKg, airDensity(p.airDensity, world.state.conditions.airC), false);
    expect(car.input.steer * p.maxSteerRad).toBeCloseTo(dMax, 6);
  });

  it('DriverControls.steerSensitivity scales the steer ramp (D-023); NaN falls back to 1', () => {
    const ramp = (sens: number): number => {
      const { world, car, sys } = setup(100);
      car.controls.steerSensitivity = sens;
      car.controls.left = true;
      for (let i = 0; i < 12; i++) sys.step(world, SIM_DT);
      return car.kb.steerU;
    };
    expect(ramp(1.5)).toBeCloseTo(1.5 * ramp(1), 6);
    expect(ramp(0.5)).toBeCloseTo(0.5 * ramp(1), 6);
    expect(ramp(NaN)).toBeCloseTo(ramp(1), 6);
  });

  it('skips cars that are not player-controlled', () => {
    const { world, car, sys } = setup(100);
    car.control = 'ai';
    car.controls.throttle = true;
    sys.step(world, SIM_DT);
    expect(car.kb.throttle).toBe(0);
  });

  it('pit limiter toggles on the key edge', () => {
    const { world, car, sys } = setup(50);
    car.controls.pitLimiterPressed = true;
    sys.step(world, SIM_DT);
    expect(car.input.pitLimiter).toBe(true);
    car.controls.pitLimiterPressed = false;
    sys.step(world, SIM_DT);
    expect(car.input.pitLimiter).toBe(true);
    car.controls.pitLimiterPressed = true;
    sys.step(world, SIM_DT);
    expect(car.input.pitLimiter).toBe(false);
  });
});

describe('wet stability assist (D-040)', () => {
  it('front-slip window: 0.9·αpk normally; shrinks when the rear slides (wet); dry only on a real slide', () => {
    const p = defaultVehicleParams(0);
    const sim = createSim(defaultSessionConfig({ mode: 'timeTrial', aiCount: 0, startCompound: 'wet' }), { skipLights: true });
    const v = sim.world.state.cars[0]!.vehicle;
    const apkR = p.compounds.wet.slipAnglePeak * 0.9;
    v.wheels[2].slipAngle = 0.8 * apkR;
    v.wheels[3].slipAngle = 0.8 * apkR;
    expect(frontWindowK(p, v, 1)).toBe(0.9);
    v.wheels[2].slipAngle = 1.6 * apkR;
    v.wheels[3].slipAngle = 1.6 * apkR;
    expect(frontWindowK(p, v, 1)).toBeLessThanOrEqual(0.4);
    // Dry, rear past its peak but no slide (body slip 3°, rotating with the path): only the gentle predictive narrowing
    // (k ≥ 0.65), not the slide shrink; well inside the rear peak: full window (2026-10-19).
    v.speed = 40; v.vLong = 40 * Math.cos(0.05); v.vLat = -40 * Math.sin(0.05); v.yawRate = 1.0; v.ayLat = 40;
    expect(frontWindowK(p, v, 0)).toBeGreaterThanOrEqual(0.65);
    v.wheels[2].slipAngle = 0.7 * apkR;
    v.wheels[3].slipAngle = 0.7 * apkR;
    expect(frontWindowK(p, v, 0)).toBe(0.9);
    v.wheels[2].slipAngle = 1.6 * apkR;
    v.wheels[3].slipAngle = 1.6 * apkR;
    // Dry, a real slide: body slip 9°, over-rotating → full shrink.
    v.vLong = 40 * Math.cos(0.16); v.vLat = -40 * Math.sin(0.16); v.yawRate = 1.2; v.ayLat = 30;
    expect(frontWindowK(p, v, 0)).toBeLessThanOrEqual(0.4);
  });
});
