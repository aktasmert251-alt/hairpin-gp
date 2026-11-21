// RaceDirector / PitProcedure private per-car and race-wide state (sim layer, plain data).
//
// Like the physics `aux` (CR-13), these are extra plain-data fields on the contract objects, created by the state
// builders (createSim) so they live in SimState: snapshots, flashback and hashing include them. They are written only
// by the race systems (RaceDirector, PitProcedure) and the race glue writers (retire). Planned contract promotion: L12.

import type { CarRaceState, RaceState } from '../contracts/race';

export interface CarRaceExtra {
  // §2 jump start
  /** Progress at the grid slot (set on the first director tick, gridSet = 1). */
  gridProg: number;
  gridSet: number;
  jumped: number;
  // §3 track limits
  /** Continuous time with all four wheels out (s). */
  exT: number;
  /** Speed integral over the excursion (m). */
  exDist: number;
  /** 1 while a registered excursion (≥ 0.10 s) is in progress. */
  exActive: number;
  /** 1 when a new excursion can count (re-armed). */
  armed: number;
  rearmT: number;
  /** Post-reset exemption left (s) and the reset counter it was armed for. */
  recoverT: number;
  resetSeen: number;
  /** TT: the next lap starts invalid (excursion in the last 150 m). */
  nextLapInvalid: number;
  // §4 cut zones (one entry per TrackData.cutZones)
  /** 1 when the car cut a gate of that zone on the current pass. */
  zoneCut: number[];
  /** Best valid zone time this session (ms, 0 = none). */
  zoneBest: number[];
  // §6 flags
  slowT: number;
  blueT: number;
  blueOn: number;
  /** DRS detection: last crossing time (race clock, ms) of each zone's detection line (-1e9 = never). */
  detectMs: number[];
  /** Zone id whose detection line was crossed this tick (-1 = none) and when. */
  pendingZone: number;
  pendingMs: number;
  // §7 pit speeding
  speedT: number;
  // PitProcedure (pit-weather §2)
  /** Control before pitAuto took over: 0 = not taken, 1 = player, 2 = ai. */
  pitCtrl: number;
  /** Penalty seconds held in the box this visit, and seconds added during this visit (served next stop). */
  pitHoldS: number;
  pitVisitPen: number;
  /** Safe-release hold time (s). */
  pitRelT: number;
  /** Reset counter observed by the pit procedure (independent of track-limit recovery). */
  pitResetSeen: number;
  // §8 / §9
  /** Two-compound penalty (s), never served. */
  twoCompoundSec: number;
  /** Race clock (ms) at retirement (-1 = running). */
  retireMs: number;
  // D-040 wrong way (wrongWay.ts)
  /** Continuous time going the wrong way (s), time with a correct heading while the warning is on (s), 1 = warning on. */
  wwT: number;
  wwOkT: number;
  wwOn: number;
  // D-056 collision penalties (collisionPenalty.ts)
  /** Last contact partner and its race clock (ms), for the per-pair cooldown. */
  colOther: number;
  colMs: number;
  /** Pending incident where this car is at fault: time left to judge (s), victim, kind (1 rear-end, 2 divebomb, 3 push), heavy flag. */
  incT: number;
  incVictim: number;
  incKind: number;
  incHeavy: number;
  // D-056 safety car (safetyCar.ts)
  /** 1 = this stopped / retired car no longer counts for yellows and the SC (cleared by marshals). */
  scCleared: number;
  /** Cooldown left after an SC overtaking penalty (s). */
  scPenT: number;
  /** Race progress at the latest SC deployment (cars already alongside then may complete the pass, noteScPass); -1e9 = none. */
  scDeployProg: number;
}

export interface RaceExtra {
  /** Seconds left before each sector's yellow clears (cause gone). */
  yellowT: [number, number, number];
  /** Seconds of green marshal panels left per sector. */
  greenT: [number, number, number];
  /** 1 while DRS is blocked by wetness. */
  drsWetBlock: number;
  /** Leader lap at which DRS re-enables after drying (-1 = none). */
  drsReenableLap: number;
  /** Highest wetness seen this race (two-compound lift). */
  wetMax: number;
  /** D-056: the leader's lapsCompleted at the previous SC step (line crossings count SC laps). */
  scLeaderLaps: number;
}

export type CarRaceStateX = CarRaceState & { rx: CarRaceExtra };
export type RaceStateX = RaceState & { rx: RaceExtra };

export function newCarRaceExtra(cutZones: number, drsZones: number): CarRaceExtra {
  return {
    gridProg: 0, gridSet: 0, jumped: 0,
    exT: 0, exDist: 0, exActive: 0, armed: 1, rearmT: 0, recoverT: 0, resetSeen: 0, nextLapInvalid: 0,
    zoneCut: new Array<number>(cutZones).fill(0), zoneBest: new Array<number>(cutZones).fill(0),
    slowT: 0, blueT: 0, blueOn: 0,
    detectMs: new Array<number>(Math.max(1, drsZones)).fill(-1e9), pendingZone: -1, pendingMs: 0,
    speedT: 0, pitCtrl: 0, pitHoldS: 0, pitVisitPen: 0, pitRelT: 0, pitResetSeen: 0, twoCompoundSec: 0, retireMs: -1,
    wwT: 0, wwOkT: 0, wwOn: 0,
    colOther: -1, colMs: -1e9, incT: 0, incVictim: -1, incKind: 0, incHeavy: 0, scCleared: 0, scPenT: 0, scDeployProg: -1e9,
  };
}

export function newRaceExtra(): RaceExtra {
  return { yellowT: [0, 0, 0], greenT: [0, 0, 0], drsWetBlock: 0, drsReenableLap: -1, wetMax: 0, scLeaderLaps: 0 };
}

/** The extra state of a car (attached once if a foreign builder created the object). */
export function crx(r: CarRaceState): CarRaceExtra {
  const x = r as CarRaceStateX;
  return x.rx ?? (x.rx = newCarRaceExtra(0, 0));
}

export function rrx(r: RaceState): RaceExtra {
  const x = r as RaceStateX;
  return x.rx ?? (x.rx = newRaceExtra());
}
