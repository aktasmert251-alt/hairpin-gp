// RaceDirector v2 (§3.3 #6, YÖN; docs/design/rules.md §2–§6, §9). Sim layer, allocation-free per tick.
//
// grid (2 s) -> lights (1…5 at 1.0…5.0 s, seeded hold 0.2–3.0 s) -> running -> finishing -> finished.
// Clock: `raceMs` is the session clock in ms (= sim time); race time = raceMs − lightsOutAtMs (rules §2: the race clock
// starts at lights out; with skipLights / TT lightsOutAtMs = 0). Every stored time (lap/sector starts, marker times,
// finish times) is on the session clock. Line crossings are interpolated inside the tick (1 ms resolution).
// Also: jump starts, track limits and cut zones (limits.ts), penalties (penalties.ts), yellow/blue flags and DRS
// gating (flags.ts), marker-based gaps and positions at 60 Hz, speed trap.

import type { CarRaceState, RaceState, SectorStatus } from '../contracts/race';
import { SIM_DT, type SimCarState, type SimEvent, type SimSystem, type SimWorld } from '../contracts/sim';
import { stepPit } from './pit';
import { crx, rrx } from './extra';
import { stepBlueFlags, stepDrsWetness, stepYellowFlags } from './flags';
import { invalidateLap, stepCutZones, stepTrackLimits } from './limits';
import { addPenalty, applyFinishPenalties, rulesOn } from './penalties';
import { stepWrongWay } from './wrongWay';
import { noteCollision, stepCollisionPenalties } from './collisionPenalty';
import { noteScPass, stepSafetyCar } from './safetyCar';
import {
  DRS_ENABLE_LEADER_LAP, DRS_GAP_MS, FINISH_WINDOW_MS, GRID_HOLD_MS, JUMP_START_M, LIGHTS_COUNT, LIGHT_INTERVAL_MS, PENALTY_S,
} from './rules';

const TICK_MS = SIM_DT * 1000;
/** Positions and gaps run at 60 Hz (§3.2). */
const STANDINGS_EVERY = 4;
/** Larger per-tick progress jumps are treated as teleports (no timing events). */
const MAX_TICK_ADVANCE_M = 50;

/** Fraction (0, 1] of a tick at which the line at `lineS` was crossed moving from prevS by ds > 0, else -1. */
export function crossFraction(prevS: number, ds: number, lineS: number, length: number): number {
  let dl = lineS - prevS;
  dl -= Math.floor(dl / length) * length;
  if (dl === 0) dl = length;
  return dl <= ds ? dl / ds : -1;
}

export function sectorStatusFor(ms: number, personalBest: number, sessionBest: number): SectorStatus {
  if (sessionBest <= 0 || ms < sessionBest) return 'purple';
  if (personalBest <= 0 || ms < personalBest) return 'green';
  return 'yellow';
}

function inZone(s: number, from: number, to: number): boolean {
  return from <= to ? s >= from && s < to : s >= from || s < to;
}

function effectiveProgress(r: CarRaceState, length: number): number {
  return r.finished ? r.lapsCompleted * length : r.progress;
}

