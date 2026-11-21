// Per-car `state` validation (design §7.2, thresholds = NET_LIMITS). Pure and allocation-free per call: one validator per
// human car holds its last accepted sample, a persistent TrackHint and a scratch GroundHit. Strike / hard / DSQ bookkeeping
// lives in the room (it needs the clock and the room's broadcast).
import type { NetCarState } from '../../src/contracts/net';
import type { GroundHit, TrackHint, TrackQuery } from '../../src/contracts/track';
import { NET_FLAG_PIT_RIBBON, NET_FLAG_RESET, NET_LIMITS, seqNewer } from '../../src/net/protocol';

/** ok = relay; drop = ignore silently (old / duplicate); strike = ignore + strike; hard = ignore + hard violation. */
export type Verdict = 'ok' | 'drop' | 'strike' | 'hard';

export type RejectReason =
  | '' | 'seq' | 'order' | 'ahead' | 'speed' | 'speedHard' | 'teleport' | 'displacement' | 'reset' | 'progress' | 'trackS' | 'offTrack';

export class StateValidator {
  hasLast = false;
  lastSeq = 0;
  lastSimMs = 0;
  lastX = 0;
  lastZ = 0;
  lastProgress = 0;
  /** simMs older than the race clock − simLagMs: accepted, but the car counts as lagging (no contacts). */
  lagging = false;
  /** Reason of the last non-ok verdict (logs, tests). */
  reason: RejectReason = '';
  /** After a resume the first state skips the displacement check (the car may have moved while offline). */
  private fresh = false;
  private readonly hint: TrackHint;
  private readonly hit: GroundHit = {
    y: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt', ribbon: 'main', s: 0, d: 0, sp: 0, inLimits: true, wetLocal: 1,
  };

  constructor(
    private readonly q: TrackQuery,
    startS: number,
  ) {
    this.hint = { s: startS, ribbon: 'main', sp: 0 };
  }

  resume(): void {
    this.fresh = true;
  }

  /** Checks `s` against the last accepted state and the track; on 'ok' the caller relays it and calls accept(). */
  check(s: NetCarState, raceMs: number): Verdict {
    const L = NET_LIMITS;
    if (this.hasLast && !seqNewer(s.seq, this.lastSeq)) return this.no('drop', 'seq');
    if (s.simMs > raceMs + L.simAheadMs) return this.no('strike', 'ahead');
    if (this.hasLast && s.simMs <= this.lastSimMs) return this.no('drop', 'order');
    const speed = Math.hypot(s.vx, s.vz);
    if (speed > L.hardSpeedMs) return this.no('hard', 'speedHard');
    if (speed > L.maxSpeedMs) return this.no('strike', 'speed');

    const q = this.q;
    const reset = (s.flags & NET_FLAG_RESET) !== 0;
    if (this.hasLast) {
      const dt = (s.simMs - this.lastSimMs) / 1000;
      const allowed = L.maxSpeedMs * dt + L.displacementSlackM;
      const dist = Math.hypot(s.x - this.lastX, s.z - this.lastZ);
      const dProg = s.progress - this.lastProgress;
      if (reset) {
        if (dProg > L.resetProgressM) return this.no('strike', 'reset');
      } else {
        if (!this.fresh && dist > allowed) return dist > L.teleportM ? this.no('hard', 'teleport') : this.no('strike', 'displacement');
        if (dProg > allowed) return this.no('strike', 'progress');
      }
    }

    // Track position: project near the claimed progress, so a faked progress also fails here.
    const sClaim = q.wrapS(s.progress);
    if (this.hint.ribbon === 'main') this.hint.s = sClaim;
    const g = q.ground(s.x, s.z, this.hint, this.hit);
    if (Math.abs(q.deltaS(g.s, sClaim)) > L.trackDeltaSM) return this.no('strike', 'trackS');
    if (g.ribbon === 'main') {
      const i = Math.min(q.data.count - 1, Math.max(0, Math.floor(g.s)));
      const d = g.d;
      if (reset) {
        const half = d >= 0 ? q.data.halfWidthL[i]! : q.data.halfWidthR[i]!;
        if (Math.abs(d) > half) return this.no('strike', 'reset');
      }
      const wall = d >= 0 ? q.data.wallL[i]! : q.data.wallR[i]!;
      if (Math.abs(d) > wall + L.escapeM && !((s.flags & NET_FLAG_PIT_RIBBON) !== 0 && this.nearPitLane(s.x, s.z))) {
        return this.no('strike', 'offTrack');
      }
    }
    this.reason = '';
    return 'ok';
  }

  accept(s: NetCarState, raceMs: number): void {
    this.hasLast = true;
    this.fresh = false;
    this.lastSeq = s.seq;
    this.lastSimMs = s.simMs;
    this.lastX = s.x;
    this.lastZ = s.z;
    this.lastProgress = s.progress;
    this.lagging = s.simMs < raceMs - NET_LIMITS.simLagMs;
  }

  private no(v: Verdict, r: RejectReason): Verdict {
    this.reason = r;
    return v;
  }

  /** Fallback for the pit ribbon (the hint did not switch through the entry gate): near the pit-lane centreline. Rare path. */
  private nearPitLane(x: number, z: number): boolean {
    const p = this.q.data.pit;
    let best = Infinity;
    let bi = -1;
    for (let i = 0; i < p.count; i++) {
      const dx = p.x[i]! - x;
      const dz = p.z[i]! - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        bi = i;
      }
    }
    return bi >= 0 && Math.sqrt(best) <= p.halfWidth[bi]! + NET_LIMITS.escapeM;
  }
}

/** Sliding count of events in a time window (strikes, bad messages, contact rejects). Fixed capacity, no allocation. */
export class WindowCounter {
  private readonly t: Float64Array;
  private head = 0;
  private n = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    this.t = new Float64Array(Math.max(1, limit));
  }

  /** Records one event; true when `limit` events fell within the window (the counter then resets). */
  hit(nowMs: number): boolean {
    this.t[this.head] = nowMs;
    this.head = (this.head + 1) % this.t.length;
    if (this.n < this.t.length) this.n++;
    if (this.n < this.limit) return false;
    const oldest = this.t[this.head % this.t.length]!; // with n === capacity, head points at the oldest
    if (nowMs - oldest <= this.windowMs) {
      this.n = 0;
      return true;
    }
    return false;
  }

  reset(): void {
    this.n = 0;
  }
}
