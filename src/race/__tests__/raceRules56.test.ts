// D-056: collision-causing penalties and the safety car (sim layer, headless).
import { describe, expect, it } from 'vitest';
import type { SimEvent, SimRunner } from '../../contracts/sim';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { teleportCar } from '../../game/sim/teleport';
import { noteCollision, stepCollisionPenalties } from '../collisionPenalty';
import { crx } from '../extra';
import { retireCar } from '../penalties';
import { COLLISION_HEAVY_S, COLLISION_MIN_J, COLLISION_PENALTY_S, COLLISION_WINDOW_S } from '../rules';

function race(opts: { ai?: number; laps?: number; seed?: number; trackId?: 'istanbul' | 'lombardia' | 'bosphorus' | 'ardennes'; safetyCar?: boolean } = {}): SimRunner {
  return createSim(defaultSessionConfig({
    mode: 'race', aiCount: opts.ai ?? 3, laps: opts.laps ?? 3, seed: opts.seed ?? 4, autodrive: true, trackId: opts.trackId ?? 'bosphorus',
    difficulty: 55, safetyCar: opts.safetyCar,
  }), { skipLights: true });
}

/** Car `id` at track position s, lateral d, speed kmh, heading along the track. */
function place(sim: SimRunner, id: number, s: number, d: number, kmh: number): void {
  teleportCar(sim.world, id, s, d, kmh);
}

function judge(sim: SimRunner): SimEvent[] {
  const evs: SimEvent[] = [];
  sim.world.events.drain(() => {});
  for (let t = 0; t < COLLISION_WINDOW_S * 240 + 10; t++) stepCollisionPenalties(sim.world, 1 / 240);
  sim.world.events.drain((e) => evs.push(e));
  return evs;
}

function running(sim: SimRunner): void {
  const r = sim.world.state.race;
  r.raceMs = 60_000;
  r.lightsOutAtMs = 0;
}

describe('D-056 collision penalties', () => {
  it('rear-end at fault: first a warning, the next one +5 s; light contacts are free', () => {
    const sim = race();
    running(sim);
    place(sim, 0, 500, 0, 200);
    place(sim, 1, 507, 0.3, 150); // ahead, in line, slower
    noteCollision(sim.world, 0, 1, COLLISION_MIN_J * 0.5);
    expect(crx(sim.world.state.cars[0]!.race).incT).toBe(0); // light: nothing
    noteCollision(sim.world, 0, 1, COLLISION_MIN_J * 2);
    let evs = judge(sim);
    expect(evs.filter((e) => e.type === 'collisionWarning')).toEqual([{ type: 'collisionWarning', car: 0, other: 1 }]);
    expect(sim.world.state.cars[0]!.race.penaltySec).toBe(0);
    sim.world.state.race.raceMs += 10_000; // past the pair cooldown
    place(sim, 0, 800, 0, 200);
    place(sim, 1, 807, 0, 150);
    noteCollision(sim.world, 1, 0, COLLISION_MIN_J * 2);
    evs = judge(sim);
    expect(evs.filter((e) => e.type === 'penalty')).toEqual([{ type: 'penalty', car: 0, seconds: COLLISION_PENALTY_S, reason: 'collision' }]);
    expect(sim.world.state.cars[1]!.race.penaltySec).toBe(0);
  });

  it('heavy (the victim spins / stops) = +10 s; side-by-side pushes without consequence are free', () => {
    const sim = race();
    running(sim);
    place(sim, 0, 500, 0, 200);
    place(sim, 1, 507, 0, 20); // victim almost stopped → heavy
    sim.world.state.cars[1]!.vehicle.speed = 2;
    noteCollision(sim.world, 0, 1, COLLISION_MIN_J * 2);
    const evs = judge(sim);
    expect(evs.filter((e) => e.type === 'penalty')).toEqual([{ type: 'penalty', car: 0, seconds: COLLISION_HEAVY_S, reason: 'collision' }]);

    const s2 = race({ seed: 5 });
    running(s2);
    place(s2, 2, 900, 2, 180);
    place(s2, 3, 900.5, -0.2, 180); // alongside
    const v2 = s2.world.state.cars[2]!.vehicle;
    const tx = s2.world.static.track.data.tx[900]!;
    const tz = s2.world.static.track.data.tz[900]!;
    // Car 2 (left) moves right into car 3 at 4 m/s.
    v2.vx -= 4 * tz;
    v2.vz += 4 * tx;
    noteCollision(s2.world, 2, 3, COLLISION_MIN_J * 2);
    expect(crx(s2.world.state.cars[2]!.race).incKind).toBe(3);
    expect(judge(s2).filter((e) => e.type === 'penalty' || e.type === 'collisionWarning')).toEqual([]);
  });

  it('AI races: penalties stay rare (no spam from normal racing)', () => {
    const sim = race({ ai: 9, laps: 1, seed: 7, trackId: 'lombardia' });
    let pens = 0;
    for (let t = 0; t < 240 * 120 && sim.world.state.race.phase !== 'finished'; t++) {
      sim.step();
      sim.world.events.drain((e) => {
        if ((e.type === 'penalty' && e.reason === 'collision') || e.type === 'collisionWarning') pens++;
      });
    }
    expect(pens).toBeLessThanOrEqual(2);
  }, 120_000);
});

