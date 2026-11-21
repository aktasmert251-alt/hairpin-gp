// Server lap timing, standings and results (design §6.1, §6.3). Pure: fed with (simMs, progress) samples of validated
// human states and of the server AI cars. A lap counts when progress crosses the next multiple of L *and* the car crossed
// both sector lines of that lap in order (no infield shortcuts). Crossing times are interpolated between the bracketing
// samples. Laps under the track floor (D-042) are rejected. Allocation-free per sample.
import type { CarRaceState } from '../../src/contracts/race';
import type { NetResultRow } from '../../src/contracts/net';
import { POINTS } from '../../src/race/rules';

export type CarStatus = CarRaceState['status'];

/** Result of one sample: nothing, a credited lap, or a line crossing without credit (shortcut / under the floor). */
export const LAP_NONE = 0;
export const LAP_CREDIT = 1;
export const LAP_REJECT = -1;

const MARKER_M = 10;

/** Time at which progress passed `line`, linear between the samples (p0, t0) and (p1, t1), p1 > p0. */
function interp(line: number, p0: number, p1: number, t0: number, t1: number): number {
  return t0 + ((line - p0) / (p1 - p0)) * (t1 - t0);
}

export class CarTiming {
  lapsCompleted = 0;
  status: CarStatus = 'running';
  finishMs = 0;
  /** Order in which cars took the flag (1 = winner); 0 = not finished. */
  finishOrder = 0;
  penaltySec = 0;
  stops = 0;
  bestLapMs = 0;
  lastLapMs = 0;
  /** Why the last crossing was rejected (logs / tests). */
  rejectReason: '' | 'sectors' | 'floor' = '';
  progress = 0;
  simMs = 0;
  private hasSample = false;
  private lapBase = 0;
  private s1 = false;
  private s2 = false;
  private lastCrossMs: number;
  /** Bit per lap (1..99) invalidated by a client `report{lapInvalidated}`. */
  private readonly invalid = new Uint8Array(100);
  readonly markerTimes: Float64Array;

  constructor(
    private readonly L: number,
    private readonly sectors: readonly [number, number],
    private readonly minLapMs: number,
    lightsOutAtMs: number,
  ) {
    this.lastCrossMs = lightsOutAtMs;
    this.markerTimes = new Float64Array(Math.ceil(L / MARKER_M)).fill(-1);
  }

  get running(): boolean {
    return this.status === 'running';
  }

  invalidateLap(lap: number): void {
    if (lap >= 1 && lap < this.invalid.length) this.invalid[lap] = 1;
  }

  isLapValid(lap: number): boolean {
    return lap < 1 || lap >= this.invalid.length || this.invalid[lap] === 0;
  }

  /** One sample; returns LAP_NONE / LAP_CREDIT / LAP_REJECT. On a credit `lapsCompleted` and `lastLapMs` are updated. */
  sample(simMs: number, progress: number): number {
    if (!this.hasSample) {
      this.hasSample = true;
      this.simMs = simMs;
      this.progress = progress;
      return LAP_NONE;
    }
    const p0 = this.progress;
    const t0 = this.simMs;
    this.progress = progress;
    this.simMs = simMs;
    if (progress <= p0) return LAP_NONE;
    this.markers(p0, progress, t0, simMs);
    // Each line must be crossed in its own sample: one sample spanning S1→S2 or S2→finish is a jump, not driving.
    const b = this.lapBase;
    const line = b + this.L;
    const wasS1 = this.s1;
    const wasS2 = this.s2;
    if (!wasS1 && p0 < b + this.sectors[0] && progress >= b + this.sectors[0]) this.s1 = true;
    if (wasS1 && !wasS2 && p0 < b + this.sectors[1] && progress >= b + this.sectors[1]) this.s2 = true;
    if (progress < line) return LAP_NONE;
    this.s2 = wasS2;
    const cross = interp(line, p0, progress, t0, simMs);
    const ms = cross - this.lastCrossMs;
    const ok = this.s1 && this.s2;
    this.lapBase = line;
    this.s1 = false;
    this.s2 = false;
    this.lastCrossMs = cross;
    if (!ok || ms < this.minLapMs) {
      this.rejectReason = ok ? 'floor' : 'sectors';
      return LAP_REJECT;
    }
    this.lapsCompleted++;
    this.lastLapMs = ms;
    if (this.isLapValid(this.lapsCompleted) && (this.bestLapMs === 0 || ms < this.bestLapMs)) this.bestLapMs = ms;
    return LAP_CREDIT;
  }

