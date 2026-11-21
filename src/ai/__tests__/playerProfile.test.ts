// The player's speed profile (braking assist, track limits, the HUD line) follows the fitted compound: the player car
// never runs computeInput, so before Sprint 4 its profile stayed built for the starting tyre after a stop.

import { describe, expect, it } from 'vitest';
import { createSim, defaultSessionConfig } from '../../game/createSim';

describe('player speed profile', () => {
  it('rebuilds for the fitted compound (Medium → Wets: slower corners)', () => {
    const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 1, seed: 3, laps: 3, difficulty: 70, startCompound: 'medium' }), { skipLights: true });
    const w = sim.world;
    const ai = w.static.ai;
    const before = Array.from(ai.getProfile(0).v);
    w.state.cars[0]!.vehicle.compound = 'wet';
    const after = ai.getProfile(0).v;
    let slower = 0;
    for (let i = 0; i < after.length; i++) if (after[i]! < before[i]! - 0.5) slower++;
    expect(slower / after.length).toBeGreaterThan(0.2);
  });
});
