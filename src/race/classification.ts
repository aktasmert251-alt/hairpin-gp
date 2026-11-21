// Final and projected classification (rules §9). Sim layer, pure (reads SimState, writes nothing).

import type { CarRaceState } from '../contracts/race';
import type { SimWorld } from '../contracts/sim';
import { crx } from './extra';
import { classificationMs } from './penalties';
import { POINTS } from './rules';

export interface ClassifiedCar {
  car: number;
  pos: number;
  /** Race time incl. unserved and two-compound penalties (ms); projected for cars still running; time at retirement for DNF. */
  totalMs: number;
  gapMs: number;
  lapsDown: number;
  points: number;
  status: CarRaceState['status'];
  /** true when the time is a projection (car still running when the session ended, rules §9). */
  projected: boolean;
}

export function pointsForPosition(pos: number): number {
  return pos >= 1 && pos <= POINTS.length ? POINTS[pos - 1]! : 0;
}

/**
 * Rules §9. Finished cars: laps completed (desc), then classification time (asc), equal → better grid slot.
 * Cars still running (session ended early: player finished / retired / skip, or the 120 s window closed) keep their
 * current track order after the finishers with the same lap count; their time is projected as
 * race time now + remaining laps × last valid lap (or the session average). DNF after every classified car,
 * by laps completed (desc), then retirement time (later first).
 */
export function classify(world: SimWorld): ClassifiedCar[] {
  const st = world.state;
  const race = st.race;
  const cfg = world.static.config;
  const cars = st.cars;
  const length = world.static.track.query.length;
  const nowRace = Math.max(0, race.raceMs - race.lightsOutAtMs);

  // Session average lap (valid laps of every car) for projections without a last valid lap.
  let lapSum = 0;
  let lapN = 0;
  for (const c of cars) {
    if (c.race.bestLapMs > 0) {
      lapSum += c.race.lastLapMs > 0 ? c.race.lastLapMs : c.race.bestLapMs;
      lapN++;
    }
  }
  const avgLap = lapN > 0 ? lapSum / lapN : 95_000;

  interface Row { car: number; laps: number; time: number; grid: number; live: number; group: 0 | 1 | 2; projected: boolean }
  const rows: Row[] = cars.map((c) => {
    const r = c.race;
    const x = crx(r);
    const live = race.order.indexOf(c.id);
    if (r.status === 'dnf' || r.status === 'dsq') {
      return { car: c.id, laps: r.lapsCompleted, time: x.retireMs >= 0 ? x.retireMs - race.lightsOutAtMs : nowRace, grid: x.gridProg, live, group: 2, projected: false };
    }
    if (r.finished) return { car: c.id, laps: r.lapsCompleted, time: classificationMs(c) - race.lightsOutAtMs, grid: x.gridProg, live, group: 0, projected: false };
    const lapRef = r.lastLapMs > 0 && r.lapValid ? r.lastLapMs : r.bestLapMs > 0 ? r.bestLapMs : avgLap;
    const remaining = Math.max(0, cfg.laps - r.progress / length);
    const time = nowRace + remaining * lapRef + (r.penaltyToServeSec + x.twoCompoundSec) * 1000;
    // Projected cars complete the race distance unless they are already lapped.
    return { car: c.id, laps: Math.max(r.lapsCompleted, cfg.laps - r.lapsDown), time, grid: x.gridProg, live, group: 1, projected: true };
  });

  rows.sort((a, b) => {
    const ga = a.group === 2 ? 1 : 0;
    const gb = b.group === 2 ? 1 : 0;
    if (ga !== gb) return ga - gb;
    if (a.group === 2) return b.laps - a.laps || b.time - a.time;
    if (a.laps !== b.laps) return b.laps - a.laps;
    // Running cars keep their current order relative to each other.
    if (a.group === 1 && b.group === 1) return a.live - b.live;
    if (a.time !== b.time) return a.time - b.time;
    return b.grid - a.grid;
  });

  const winner = rows[0]!;
  return rows.map((row, i) => {
    const r = cars[row.car]!.race;
    const dnf = row.group === 2;
    const lapsDown = dnf ? 0 : Math.max(0, winner.laps - row.laps);
    return {
      car: row.car,
      pos: i + 1,
      totalMs: row.time,
      gapMs: i === 0 || dnf || lapsDown > 0 ? 0 : Math.max(0, row.time - winner.time),
      lapsDown,
      points: dnf ? 0 : pointsForPosition(i + 1),
      status: r.status,
      projected: row.projected,
    };
  });
}
