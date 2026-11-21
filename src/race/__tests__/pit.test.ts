// PitProcedure (pit-weather §2, rules §5/§7): phases, pit loss, penalty serving, speeding, double stack, 20 cars.
// The director runs alone on İstanbul with kinematic car motion (no physics): main track at the car's own AI speed
// profile, pit lane by a scripted pitAuto (≤ 150 km/h, limiter 79 km/h, 4 m/s² into the box, 8 m/s² out). That
// isolates the state machine from the pit-lane driver (Sürüş S7).

import { describe, expect, it } from 'vitest';
import type { PitPhase } from '../../contracts/race';
import { SIM_DT, type SimEvent, type SimWorld } from '../../contracts/sim';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { createRaceDirector } from '../director';
import { pitLossEstimateS, stepPit } from '../pit';
import { crx } from '../extra';

const V_LANE = 150 / 3.6;
const V_LIM = 79 / 3.6;

interface Kin { onPit: boolean; sp: number; v: number; force: number }

function harness(cars: number, seed = 11) {
  const sim = createSim(defaultSessionConfig({ aiCount: cars - 1, autodrive: true, seed, laps: 5, startCompound: 'medium' }), { skipLights: true });
  const w: SimWorld = sim.world;
  w.events.drain(() => {});
  const dir = createRaceDirector();
  const q = w.static.track.query;
  const pit = w.static.track.data.pit;
  const L = q.length;
  const pitMain = q.deltaS(pit.mainSAtSplit, pit.mainSAtMerge) + (q.deltaS(pit.mainSAtSplit, pit.mainSAtMerge) < 0 ? L : 0);
  const kin: Kin[] = w.state.cars.map((c) => ({ onPit: false, sp: 0, v: c.vehicle.speed, force: 0 }));
  const profV = (id: number, s: number): number => {
    const p = w.static.ai.getProfile(id);
    const i = Math.min(p.line.count - 1, Math.max(0, Math.round(s / p.line.ds)));
    return Math.max(5, p.v[i]!);
  };
  const events: SimEvent[] = [];
  const step = (): void => {
    for (const c of w.state.cars) {
      const k = kin[c.id]!;
      const v = c.vehicle;
      if (!k.onPit) {
        const ds = profV(c.id, v.s) * SIM_DT;
        const toSplit = q.deltaS(v.s, pit.mainSAtSplit);
        if (c.pit.phase === 'requested' && toSplit >= 0 && toSplit < ds) {
          k.onPit = true;
          k.sp = ds - toSplit;
          k.v = V_LANE;
        } else {
          let s = v.s + ds;
          if (s >= L) { s -= L; v.lapWraps++; }
          v.s = s;
          v.speed = ds / SIM_DT;
          v.hint.ribbon = 'main';
          v.hint.sp = NaN;
          continue;
        }
      }
      const ph: PitPhase = c.pit.phase;
      let target = V_LANE;
      if (k.sp < pit.limitStartSp) target = Math.min(V_LANE, Math.sqrt(V_LIM * V_LIM + 2 * 10 * (pit.limitStartSp - k.sp)));
      else if (k.sp < pit.limitEndSp) target = V_LIM;
      if (ph === 'boxIn') target = Math.min(V_LIM, Math.sqrt(2 * 4 * Math.max(0, c.pit.boxSp - k.sp)));
      if (ph === 'stationary' || ph === 'release') target = 0;
      k.v = target < k.v ? target : Math.min(target, k.v + 8 * SIM_DT);
      if (ph === 'boxIn' && c.pit.boxSp - k.sp < 0.05) k.v = 0;
      if (k.force > 0) k.v = k.force;
      k.sp += k.v * SIM_DT;
      if (k.sp >= pit.length) {
        k.onPit = false;
        let s = pit.mainSAtMerge + (k.sp - pit.length);
        if (s >= L) s -= L;
        v.s = s;
        v.hint.ribbon = 'main';
        v.hint.sp = NaN;
        v.speed = k.v;
        continue;
      }
      let s = pit.mainSAtSplit + (k.sp / pit.length) * pitMain;
      if (s >= L) s -= L;
      if (s < v.s - L / 2) v.lapWraps++;
      v.s = s;
      v.hint.ribbon = 'pit';
      v.hint.sp = k.sp;
      v.d = ph === 'boxIn' || ph === 'stationary' || ph === 'release' ? pit.workingLaneD : pit.fastLaneD;
      v.speed = k.v;
    }
    w.state.tick++;
    w.state.time += SIM_DT;
    dir.step(w, SIM_DT);
    w.events.drain((e) => events.push(e));
  };
  return { w, kin, step, events };
}