describe('D-056 safety car', () => {
  /** A crash: car 4 retires (brakes to a stop on track); runs until the restart. */
  function scRun(seed: number) {
    const sim = race({ ai: 7, laps: 6, seed, trackId: 'bosphorus' });
    const log: string[] = [];
    let maxQueue = 0;
    let scPens = 0;
    const st = sim.world.state;
    for (let t = 0; t < 240 * 600 && st.race.phase !== 'finished'; t++) {
      if (t === 240 * 25) retireCar(sim.world, 4);
      sim.step();
      if (st.race.sc.phase !== 'none') {
        // Every racing AI car obeys its cap within a margin (queue keeping).
        for (const c of st.cars) if (c.race.scTargetSpeed >= 0) maxQueue = Math.max(maxQueue, c.vehicle.speed - c.race.scTargetSpeed);
      }
      sim.world.events.drain((e) => {
        if (e.type === 'safetyCar') log.push(`${e.phase}@${Math.round(st.time)}`);
        if (e.type === 'flag' && e.flag === 'yellow') log.push(`yellow${e.sector}@${Math.round(st.time)}`);
        if (e.type === 'penalty' && e.reason === 'safetyCar') scPens++;
      });
      if (log.some((l) => l.startsWith('none@'))) break;
    }
    return { sim, log, maxQueue, scPens };
  }

  it('crash → yellow → SC after 10 s → queue → SC in → restart; deterministic', () => {
    const a = scRun(11);
    const phases = a.log.filter((l) => !l.startsWith('yellow')).map((l) => l.split('@')[0]);
    expect(phases).toEqual(['deployed', 'ending', 'none']);
    const yellowAt = Number(a.log.find((l) => l.startsWith('yellow'))!.split('@')[1]);
    const deployedAt = Number(a.log.find((l) => l.startsWith('deployed'))!.split('@')[1]);
    expect(deployedAt - yellowAt).toBeGreaterThanOrEqual(9);
    expect(deployedAt - yellowAt).toBeLessThanOrEqual(12);
    expect(a.sim.world.state.race.sc.count).toBe(1);
    expect(a.scPens).toBeLessThanOrEqual(1);
    const b = scRun(11);
    expect(b.log).toEqual(a.log);
    expect(b.sim.hash()).toBe(a.sim.hash());
  }, 300_000);

  it('the race-settings toggle turns it off', () => {
    const sim = race({ ai: 3, laps: 4, seed: 11, safetyCar: false });
    const st = sim.world.state;
    let yellow = false;
    for (let t = 0; t < 240 * 60; t++) {
      if (t === 240 * 15) retireCar(sim.world, 2);
      sim.step();
      yellow ||= st.race.yellow.some((y) => y);
    }
    expect(st.race.sc.count).toBe(0);
    expect(yellow).toBe(true); // the yellow still comes
    // The marshals removed the retired car (parked off the map, hidden, ignored by traffic).
    expect(st.cars[2]!.control).toBe('remote');
    expect(st.race.yellow.some((y) => y)).toBe(false);
  }, 120_000);
});

describe('D-061 Kasap mode', () => {
  function sim(rules: 'normal' | 'kasap'): SimRunner {
    return createSim(defaultSessionConfig({ mode: 'race', aiCount: 3, laps: 4, seed: 11, autodrive: true, trackId: 'bosphorus', difficulty: 55, rules }), { skipLights: true });
  }
  function incident(s: SimRunner): SimEvent[] {
    running(s);
    place(s, 0, 500, 0, 200);
    place(s, 1, 507, 0, 20);
    s.world.state.cars[1]!.vehicle.speed = 2; // the victim stops: heavy
    noteCollision(s.world, 0, 1, COLLISION_MIN_J * 2);
    return judge(s);
  }

  it('the same heavy rear-end costs +10 s in Normal and nothing in Kasap; no penalties or warnings of any kind', async () => {
    expect(incident(sim('normal')).filter((e) => e.type === 'penalty')).toHaveLength(1);
    const k = sim('kasap');
    expect(incident(k).filter((e) => e.type === 'penalty' || e.type === 'collisionWarning')).toEqual([]);
    const { addPenalty } = await import('../penalties');
    addPenalty(k.world, k.world.state.cars[2]!, 5, 'jumpStart');
    addPenalty(k.world, k.world.state.cars[2]!, 5, 'pitSpeeding');
    let evs: SimEvent[] = [];
    k.world.events.drain((e) => evs.push(e));
    expect(evs).toEqual([]);
    expect(k.world.state.cars[2]!.race.penaltySec).toBe(0);
    // A stopped car never brings out the safety car in Kasap (yellow flags stay informational).
    const st = k.world.state;
    let yellow = false;
    for (let t = 0; t < 240 * 40; t++) {
      if (t === 240 * 10) retireCar(k.world, 3);
      k.step();
      yellow ||= st.race.yellow.some((y) => y);
    }
    evs = [];
    k.world.events.drain((e) => evs.push(e));
    expect(st.race.sc.count).toBe(0);
    expect(yellow).toBe(true);
    expect(evs.filter((e) => e.type === 'penalty' || e.type === 'trackLimits' || e.type === 'lapInvalidated' || e.type === 'collisionWarning')).toEqual([]);
  }, 120_000);
});
