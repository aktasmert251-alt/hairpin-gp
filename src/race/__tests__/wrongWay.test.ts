// D-040 wrong-way warning in the RaceDirector: > 10 km/h with heading·tangent < −0.5 for ≥ 1.5 s → `wrongWay` on;
// off after 1 s with a correct heading. No penalty in a race; TT lap invalidated. Exempt in the pit lane and during
// the post-reset recovery window; a brief spin never triggers it.

import { describe, expect, it } from 'vitest';
import { SIM_DT, type SimEvent, type SimWorld } from '../../contracts/sim';
import type { TrackFrame } from '../../contracts/track';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { createStraightTrack } from '../../track/index';
import { createRaceDirector } from '../director';
import { crx } from '../extra';

const L = 2000;

function makeWorld(mode: 'race' | 'timeTrial' = 'race'): SimWorld {
  const sim = createSim(defaultSessionConfig({ mode, aiCount: 0, gridPos: 1 }), { track: createStraightTrack(L), skipLights: true });
  sim.world.events.drain(() => {});
  return sim.world;
}

/** Yaw of a car facing along (+1) or against (−1) the track at s; forward = (cos yaw, −sin yaw). */
function yawAt(w: SimWorld, s: number, dir: 1 | -1): number {
  const f = w.static.track.query.frameAt(s, {} as TrackFrame);
  return Math.atan2(-f.tz * dir, f.tx * dir);
}

/** Drives the player for `sec` at `kmh` facing `dir` (moving along its heading), collecting events. */
function drive(w: SimWorld, dir: 1 | -1, kmh: number, sec: number, out: SimEvent[], dirSys = director(w)): void {
  const car = w.state.cars[0]!;
  const v = car.vehicle;
  const n = Math.round(sec / SIM_DT);
  for (let i = 0; i < n; i++) {
    v.yaw = yawAt(w, v.s, dir);
    v.speed = kmh / 3.6;
    v.s = (((v.s + dir * v.speed * SIM_DT) % L) + L) % L;
    w.state.tick++;
    w.state.time += SIM_DT;
    dirSys.step(w, SIM_DT);
    w.events.drain((e) => out.push(e));
  }
}

const dirs = new WeakMap<SimWorld, ReturnType<typeof createRaceDirector>>();
function director(w: SimWorld): ReturnType<typeof createRaceDirector> {
  let d = dirs.get(w);
  if (!d) dirs.set(w, (d = createRaceDirector()));
  return d;
}

const ww = (ev: SimEvent[]): { on: boolean }[] => ev.filter((e): e is Extract<SimEvent, { type: 'wrongWay' }> => e.type === 'wrongWay').map((e) => ({ on: e.on }));

function setUp(w: SimWorld, s: number): void {
  const v = w.state.cars[0]!.vehicle;
  v.s = s;
  v.lapWraps = 0;
  v.d = 0;
  v.offTrackWheels = 0;
  w.state.cars[0]!.race.progress = s;
}

describe('RaceDirector: wrong way (D-040)', () => {
  it('turns on after 1.5 s backwards above 10 km/h, no penalty in a race; off after 1 s forward', () => {
    const w = makeWorld();
    setUp(w, 1000);
    const ev: SimEvent[] = [];
    drive(w, -1, 40, 1.4, ev);
    expect(ww(ev), 'not yet at 1.4 s').toEqual([]);
    drive(w, -1, 40, 0.2, ev);
    expect(ww(ev)).toEqual([{ on: true }]);
    expect(crx(w.state.cars[0]!.race).wwOn).toBe(1);
    const r = w.state.cars[0]!.race;
    expect(r.lapValid, 'race: no lap invalidation').toBe(true);
    expect(r.penaltySec + r.penaltyToServeSec, 'race: no penalty').toBe(0);
    expect(ev.some((e) => e.type === 'penalty' || e.type === 'lapInvalidated')).toBe(false);
    drive(w, -1, 40, 3, ev);
    expect(ww(ev), 'stays on, one event').toEqual([{ on: true }]);
    drive(w, 1, 40, 0.9, ev);
    expect(ww(ev), 'still on before 1 s forward').toEqual([{ on: true }]);
    drive(w, 1, 40, 0.2, ev);
    expect(ww(ev)).toEqual([{ on: true }, { on: false }]);
  });

  it('Time Trial: the warning invalidates the lap (reason wrongWay)', () => {
    const w = makeWorld('timeTrial');
    setUp(w, 1000);
    w.state.cars[0]!.race.lapValid = true;
    w.state.cars[0]!.race.lapStartMs = 0;
    const ev: SimEvent[] = [];
    drive(w, -1, 30, 1.6, ev);
    expect(ww(ev)).toEqual([{ on: true }]);
    expect(ev.some((e) => e.type === 'lapInvalidated' && e.reason === 'wrongWay')).toBe(true);
    expect(w.state.cars[0]!.race.lapValid).toBe(false);
  });

  it('never triggers below 10 km/h or on a brief spin (< 1.5 s backwards)', () => {
    const w = makeWorld();
    setUp(w, 1000);
    const ev: SimEvent[] = [];
    drive(w, -1, 9, 4, ev);
    expect(ww(ev), 'slow reverse').toEqual([]);
    for (let k = 0; k < 4; k++) {
      drive(w, -1, 60, 1.2, ev);
      drive(w, 1, 60, 0.1, ev);
    }
    expect(ww(ev), 'repeated brief spins').toEqual([]);
  });

  it('exempt in the pit lane and during the post-reset recovery window', () => {
    const w = makeWorld();
    setUp(w, 1000);
    const car = w.state.cars[0]!;
    const ev: SimEvent[] = [];
    car.vehicle.hint.ribbon = 'pit';
    drive(w, -1, 40, 3, ev);
    expect(ww(ev), 'pit ribbon').toEqual([]);
    car.vehicle.hint.ribbon = 'main';
    car.pit.phase = 'limiter';
    drive(w, -1, 40, 3, ev);
    expect(ww(ev), 'pit procedure').toEqual([]);
    car.pit.phase = 'none';
    car.vehicle.resetCount++;
    drive(w, -1, 40, 2.9, ev);
    expect(ww(ev), 'recovery window (3 s)').toEqual([]);
    drive(w, -1, 40, 1.7, ev);
    expect(ww(ev), 'after the window it counts again').toEqual([{ on: true }]);
    // A reset while the warning is on clears it.
    car.vehicle.resetCount++;
    drive(w, 1, 0, 0.1, ev);
    expect(ww(ev)).toEqual([{ on: true }, { on: false }]);
  });

  it('state lives in SimState (survives structuredClone, so flashback restores it)', () => {
    const w = makeWorld();
    setUp(w, 1000);
    drive(w, -1, 40, 1.6, []);
    const copy = structuredClone(w.state);
    expect(crx(copy.cars[0]!.race).wwOn).toBe(1);
  });
});
