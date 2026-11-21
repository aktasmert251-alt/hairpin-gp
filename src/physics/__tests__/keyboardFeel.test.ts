// Keyboard-feel regression (S1/S5): a crude bang-bang "keyboard driver" (binary keys only, through the real
// keyboard filter and the default Intermediate assists) laps İstanbul. It saws at the steering keys and stabs the
// pedals, the way a keyboard player does, aiming 10 % under the d = 100 AI speed profile (S2-S1: the profile now
// runs at 95 % of the car μ instead of 90 %, so the bot keeps the Sprint 1 margin of ≈ 86 % of the car μ).
// Requirements: corners stay drivable (no recovery resets, body slip never past 20°, i.e. not even a big slide;
// Sprint 1 allowed 45° and the bot slid 32° on cold tyres at the T1 exit before the engine-braking fade) and the
// laps are complete. Sprint 2 laps: 93–95 s (Sprint 1: 98–108 s with 13 % less grip).

import { describe, expect, it } from 'vitest';
import { lineAt } from '../../ai/line/racingLine';
import { createSim, defaultSessionConfig } from '../../game/index';
import { MODULE_STATUS as TRACK_STATUS } from '../../track/index';

describe.skipIf(TRACK_STATUS === 'stub')('keyboard feel (Intermediate assists)', () => {
  it('a bang-bang keyboard driver laps İstanbul 3× without spinning', () => {
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
    const laps: number[] = [];
    let maxBeta = 0;
    for (let i = 0; i < 240 * 420 && laps.length < 3; i++) {
      if (i % 4 === 0) {
        const sp = v.speed;
        const ld = Math.max(10, 6 + 0.4 * sp);
        q.worldFromSD(v.s + ld, lineAt(line.d, line, v.s + ld, L), tgt);
        const dx = tgt.x - v.x;
        const dz = tgt.z - v.z;
        const lat = dx * -Math.sin(v.yaw) + dz * -Math.cos(v.yaw);
        const want = Math.atan((3.6 * 2 * lat) / (dx * dx + dz * dz)) / 0.384;
        c.left = want > car.input.steer + 0.02;
        c.right = want < car.input.steer - 0.02;
        // A human feels cold or hot tyres; the bot scales its target like the AI (√ of the weaker axle's grip).
        const gF = 0.5 * (v.tyres[0].gripMul + v.tyres[1].gripMul);
        const gR = 0.5 * (v.tyres[2].gripMul + v.tyres[3].gripMul);
        const vT = lineAt(prof.v, line, v.s + 0.15 * sp, L) * 0.9 * Math.sqrt(Math.min(1, gF, gR));
        c.throttle = sp < vT - 0.5;
        c.brake = sp > vT + 2;
      }
      sim.step();
      w.events.drain((e) => {
        if (e.type === 'lap') laps.push(e.ms / 1000);
      });
      if (v.speed > 10) maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(v.vLat, Math.abs(v.vLong))));
    }
    console.log(`keyboard bot laps ${laps.map((x) => x.toFixed(2)).join(' / ')} s, max body slip ${((maxBeta * 180) / Math.PI).toFixed(1)}°`);
    expect(laps.length).toBe(3);
    expect(v.resetCount).toBe(0);
    expect((maxBeta * 180) / Math.PI).toBeLessThan(20);
  }, 300_000);
});
