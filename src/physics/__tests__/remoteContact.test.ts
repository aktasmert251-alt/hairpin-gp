// P3 / P3c (docs/design/multiplayer.md §5.2, §6.2): remote puppets are kinematic for the physics. The VehicleSystem and
// the CollisionSystem never move them; a local–remote overlap gives the local car its half of the two-body impulse (≤ 15 kN·s),
// emits `collision` with nx/nz, softens with latency and respects the ghost windows.
//
// `duel` is a two-client harness on a flat plane: client A owns car 0 and sees car 1 as a puppet, client B the reverse. Each
// tick the puppets copy the other client's car (one tick old), both clients step VehicleSystem + CollisionSystem, and every
// local–remote `collision` (one per episode) is sent as a `contact` (delivered `delayTicks` later, applied through contactTopUp on the same
// episode memory the receiver's CollisionSystem uses). Each car's
// contact Δv is compared with the offline two-body hit (both cars local in one sim), ±25 % as in the T13 pass criteria.

import { describe, expect, it } from 'vitest';
import { SIM_DT, type SimCarState, type SimEvent, type SimWorld } from '../../contracts/sim';
import type { VehicleState } from '../../contracts/vehicle';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { createCollisionSystem } from '../collision/collisionSystem';
import {
  CONTACT_J_MAX, applyContactImpulse, contactAccumulate, contactApplied, contactScale, contactTopUp, createContactEpisodes,
} from '../remote/contact';
import { aux } from '../state';
import { createVehicleSystem } from '../vehicle/vehicleSystem';
import { createFlatPlane } from './helpers/flatPlane';

type CollisionEvent = Extract<SimEvent, { type: 'collision' }>;

interface Pose { x: number; z: number; yaw: number; kmh: number }

function place(w: SimWorld, car: SimCarState, o: Pose): void {
  const p = w.static.params[car.id]!;
  const v = car.vehicle;
  const sp = o.kmh / 3.6;
  v.x = o.x; v.z = o.z; v.y = 0; v.yaw = o.yaw; v.yawRate = 0;
  v.vx = Math.cos(o.yaw) * sp; v.vz = -Math.sin(o.yaw) * sp; v.speed = sp; v.vLong = sp; v.vLat = 0;
  v.s = o.x; v.d = -o.z; v.hint.s = o.x;
  for (const wh of v.wheels) wh.omega = sp / p.wheelRadius;
  v.clutch = 1;
  const om = sp / p.wheelRadius;
  for (let g = 1; g <= p.gearRatios.length; g++) {
    v.gear = g;
    if ((om * p.gearRatios[g - 1]! * p.finalDrive * 60) / (2 * Math.PI) < 11000) break;
  }
}

type Ctl = 'player' | 'ai' | 'remote';

function world(c0: Ctl, c1: Ctl, a: Pose, b: Pose, raceMs = 5000): SimWorld {
  const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 1, seed: 3, weather: 'dry' }), {
    track: createFlatPlane(),
    skipLights: true,
    lineup: [
      { teamId: 'anka', driverIdx: 0, gridSlot: 0, control: c0, human: true },
      { teamId: 'anka', driverIdx: 1, gridSlot: 1, control: c1, human: true },
    ],
  });
  const w = sim.world;
  place(w, w.state.cars[0]!, a);
  place(w, w.state.cars[1]!, b);
  w.state.race.raceMs = raceMs;
  return w;
}

/** Puppet writer stand-in: copies the owner's pose and velocity. */
function copyPose(dst: VehicleState, src: VehicleState): void {
  dst.x = src.x; dst.y = src.y; dst.z = src.z; dst.yaw = src.yaw; dst.vx = src.vx; dst.vz = src.vz; dst.yawRate = src.yawRate;
  dst.speed = src.speed; dst.vLong = src.vLong; dst.vLat = src.vLat; dst.s = src.s; dst.d = src.d; dst.hint.s = src.hint.s;
}

const T = (seconds: number): number => Math.round(seconds / SIM_DT);