export function createRaceDirector(): SimSystem {
  let world!: SimWorld;
  let length = 1;
  let rules = true;
  // D-056 contact buffer (fixed size; extra contacts in one tick are ignored).
  const COL_MAX = 64;
  const colA = new Int16Array(COL_MAX);
  const colB = new Int16Array(COL_MAX);
  const colJ = new Float64Array(COL_MAX);
  let colN = 0;
  let listened: SimWorld | null = null;
  const onEvent = (e: SimEvent): void => {
    if (e.type !== 'collision' || e.b < 0 || colN >= COL_MAX) return;
    colA[colN] = e.a;
    colB[colN] = e.b;
    colJ[colN] = e.impulse;
    colN++;
  };
  // Per-tick crossing context for the cut-zone callback (no closure allocation per car).
  let cxPrevS = 0;
  let cxDs = 0;
  const cross = (lineS: number): number => crossFraction(cxPrevS, cxDs, lineS, length);

  const closeSector = (car: SimCarState, k: 0 | 1 | 2, tMs: number): void => {
    const r = car.race;
    const race = world.state.race;
    const ms = tMs - r.sectorStartMs;
    r.curSectors[k] = ms;
    const status = sectorStatusFor(ms, r.bestSectors[k], race.sessionBestSectors[k]);
    r.sectorStatus[k] = status;
    if (r.lapValid) {
      if (r.bestSectors[k] <= 0 || ms < r.bestSectors[k]) r.bestSectors[k] = ms;
      if (race.sessionBestSectors[k] <= 0 || ms < race.sessionBestSectors[k]) race.sessionBestSectors[k] = ms;
    }
    r.sectorStartMs = tMs;
    r.sector = k === 2 ? 0 : ((k + 1) as 1 | 2);
    world.events.push({ type: 'sector', car: car.id, sector: k, ms, status });
  };

  const finishCar = (car: SimCarState, tMs: number): void => {
    const r = car.race;
    const race = world.state.race;
    r.finished = true;
    r.status = 'finished';
    r.finishMs = tMs;
    let finishedCount = 0;
    const cars = world.state.cars;
    for (let i = 0; i < cars.length; i++) if (cars[i]!.race.finished) finishedCount++;
    if (race.phase === 'running') {
      race.phase = 'finishing';
      race.finishCountdownMs = FINISH_WINDOW_MS;
      world.events.push({ type: 'flag', flag: 'chequered', sector: -1, car: car.id });
    }
    applyFinishPenalties(world, car);
    world.events.push({ type: 'finish', car: car.id, position: finishedCount });
  };

  const startLap = (car: SimCarState, tMs: number): void => {
    const r = car.race;
    const x = crx(r);
    r.lapStartMs = tMs;
    r.sectorStartMs = tMs;
    r.sector = 0;
    r.lapValid = true;
    if (x.nextLapInvalid === 1) {
      x.nextLapInvalid = 0;
      invalidateLap(world, car, 'trackLimits');
    }
  };

  const onFinishLine = (car: SimCarState, lapIdx: number, tMs: number): void => {
    const r = car.race;
    const st = world.state;
    const cfg = world.static.config;
    if (cfg.mode === 'timeTrial' && r.lapStartMs < 0) {
      // TT flying start (and restartLap, which sets lapWraps = lapsCompleted − 1): the lap starts at the line.
      if (lapIdx === r.lapsCompleted) startLap(car, tMs);
      return;
    }
    // First crossing from the grid: not a completed lap.
    if (lapIdx <= 0) return;
    if (lapIdx <= r.lapsCompleted || r.lapStartMs < 0) return; // re-crossing after reversing, or never started
    const complete = r.sector === 2;
    if (complete) closeSector(car, 2, tMs);
    const lapMs = tMs - r.lapStartMs;
    const valid = r.lapValid && complete;
    r.lapsCompleted = lapIdx;
    r.lastLapMs = lapMs;
    if (valid && (r.bestLapMs <= 0 || lapMs < r.bestLapMs)) r.bestLapMs = lapMs;
    const race = st.race;
    world.events.push({ type: 'lap', car: car.id, lap: lapIdx, ms: lapMs, valid });
    if (valid && (race.fastest.car < 0 || lapMs < race.fastest.ms)) {
      race.fastest.car = car.id;
      race.fastest.ms = lapMs;
      world.events.push({ type: 'fastestLap', car: car.id, ms: lapMs });
    }
    startLap(car, tMs);
    if (cfg.mode === 'race' && !r.finished && (r.lapsCompleted >= cfg.laps || race.phase === 'finishing')) finishCar(car, tMs);
  };

  const markRange = (r: CarRaceState, from: number, to: number, distOffset: number, ds: number, tStartMs: number): void => {
    const markers = r.markerTimes;
    const m = markers.length;
    for (let k = Math.floor(from / 10) + 1; k * 10 <= to && k < m; k++) {
      markers[k] = tStartMs + ((k * 10 - from + distOffset) / ds) * TICK_MS;
    }
  };

  /** 10 m markers passed moving from prevProg by ds (0 < ds ≤ MAX_TICK_ADVANCE_M) during the tick starting at tStart. */
  const markProgress = (r: CarRaceState, prevProg: number, ds: number, tStart: number): void => {
    const prevS = prevProg - Math.floor(prevProg / length) * length;
    const endS = prevS + ds;
    if (endS < length) markRange(r, prevS, endS, 0, ds, tStart);
    else {
      markRange(r, prevS, length - 1e-9, 0, ds, tStart);
      r.markerTimes[0] = tStart + ((length - prevS) / ds) * TICK_MS;
      markRange(r, 0, endS - length, length - prevS, ds, tStart);
    }
  };

  /** Rules §2: grid / lights phases. Records the grid progress and detects jump starts (> 0.5 m, once). */
  const preStart = (car: SimCarState): void => {
    const r = car.race;
    const x = crx(r);
    const prog = car.vehicle.lapWraps * length + car.vehicle.s;
    r.progress = prog;
    // Online puppet (design §5.2): its own client and the server judge its start.
    if (car.control === 'remote') return;
    if (x.gridSet === 0) {
      x.gridSet = 1;
      x.gridProg = prog;
      return;
    }
    if (x.jumped === 0 && rules && Math.abs(prog - x.gridProg) > JUMP_START_M) {
      x.jumped = 1;
      world.events.push({ type: 'jumpStart', car: car.id });
      addPenalty(world, car, PENALTY_S, 'jumpStart');
    }
  };

  const processCar = (car: SimCarState, clockMs: number, race: RaceState, dt: number): void => {
    const r = car.race;
    const v = car.vehicle;
    const prevProg = r.progress;
    const prog = v.lapWraps * length + v.s;
    r.progress = prog;
    if (r.finished || r.status !== 'running' || (race.phase !== 'running' && race.phase !== 'finishing')) return;
    if (car.control === 'remote') {
      // Online puppet (design §5.2): progress + 10 m markers only (gaps, tower); laps, limits, pit and results come from the server.
      const dsR = prog - prevProg;
      if (dsR > 0 && dsR <= MAX_TICK_ADVANCE_M) {
        markProgress(r, prevProg, dsR, clockMs - TICK_MS);
        // DRS detection times of the puppet: a local car behind it within 1 s gets DRS (rules §6). Without them no car following a
        // remote car (another human online, or a human in the server sim) could ever become DRS-eligible.
        const zonesR = world.static.track.data.drsZones;
        const xr = crx(r);
        const prevSR = prevProg - Math.floor(prevProg / length) * length;
        for (let i = 0; i < zonesR.length; i++) {
          const fd = crossFraction(prevSR, dsR, zonesR[i]!.detectS, length);
          if (fd > 0) xr.detectMs[i] = clockMs - TICK_MS + fd * TICK_MS;
        }
      }
      return;
    }
    const cfg = world.static.config;
    const tt = cfg.mode === 'timeTrial';

    // Track limits run every tick (also when stationary).
    // D-061 Kasap: no track-limit / cut-zone strikes, invalidations or warnings.
    if (v.hint.ribbon === 'main') { if (rules) stepTrackLimits(world, car, dt); }
    else if (tt) invalidateLap(world, car, 'trackLimits'); // rules §7: entering the pit lane in TT invalidates the lap
    if (!tt) stepPit(world, car, dt);
    stepWrongWay(world, car, dt); // D-040 (before the forward-motion early return: wrong way means ds < 0)

    const ds = prog - prevProg;
    if (!(ds > 0) || ds > MAX_TICK_ADVANCE_M) return;
    const prevS = prevProg - Math.floor(prevProg / length) * length;
    const tStart = clockMs - TICK_MS;
    const data = world.static.track.data;

    // 10 m markers (gap timing, cut zones).
    markProgress(r, prevProg, ds, tStart);

    // Sector lines.
    const f2 = crossFraction(prevS, ds, data.sectors[0], length);
    if (f2 > 0 && r.sector === 0 && r.sectorStartMs >= 0) closeSector(car, 0, tStart + f2 * TICK_MS);
    const f3 = crossFraction(prevS, ds, data.sectors[1], length);
    if (f3 > 0 && r.sector === 1 && r.sectorStartMs >= 0) closeSector(car, 1, tStart + f3 * TICK_MS);

    // Speed trap.
    const lines = data.timingLines;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.kind === 'speedTrap' && crossFraction(prevS, ds, line.s, length) > 0) r.speedTrapKmh = v.speed * 3.6;
    }

    // Corner cutting (rules §4).
    cxPrevS = prevS;
    cxDs = ds;
    if (rules) stepCutZones(world, car, cross);

    // DRS: detection crossings are evaluated after every car moved this tick (exact 1.000 s rule).
    const x = crx(r);
    const zones = data.drsZones;
    let zoneId = -1;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i]!;
      const fd = crossFraction(prevS, ds, z.detectS, length);
      if (fd > 0) {
        const t = tStart + fd * TICK_MS;
        x.detectMs[i] = t;
        x.pendingZone = i;
        x.pendingMs = t;
      }
      if (!tt && crossFraction(prevS, ds, z.endS, length) > 0) r.drsEligible = false;
      if (inZone(v.s, z.activateS, z.endS)) zoneId = i;
    }
    if (tt) r.drsEligible = true;
    let zoneOk = zoneId >= 0;
    if (zoneOk && !tt) zoneOk = !race.yellow[world.static.track.query.sectorAt(zones[zoneId]!.activateS)];
    if (zoneOk && race.sc.phase !== 'none') zoneOk = false; // D-056: no DRS under the safety car
    r.drsZone = r.drsEligible && zoneOk ? zones[zoneId]!.id : -1;

    // Finish line.
    const ff = crossFraction(prevS, ds, 0, length);
    if (ff > 0) onFinishLine(car, Math.floor(prog / length), tStart + ff * TICK_MS);
  };

  /** Rules §6 DRS detection: ≤ 1.000 s behind any car (lapped cars included) at the detection line. */
  const resolveDrsDetection = (race: RaceState): void => {
    const cars = world.state.cars;
    const zones = world.static.track.data.drsZones;
    const tt = world.static.config.mode === 'timeTrial';
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      const x = crx(car.race);
      const zi = x.pendingZone;
      if (zi < 0) continue;
      x.pendingZone = -1;
      let eligible = tt;
      if (!tt && race.drsEnabled) {
        for (let j = 0; j < cars.length && !eligible; j++) {
          if (j === i) continue;
          const dt = x.pendingMs - (crx(cars[j]!.race).detectMs[zi] ?? -1e9);
          if (dt > 0 && dt <= DRS_GAP_MS) eligible = true;
        }
      }
      car.race.drsEligible = eligible;
      if (eligible) world.events.push({ type: 'drsAvailable', car: car.id, zone: zones[zi]!.id });
    }
  };

  const compare = (a: number, b: number): number => {
    const cars = world.state.cars;
    const ra = cars[a]!.race;
    const rb = cars[b]!.race;
    const da = ra.status === 'dnf' || ra.status === 'dsq' ? 1 : 0;
    const db = rb.status === 'dnf' || rb.status === 'dsq' ? 1 : 0;
    if (da !== db) return da - db;
    const ea = effectiveProgress(ra, length);
    const eb = effectiveProgress(rb, length);
    if (ea !== eb) return eb - ea;
    if (ra.finished && rb.finished) return ra.finishMs - rb.finishMs;
    return a - b;
  };

  const updateStandings = (race: RaceState): void => {
    const cars = world.state.cars;
    const order = race.order;
    // In-place insertion sort: allocation-free and O(n) when nearly sorted.
    for (let i = 1; i < order.length; i++) {
      const x = order[i]!;
      let j = i - 1;
      while (j >= 0 && compare(order[j]!, x) > 0) {
        order[j + 1] = order[j]!;
        j--;
      }
      order[j + 1] = x;
    }
    const live = race.phase === 'running' || race.phase === 'finishing';
    const leader = cars[order[0]!]!.race;
    const leaderEff = effectiveProgress(leader, length);
    const leaderSpeed = cars[order[0]!]!.vehicle.speed;
    let prevGap = 0;
    for (let idx = 0; idx < order.length; idx++) {
      const car = cars[order[idx]!]!;
      const r = car.race;
      const pos = idx + 1;
      if (r.position !== pos) {
        if (live && r.position > 0) world.events.push({ type: 'position', car: car.id, from: r.position, to: pos });
        // D-056: a place gained under the safety car (the car now right behind was passed).
        if (live && r.position > 0 && pos < r.position && race.sc.phase !== 'none' && idx + 1 < order.length) noteScPass(world, car.id, order[idx + 1]!);
        r.position = pos;
      }
      if (idx === 0) {
        r.gapToLeaderMs = 0;
        r.intervalMs = 0;
        r.lapsDown = 0;
        prevGap = 0;
        continue;
      }
      const eff = effectiveProgress(r, length);
      r.lapsDown = Math.max(0, Math.floor((leaderEff - eff) / length));
      let gap: number;
      if (r.finished && leader.finished && r.lapsCompleted === leader.lapsCompleted) gap = r.finishMs - leader.finishMs;
      else {
        // B-5: now − the time the leader last passed this car's s (interpolated between its 10 m markers), so cars
        // further back on the leader's lap always get larger gaps; whole laps down add the leader's last lap.
        const sNow = eff - Math.floor(eff / length) * length;
        const lm = leader.markerTimes;
        const m = Math.min(lm.length - 1, Math.floor(sNow / 10));
        const t0 = lm[m]!;
        const t1 = m + 1 < lm.length ? lm[m + 1]! : -1;
        let tLeader = -1;
        if (t0 >= 0 && t1 >= t0) tLeader = t0 + (t1 - t0) * Math.min(1, (sNow - m * 10) / 10);
        else if (t0 >= 0 && leaderEff - eff >= sNow - m * 10) tLeader = t0 + ((sNow - m * 10) / Math.max(10, leaderSpeed)) * 1000;
        if (tLeader >= 0 && tLeader <= race.raceMs) gap = race.raceMs - tLeader + r.lapsDown * Math.max(0, leader.lastLapMs);
        else gap = ((leaderEff - eff) / Math.max(10, car.vehicle.speed)) * 1000;
      }
      // Order is by progress; where the leader has no marker yet (cars behind its grid slot) the distance/speed
      // estimate can undercut the car ahead, so keep the gaps monotone with the order.
      if (gap < prevGap) gap = prevGap;
      r.gapToLeaderMs = gap;
      r.intervalMs = Math.max(0, gap - prevGap);
      prevGap = gap;
    }
    const cfg = world.static.config;
    race.leaderLap = cfg.mode === 'race' ? Math.min(cfg.laps, leader.lapsCompleted + 1) : leader.lapsCompleted + 1;
  };

  return {
    name: 'raceDirector',
    step(w, dt) {
      world = w;
      rules = rulesOn(w);
      // D-056: this tick's car–car contacts (pushed by the CollisionSystem before this system runs), read without draining.
      if (listened !== w) {
        listened = w;
        w.events.listen?.(onEvent);
        colN = 0;
      }
      length = w.static.track.query.length;
      for (let k = 0; k < colN; k++) noteCollision(w, colA[k]!, colB[k]!, colJ[k]!);
      colN = 0;
      length = w.static.track.query.length;
      const st = w.state;
      const race = st.race;
      const cfg = w.static.config;
      const simMs = st.time * 1000;
      const cars = st.cars;

      race.raceMs = simMs;
      if (race.phase === 'grid' || race.phase === 'lights') {
        if (race.phase === 'grid' && simMs >= GRID_HOLD_MS) race.phase = 'lights';
        if (race.phase === 'lights') {
          const lit = Math.min(LIGHTS_COUNT, Math.floor((simMs - GRID_HOLD_MS) / LIGHT_INTERVAL_MS));
          while (race.lightsLit < lit && simMs < race.lightsOutAtMs) {
            race.lightsLit++;
            w.events.push({ type: 'lightsOn', count: race.lightsLit });
          }
        }
        for (let i = 0; i < cars.length; i++) preStart(cars[i]!);
        if (race.phase === 'lights' && simMs >= race.lightsOutAtMs) {
          race.phase = 'running';
          race.lightsLit = 0;
          for (let i = 0; i < cars.length; i++) {
            const r = cars[i]!.race;
            r.lapStartMs = race.lightsOutAtMs;
            r.sectorStartMs = race.lightsOutAtMs;
            r.sector = 0;
          }
          w.events.push({ type: 'lightsOut' });
        }
        if (st.tick % STANDINGS_EVERY === 0) updateStandings(race);
        return;
      }

      for (let i = 0; i < cars.length; i++) processCar(cars[i]!, simMs, race, dt);
      resolveDrsDetection(race);

      if (race.phase === 'running' || race.phase === 'finishing') {
        stepYellowFlags(w, dt);
        if (cfg.mode === 'race') stepCollisionPenalties(w, dt);
      }

      if (cfg.mode === 'race') {
        const leader = cars[race.order[0]!]!.race;
        stepDrsWetness(w, leader.lapsCompleted + 1);
        if (!race.drsEnabled && race.phase === 'running' && rrx(race).drsWetBlock === 0 && leader.lapsCompleted + 1 >= DRS_ENABLE_LEADER_LAP) {
          race.drsEnabled = true;
          w.events.push({ type: 'drsEnabled' });
        }
      }

      if (st.tick % STANDINGS_EVERY === 0 || race.phase === 'finishing') {
        updateStandings(race);
        if (cfg.mode === 'race' && race.phase === 'running' && race.sc.phase === 'none') stepBlueFlags(w, dt * STANDINGS_EVERY);
      }
      if (cfg.mode === 'race') stepSafetyCar(w, dt);

      if (race.phase === 'finishing') {
        race.finishCountdownMs -= dt * 1000;
        let allDone = true;
        for (let i = 0; i < cars.length; i++) {
          const r = cars[i]!.race;
          if (!r.finished && r.status === 'running') allDone = false;
        }
        if (allDone || race.finishCountdownMs <= 0) {
          race.phase = 'finished';
          race.finishCountdownMs = 0;
          updateStandings(race);
        }
      }
    },
  };
}
