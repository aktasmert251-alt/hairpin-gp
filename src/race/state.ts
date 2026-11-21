// Initial race / pit state builders used by createSim (sim layer).

import type { Compound } from '../contracts/common';
import type { CarPitState, CarRaceState, RaceState, SessionConfig } from '../contracts/race';
import { nextRandom, seedStream } from '../core/rng';
import { newCarRaceExtra, newRaceExtra, type CarRaceStateX, type RaceStateX } from './extra';
import { FINISH_WINDOW_MS, GRID_HOLD_MS, LIGHTS_COUNT, LIGHTS_HOLD_MAX_MS, LIGHTS_HOLD_MIN_MS, LIGHT_INTERVAL_MS } from './rules';

export { FINISH_WINDOW_MS, GRID_HOLD_MS, LIGHTS_HOLD_MAX_MS, LIGHTS_HOLD_MIN_MS, LIGHT_INTERVAL_MS };

export function markerCountFor(trackLength: number): number {
  return Math.max(1, Math.ceil(trackLength / 10));
}

/** `cutZones` / `drsZones` size the director's per-car extra state (TrackData.cutZones / drsZones lengths). */
export function initCarRaceState(markerCount: number, compound: Compound, cutZones = 0, drsZones = 0): CarRaceState {
  const r: CarRaceStateX = {
    lapsCompleted: 0,
    sector: 0,
    position: 0,
    progress: 0,
    lapStartMs: -1,
    sectorStartMs: -1,
    curSectors: [0, 0, 0],
    lastLapMs: 0,
    bestLapMs: 0,
    bestSectors: [0, 0, 0],
    sectorStatus: ['none', 'none', 'none'],
    lapValid: true,
    trackLimitCount: 0,
    penaltySec: 0,
    penaltyToServeSec: 0,
    gapToLeaderMs: 0,
    intervalMs: 0,
    lapsDown: 0,
    drsEligible: false,
    drsZone: -1,
    finished: false,
    finishMs: 0,
    status: 'running',
    compoundsUsedMask: compoundBit(compound),
    pitStops: 0,
    speedTrapKmh: 0,
    markerTimes: new Float32Array(markerCount).fill(-1),
    scTargetSpeed: -1,
    collisionWarnings: 0,
    rx: newCarRaceExtra(cutZones, drsZones),
  };
  return r;
}

export function compoundBit(c: Compound): number {
  switch (c) {
    case 'soft': return 1;
    case 'medium': return 2;
    case 'hard': return 4;
    case 'inter': return 8;
    case 'wet': return 16;
  }
}

export function initCarPitState(compound: Compound): CarPitState {
  return { phase: 'none', requested: false, nextCompound: compound, boxSp: 0, timer: 0, serviceS: 0, speeding: false };
}

/**
 * `lightsHoldMs` comes from the seeded race RNG; with skipLights the race starts in `running` at t = 0.
 * Rules §2: grid 2.0 s, lights 1…5 at 1.0…5.0 s into the lights phase, then the hold. `lightsOutAtMs` is on the sim
 * clock; the race clock (`raceMs`) is 0 until lights out and counts from there.
 */
export function initRaceState(cfg: SessionConfig, carCount: number, lightsHoldMs: number, skipLights: boolean): RaceState {
  const running = skipLights || cfg.mode === 'timeTrial';
  const r: RaceStateX = {
    phase: running ? 'running' : 'grid',
    lightsLit: 0,
    lightsOutAtMs: running ? 0 : lightsOutAtMsFromHold(lightsHoldMs),
    raceMs: 0,
    leaderLap: 1,
    drsEnabled: cfg.mode === 'timeTrial',
    fastest: { car: -1, ms: 0 },
    sessionBestSectors: [0, 0, 0],
    yellow: [false, false, false],
    order: Array.from({ length: carCount }, (_, i) => i),
    flashbacksLeft: cfg.flashbacks,
    finishCountdownMs: 0,
    sc: { phase: 'none', sinceMs: -1, progress: 0, speed: 0, onTrack: false, laps: 0, count: 0 },
    rx: newRaceExtra(),
  };
  return r;
}

/** Seeded lights hold in ms for a uniform draw u ∈ [0, 1). */
export function lightsHoldFor(u: number): number {
  return LIGHTS_HOLD_MIN_MS + (LIGHTS_HOLD_MAX_MS - LIGHTS_HOLD_MIN_MS) * u;
}

function lightsOutAtMsFromHold(lightsHoldMs: number): number {
  return GRID_HOLD_MS + LIGHTS_COUNT * LIGHT_INTERVAL_MS + lightsHoldMs;
}

/** Race-RNG stream seed of a session (createSim's `rng.race`). */
export function raceRngSeed(seed: number): number {
  return seedStream(seed, 1);
}

/**
 * CR-NET-6: sim time (ms) of lights out in a standing-start race with this seed. Pure; equals what createSim produces (its first
 * race-RNG draw is the lights hold), so the server's jump-start check uses the client's exact number.
 */
export function lightsOutAtMsFor(seed: number): number {
  const h = { race: raceRngSeed(seed) };
  return lightsOutAtMsFromHold(lightsHoldFor(nextRandom(h, 'race')));
}