/** SAT penetration depth of two 5.6 × 2.0 m car bodies (≤ 0 = apart). */
function depth(a: VehicleState, b: VehicleState): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  let best = Infinity;
  for (const yaw of [a.yaw, a.yaw + Math.PI / 2, b.yaw, b.yaw + Math.PI / 2]) {
    const ux = Math.cos(yaw), uz = -Math.sin(yaw);
    const r = (v: VehicleState): number => 2.8 * Math.abs(Math.cos(v.yaw) * ux - Math.sin(v.yaw) * uz) + Math.abs(-Math.sin(v.yaw) * ux - Math.cos(v.yaw) * uz);
    best = Math.min(best, r(a) + r(b) - Math.abs(dx * ux + dz * uz));
  }
  return best;
}

const WINDOW = T(0.1);

/** Offline reference: both cars local in one sim. Each car's |Δv| from the tick before the first contact to 100 ms after. */
function offline(a: Pose, b: Pose, seconds: number): [number, number] {
  const w = world('player', 'ai', a, b);
  const veh = createVehicleSystem();
  const col = createCollisionSystem();
  const v0 = w.state.cars[0]!.vehicle, v1 = w.state.cars[1]!.vehicle;
  const pre = [0, 0, 0, 0];
  let first = -1;
  let out: [number, number] = [0, 0];
  for (let t = 0; t < T(seconds); t++) {
    if (first < 0) { pre[0] = v0.vx; pre[1] = v0.vz; pre[2] = v1.vx; pre[3] = v1.vz; }
    veh.step(w, SIM_DT);
    col.step(w, SIM_DT);
    w.events.drain((e) => { if (e.type === 'collision' && e.b >= 0 && first < 0) first = t; });
    if (first >= 0 && t === first + WINDOW) out = [Math.hypot(v0.vx - pre[0]!, v0.vz - pre[1]!), Math.hypot(v1.vx - pre[2]!, v1.vz - pre[3]!)];
  }
  return out;
}

interface Duel {
  dvA: number; dvB: number; maxJ: number; sentA: number; sentB: number; toppedUp: number;
  /** Car 1 crossed through car 0 along the approach axis (client A's view). */
  tunnelled: boolean;
  /** Longest continuous body overlap deeper than 0.15 m (client A's view), s. */
  overlapS: number;
  eventsA: CollisionEvent[];
}

interface Msg { at: number; to: 'A' | 'B'; j: number; nx: number; nz: number; px: number; pz: number }

