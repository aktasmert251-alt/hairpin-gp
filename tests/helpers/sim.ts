// Helpers for headless sim tests (tests/sim, tests/integration). Always build worlds through `createSim` (ARCHITECTURE §2: canonical
// world factory for the game AND tests) so tests exercise exactly what the game runs.

import type { SessionConfig } from '../../src/contracts/race';
import { SIM_HZ, type CreateSimOptions, type SimEvent, type SimRunner } from '../../src/contracts/sim';
import { createSim, defaultSessionConfig } from '../../src/game/createSim';
import { findNonFinite, hashState } from '../../src/game/sim/stateUtils';

export { findNonFinite, hashState };

/** Explicit seeds, printed in every failure message (testing-qc.md §1: tests never use Math.random). */
export const SEEDS = { field: 1234, snapshot: 2345, other: 4321, tt: 777 } as const;

export interface MakeSimOptions extends CreateSimOptions {
  /** Merged over `defaultSessionConfig`. */
  cfg?: Partial<SessionConfig>;
}

/** 20-car field by default (player + 19 AI, autodrive so the player is driven by the AI). */
export function makeSim(opts: MakeSimOptions = {}): SimRunner {
  const { cfg, ...simOpts } = opts;
  return createSim(defaultSessionConfig({ aiCount: 19, autodrive: true, seed: SEEDS.field, laps: 50, ...cfg }), simOpts);
}

/** FNV-1a (32 bit) accumulator over the JSON of every drained sim event: the "event digest" of a run. */
export class EventDigest {
  private h = 0x811c9dc5;
  count = 0;
  readonly types = new Map<string, number>();

  add(e: SimEvent): void {
    const s = JSON.stringify(e);
    for (let i = 0; i < s.length; i++) this.h = Math.imul(this.h ^ s.charCodeAt(i), 16777619);
    this.count++;
    this.types.set(e.type, (this.types.get(e.type) ?? 0) + 1);
  }

  get value(): string {
    return (this.h >>> 0).toString(16).padStart(8, '0');
  }
}

/** Steps `ticks` sim ticks, draining events every tick (the queue is fixed-size) into `digest` when given. */
export function stepTicks(sim: SimRunner, ticks: number, digest?: EventDigest): void {
  const sink = digest ? (e: SimEvent): void => digest.add(e) : (): void => {};
  for (let i = 0; i < ticks; i++) {
    sim.step();
    sim.world.events.drain(sink);
  }
}

export function stepSeconds(sim: SimRunner, seconds: number, digest?: EventDigest): void {
  stepTicks(sim, Math.round(seconds * SIM_HZ), digest);
}

/** Throws with the path of the first NaN/Infinity in the sim state, plus the seed to reproduce. */
export function assertFinite(sim: SimRunner, what: string): void {
  const bad = findNonFinite(sim.world.state);
  if (bad) throw new Error(`non-finite value at ${bad} (${what}; seed ${sim.world.static.config.seed}, tick ${sim.world.state.tick})`);
}

/** Recursively freezes plain data (objects and arrays; typed arrays are skipped because their elements cannot be frozen). */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value) || ArrayBuffer.isView(value)) return value;
  for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  return Object.freeze(value);
}
