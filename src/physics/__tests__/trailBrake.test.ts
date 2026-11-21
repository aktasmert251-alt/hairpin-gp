// D-051 #3 (user bug 2026-10-16: "the car doesn't turn while braking"): with the keyboard, holding brake + steer (trail
// braking into a corner) must still turn the car. Flat plane, Intermediate assists, real keyboard filter: from 250 / 160 km/h
// brake for 0.4 s, then add a steer key; compare with the steer key alone. Before the fix the 250 km/h case kept 66 % of the yaw rate.
// The brake+steer run keeps most of the steer-only turn (the friction circle costs some, never all) and still brakes hard.

import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../contracts/sim';
import { ASSIST_PRESETS } from '../../core/settings/defaults';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { createFlatPlane } from './helpers/flatPlane';

interface Out { yawRate: number; ay: number; decel: number; kmhEnd: number; early: number; beta: number; /** Ticks steering against the held key. */ wrong: number }

function run(kmh: number, brake: boolean, steer: boolean, preset: keyof typeof ASSIST_PRESETS = 'intermediate', brakeLead = 0): Out {
  const sim = createSim(
    defaultSessionConfig({ mode: 'timeTrial', aiCount: 0, weather: 'dry', assists: { ...ASSIST_PRESETS[preset] } }),
    { track: createFlatPlane(), skipLights: true },
  );
  const car = sim.world.state.cars[0]!;
  const p = sim.world.static.params[0]!;
  const v = car.vehicle;
  const sp = kmh / 3.6;
  v.x = 0; v.z = 0; v.yaw = 0; v.yawRate = 0; v.vx = sp; v.vz = 0; v.speed = sp; v.vLong = sp; v.vLat = 0; v.s = 0; v.d = 0; v.hint.s = 0;
  for (const w of v.wheels) w.omega = sp / p.wheelRadius;
  for (const t of v.tyres) { t.surfC = 95; t.coreC = 95; }
  v.clutch = 1;
  for (let g = 1; g <= p.gearRatios.length; g++) {
    v.gear = g;
    if ((sp / p.wheelRadius) * p.gearRatios[g - 1]! * p.finalDrive * 60 / (2 * Math.PI) < 11000) break;
  }
  // Settle 0.3 s coasting, then hold the keys for 0.8 s; average over the last 0.5 s.
  const c = car.controls;
  for (let i = 0; i < Math.round(0.3 / SIM_DT); i++) sim.step();
  c.brake = brake;
  const v0 = v.speed;
  for (let i = 0; i < Math.round(brakeLead / SIM_DT); i++) sim.step();
  c.left = steer;
  let yr = 0, ay = 0, n = 0, early = 0, beta = 0, wrong = 0;
  const N = Math.round(0.8 / SIM_DT);
  for (let i = 0; i < N; i++) {
    sim.step();
    if (steer && car.input.steer < -0.01) wrong++;
    if (v.speed > 5) beta = Math.max(beta, Math.abs(Math.atan2(v.vLat, Math.abs(v.vLong))) * 180 / Math.PI);
    if (i < Math.round(0.3 / SIM_DT)) early += Math.abs(v.yawRate) / Math.round(0.3 / SIM_DT);
    if (i >= N - Math.round(0.5 / SIM_DT)) { yr += Math.abs(v.yawRate); ay += Math.abs(v.ayLat); n++; }
  }
  return { yawRate: yr / n, ay: ay / n, decel: (v0 - v.speed) / (0.8 + brakeLead), kmhEnd: v.speed * 3.6, early, beta, wrong };
}

describe('trail braking with the keyboard (D-051 #3, keyboard brake limiter on)', () => {
  it.each([250, 160])('brake first, then steer from %i km/h: keeps 75 pct of the steer-only yaw rate and 60 pct of ay, no spin, still brakes', (kmh) => {
    const steer = run(kmh, false, true);
    const both = run(kmh, true, true, 'intermediate', 0.4);
    console.log(`${kmh} km/h: steer-only r ${steer.yawRate.toFixed(3)} ay ${steer.ay.toFixed(1)} | brake then steer r ${both.yawRate.toFixed(3)} ay ${both.ay.toFixed(1)} decel ${both.decel.toFixed(1)} slip ${both.beta.toFixed(1)}°`);
    expect(both.yawRate).toBeGreaterThan(0.75 * steer.yawRate);
    expect(both.ay).toBeGreaterThan(0.6 * steer.ay);
    expect(both.beta).toBeLessThan(8);
    expect(both.wrong).toBe(0); // the front wheels never point against the held key (user report 2026-10-19)
    expect(both.decel).toBeGreaterThan(15);
  });
});

describe('brake and steer pressed together keep strong deceleration (2026-10-23)', () => {
  // User: "while turning, the brake key sometimes isn't detected". Brake + full lock from the same instant: the car
  // must still decelerate hard (the earlier 0.5 trail cut left 62–65 % of the straight-line deceleration).
  it.each([[200, 0.69], [120, 0.645]] as const)('%i km/h: brake + full steer keeps ≥ %f of the brake-only deceleration', (kmh, share) => {
    for (const preset of ['beginner', 'intermediate'] as const) {
      const straight = run(kmh, true, false, preset);
      const both = run(kmh, true, true, preset);
      console.log(`${preset} ${kmh} km/h: brake-only ${straight.decel.toFixed(1)} m/s² | brake + full steer ${both.decel.toFixed(1)} m/s² (${(100 * both.decel / straight.decel).toFixed(0)} %), yaw ${both.yawRate.toFixed(2)}`);
      expect(both.decel).toBeGreaterThan(share * straight.decel);
      expect(both.wrong).toBe(0);
    }
  });
});