function duel(a: Pose, b: Pose, axis: 'x' | 'z', seconds: number, delayTicks = 0, scale = 1): Duel {
  const A = world('player', 'remote', a, b);
  const B = world('remote', 'ai', a, b);
  const epA = createContactEpisodes(), epB = createContactEpisodes();
  // Response visible after the delivery delay plus the one-tick-old puppet copy.
  const delay = () => (delayTicks + 2) * SIM_DT * 1000;
  const sys = [createVehicleSystem(), createCollisionSystem({ remoteContactScale: () => scale, remoteResponseDelayMs: delay, episodes: epA })];
  const sysB = [createVehicleSystem(), createCollisionSystem({ remoteContactScale: () => scale, remoteResponseDelayMs: delay, episodes: epB })];
  const a0 = A.state.cars[0]!.vehicle, a1 = A.state.cars[1]!.vehicle;
  const b0 = B.state.cars[0]!.vehicle, b1 = B.state.cars[1]!.vehicle;
  const pA = A.static.params[0]!, pB = B.static.params[1]!;
  const queue: Msg[] = [];
  const pre = [0, 0, 0, 0];
  let first = -1;
  const r: Duel = { dvA: 0, dvB: 0, maxJ: 0, sentA: 0, sentB: 0, toppedUp: 0, tunnelled: false, overlapS: 0, eventsA: [] };
  const sign0 = Math.sign(axis === 'x' ? b.x - a.x : b.z - a.z);
  let run = 0;
  for (let t = 0; t < T(seconds); t++) {
    const now = A.state.race.raceMs;
    copyPose(a1, b1);
    copyPose(b0, a0);
    for (let k = queue.length - 1; k >= 0; k--) {
      const m = queue[k]!;
      if (m.at > t) continue;
      queue.splice(k, 1);
      const [ep, v, p, me, other] = m.to === 'A' ? [epA, a0, pA, 0, 1] : [epB, b1, pB, 1, 0];
      const add = contactTopUp(ep, me, other, m.j, now);
      if (add > 0) r.toppedUp += add;
      applyContactImpulse(v, p, add, m.nx, m.nz, m.px, m.pz);
    }
    if (first < 0) { pre[0] = a0.vx; pre[1] = a0.vz; pre[2] = b1.vx; pre[3] = b1.vz; }
    sys[0]!.step(A, SIM_DT); sysB[0]!.step(B, SIM_DT);
    sys[1]!.step(A, SIM_DT); sysB[1]!.step(B, SIM_DT);
    A.state.race.raceMs += SIM_DT * 1000;
    B.state.race.raceMs += SIM_DT * 1000;
    A.events.drain((e) => {
      if (e.type !== 'collision' || e.b < 0) return;
      r.eventsA.push(e);
      if (e.impulse > r.maxJ) r.maxJ = e.impulse;
      r.sentA++;
      if (first < 0) first = t;
      queue.push({ at: t + 1 + delayTicks, to: 'B', j: e.impulse, nx: e.nx!, nz: e.nz!, px: e.x, pz: e.z });
    });
    B.events.drain((e) => {
      if (e.type !== 'collision' || e.b < 0) return;
      if (e.impulse > r.maxJ) r.maxJ = e.impulse;
      r.sentB++;
      if (first < 0) first = t;
      queue.push({ at: t + 1 + delayTicks, to: 'A', j: e.impulse, nx: e.nx!, nz: e.nz!, px: e.x, pz: e.z });
    });
    const rel = axis === 'x' ? a1.x - a0.x : a1.z - a0.z;
    if (Math.sign(rel) !== sign0) r.tunnelled = true;
    const deep = depth(a0, a1) > 0.15;
    run = deep ? run + 1 : 0;
    if (run * SIM_DT > r.overlapS) r.overlapS = run * SIM_DT;
    if (first >= 0 && t === first + WINDOW) {
      r.dvA = Math.hypot(a0.vx - pre[0]!, a0.vz - pre[1]!);
      r.dvB = Math.hypot(b1.vx - pre[2]!, b1.vz - pre[3]!);
    }
  }
  return r;
}

/** Single client, scripted constant-velocity puppet (no relay): for the softening, ghost and separation checks. */
function kinematic(a: Pose, b: Pose, seconds: number, o: { scale?: number; raceMs?: number; setup?(w: SimWorld): void } = {}): {
  events: CollisionEvent[]; local: VehicleState; remote: VehicleState;
} {
  const w = world('player', 'remote', a, b, o.raceMs);
  o.setup?.(w);
  const veh = createVehicleSystem();
  const col = createCollisionSystem({ remoteContactScale: () => o.scale ?? 1 });
  const events: CollisionEvent[] = [];
  const R = w.state.cars[1]!.vehicle;
  for (let t = 0; t < T(seconds); t++) {
    R.x += R.vx * SIM_DT; R.z += R.vz * SIM_DT; R.s = R.x; R.d = -R.z; R.hint.s = R.x;
    veh.step(w, SIM_DT);
    col.step(w, SIM_DT);
    w.state.race.raceMs += SIM_DT * 1000;
    w.events.drain((e) => { if (e.type === 'collision' && e.b >= 0) events.push(e); });
  }
  return { events, local: w.state.cars[0]!.vehicle, remote: R };
}

