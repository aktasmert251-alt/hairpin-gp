// Contact validation and clamp (design §6.2 anti-abuse). Pure: the room supplies the server's own copies of both cars
// (newest validated sample of a human, the live sim pose of a server AI car), extrapolated here to the contact's simMs.
import type { NetContact } from '../../src/contracts/net';
import { NET_LIMITS } from '../../src/net/protocol';

/** Restitution of car pairs (offline CAR_E). */
export const CONTACT_E = 0.15;
/** Reference mass for the plausibility bound (design: Δv ≤ 19 m/s at 800 kg). */
export const CONTACT_MASS_KG = 800;
/** Max centre distance of two touching cars: 2 × the half-diagonal of a 5.6 m × 2.0 m footprint. */
export const CONTACT_REACH_M = 2 * Math.hypot(2.8, 1.0);
export const CONTACT_SLACK_M = 0.3;
export const CONTACT_CLOSING_S = 0.15;
export const CONTACT_J_SLACK = 500;
/** Contacts are refused before lights out + this (grid start). */
export const CONTACT_AFTER_LIGHTS_MS = 1000;
/** …and for this long after a (re)connect or resume of either car. */
export const CONTACT_AFTER_CONNECT_MS = 2000;
/** Server copy older than this (relative to the contact time) = stale car, no contact. */
export const CONTACT_MAX_POSE_AGE_MS = 1000;

export interface ContactPose { x: number; z: number; vx: number; vz: number; simMs: number }

export type ContactReject = '' | 'early' | 'time' | 'stale' | 'far' | 'impulse';

/**
 * Returns the clamped impulse (N·s, ≥ 0) or −1 when the contact is rejected (reason in `why.r`).
 * `sender` hit `other`; `n` points from sender to other.
 */
export function checkContact(
  c: NetContact, sender: ContactPose, other: ContactPose, raceMs: number, lightsOutAtMs: number, why: { r: ContactReject },
): number {
  if (c.simMs < lightsOutAtMs + CONTACT_AFTER_LIGHTS_MS) return reject(why, 'early');
  if (c.simMs > raceMs + NET_LIMITS.simAheadMs || c.simMs < raceMs - NET_LIMITS.simLagMs) return reject(why, 'time');
  if (Math.abs(c.simMs - sender.simMs) > CONTACT_MAX_POSE_AGE_MS || Math.abs(c.simMs - other.simMs) > CONTACT_MAX_POSE_AGE_MS) {
    return reject(why, 'stale');
  }
  const ta = (c.simMs - sender.simMs) / 1000;
  const tb = (c.simMs - other.simMs) / 1000;
  const ax = sender.x + sender.vx * ta;
  const az = sender.z + sender.vz * ta;
  const bx = other.x + other.vx * tb;
  const bz = other.z + other.vz * tb;
  // Relative normal velocity of the other car w.r.t. the sender, along n (closing < 0).
  const vRel = (other.vx - sender.vx) * c.nx + (other.vz - sender.vz) * c.nz;
  const closing = Math.max(0, -vRel);
  const dist = Math.hypot(bx - ax, bz - az);
  if (dist > CONTACT_REACH_M + CONTACT_SLACK_M + CONTACT_CLOSING_S * closing) return reject(why, 'far');
  const mRed = (CONTACT_MASS_KG * CONTACT_MASS_KG) / (2 * CONTACT_MASS_KG);
  const jPlausible = (1 + CONTACT_E) * closing * mRed * 1.5 + CONTACT_J_SLACK;
  // Clamp (not reject) the magnitude: a real hit with a slightly high j still lands, capped.
  why.r = '';
  if (c.j > jPlausible * 4 && c.j > NET_LIMITS.contactJMax) return reject(why, 'impulse');
  return Math.min(c.j, jPlausible, NET_LIMITS.contactJMax);
}

function reject(why: { r: ContactReject }, r: ContactReject): number {
  why.r = r;
  return -1;
}
