// D-051 #4 (user request 2026-10-16): an AI car stuck against a wall / in the gravel / facing the wrong way backs out
// with the D-049 reverse rule (hold the brake at a standstill → R; in R the brake drives backwards) before the stuck
// reset. The AI side is checked on its inputs; the full manoeuvre needs the VehicleSystem to select R for AI cars in
// 'recover' (reverseGear is player-only today: change request to the physics owner). Until then the stuck reset is
// the fallback and the car is never left standing for more than ~3.5 s.

import { describe, expect, it } from 'vitest';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { teleportCar } from '../../game/sim/teleport';

function setup() {
  const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 1, seed: 7, laps: 3, difficulty: 70, autodrive: false, gridPos: 1, trackId: 'istanbul' }), { skipLights: true });
  const w = sim.world;
  const pl = w.state.cars.find((c) => c.isPlayer)!;
  const ai = w.state.cars.find((c) => !c.isPlayer)!;
  const data = w.static.track.data;
  // Past the start reaction time (the AI holds the brake until then).
  for (let t = 0; t < 240; t++) { sim.step(); w.events.drain(() => {}); }
  // A wall 8–14 m left of the centreline; the AI car stands 1.6 m from it, nose 75° into it.
  let k = 1200;
  while (!(data.wallL[k]! > 8 && data.wallL[k]! < 14)) k++;
  teleportCar(w, pl.id, k - 300, 0, 0);
  teleportCar(w, ai.id, k, data.wallL[k]! - 1.6, 0);
  ai.vehicle.yaw += 1.3;
  ai.ai.mode = 'race';
  return { sim, w, pl, ai };
}

describe('AI stuck recovery (D-051 #4)', () => {
  it('stopped in recover: holds the brake with opposite lock (selects R), in R brakes to drive back, then leaves R', () => {
    const { w, ai } = setup();
    const mod = w.static.ai;
    const inp = ai.input;
    mod.computeInput(w, ai.id, inp);
    expect(ai.ai.mode).toBe('recover');
    const fwdSteer = Math.sign(inp.steer);
    // 0.6 s stopped although it wants to move: brake held, no throttle, lock away from the target.
    for (let k = 0; k < 40; k++) {
      ai.ai.stuckTimer = 0.6;
      mod.computeInput(w, ai.id, inp);
    }
    expect(inp.throttle).toBe(0);
    expect(inp.brake).toBe(1);
    expect(Math.sign(inp.steer)).toBe(-fwdSteer);
    expect(Math.abs(inp.steer)).toBeGreaterThan(0.9);
    // In R (the VehicleSystem swaps the pedals): the brake drives backwards...
    ai.vehicle.gear = -1;
    ai.ai.stuckTimer = 0.9;
    mod.computeInput(w, ai.id, inp);
    expect(inp.brake).toBe(1);
    expect(inp.throttle).toBe(0);
    // ...until the time budget is used: the throttle stops the car and returns to 1st.
    ai.ai.stuckTimer = 2.1;
    mod.computeInput(w, ai.id, inp);
    expect(inp.throttle).toBe(1);
    expect(inp.brake).toBe(0);
  });

  it('nose in a wall: gets going again within 6 s (backing out in R: no reset, never 3 s still; without R: reset < 4 s)', () => {
    const { sim, w, pl, ai } = setup();
    let still = 0;
    let worst = 0;
    let moved = false;
    let resets = 0;
    let usedR = false;
    for (let t = 0; t < 8 * 240; t++) {
      pl.input.throttle = 0;
      pl.input.brake = 1;
      sim.step();
      w.events.drain((e) => {
        if (e.type === 'carReset' && e.car === ai.id) resets++;
      });
      if (ai.vehicle.gear < 0) usedR = true;
      still = ai.vehicle.speed < 1 ? still + 1 / 240 : 0;
      if (still > worst) worst = still;
      if (t < 6 * 240 && ai.ai.mode !== 'recover' && ai.vehicle.speed > 8) moved = true;
    }
    if (usedR) {
      expect(resets).toBe(0);
      expect(worst).toBeLessThan(3);
    } else expect(worst).toBeLessThan(4);
    expect(moved).toBe(true);
  });
});