/** 150 km/h, the remote car 2.3 m to the left closing at 3 m/s laterally. */
const swipe = (o: Parameters<typeof kinematic>[3] = {}, seconds = 0.6) => kinematic(
  { x: 0, z: 0, yaw: 0, kmh: 150 }, { x: 0, z: -2.3, yaw: 0, kmh: 150 }, seconds,
  { ...o, setup(w) { w.state.cars[1]!.vehicle.vz = 3; o.setup?.(w); } },
);

function check(name: string, a: Pose, b: Pose, axis: 'x' | 'z', seconds: number, tol = 0.25): Duel {
  const d = duel(a, b, axis, seconds);
  const [oa, ob] = offline(a, b, seconds);
  console.log(`${name}: Δv A ${d.dvA.toFixed(2)} (offline ${oa.toFixed(2)}) B ${d.dvB.toFixed(2)} (offline ${ob.toFixed(2)}) maxJ ${d.maxJ.toFixed(0)} sent ${d.sentA}/${d.sentB} top-up ${d.toppedUp.toFixed(0)} overlap ${d.overlapS.toFixed(3)} s`);
  expect(d.sentA + d.sentB).toBeGreaterThan(0);
  expect(d.dvA).toBeGreaterThan((1 - tol) * oa);
  expect(d.dvA).toBeLessThan((1 + tol) * oa);
  expect(d.dvB).toBeGreaterThan((1 - tol) * ob);
  expect(d.dvB).toBeLessThan((1 + tol) * ob);
  expect(d.maxJ).toBeLessThanOrEqual(CONTACT_J_MAX);
  expect(d.tunnelled).toBe(false);
  expect(d.overlapS).toBeLessThan(0.3);
  return d;
}

describe('P3 remote puppets are kinematic', () => {
  it('VehicleSystem + CollisionSystem leave a remote car pose and velocity untouched', () => {
    const w = world('player', 'remote', { x: 0, z: 0, yaw: 0, kmh: 0 }, { x: 200, z: 30, yaw: 0.3, kmh: 220 });
    const R = w.state.cars[1]!;
    R.vehicle.yawRate = 0.2;
    R.input.throttle = 1;
    const before = JSON.stringify(R.vehicle);
    const veh = createVehicleSystem();
    const col = createCollisionSystem();
    for (let t = 0; t < 240; t++) { veh.step(w, SIM_DT); col.step(w, SIM_DT); }
    expect(JSON.stringify(R.vehicle)).toBe(before);
  });

  it('a full createSim tick (AI, vehicle, collision, race) does not drive or move a remote car', () => {
    const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 3, seed: 5 }), {
      skipLights: true,
      lineup: [
        { teamId: 'anka', driverIdx: 0, gridSlot: 0, control: 'player', human: true },
        { teamId: 'anka', driverIdx: 1, gridSlot: 1, control: 'remote', human: true },
        { teamId: 'aurora', driverIdx: 0, gridSlot: 2, control: 'ai', human: false },
        { teamId: 'aurora', driverIdx: 1, gridSlot: 3, control: 'ai', human: false },
      ],
    });
    const R = sim.world.state.cars[1]!;
    const pose = (): string => JSON.stringify([R.vehicle.x, R.vehicle.y, R.vehicle.z, R.vehicle.yaw, R.vehicle.vx, R.vehicle.vz, R.vehicle.yawRate, R.vehicle.speed, R.input]);
    const before = pose();
    for (let t = 0; t < 240; t++) sim.step();
    expect(pose()).toBe(before);
    expect(sim.world.state.cars[2]!.vehicle.speed).toBeGreaterThan(2); // the AI cars do drive
  });
});

