// Gamepad analog path of the PlayerInputSystem (2026-10-27): stick / trigger values reach VehicleInput undistorted by the
// keyboard ramps, shaping and brake limiter; assists still apply.

import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../contracts/sim';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { createPlayerInputSystem, PAD_STEER_SLEW } from '../input/playerInputSystem';

const setup = (kmh: number, assists?: Partial<ReturnType<typeof defaultSessionConfig>['assists']>) => {
  const cfg = defaultSessionConfig({ mode: 'timeTrial', aiCount: 0 });
  if (assists) Object.assign(cfg.assists, assists);
  const sim = createSim(cfg, { skipLights: true });
  const world = sim.world;
  const car = world.state.cars[0]!;
  car.vehicle.speed = kmh / 3.6;
  car.vehicle.vLong = car.vehicle.speed;
  for (const t of car.vehicle.tyres) t.gripMul = 1;
  car.controls.analog = true;
  return { world, car, sys: createPlayerInputSystem() };
};

describe('PlayerInputSystem analog (gamepad) path', () => {
  it('pedals pass through 1:1 from the first tick (no keyboard ramp), also with the keyboard brake limiter on', () => {
    const { world, car, sys } = setup(120, { kbBrakeLimiter: true, braking: 'off', abs: true });
    car.controls.throttleAxis = 0.37;
    car.controls.brakeAxis = 0.62;
    sys.step(world, SIM_DT);
    expect(car.input.throttle).toBeCloseTo(0.37, 9);
    expect(car.input.brake).toBeCloseTo(0.62, 9);
    car.controls.brakeAxis = 1;
    sys.step(world, SIM_DT);
    expect(car.input.brake).toBe(1);
  });

  it('keyboard booleans are ignored while analog is on', () => {
    const { world, car, sys } = setup(100);
    car.controls.throttle = true;
    car.controls.left = true;
    sys.step(world, SIM_DT);
    expect(car.input.throttle).toBe(0);
    expect(car.input.steer).toBe(0);
  });

  it('steering follows the stick linearly (no |u|^1.4 shaping), slew-limited only', () => {
    const { world, car, sys } = setup(20, { steering: false });
    car.controls.steerAxis = 0.5;
    const ticks = Math.ceil(0.5 / (PAD_STEER_SLEW * SIM_DT)) + 2;
    for (let i = 0; i < ticks; i++) sys.step(world, SIM_DT);
    expect(car.kb.steerU).toBeCloseTo(0.5, 9);
    const half = car.input.steer;
    car.controls.steerAxis = 1;
    for (let i = 0; i < ticks * 2; i++) sys.step(world, SIM_DT);
    // Linear: half the stick = half the lock of full stick (keyboard shaping would give 0.5^1.4 = 0.38).
    expect(half / car.input.steer).toBeCloseTo(0.5, 3);
    expect(Math.sign(half)).toBe(1);
  });

  it('assists still apply: braking assist raises the pedal above the trigger', () => {
    const a = setup(250, { braking: 'high' });
    const b = setup(250, { braking: 'off' });
    for (const s of [a, b]) {
      s.car.vehicle.s = 0;
      s.car.controls.brakeAxis = 0;
      s.sys.step(s.world, SIM_DT);
    }
    expect(a.car.input.brake).toBeGreaterThanOrEqual(b.car.input.brake);
  });
});
