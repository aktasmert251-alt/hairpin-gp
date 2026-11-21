// User request 2026-10-25: "changing the difficulty feels like nothing". The old ladder scaled corner grip only
// (0.86–1.0): a pace-1.0 driver was +1.7–2.1 % at d55, +1.1–1.4 % at d70 and +0.3–0.6 % at d100 against the calibrated
// d = 100 perfect driver, so d55 → d100 changed a lap by ~1.3 s. Targets (lap time vs the perfect driver, pace-1.0 AI
// driver, dry, Medium, TT fuel): d0 +9–10 %, d55 +4 %, d70 +2.5–3 %, d85 +1.2 %, d100 ≈ calibrated, d110 below d100
// (−0.8 % was asked for; the physics car caps it at about −0.2 %, see test-results/progress/surus-ai.md).
// Bands are the targets ± the per-track spread of one ladder (street / power tracks respond less to corner grip).

import { describe, expect, it } from 'vitest';
import type { AIDriverProfile } from '../../contracts/ai';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { loadTrack } from '../../track/index';

type Tid = 'istanbul' | 'lombardia' | 'bosphorus' | 'ardennes';
const REF: AIDriverProfile = { pace: 1, consistency: 0.9, aggression: 0.7, wetSkill: 0.8, tyreMgmt: 0.8, startSkill: 0.8, defending: 0.7 };

function trackReady(id: Tid): boolean {
  try {
    return loadTrack(id).data.id === id;
  } catch {
    return false;
  }
}

/** Best of flying laps 2–3 of one car; d = null: the d = 100 perfect (autodrive) driver. Resets count +1000 s. */
function lap(trackId: Tid, d: number | null): number {
  const sim = createSim(defaultSessionConfig({ mode: 'timeTrial', aiCount: 0, autodrive: true, startCompound: 'medium', seed: 7, trackId }), { skipLights: true });
  const w = sim.world;
  const car = w.state.cars[0]!;
  if (d !== null) {
    car.isPlayer = false;
    w.static.ai.setDifficulty(d);
    w.static.ai.initCar(w, 0, REF);
  }
  const laps: number[] = [];
  for (let i = 0; i < 3 * 140 * 240 && laps.length < 3; i++) {
    sim.step();
    w.events.drain((e) => {
      if (e.type === 'lap' && e.car === 0) laps.push(e.ms / 1000);
    });
  }
  return Math.min(...laps.slice(1)) + 1000 * car.vehicle.resetCount;
}

/** [difficulty, min %, max %] lap time over the perfect driver. */
const BANDS: [number, number, number][] = [[0, 8.3, 11.2], [55, 3.0, 4.8], [70, 2.0, 3.5], [85, 0.7, 1.9], [100, -0.4, 0.6]];

describe('difficulty plumbing', () => {
  it('session difficulty reaches the AI profiles (grip used scales with it)', () => {
    const grip = (difficulty: number): number => {
      const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 3, seed: 3, laps: 3, difficulty }), { skipLights: true });
      const ai = sim.world.state.cars.find((c) => !c.isPlayer)!;
      return sim.world.static.ai.getProfile(ai.id).gripScale;
    };
    const g = [0, 55, 70, 100].map(grip);
    for (let k = 1; k < g.length; k++) expect(g[k]!).toBeGreaterThan(g[k - 1]!);
    // d55 → d100 must be a clear step (old ladder: 6 % grip, ~1.5 % lap time).
    expect(g[3]! / g[1]!).toBeGreaterThan(1.1);
  });
});

for (const tid of ['istanbul', 'lombardia', 'bosphorus', 'ardennes'] as const) {
  describe.skipIf(!trackReady(tid))(`difficulty ladder on ${tid}`, () => {
    it('lap time vs the calibrated perfect driver follows the target ladder', () => {
      const ref = lap(tid, null);
      const pct = (x: number): number => 100 * (x / ref - 1);
      const got = BANDS.map(([d]) => pct(lap(tid, d)));
      const d110 = pct(lap(tid, 110));
      console.log(`${tid} perfect ${ref.toFixed(2)} s: ${BANDS.map(([d], k) => `d${d} ${got[k]!.toFixed(2)} %`).join(', ')}, d110 ${d110.toFixed(2)} %`);
      BANDS.forEach(([d, lo, hi], k) => {
        expect(got[k]!, `d${d}`).toBeGreaterThanOrEqual(lo);
        expect(got[k]!, `d${d}`).toBeLessThanOrEqual(hi);
      });
      for (let k = 1; k < got.length; k++) expect(got[k]!).toBeLessThan(got[k - 1]!);
      expect(d110).toBeLessThan(got[got.length - 1]!);
    }, 300_000);
  });
}