describe('P3c contact with remote cars (§6.2), two clients at 0 ms', () => {
  it('side swipe at 150 km/h (4° converging): both cars feel the offline hit (±35 %), ≤ one message per episode', () => {
    // Glancing nose-to-side contact: the offline pair keeps re-resolving the full MTV every tick while the online pair
    // separates softly, so online Δv over 100 ms is ~0.7–0.8 × offline here (rear-end / T-bone stay within ±25 %).
    const d = check('side swipe', { x: 0, z: 0, yaw: 0, kmh: 150 }, { x: 0, z: -2.6, yaw: -0.07, kmh: 150 }, 'z', 1, 0.35);
    const e = d.eventsA[0]!;
    expect(e.a).toBe(0);
    expect(e.b).toBe(1);
    expect(e.nz!).toBeLessThan(-0.9); // from the local car (z 0) to the remote car on its left (z < 0)
    expect(d.sentA).toBeLessThanOrEqual(5); // ≤ one per 200 ms episode over 1 s
  });

  it.each([15, 30, 60])('rear-end with Δv %i km/h: like offline, no tunnelling', (dk) => {
    check(`rear-end Δ${dk}`, { x: 0, z: 0, yaw: 0, kmh: 150 }, { x: -6.0, z: 0, yaw: 0, kmh: 150 + dk }, 'x', 1);
  });

  it.each([30, 60, 90])('T-bone at %i km/h: like offline, j ≤ 15 kN·s, no tunnelling', (kmh) => {
    // Car 0 at rest heading +X; car 1 comes from the left (z −6) heading +Z (yaw −π/2) into its side.
    check(`T-bone ${kmh}`, { x: 0, z: 0, yaw: 0, kmh: 0 }, { x: 0, z: -6, yaw: -Math.PI / 2, kmh }, 'z', 1);
  });

  it('rear-end Δ30 with 50 ms one way: each car feels the hit once (no double application), no tunnelling', () => {
    const d = duel({ x: 0, z: 0, yaw: 0, kmh: 150 }, { x: -6.0, z: 0, yaw: 0, kmh: 180 }, 'x', 1, 12);
    const [oa] = offline({ x: 0, z: 0, yaw: 0, kmh: 150 }, { x: -6.0, z: 0, yaw: 0, kmh: 180 }, 1);
    console.log(`dedup 50 ms: Δv A ${d.dvA.toFixed(2)} offline ${oa.toFixed(2)} top-up ${d.toppedUp.toFixed(0)} N·s`);
    expect(d.dvA).toBeGreaterThan(0.75 * oa);
    expect(d.dvA).toBeLessThan(1.25 * oa);
    expect(d.tunnelled).toBe(false);
  });
});

describe('P3c latency softening, ghost windows, gentle separation', () => {
  it('impulse ×0.84 at 150 ms and ×0.3 at 250 ms RTT; none when stale', () => {
    expect(contactScale(80)).toBe(1);
    expect(contactScale(120)).toBe(1);
    expect(contactScale(150)).toBeCloseTo(0.838, 3);
    expect(contactScale(250)).toBeCloseTo(0.3, 6);
    expect(contactScale(400)).toBeCloseTo(0.3, 6);
    expect(contactScale(50, 401)).toBe(0);
    expect(contactScale(NaN)).toBe(0);
    const j0 = swipe().events[0]!.impulse;
    const j150 = swipe({ scale: contactScale(150) }).events[0]!.impulse;
    const j250 = swipe({ scale: contactScale(250) }).events[0]!.impulse;
    console.log(`softening: j ${j0.toFixed(0)} / ${j150.toFixed(0)} / ${j250.toFixed(0)}`);
    expect(j150 / j0).toBeGreaterThan(0.838 * 0.9);
    expect(j150 / j0).toBeLessThan(0.838 * 1.1);
    expect(j250 / j0).toBeGreaterThan(0.3 * 0.85);
    expect(j250 / j0).toBeLessThan(0.3 * 1.15);
    expect(swipe({ scale: contactScale(50, 500) }).events).toHaveLength(0);
  });

  it('no contact while either car has aux.ghostT > 0, before lights out + 1 s, or outside the race phases', () => {
    const ghostR = swipe({ setup(w) { aux(w.state.cars[1]!.vehicle).ghostT = 2; } });
    expect(ghostR.events).toHaveLength(0);
    expect(swipe({ setup(w) { aux(w.state.cars[0]!.vehicle).ghostT = 2; } }).events).toHaveLength(0);
    expect(swipe({ raceMs: 0 }, 0.5).events).toHaveLength(0);
    expect(swipe({ setup(w) { w.state.race.phase = 'lights'; } }).events).toHaveLength(0);
    // The puppet's ghost timer runs down in the CollisionSystem, so the window ends by itself.
    expect(aux(ghostR.remote).ghostT).toBeCloseTo(1.4, 2);
  });

  it('side by side with a small overlap: gentle separation, no impulse', () => {
    const r = kinematic({ x: 0, z: 0, yaw: 0, kmh: 200 }, { x: 0, z: -1.85, yaw: 0, kmh: 200 }, 0.5);
    const gap = r.local.z - r.remote.z;
    console.log(`side by side: local vz ${r.local.vz.toFixed(3)} centre gap ${gap.toFixed(3)} events ${r.events.length}`);
    expect(Math.abs(r.local.vz)).toBeLessThan(0.3);
    expect(r.events).toHaveLength(0);
    expect(gap).toBeGreaterThan(1.9);
  });
});

