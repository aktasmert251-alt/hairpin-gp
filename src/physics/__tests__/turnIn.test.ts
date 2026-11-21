// User report 2026-10-18: "turning WITHOUT braking the car straightens" on Intermediate. Root cause: the dry stability
// window (bb778fb) shrank the front-slip window as soon as the rear passed its peak slip angle, which ordinary limit
// cornering does (1.1–1.4·αpk at 2–5° body slip): the steering was pulled out mid-corner and the yaw rate collapsed
// (160 km/h: 0.98 → 0.48 rad/s), then came back — the car "straightened". Flat plane, real keyboard filter, a steer key
// held for 1.5 s from 100 / 160 km/h, coasting: the turn must build and hold (no collapse), as before that change.
// 2026-10-19: the steer must also never point against the held key, and the yaw bands follow the path (ay held or higher)
// now that the yaw limiter removes the turn-in overshoot and the 8–10° drift the old yaw means included.

import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../contracts/sim';
import { ASSIST_PRESETS } from '../../core/settings/defaults';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { createFlatPlane } from './helpers/flatPlane';

function heldSteer(kmh: number): { peak: number; minAfterPeak: number; mean: number; ayG: number; wrong: number } {
  const sim = createSim(
    defaultSessionConfig({ mode: 'timeTrial', aiCount: 0, weather: 'dry', assists: { ...ASSIST_PRESETS.intermediate } }),
    { track: createFlatPlane(), skipLights: true },
  );
  const car = sim.world.state.cars[0]!;
  const p = sim.world.static.params[0]!;
  const v = car.vehicle;
  const sp = kmh / 3.6;
  v.vx = sp; v.speed = sp; v.vLong = sp;
  for (const w of v.wheels) w.omega = sp / p.wheelRadius;
  for (const t of v.tyres) { t.surfC = 95; t.coreC = 95; }
  v.clutch = 1;
  for (let g = 1; g <= p.gearRatios.length; g++) {
    v.gear = g;
    if ((sp / p.wheelRadius) * p.gearRatios[g - 1]! * p.finalDrive * 60 / (2 * Math.PI) < 11000) break;
  }
  for (let i = 0; i < 48; i++) sim.step();
  car.controls.left = true;
  let peak = 0, minAfter = Infinity, sum = 0, ay = 0, n = 0, wrong = 0;
  const N = Math.round(1.5 / SIM_DT);
  for (let i = 0; i < N; i++) {
    sim.step();
    if (car.input.steer < -0.01) wrong++;
    const r = Math.abs(v.yawRate);
    if (r > peak) { peak = r; minAfter = r; } else if (r < minAfter) minAfter = r;
    if (i >= Math.round(0.5 / SIM_DT)) { sum += r; ay += Math.abs(v.ayLat); n++; }
  }
  return { peak, minAfterPeak: minAfter, mean: sum / n, ayG: ay / n / 9.81, wrong };
}

describe('turn-in on Intermediate holds the turn (user report 2026-10-18)', () => {
  it.each([[100, 0.9, 2.25], [160, 0.72, 2.85]] as const)('%i km/h held steer key: no yaw collapse, mean yaw ≥ %f rad/s, ay ≥ %f g', (kmh, yawMin, gMin) => {
    const r = heldSteer(kmh);
    console.log(`${kmh} km/h: yaw peak ${r.peak.toFixed(2)} min after peak ${r.minAfterPeak.toFixed(2)} mean ${r.mean.toFixed(2)} rad/s, ay ${r.ayG.toFixed(2)} g`);
    expect(r.minAfterPeak).toBeGreaterThan(0.6 * r.peak);
    expect(r.mean).toBeGreaterThan(yawMin);
    expect(r.ayG).toBeGreaterThan(gMin);
    expect(r.wrong).toBe(0);
  });
});
