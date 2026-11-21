// RaceDirector v2 (rules §2–§6): lights, crossing accuracy, jump start, track limits, cut zones, penalties, flags, DRS.
// The director runs alone on a world built by createSim; car motion is scripted (no physics) so times are analytic.

import { describe, expect, it } from 'vitest';
import { SIM_DT, type SimEvent, type SimWorld, type SimSystem } from '../../contracts/sim';
import type { TrackFrame } from '../../contracts/track';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { loadTrack, createStraightTrack } from '../../track/index';
import { createRaceDirector } from '../director';
import { crx } from '../extra';
import { classificationMs } from '../penalties';
import { buildResults } from '../../game/results';
import { TEAMS } from '../../data/teams';
import { GRID_HOLD_MS, LIGHT_INTERVAL_MS, LIGHTS_HOLD_MAX_MS, LIGHTS_HOLD_MIN_MS } from '../rules';

const L = 2000;

function makeWorld(patch: Parameters<typeof defaultSessionConfig>[0], skipLights: boolean, length = L): SimWorld {
  const sim = createSim(defaultSessionConfig({ aiCount: 1, gridPos: 1, ...patch }), { track: createStraightTrack(length), skipLights });
  sim.world.events.drain(() => {});
  return sim.world;
}

function setProg(w: SimWorld, car: number, prog: number, init = false): void {
  const v = w.state.cars[car]!.vehicle;
  const len = w.static.track.query.length;
  v.lapWraps = Math.floor(prog / len);
  v.s = prog - v.lapWraps * len;
  if (init) w.state.cars[car]!.race.progress = prog;
}

function tick(w: SimWorld, dir: SimSystem, out?: SimEvent[]): void {
  w.state.tick++;
  w.state.time += SIM_DT;
  dir.step(w, SIM_DT);
  w.events.drain((e) => out?.push(e));
}

describe('RaceDirector v2: start (rules §2)', () => {
  it('lights 1…5 at 1.0…5.0 s into the lights phase; seeded hold 0.2–3.0 s over 50 seeds', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const w = makeWorld({ seed }, false);
      const hold = w.state.race.lightsOutAtMs - GRID_HOLD_MS - 5 * LIGHT_INTERVAL_MS;
      expect(hold).toBeGreaterThanOrEqual(LIGHTS_HOLD_MIN_MS);
      expect(hold).toBeLessThanOrEqual(LIGHTS_HOLD_MAX_MS);
    }
    const w = makeWorld({ seed: 7 }, false);
    const dir = createRaceDirector();
    const ev: { t: number; e: SimEvent }[] = [];
    const sink: SimEvent[] = [];
    while (w.state.race.phase !== 'running') {
      tick(w, dir, sink);
      for (const e of sink) ev.push({ t: w.state.time * 1000, e });
      sink.length = 0;
    }
    const on = ev.filter((x) => x.e.type === 'lightsOn');
    expect(on.map((x) => (x.e as { count: number }).count)).toEqual([1, 2, 3, 4, 5]);
    on.forEach((x, k) => expect(Math.abs(x.t - (GRID_HOLD_MS + (k + 1) * LIGHT_INTERVAL_MS))).toBeLessThan(SIM_DT * 1000 + 1e-6));
    const out = ev.find((x) => x.e.type === 'lightsOut')!;
    expect(Math.abs(out.t - w.state.race.lightsOutAtMs)).toBeLessThan(SIM_DT * 1000 + 1e-6);
  });

  it('jump start: > 0.5 m before lights out = jumpStart + 5 s penalty, once', () => {
    const w = makeWorld({ seed: 3 }, false);
    const dir = createRaceDirector();
    const ev: SimEvent[] = [];
    tick(w, dir, ev);
    const base = w.state.cars[0]!.race.progress;
    setProg(w, 0, base + 0.4);
    tick(w, dir, ev);
    expect(ev.some((e) => e.type === 'jumpStart')).toBe(false);
    setProg(w, 0, base + 0.6);
    tick(w, dir, ev);
    setProg(w, 0, base + 2);
    tick(w, dir, ev);
    expect(ev.filter((e) => e.type === 'jumpStart')).toHaveLength(1);
    expect(ev.filter((e) => e.type === 'penalty' && e.reason === 'jumpStart' && e.seconds === 5)).toHaveLength(1);
    expect(w.state.cars[0]!.race.penaltyToServeSec).toBe(5);
  });
});

