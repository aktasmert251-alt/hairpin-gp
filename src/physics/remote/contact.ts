// Online car-to-car contact helpers (docs/design/multiplayer.md §6.2, P3c; DECISIONS D-043). Pure, allocation-free, sim layer.
//
// Sign convention (CR-NET-8): a `collision` event from a local–remote pair has a = the local car, b = the remote car and
// (nx, nz) = unit normal from a to b. The local car already received −j·n; the remote car's owner applies +j·n to its own
// car with `applyContactImpulse` when the relayed `contact` arrives (n from the sender to the receiver).

import type { VehicleParams, VehicleState } from '../../contracts/vehicle';

/** Server and receiving-client clamp on one contact impulse, N·s (design §6.2 anti-abuse). */
export const CONTACT_J_MAX = 15_000;
/** A contact episode: one pair, 200 ms from its first impulse. */
export const CONTACT_EPISODE_MS = 200;
/** A remote sample older than this gives no contact at all. */
export const CONTACT_STALE_MS = 400;

/**
 * Latency softening factor for a local–remote pair: 1 up to 120 ms RTT, linear to 0.3 at 250 ms, 0.3 beyond;
 * 0 when the puppet's newest sample is older than 400 ms (stale) or the inputs are not numbers.
 */
export function contactScale(rttMs: number, sampleAgeMs = 0): number {
  if (!(sampleAgeMs <= CONTACT_STALE_MS) || !(rttMs === rttMs)) return 0;
  if (rttMs <= 120) return 1;
  if (rttMs >= 250) return 0.3;
  return 1 - (0.7 * (rttMs - 120)) / 130;
}

/** Overlap ignored for a local–remote pair (m): 0.05 at full contact, growing to 0.4 at scale 0.3 (extrapolation error). */
export function contactTolerance(scale: number): number {
  const t = 0.05 + (0.35 * (1 - scale)) / 0.7;
  return t > 0.4 ? 0.4 : t;
}

/**
 * CR-NET-8 glue writer: applies a relayed contact impulse +j·n at world point (px, pz) to the local car, before the next
 * tick: the same response as the local car's half of a car–car hit (velocity + yaw kick, carImpulse). Untrusted input is
 * guarded: j clamped to [0, 15 kN·s], n renormalised, the lever arm limited to the car's half length.
 */
export function applyContactImpulse(v: VehicleState, p: VehicleParams, j: number, nx: number, nz: number, px: number, pz: number): void {
  if (!(j > 0)) return;
  if (j > CONTACT_J_MAX) j = CONTACT_J_MAX;
  const len = Math.sqrt(nx * nx + nz * nz);
  if (!(len > 0.5 && len < 1.5)) return;
  nx /= len;
  nz /= len;
  const m = v.massKg;
  const izz = p.yawInertiaPerKg * m;
  let rn = 0;
  if (px === px && pz === pz) {
    rn = (pz - v.z) * nx - (px - v.x) * nz;
    const lim = 0.5 * p.bodyLength;
    rn = rn > lim ? lim : rn < -lim ? -lim : rn;
  }
  v.vx += (j * nx) / m;
  v.vz += (j * nz) / m;
  v.yawRate += (j * rn) / izz;
  v.speed = Math.sqrt(v.vx * v.vx + v.vz * v.vz);
  v.carImpulse += j;
}

/**
 * Contact episodes per (local car, other car) pair, shared by the CollisionSystem (local detections) and the glue (relayed
 * contacts) so both paths dedup against one memory. Plain data, allocated once; not sim state (online only, no flashback).
 */
export interface ContactEpisodes {
  n: number;
  untilMs: Float64Array;
  applied: Float64Array;
  /** Local impulse the puppet's samples do not show yet (decays with the response delay), N·s, and its time stamp. */
  credit: Float64Array;
  creditMs: Float64Array;
}

export function createContactEpisodes(maxCars = 20): ContactEpisodes {
  const n2 = maxCars * maxCars;
  return {
    n: maxCars, untilMs: new Float64Array(n2).fill(-Infinity), applied: new Float64Array(n2), credit: new Float64Array(n2), creditMs: new Float64Array(n2),
  };
}

/**
 * The part of this pair's recent local impulses that the remote owner has applied to its car but the puppet does not show
 * yet: decays as exp(−Δt / delayMs) (delayMs ≈ one-way latency + relay tick). The CollisionSystem adds it to the puppet's
 * velocity so the local car does not absorb the whole closing speed against a stale puppet.
 */
export function contactCredit(ep: ContactEpisodes, local: number, other: number, nowMs: number, delayMs: number): number {
  if (local < 0 || other < 0 || local >= ep.n || other >= ep.n) return 0;
  const k = local * ep.n + other;
  const c = ep.credit[k]!;
  if (c === 0) return 0;
  const dt = nowMs - ep.creditMs[k]!;
  const out = dt <= 0 ? c : delayMs > 0 ? c * Math.exp(-dt / delayMs) : 0;
  ep.credit[k] = out < 1 ? 0 : out;
  ep.creditMs[k] = nowMs;
  return ep.credit[k]!;
}

/**
 * Relayed contact (design §6.2 step 4): `j` is the sender's episode total. Applies at most what this episode has not applied
 * yet (local detections and earlier relays), so a hit is never applied twice in full; opens an episode when none is open.
 * Returns the impulse to apply now with `applyContactImpulse` (0 = duplicate); `j` is clamped to 15 kN·s.
 * `nowMs` = the local race clock (`state.race.raceMs`), the clock the CollisionSystem uses.
 */
export function contactTopUp(ep: ContactEpisodes, local: number, other: number, j: number, nowMs: number): number {
  if (!(j > 0) || local < 0 || other < 0 || local >= ep.n || other >= ep.n) return 0;
  if (j > CONTACT_J_MAX) j = CONTACT_J_MAX;
  const k = local * ep.n + other;
  if (!(nowMs < ep.untilMs[k]!)) {
    ep.untilMs[k] = nowMs + CONTACT_EPISODE_MS;
    ep.applied[k] = j;
    return j;
  }
  const add = j - ep.applied[k]!;
  if (add <= 0) return 0;
  ep.applied[k] = j;
  return add;
}

/** Local detection (CollisionSystem): adds `j` to the pair's episode, opening one when none is open. */
export function contactAccumulate(ep: ContactEpisodes, local: number, other: number, j: number, nowMs: number): void {
  if (local < 0 || other < 0 || local >= ep.n || other >= ep.n) return;
  const k = local * ep.n + other;
  if (!(nowMs < ep.untilMs[k]!)) {
    ep.untilMs[k] = nowMs + CONTACT_EPISODE_MS;
    ep.applied[k] = j;
  } else ep.applied[k]! += j;
  ep.credit[k]! += j;
  ep.creditMs[k] = nowMs;
}

/** The impulse already applied in the current episode of the pair (0 when none is open). */
export function contactApplied(ep: ContactEpisodes, local: number, other: number, nowMs: number): number {
  if (local < 0 || other < 0 || local >= ep.n || other >= ep.n) return CONTACT_J_MAX;
  const k = local * ep.n + other;
  return nowMs < ep.untilMs[k]! ? ep.applied[k]! : 0;
}