describe('contact episodes and the relayed impulse', () => {
  it('episodes: a relayed duplicate is dropped, a larger one only tops up, a new episode after 200 ms', () => {
    const ep = createContactEpisodes(8);
    contactAccumulate(ep, 0, 3, 3000, 1000); // local detections open the episode and add up
    contactAccumulate(ep, 0, 3, 1000, 1010);
    expect(contactApplied(ep, 0, 3, 1020)).toBe(4000);
    expect(contactTopUp(ep, 0, 3, 4000, 1050)).toBe(0); // relayed duplicate of the same hit
    expect(contactTopUp(ep, 0, 3, 6000, 1100)).toBeCloseTo(2000, 6); // larger relayed: top-up only
    expect(contactApplied(ep, 0, 3, 1150)).toBe(6000);
    expect(contactTopUp(ep, 0, 3, 2000, 1250)).toBe(2000); // new episode (> 200 ms)
    expect(contactTopUp(ep, 0, 5, 99_000, 0)).toBe(CONTACT_J_MAX); // other pair, clamped
    expect(contactTopUp(ep, 2, 5, 100, 0)).toBe(100); // pairs are per (local, other): server AI cars each have their own
    expect(contactTopUp(ep, 0, 9, 100, 0)).toBe(0); // id out of range
    expect(contactTopUp(ep, 0, 4, NaN, 0)).toBe(0);
  });

  it('applyContactImpulse: velocity + yaw kick of the local half, clamps untrusted input', () => {
    const w = world('player', 'remote', { x: 0, z: 0, yaw: 0, kmh: 100 }, { x: 100, z: 0, yaw: 0, kmh: 0 });
    const v = w.state.cars[0]!.vehicle;
    const p = w.static.params[0]!;
    const m = v.massKg;
    applyContactImpulse(v, p, 4000, 0, 1, 2, 0); // push +z at the nose
    expect(v.vz).toBeCloseTo(4000 / m, 6);
    expect(v.yawRate).toBeLessThan(0); // same sign as the local pair response for this lever arm
    expect(v.carImpulse).toBe(4000);
    const vz = v.vz;
    applyContactImpulse(v, p, 1e9, 0, 1.2, 1e6, 1e6); // huge j, unnormalised n, far point
    expect(v.vz - vz).toBeCloseTo(CONTACT_J_MAX / m, 6);
    expect(Number.isFinite(v.yawRate)).toBe(true);
    const snap = JSON.stringify(v);
    applyContactImpulse(v, p, NaN, 0, 1, 0, 0);
    applyContactImpulse(v, p, 1000, NaN, 1, 0, 0);
    applyContactImpulse(v, p, -5, 0, 1, 0, 0);
    applyContactImpulse(v, p, 1000, 0, 3, 0, 0); // not a unit normal
    expect(JSON.stringify(v)).toBe(snap);
  });
});
