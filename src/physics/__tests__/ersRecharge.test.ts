// User report 2026-10-24: "once the ERS runs out it never fills up again". The medium (default / ERS-assist) deploy
// strategy spent a full ~4 MJ budget every lap against ~3 MJ harvested, so the battery emptied in ~3 laps and then every
// harvested joule was spent on the next straight (stuck at 0–5 %). Now medium scales its budget with the state of charge:
// an empty battery must recharge through braking (MGU-K) and full throttle (MGU-H) and settle at a usable level.

import { describe, expect, it } from 'vitest';
import { lineAt } from '../../ai/line/racingLine';
import { createSim, defaultSessionConfig } from '../../game/index';
import { MODULE_STATUS as TRACK_STATUS } from '../../track/index';

describe.skipIf(TRACK_STATUS === 'stub')('ERS recharge (medium strategy)', () => {
  it('an empty battery recharges within a lap and stays usable (keyboard bot, İstanbul)', () => {
    const sim = createSim(defaultSessionConfig({ mode: 'timeTrial', aiCount: 0 }), { skipLights: true });
    const w = sim.world;
    const car = w.state.cars[0]!;
    const v = car.vehicle;
    const c = car.controls;
    const prof = w.static.ai.getProfile(0);
    const line = prof.line;
    const q = w.static.track.query;
    const L = q.length;
    const tgt = { x: 0, y: 0, z: 0 };
    const cap = w.static.params[0]!.ers.capacityMJ * 1e6;
    v.ers.socJ = 0; // drained (e.g. a lap with the overtake key held)
    const atLine: number[] = [];
    let lap = v.lapWraps;
    for (let i = 0; i < 240 * 330 && atLine.length < 3; i++) {
      if (i % 4 === 0) {
        const sp = v.speed;
        const ld = Math.max(10, 6 + 0.4 * sp);
        q.worldFromSD(v.s + ld, lineAt(line.d, line, v.s + ld, L), tgt);
        const dx = tgt.x - v.x, dz = tgt.z - v.z;
        const lat = dx * -Math.sin(v.yaw) + dz * -Math.cos(v.yaw);
        const want = Math.atan((3.6 * 2 * lat) / (dx * dx + dz * dz)) / 0.384;
        c.left = want > car.input.steer + 0.02;
        c.right = want < car.input.steer - 0.02;
        const vT = lineAt(prof.v, line, v.s + 0.15 * sp, L) * 0.9;
        c.throttle = sp < vT - 0.5;
        c.brake = sp > vT + 2;
      }
      sim.step();
      if (v.lapWraps !== lap) {
        lap = v.lapWraps;
        atLine.push(v.ers.socJ / cap);
      }
    }
    console.log(`state of charge at the line: ${atLine.map((x) => `${(100 * x).toFixed(0)} %`).join(' → ')}`);
    // The first crossing ends the Time Trial run-up (~200 m from empty); then two full laps.
    expect(atLine.length).toBe(3);
    expect(atLine[1]!).toBeGreaterThan(0.3);
    expect(atLine[2]!).toBeGreaterThan(0.4);
  }, 300_000);
});
