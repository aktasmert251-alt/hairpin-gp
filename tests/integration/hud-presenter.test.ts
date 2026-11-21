// I-01: HudPresenter builds a valid HudModel from a running sim (all fields finite, tower sorted). testing-qc.md §2.4.
// Written against the Sprint 0 presenter (src/game/hud/presenter.ts); Sprint 2 extends it (notifications, deltas, MFD).

import { describe, expect, it } from 'vitest';
import { createHudPresenter } from '../../src/game/hud/presenter';
import { PLAYER_CAR_ID } from '../../src/game/createSim';
import { TEAMS } from '../../src/data/teams';
import { SEEDS, findNonFinite, makeSim, stepSeconds } from '../helpers/sim';

describe('I-01 HudPresenter over a running sim', () => {
  it('fills one long-lived, finite, sorted HudModel for 20 cars over 30 s', () => {
    const sim = makeSim({ skipLights: true, cfg: { seed: SEEDS.field, laps: 5 } });
    const presenter = createHudPresenter(sim, TEAMS, PLAYER_CAR_ID, 'full');
    const model = presenter.model;
    const n = sim.world.state.cars.length;
    expect(n).toBe(20);

    for (let t = 0; t < 30; t += 3) {
      stepSeconds(sim, 3);
      const m = presenter.update();
      expect(m, 'update() returns the same long-lived object').toBe(model);
      const bad = findNonFinite(m, 'hud');
      expect(bad, `non-finite HUD value at ${bad} (t=${t + 3} s, seed ${SEEDS.field})`).toBeNull();

      // Tower: a permutation of the 20 cars, ordered by position 1..20, exactly one player row, valid colours.
      expect(m.tower).toHaveLength(n);
      expect(m.tower.map((r) => r.pos)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      expect(new Set(m.tower.map((r) => r.car)).size).toBe(n);
      expect(m.tower.filter((r) => r.isPlayer)).toHaveLength(1);
      for (const row of m.tower) {
        expect(row.teamColor, `team colour of car ${row.car}`).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(row.code).toMatch(/^[A-Z]{3}$/);
      }
      expect(m.position?.pos).toBe(m.tower.find((r) => r.isPlayer)!.pos);
      expect(m.position?.of).toBe(n);

      // Order in the tower follows the race order of the sim.
      expect(m.tower.map((r) => r.car)).toEqual([...sim.world.state.race.order]);

      // Car panel ranges.
      expect(m.car.kmh).toBeGreaterThanOrEqual(0);
      expect(m.car.kmh).toBeLessThan(420);
      expect(Number.isInteger(m.car.gear)).toBe(true);
      expect(m.car.shiftLeds).toBeGreaterThanOrEqual(0);
      expect(m.car.shiftLeds).toBeLessThanOrEqual(15);
      expect(m.car.ers.soc).toBeGreaterThanOrEqual(-1e-6);
      expect(m.car.ers.soc).toBeLessThanOrEqual(1 + 1e-6);
      for (const w of m.car.tyre.wear) {
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1 + 1e-6);
      }

      // Minimap mirrors the cars.
      expect(m.minimap.x).toHaveLength(n);
      expect(m.minimap.z).toHaveLength(n);
      expect(m.minimap.teamColor).toHaveLength(n);
      expect(m.minimap.player).toBe(PLAYER_CAR_ID);
      for (let i = 0; i < n; i++) expect(m.minimap.x[i]).toBeCloseTo(sim.world.state.cars[i]!.vehicle.x, 2);

      expect(m.lap.current).toBeGreaterThanOrEqual(1);
      expect(m.lap.total).toBe(5);
      expect(m.lap.current).toBeLessThanOrEqual(5);
    }
  });

  it('time trial: no position panel, no lap total, a single tower row', () => {
    const sim = makeSim({ skipLights: true, cfg: { mode: 'timeTrial', aiCount: 0, seed: SEEDS.tt } });
    const presenter = createHudPresenter(sim, TEAMS, PLAYER_CAR_ID, 'full');
    stepSeconds(sim, 5);
    const m = presenter.update();
    expect(m.mode).toBe('timeTrial');
    expect(m.position).toBeNull();
    expect(m.lap.total).toBeNull();
    expect(m.tower).toHaveLength(1);
    expect(findNonFinite(m, 'hud')).toBeNull();
  });

  it('setVisible switches the HUD mode without touching the rest of the model', () => {
    const sim = makeSim({ skipLights: true, cfg: { aiCount: 3 } });
    const presenter = createHudPresenter(sim, TEAMS, PLAYER_CAR_ID, 'full');
    presenter.setVisible('minimal');
    expect(presenter.model.visible).toBe('minimal');
    presenter.setVisible('off');
    expect(presenter.update().visible).toBe('off');
  });
});