describe('RaceDirector v2: timing', () => {
  it('S-SM-12: interpolated line crossing error < 1 ms against the analytic time', () => {
    const w = makeWorld({ laps: 5 }, true);
    const dir = createRaceDirector();
    const v = 47.3;
    let prog = -100;
    setProg(w, 0, prog, true);
    setProg(w, 1, -5000, true);
    const laps: number[] = [];
    const ev: SimEvent[] = [];
    for (let i = 0; i < 240 * 100 && laps.length < 2; i++) {
      prog += v * SIM_DT;
      setProg(w, 0, prog);
      tick(w, dir, ev);
      for (const e of ev) if (e.type === 'lap' && e.car === 0) laps.push(e.ms);
      ev.length = 0;
    }
    // Lap 1 is timed from the race start (t = 0, skipLights) and includes the 100 m grid distance.
    expect(Math.abs(laps[0]! - ((100 + L) / v) * 1000)).toBeLessThan(1);
    expect(Math.abs(laps[1]! - (L / v) * 1000)).toBeLessThan(1);
  });

  it('1-lap race from a standing start: lap 1 is a valid timed lap → bestLapMs, fastest lap and results best lap set', () => {
    const sim = createSim(defaultSessionConfig({ aiCount: 1, laps: 1, gridPos: 1, seed: 9 }), { track: createStraightTrack(L) });
    const w = sim.world;
    w.events.drain(() => {});
    const dir = createRaceDirector();
    const ev: SimEvent[] = [];
    let prog = -100;
    setProg(w, 0, prog, true);
    setProg(w, 1, -5000, true);
    let movedFromMs = -1;
    for (let i = 0; i < 240 * 120 && !w.state.cars[0]!.race.finished; i++) {
      if (w.state.race.phase === 'running') {
        if (movedFromMs < 0) movedFromMs = w.state.time * 1000;
        prog += 60 * SIM_DT;
      }
      setProg(w, 0, prog);
      tick(w, dir, ev);
    }
    const r = w.state.cars[0]!.race;
    expect(r.finished).toBe(true);
    const lap = ev.find((e) => e.type === 'lap' && e.car === 0) as Extract<SimEvent, { type: 'lap' }>;
    expect(lap.valid).toBe(true);
    // Timed from lights out (sub-tick); the scripted car starts moving at the first tick boundary after it.
    const analytic = movedFromMs - w.state.race.lightsOutAtMs + ((100 + L) / 60) * 1000;
    expect(Math.abs(lap.ms - analytic)).toBeLessThan(1);
    expect(r.bestLapMs).toBe(lap.ms);
    expect(w.state.race.fastest.car).toBe(0);
    const row = buildResults(sim, TEAMS).rows.find((x) => x.car === 0)!;
    expect(row.bestLapMs).toBe(lap.ms);
    expect(row.status).toBe('finished');
  });

  it('S-SM-15: 20-car director tick ≤ 0.6 ms mean on İstanbul (scripted motion, all timing paths)', () => {
    const sim = createSim(defaultSessionConfig({ aiCount: 19, laps: 50 }), { track: loadTrack(), skipLights: true });
    const w = sim.world;
    w.events.drain(() => {});
    const dir = createRaceDirector();
    const len = w.static.track.query.length;
    const progs = w.state.cars.map((c) => c.race.progress);
    const speeds = w.state.cars.map((_, i) => 60 + i * 0.7);
    const run = (n: number): number => {
      const t0 = performance.now();
      for (let k = 0; k < n; k++) {
        for (let i = 0; i < progs.length; i++) {
          progs[i] = progs[i]! + speeds[i]! * SIM_DT;
          const vs = w.state.cars[i]!.vehicle;
          vs.lapWraps = Math.floor(progs[i]! / len);
          vs.s = progs[i]! - vs.lapWraps * len;
          vs.speed = speeds[i]!;
        }
        tick(w, dir);
      }
      return (performance.now() - t0) / n;
    };
    run(2400); // warm-up
    const mean = run(240 * 60);
    expect(mean).toBeLessThan(0.6);
  });
});