function lapTimeOf(h: ReturnType<typeof harness>, car: number, lap: number): number {
  for (let i = 0; i < 240 * 900; i++) {
    h.step();
    const e = h.events.find((x) => x.type === 'lap' && x.car === car && x.lap === lap);
    if (e) return h.w.state.race.raceMs;
  }
  return -1;
}

describe('PitProcedure', () => {
  it('a requested stop walks every phase, fits new tyres, counts the stop; pit loss 20–24 s', () => {
    const base = harness(1);
    const tBase = lapTimeOf(base, 0, 3);
    const h = harness(1);
    const me = h.w.state.cars[0]!;
    me.ai.plannedStopLaps = [2];
    me.ai.nextCompound = 'medium'; // same compound as the Medium baseline lap: the player's profile now follows the fitted compound
    const t = lapTimeOf(h, 0, 3);
    const phases = h.events.filter((e) => e.type === 'pit').map((e) => (e as { phase: PitPhase }).phase);
    expect(phases).toEqual(['requested', 'entry', 'limiter', 'boxIn', 'stationary', 'release', 'boxOut', 'exit', 'none']);
    expect(me.race.pitStops).toBe(1);
    expect(me.vehicle.compound).toBe('medium');
    expect(me.vehicle.tyres.every((x) => x.wear === 0)).toBe(true);
    expect(me.race.compoundsUsedMask & 2).toBe(2);
    expect(me.control).toBe('ai');
    expect(h.events.some((e) => e.type === 'penalty')).toBe(false);
    const loss = (t - tBase) / 1000;
    expect(loss, 'pit loss (s)').toBeGreaterThanOrEqual(20);
    expect(loss, 'pit loss (s)').toBeLessThanOrEqual(24);
    expect(Math.abs(pitLossEstimateS(h.w, 0) - loss), `mfd.pitLossS ${pitLossEstimateS(h.w, 0).toFixed(2)} vs measured ${loss.toFixed(2)}`).toBeLessThan(1.5);
  }, 60_000);

  it('an unserved penalty is held before the work; speeding in the lane = +5 s once, served next stop', () => {
    const a = harness(1);
    a.w.state.cars[0]!.ai.plannedStopLaps = [2];
    const tA = lapTimeOf(a, 0, 3);
    const h = harness(1);
    const me = h.w.state.cars[0]!;
    me.ai.plannedStopLaps = [2];
    me.race.penaltySec = me.race.penaltyToServeSec = 5;
    const t = lapTimeOf(h, 0, 3);
    expect(h.events.filter((e) => e.type === 'penaltyServed')).toEqual([{ type: 'penaltyServed', car: 0, seconds: 5 }]);
    expect(me.race.penaltyToServeSec).toBe(0);
    expect((t - tA) / 1000).toBeCloseTo(5, 0);

    // Speeding: 100 km/h through the limit zone.
    const s = harness(1);
    const car = s.w.state.cars[0]!;
    car.ai.plannedStopLaps = [2];
    for (let i = 0; i < 240 * 400 && car.race.pitStops === 0; i++) {
      s.kin[0]!.force = car.pit.phase === 'limiter' ? 100 / 3.6 : 0;
      s.step();
    }
    expect(s.events.filter((e) => e.type === 'penalty' && e.reason === 'pitSpeeding')).toHaveLength(1);
    expect(car.race.penaltyToServeSec).toBe(5); // incurred this visit: served at the next stop
    expect(s.events.some((e) => e.type === 'penaltyServed')).toBe(false);
  }, 60_000);

  it('20 cars boxing on the same lap: no deadlock, teammates double-stack, everyone stops once', () => {
    const h = harness(20, 5);
    for (const c of h.w.state.cars) {
      c.ai.plannedStopLaps = [2];
      c.ai.nextCompound = 'hard';
    }
    let queued = 0;
    for (let i = 0; i < 240 * 400; i++) {
      h.step();
      for (const c of h.w.state.cars) if (c.pit.phase === 'boxIn' && h.kin[c.id]!.v === 0) queued++;
      if (h.w.state.cars.every((c) => c.race.pitStops === 1 && c.pit.phase === 'none')) break;
    }
    const open = h.w.state.cars.filter((c) => c.race.pitStops !== 1).map((c) => `${c.id}:${c.pit.phase}`);
    expect(open, 'cars without a completed stop').toEqual([]);
    expect(queued, 'ticks spent waiting in a queue slot').toBeGreaterThan(0);
    expect(h.w.state.cars.every((c) => c.vehicle.compound === 'hard' && c.control === 'ai')).toBe(true);
  }, 120_000);
});

