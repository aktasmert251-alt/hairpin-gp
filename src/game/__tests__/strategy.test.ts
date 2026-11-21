// MFD + PlayerStrategy (ui-hud §4, CR-03): pages, options, latch, auto close, suggestions.

import { describe, expect, it } from 'vitest';
import type { EventMap } from '../../contracts/events';
import { createEventBus } from '../../core/eventBus';
import { TEAMS } from '../../data/teams';
import { createStraightTrack } from '../../track/index';
import { PLAYER_CAR_ID, createSim, defaultSessionConfig } from '../createSim';
import { createHudPresenter } from '../hud/presenter';
import { createMfdController, suggestedNextCompound } from '../strategy';

function setup(mode: 'race' | 'timeTrial' = 'race') {
  const sim = createSim(defaultSessionConfig({ mode, aiCount: mode === 'race' ? 1 : 0, laps: 20, mandatoryStop: true }), { track: createStraightTrack(2000), skipLights: true });
  const bus = createEventBus<EventMap>();
  const hud = createHudPresenter(sim, TEAMS, PLAYER_CAR_ID, 'full');
  const notes: string[] = [];
  const mfd = createMfdController({ world: sim.world, playerId: PLAYER_CAR_ID, bus, hud: hud.model, notify: (k) => notes.push(k) });
  return { sim, hud, mfd, notes, bus };
}

describe('MFD and PlayerStrategy', () => {
  it('Tab cycles STRATEJİ → ERS → FREN → HAVA → LASTİK → closed (TT skips STRATEJİ); 1–4 act only when open', () => {
    const { hud, mfd } = setup();
    expect(mfd.onAction('mfd1')).toBe(false);
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      mfd.onAction('mfdNext');
      seen.push(hud.model.mfd.open ? hud.model.mfd.page : 'closed');
    }
    expect(seen).toEqual(['strategy', 'ers', 'brakes', 'weather', 'tyres', 'closed']);
    const tt = setup('timeTrial');
    tt.mfd.onAction('mfdNext');
    expect(tt.hud.model.mfd.page).toBe('ers');
  });

  it('brake bias ±0.5 % within 50–70 %, reaches DriverControls on the next latch; ERS auto off/on', () => {
    const { sim, hud, mfd } = setup();
    mfd.onAction('mfdNext');
    mfd.onAction('mfdNext'); // ers
    mfd.onAction('mfd3');
    expect(mfd.strategy.ersModeSel).toBe('hotlap');
    mfd.onAction('mfdNext'); // brakes
    expect(hud.model.mfd.page).toBe('brakes');
    mfd.onAction('mfd2');
    const c = sim.world.state.cars[PLAYER_CAR_ID]!.controls;
    mfd.latch(c);
    expect(c.brakeBias).toBeCloseTo(0.58, 6);
    expect(c.ersModeSel).toBe('hotlap');
    for (let i = 0; i < 60; i++) mfd.onAction('mfd2');
    expect(mfd.strategy.brakeBias).toBe(0.7);
    mfd.onAction('mfd3');
    expect(mfd.strategy.brakeBias).toBe(0.575);
    // Within one tick the PlayerInputSystem copies the latched bias into VehicleInput (getTelemetry().input).
    sim.step();
    expect(sim.world.state.cars[PLAYER_CAR_ID]!.input.brakeBias).toBeCloseTo(0.58, 6);
  });

  it('box request pre-selects the suggested compound (two-compound aware), cancels, auto-closes after 8 s', () => {
    const { sim, hud, mfd, notes } = setup();
    mfd.onAction('mfdNext');
    mfd.onAction('mfd1');
    expect(mfd.strategy.boxRequest).toBe(true);
    // Started on mediums, 20 laps left, rule active → the other dry compound by laps left (hard).
    expect(mfd.strategy.nextCompound).toBe(suggestedNextCompound(sim.world, PLAYER_CAR_ID));
    expect(mfd.strategy.nextCompound).toBe('hard');
    expect(notes).toContain('notify.pit.requested');
    mfd.onAction('mfd1');
    expect(mfd.strategy.boxRequest).toBe(false);
    expect(notes).toContain('notify.pit.cancelled');
    mfd.update(7.9);
    expect(hud.model.mfd.open).toBe(true);
    mfd.update(0.2);
    expect(hud.model.mfd.open).toBe(false);
    sim.world.state.conditions.wetness = 0.7;
    expect(suggestedNextCompound(sim.world, PLAYER_CAR_ID)).toBe('wet');
  });
});