describe('RaceDirector v2: track limits, cut zones and the penalties table (rules §3–§5)', () => {
  // `d`: car centre offset during the excursion (default well past the left white line).
  const excursion = (w: SimWorld, dir: SimSystem, ev: SimEvent[], seconds: number, kmh: number, d = 30): void => {
    const car = w.state.cars[0]!;
    car.vehicle.speed = kmh / 3.6;
    car.vehicle.offTrackWheels = 4;
    car.vehicle.d = d;
    for (let i = 0; i < Math.round(seconds * 240); i++) tick(w, dir, ev);
    car.vehicle.offTrackWheels = 0;
    car.vehicle.d = 0;
    for (let i = 0; i < 240 * 1.2; i++) tick(w, dir, ev);
  };

  it('strikes 1–4 warn, 5 = black-and-white, 6+ = +5 s (trackLimits); short, shallow, slow or long excursions do not count (D-033)', () => {
    const w = makeWorld({}, true);
    const dir = createRaceDirector();
    w.state.cars[0]!.vehicle.s = 500;
    const ev: SimEvent[] = [];
    const hw = w.static.track.query.frameAt(500, {} as TrackFrame).halfWidthL;
    excursion(w, dir, ev, 0.3, 150); // too short
    excursion(w, dir, ev, 2, 150, hw + 0.5); // all four wheels out, centre within the 0.75 m margin
    excursion(w, dir, ev, 1, 40); // too slow
    excursion(w, dir, ev, 7, 150); // rejoined after more than 6 s
    expect(ev.filter((e) => e.type === 'trackLimits')).toHaveLength(0);
    for (let k = 0; k < 7; k++) excursion(w, dir, ev, 0.8, 150);
    const tl = ev.filter((e) => e.type === 'trackLimits');
    expect(tl.map((e) => (e as { count: number }).count)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(ev.filter((e) => e.type === 'flag' && e.flag === 'blackWhite')).toHaveLength(1);
    expect(ev.filter((e) => e.type === 'penalty' && e.reason === 'trackLimits' && e.seconds === 5)).toHaveLength(2);
    expect(w.state.cars[0]!.race.penaltySec).toBe(10);
    expect(w.state.cars[0]!.race.lapValid).toBe(false);
  });

  it('time trial: any excursion invalidates the lap (lapInvalidated trackLimits), no strikes', () => {
    const w = makeWorld({ mode: 'timeTrial', aiCount: 0 }, true);
    const dir = createRaceDirector();
    w.state.cars[0]!.race.lapValid = true;
    w.state.cars[0]!.vehicle.s = 500;
    const ev: SimEvent[] = [];
    excursion(w, dir, ev, 0.8, 30);
    expect(ev.filter((e) => e.type === 'lapInvalidated' && e.reason === 'trackLimits')).toHaveLength(1);
    expect(ev.filter((e) => e.type === 'trackLimits')).toHaveLength(0);
  });

  const cutWorld = (zoneBestMs: number): { w: SimWorld; ev: SimEvent[] } => {
    const w = makeWorld({ laps: 5 }, true);
    w.static.track.data.cutZones.push({ id: 'test', side: 1, fromS: 400, toS: 600, gates: [500] });
    for (const c of w.state.cars) {
      const x = crx(c.race);
      x.zoneCut = [0];
      x.zoneBest = [zoneBestMs];
    }
    const dir = createRaceDirector();
    const ev: SimEvent[] = [];
    let prog = 300;
    setProg(w, 0, prog, true);
    setProg(w, 1, -5000, true);
    const car = w.state.cars[0]!;
    for (let i = 0; i < 240 * 8; i++) {
      prog += 50 * SIM_DT;
      setProg(w, 0, prog);
      car.vehicle.d = prog > 480 && prog < 520 ? 20 : 0;
      tick(w, dir, ev);
    }
    return { w, ev };
  };

  it('cornerCut: a cut that gains time = +5 s (cornerCut)', () => {
    const { w, ev } = cutWorld(10_000); // reference 10 s: 4 s through the zone is a gain
    expect(ev.filter((e) => e.type === 'penalty' && e.reason === 'cornerCut' && e.seconds === 5)).toHaveLength(1);
    expect(w.state.cars[0]!.race.penaltyToServeSec).toBe(5);
    expect(ev.some((e) => e.type === 'lapInvalidated' && e.reason === 'cornerCut')).toBe(true);
  });

  it('cornerCut without a gain counts as a track-limits strike', () => {
    const { ev } = cutWorld(1000); // reference 1 s: no gain
    expect(ev.filter((e) => e.type === 'penalty')).toHaveLength(0);
    expect(ev.filter((e) => e.type === 'trackLimits')).toHaveLength(1);
  });

  it('twoCompound: +30 s at the finish, never served, added to the classification time', () => {
    const w = makeWorld({ laps: 1, mandatoryStop: true }, true);
    const dir = createRaceDirector();
    let prog = -50;
    setProg(w, 0, prog, true);
    setProg(w, 1, -5000, true);
    const ev: SimEvent[] = [];
    for (let i = 0; i < 240 * 60 && !w.state.cars[0]!.race.finished; i++) {
      prog += 60 * SIM_DT;
      setProg(w, 0, prog);
      tick(w, dir, ev);
    }
    const r = w.state.cars[0]!.race;
    expect(r.finished).toBe(true);
    expect(ev.filter((e) => e.type === 'penalty' && e.reason === 'twoCompound' && e.seconds === 30)).toHaveLength(1);
    expect(r.penaltyToServeSec).toBe(0);
    expect(classificationMs(w.state.cars[0]!) - r.finishMs).toBe(30_000);
  });

  it('pitSpeeding row: covered by src/race/__tests__/pit.test.ts (L10)', () => {
    expect(true).toBe(true);
  });
});

describe('RaceDirector v2: flags and DRS (rules §6)', () => {
  it('yellow in the sector of a slow car after 2 s, cleared 3 s after it moves on; green follows', () => {
    const w = makeWorld({ aiCount: 1 }, true);
    const dir = createRaceDirector();
    const ev: SimEvent[] = [];
    for (let i = 0; i < 240 * 6; i++) {
      for (const c of w.state.cars) c.vehicle.speed = 60;
      tick(w, dir, ev);
    }
    const slow = w.state.cars[1]!;
    slow.vehicle.s = 1500;
    slow.vehicle.speed = 5;
    for (let i = 0; i < 240 * 2.5; i++) tick(w, dir, ev);
    const sec = w.static.track.query.sectorAt(1500);
    expect(w.state.race.yellow[sec]).toBe(true);
    expect(ev.some((e) => e.type === 'flag' && e.flag === 'yellow' && e.sector === sec)).toBe(true);
    slow.vehicle.speed = 60;
    for (let i = 0; i < 240 * 3.5; i++) tick(w, dir, ev);
    expect(w.state.race.yellow[sec]).toBe(false);
    expect(ev.some((e) => e.type === 'flag' && e.flag === 'green' && e.sector === sec)).toBe(true);
  });

  it('DRS enables when the leader starts lap 3', () => {
    const w = makeWorld({ laps: 5 }, true, 1000);
    const dir = createRaceDirector();
    let prog = 0;
    setProg(w, 0, prog, true);
    setProg(w, 1, -50, true);
    const ev: SimEvent[] = [];
    for (let i = 0; i < 240 * 60 && !w.state.race.drsEnabled; i++) {
      prog += 80 * SIM_DT;
      setProg(w, 0, prog);
      setProg(w, 1, prog - 50);
      tick(w, dir, ev);
    }
    expect(w.state.race.drsEnabled).toBe(true);
    expect(w.state.cars[0]!.race.lapsCompleted).toBe(2);
  });

  it('B-5: gaps to the leader are monotone with race order (seed 1234, 20 cars, every 5 s for 100 s)', () => {
    const sim = createSim(defaultSessionConfig({ aiCount: 19, autodrive: true, seed: 1234, laps: 5 }), { skipLights: true });
    const st = sim.world.state;
    for (let t = 0; t < 100; t += 5) {
      for (let i = 0; i < 5 * 240; i++) sim.step();
      sim.world.events.drain(() => {});
      let prev = 0;
      for (const car of st.race.order) {
        const g = st.cars[car]!.race.gapToLeaderMs;
        expect(g, `t=${t + 5} car ${car}`).toBeGreaterThanOrEqual(prev - 1);
        prev = g;
      }
    }
  }, 60_000);
});