describe('PitProcedure robustness', () => {
  for (const phase of ['requested', 'entry', 'limiter', 'boxIn', 'stationary', 'release', 'boxOut', 'exit'] as const) {
    it(`reset during ${phase} clears the phase and restores player control without crediting a stop`, () => {
      const h = harness(1);
      const car = h.w.state.cars[0]!;
      car.control = 'pitAuto';
      car.pit.phase = phase;
      crx(car.race).pitCtrl = 1;
      car.vehicle.resetCount++;
      stepPit(h.w, car, SIM_DT);
      expect(car.pit.phase).toBe('none');
      expect(car.control).toBe('player');
      expect(car.race.pitStops).toBe(0);
    });
  }

  it('holds release for slow fast-lane traffic beyond eight seconds, then releases into the cleared gap', () => {
    const h = harness(2);
    const [car, other] = h.w.state.cars;
    const pit = h.w.static.track.data.pit;
    const box = pit.boxes.find((b) => b.teamId === car!.teamId)!.sp;
    car!.pit.phase = 'release';
    car!.vehicle.hint.ribbon = 'pit';
    car!.vehicle.hint.sp = box;
    other!.vehicle.hint.ribbon = 'pit';
    other!.vehicle.hint.sp = box - 10;
    other!.vehicle.d = pit.fastLaneD;
    other!.vehicle.speed = 1;
    for (let tick = 0; tick < 240 * 10; tick++) stepPit(h.w, car!, SIM_DT);
    expect(car!.pit.phase).toBe('release');
    other!.vehicle.hint.sp = box + 50;
    stepPit(h.w, car!, SIM_DT);
    expect(car!.pit.phase).toBe('boxOut');
  });

  it('a car that leaves the lane again before its box goes back to requested and gets its control back', () => {
    const h = harness(1);
    const me = h.w.state.cars[0]!;
    me.ai.plannedStopLaps = [2];
    for (let i = 0; i < 240 * 300 && me.pit.phase !== 'limiter'; i++) h.step();
    expect(me.pit.phase).toBe('limiter');
    // Teleport-like abort: back on the main ribbon, kinematics frozen there.
    h.kin[0]!.onPit = false;
    for (let i = 0; i < 240 * 1.5; i++) h.step();
    expect(me.pit.phase).toBe('requested');
    expect(me.control).toBe('ai');
  }, 60_000);

  it('UIT-09: a player request withdrawn before the split returns to none, also from just past the split on the main ribbon', () => {
    const h = harness(1);
    const me = h.w.state.cars[0]!;
    me.control = 'player';
    me.isPlayer = true;
    me.controls.boxRequest = true;
    h.step();
    expect(me.pit.phase).toBe('requested');
    me.controls.boxRequest = false;
    // Car well past the split (wrapped delta negative): the old guard (toSplit > commit) kept the request alive.
    const pit = h.w.static.track.data.pit;
    me.vehicle.s = (pit.mainSAtSplit + 100) % h.w.static.track.query.length;
    h.step();
    expect(me.pit.phase).toBe('none');
    expect(me.pit.requested).toBe(false);
  });
});
