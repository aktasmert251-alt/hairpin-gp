// Lead-Net: puppet quality under a modelled network (no sockets, deterministic). A real autodrive lap is the truth; its 20 Hz
// states go through the production path's timing: client → server delay (+ jitter, FIFO like TCP), the server's 20 Hz relay
// tick (only the newest state per tick), loss of relayed batches, server → client delay (+ jitter, FIFO). The receiver pushes
// what has arrived before each tick and samples the pose of that tick, as onlineSession.beforeTick does. Measured against the
// truth at the same tick: position error, per-tick motion error (rms = jitter, > 0.25 m = a visible snap) and stale time.
import { describe, expect, it } from 'vitest';
import type { NetCarState } from '../../contracts/net';
import { SIM_DT } from '../../contracts/sim';
import type { RaceTrackId as TrackId } from '../../contracts/track';
import { createRng } from '../../core/rng';
import { newNetCarState } from '../../net/index';
import { createSim, defaultSessionConfig } from '../createSim';
import { createPuppetBuffer, newPuppetPose } from '../net/puppet';

interface Truth { x: Float64Array; z: Float64Array; states: NetCarState[] }

const truthCache = new Map<string, Truth>();
function truth(trackId: TrackId, seconds: number): Truth {
  const key = `${trackId}:${seconds}`;
  const hit = truthCache.get(key);
  if (hit) return hit;
  const sim = createSim(defaultSessionConfig({ mode: 'race', trackId, aiCount: 0, autodrive: true, laps: 3, seed: 7 }), { skipLights: true });
  const n = Math.round(seconds / SIM_DT);
  const x = new Float64Array(n + 1);
  const z = new Float64Array(n + 1);
  const states: NetCarState[] = [];
  const L = sim.world.static.track.query.length;
  for (let T = 1; T <= n; T++) {
    sim.step();
    const c = sim.world.state.cars[0]!;
    const v = c.vehicle;
    x[T] = v.x;
    z[T] = v.z;
    if (T % 12 === 0) {
      // As onlineSession.sendOwnState (20 Hz on the race clock).
      const s = newNetCarState();
      s.simMs = Math.round(sim.world.state.time * 1000);
      s.x = v.x; s.y = v.y; s.z = v.z; s.yaw = v.yaw; s.vx = v.vx; s.vz = v.vz; s.yawRate = v.yawRate;
      s.progress = v.lapWraps * L + v.s; s.gear = v.gear; s.rpm = v.rpm;
      states.push(s);
    }
  }
  const t = { x, z, states };
  truthCache.set(key, t);
  return t;
}

interface NetModel { delayMs: number; jitterMs: number; lossPct: number; seed: number }

/** Arrival time (ms, race clock) of every state at the receiver; NaN = never (loss / superseded on the server). */
function arrivals(states: readonly NetCarState[], m: NetModel): number[] {
  const rng = createRng(m.seed);
  let lastUp = 0;
  const atServer = states.map((s) => (lastUp = Math.max(lastUp, s.simMs + m.delayMs + rng.next() * m.jitterMs)));
  const out = states.map(() => Number.NaN);
  const phase = rng.next() * 50;
  let lastDown = 0;
  let k = 0;
  for (let tick = phase; k < states.length; tick += 50) {
    let newest = -1;
    while (k < states.length && atServer[k]! <= tick) newest = k++;
    if (newest < 0) continue;
    if (rng.next() * 100 < m.lossPct) continue;
    out[newest] = lastDown = Math.max(lastDown, tick + m.delayMs + rng.next() * m.jitterMs);
  }
  return out;
}

function measure(tr: Truth, m: NetModel) {
  const arr = arrivals(tr.states, m);
  const order = tr.states.map((_, i) => i).filter((i) => arr[i] === arr[i]).sort((a, b) => arr[a]! - arr[b]!);
  const b = createPuppetBuffer();
  const pose = newPuppetPose();
  const pos: number[] = [];
  let next = 0;
  let px = Number.NaN;
  let pz = Number.NaN;
  let stepSq = 0;
  let steps = 0;
  let snaps = 0;
  let stale = 0;
  let live = 0;
  const n = tr.x.length - 1;
  for (let T = 1; T <= n; T++) {
    const nowMs = (T - 1) * SIM_DT * 1000; // state.time at beforeTick
    while (next < order.length && arr[order[next]!]! <= nowMs) b.push(tr.states[order[next++]!]!, nowMs / 1000);
    const st = b.sample(T * SIM_DT, pose);
    if (st === 'none') continue;
    if (b.takeSnap()) px = Number.NaN;
    if (T * SIM_DT < 3) continue; // the standing start
    if (st === 'stale') stale++;
    else live++;
    pos.push(Math.hypot(pose.x - tr.x[T]!, pose.z - tr.z[T]!));
    if (px === px) {
      const e = Math.hypot(pose.x - px - (tr.x[T]! - tr.x[T - 1]!), pose.z - pz - (tr.z[T]! - tr.z[T - 1]!));
      stepSq += e * e;
      steps++;
      if (e > 0.25) snaps++;
    }
    px = pose.x;
    pz = pose.z;
  }
  pos.sort((a, c) => a - c);
  const q = (p: number): number => pos[Math.min(pos.length - 1, Math.floor(p * pos.length))]!;
  return {
    p50: q(0.5), p95: q(0.95), max: q(1), stepRmsMm: Math.sqrt(stepSq / Math.max(1, steps)) * 1000,
    snapsPerMin: snaps / (steps / 240 / 60), staleFrac: stale / Math.max(1, stale + live),
  };
}

// Bounds (Lead-Net 2026-10-26). Before the fix (250 ms horizon, linear blend, constant-speed arc) the same cases measured
// p95 0.17 / 0.94 / 1.13 / 14.5 m and 0 / 33 / 86 / 710 snaps per minute (alpine: stale 94 % of the time).
const CASES: (NetModel & { track: TrackId; p95: number; snaps: number })[] = [
  { track: 'bosphorus', delayMs: 5, jitterMs: 2, lossPct: 0, seed: 1, p95: 0.1, snaps: 0 },
  { track: 'bosphorus', delayMs: 50, jitterMs: 20, lossPct: 2, seed: 2, p95: 0.4, snaps: 1 },
  { track: 'cliff', delayMs: 60, jitterMs: 30, lossPct: 2, seed: 3, p95: 0.5, snaps: 1 },
  { track: 'alpine', delayMs: 100, jitterMs: 40, lossPct: 2, seed: 4, p95: 1.0, snaps: 2 },
];

describe('puppet quality under a modelled network', () => {
  it.each(CASES)('$track d$delayMs j$jitterMs l$lossPct', (c) => {
    const r = measure(truth(c.track, 45), c);
    console.log(JSON.stringify({ case: `${c.track} d${c.delayMs} j${c.jitterMs} l${c.lossPct}`, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v * 1000) / 1000])) }));
    expect(r.p95).toBeLessThan(c.p95);
    expect(r.snapsPerMin).toBeLessThanOrEqual(c.snaps);
    expect(r.staleFrac).toBeLessThan(0.02);
  });
});