  /** Time of the last line crossing (the finish time after the final lap). */
  get lastCrossingMs(): number {
    return this.lastCrossMs;
  }

  private markers(p0: number, p1: number, t0: number, t1: number): void {
    const n = this.markerTimes.length;
    const m0 = Math.floor(p0 / MARKER_M) + 1;
    const m1 = Math.min(Math.floor(p1 / MARKER_M), m0 + n - 1);
    for (let m = m0; m <= m1; m++) this.markerTimes[((m % n) + n) % n] = interp(m * MARKER_M, p0, p1, t0, t1);
  }
}

export interface TimedCar { id: number; name: string; teamId: string; timing: CarTiming }

const statusRank = (s: CarStatus): number => (s === 'finished' || s === 'running' ? 0 : s === 'dnf' ? 1 : 2);

/** Race order: classified cars by laps (finished cars by flag order within their lap count), then progress; DNF, then DSQ. */
export function compareCars(a: TimedCar, b: TimedCar): number {
  const ta = a.timing;
  const tb = b.timing;
  const r = statusRank(ta.status) - statusRank(tb.status);
  if (r !== 0) return r;
  if (ta.lapsCompleted !== tb.lapsCompleted) return tb.lapsCompleted - ta.lapsCompleted;
  if (ta.finishOrder > 0 && tb.finishOrder > 0) return ta.finishOrder - tb.finishOrder;
  if (ta.finishOrder > 0 !== tb.finishOrder > 0) return ta.finishOrder > 0 ? -1 : 1;
  return tb.progress - ta.progress;
}

/** Gap to the leader from the 10 m marker times (both cars passed the follower's latest marker). */
export function gapToLeaderMs(leader: CarTiming, car: CarTiming): number {
  if (leader === car) return 0;
  const n = car.markerTimes.length;
  const m = Math.floor(car.progress / MARKER_M);
  const i = ((m % n) + n) % n;
  const tl = leader.markerTimes[i]!;
  const tc = car.markerTimes[i]!;
  if (tl < 0 || tc < 0) return 0;
  return Math.max(0, Math.round(tc - tl));
}

/** Classification for `results` (design §6.3). Race time = finish crossing − lights out + penalties. */
export function buildResults(cars: readonly TimedCar[], lightsOutAtMs: number): NetResultRow[] {
  const sorted = [...cars].sort(compareCarsForResults(lightsOutAtMs));
  const winner = sorted[0];
  const winnerLaps = winner?.timing.lapsCompleted ?? 0;
  const winnerTotal = winner && winner.timing.status === 'finished' ? totalMs(winner.timing, lightsOutAtMs) : 0;
  return sorted.map((c, i) => {
    const t = c.timing;
    const finished = t.status === 'finished';
    const total = finished ? totalMs(t, lightsOutAtMs) : 0;
    const lapsDown = Math.max(0, winnerLaps - t.lapsCompleted);
    return {
      pos: i + 1,
      id: c.id,
      name: c.name,
      teamId: c.teamId,
      totalMs: Math.round(total),
      gapMs: finished && lapsDown === 0 && i > 0 ? Math.max(0, Math.round(total - winnerTotal)) : 0,
      lapsDown,
      bestLapMs: Math.round(t.bestLapMs),
      stops: t.stops,
      penaltySec: t.penaltySec,
      points: finished ? (POINTS[i] ?? 0) : 0,
      status: t.status,
    };
  });
}

function totalMs(t: CarTiming, lightsOutAtMs: number): number {
  return t.finishMs - lightsOutAtMs + t.penaltySec * 1000;
}

function compareCarsForResults(lightsOutAtMs: number): (a: TimedCar, b: TimedCar) => number {
  return (a, b) => {
    const ta = a.timing;
    const tb = b.timing;
    const r = statusRank(ta.status) - statusRank(tb.status);
    if (r !== 0) return r;
    if (ta.lapsCompleted !== tb.lapsCompleted) return tb.lapsCompleted - ta.lapsCompleted;
    const fa = ta.status === 'finished';
    const fb = tb.status === 'finished';
    // Penalties re-order finishers on the same lap count (offline rules: time penalties are added to the race time).
    if (fa && fb) return totalMs(ta, lightsOutAtMs) - totalMs(tb, lightsOutAtMs);
    if (fa !== fb) return fa ? -1 : 1;
    return tb.progress - ta.progress;
  };
}
