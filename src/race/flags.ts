// Yellow / green / blue flags and DRS wetness gating (rules §6). Sim layer, allocation-free.

import type { SimWorld } from '../contracts/sim';
import { crx, rrx } from './extra';
import {
  BLUE_GAP_S, BLUE_HOLD_S, BLUE_SEARCH_M, DRS_WET_OFF, DRS_WET_ON, DRS_WET_REENABLE_LAPS, GREEN_PANEL_S, YELLOW_CLEAR_S,
  YELLOW_NEAR_TRACK_M, YELLOW_SLOW_KMH, YELLOW_SLOW_S, YELLOW_START_GRACE_MS,
} from './rules';

const causeScratch: [number, number, number] = [-1, -1, -1];

/** Per tick while the race runs: yellow causes per sector (slow / stopped / post-reset cars), hold and clear. */
export function stepYellowFlags(world: SimWorld, dt: number): void {
  const st = world.state;
  const race = st.race;
  const x = rrx(race);
  const q = world.static.track.query;
  const data = q.data;
  causeScratch[0] = -1;
  causeScratch[1] = -1;
  causeScratch[2] = -1;
  for (let i = 0; i < st.cars.length; i++) {
    const car = st.cars[i]!;
    const r = car.race;
    // D-056: a retired car stopped near the track is a yellow cause too, until marshals clear it (scCleared).
    if (r.finished || (r.status !== 'running' && r.status !== 'dnf') || crx(r).scCleared === 1 || car.vehicle.hint.ribbon === 'pit' || car.pit.phase !== 'none') {
      crx(r).slowT = 0;
      continue;
    }
    const v = car.vehicle;
    const cx = crx(r);
    const kmh = v.speed * 3.6;
    // The first seconds after lights out are exempt (every car starts from rest).
    if (kmh < YELLOW_SLOW_KMH && race.raceMs - race.lightsOutAtMs > YELLOW_START_GRACE_MS) cx.slowT += dt;
    else cx.slowT = 0;
    const idx = Math.min(data.count - 1, Math.max(0, Math.round(v.s)));
    const nearTrack = v.d < data.halfWidthL[idx]! + YELLOW_NEAR_TRACK_M && v.d > -(data.halfWidthR[idx]! + YELLOW_NEAR_TRACK_M);
    const slow = cx.slowT >= YELLOW_SLOW_S && nearTrack;
    const resetWindow = cx.recoverT > 0;
    if (slow || resetWindow) {
      const sec = q.sectorAt(v.s);
      if (causeScratch[sec]! < 0) causeScratch[sec] = car.id;
    }
  }
  for (let k = 0; k < 3; k++) {
    const cause = causeScratch[k]!;
    if (cause >= 0) {
      x.yellowT[k] = YELLOW_CLEAR_S;
      if (!race.yellow[k]) {
        race.yellow[k] = true;
        x.greenT[k] = 0;
        world.events.push({ type: 'flag', flag: 'yellow', sector: k, car: cause });
      }
    } else if (race.yellow[k]) {
      x.yellowT[k] -= dt;
      if (x.yellowT[k]! <= 0) {
        race.yellow[k] = false;
        x.yellowT[k] = 0;
        x.greenT[k] = GREEN_PANEL_S;
        world.events.push({ type: 'flag', flag: 'green', sector: k, car: -1 });
      }
    } else if (x.greenT[k]! > 0) x.greenT[k] = Math.max(0, x.greenT[k]! - dt);
  }
}

/**
 * Blue flags (60 Hz with the standings): a car at least one lap down with a lapping car ≤ 1.0 s behind on track
 * for ≥ 1 s gets a `flag` blue event once per episode. `dt` = time since the previous call.
 */
export function stepBlueFlags(world: SimWorld, dt: number): void {
  const cars = world.state.cars;
  const q = world.static.track.query;
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i]!;
    const ra = a.race;
    const xa = crx(ra);
    if (ra.lapsDown < 1 || ra.finished || ra.status !== 'running') {
      xa.blueT = 0;
      xa.blueOn = 0;
      continue;
    }
    let near = false;
    for (let j = 0; j < cars.length && !near; j++) {
      if (j === i) continue;
      const b = cars[j]!;
      if (b.race.status !== 'running' || b.race.finished || b.race.progress <= ra.progress) continue;
      const gapM = q.deltaS(b.vehicle.s, a.vehicle.s); // > 0: b is behind a on track
      if (gapM <= 0 || gapM > BLUE_SEARCH_M) continue;
      if (gapM / Math.max(10, b.vehicle.speed) <= BLUE_GAP_S) near = true;
    }
    if (near) {
      xa.blueT += dt;
      if (xa.blueT >= BLUE_HOLD_S && xa.blueOn === 0) {
        xa.blueOn = 1;
        world.events.push({ type: 'flag', flag: 'blue', sector: q.sectorAt(a.vehicle.s), car: a.id });
      }
    } else {
      xa.blueT = 0;
      xa.blueOn = 0;
    }
  }
}

/** DRS wetness gating (rules §6): off while wetness ≥ 0.30, back 2 leader laps after it drops below 0.20. */
export function stepDrsWetness(world: SimWorld, leaderLap: number): void {
  const race = world.state.race;
  const x = rrx(race);
  const w = world.state.conditions.wetness;
  if (w > x.wetMax) x.wetMax = w;
  if (x.drsWetBlock === 0 && w >= DRS_WET_OFF) {
    x.drsWetBlock = 1;
    x.drsReenableLap = -1;
    if (race.drsEnabled) {
      race.drsEnabled = false;
      world.events.push({ type: 'drsDisabled' });
    }
  } else if (x.drsWetBlock === 1) {
    if (w >= DRS_WET_ON) x.drsReenableLap = -1;
    else if (x.drsReenableLap < 0) x.drsReenableLap = leaderLap + DRS_WET_REENABLE_LAPS;
    else if (leaderLap >= x.drsReenableLap) {
      x.drsWetBlock = 0;
      x.drsReenableLap = -1;
    }
  }
}
