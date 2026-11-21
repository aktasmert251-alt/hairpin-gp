// Player-engine driver (audio.md §2–§3), shared by the live AudioSystem and the offline replay renderer so both
// produce the same parameter timeline: turbo spool smoothing, engine / wind / squeal params, overrun crackle with
// pops from a seeded mulberry32, wastegate chuff on a lift from boost, gear-event cut / blip. Allocation-free per call.

import type { CarRenderState, RenderFrame } from '../contracts/render';
import type { SimEvent } from '../contracts/sim';
import type { EngineParams } from './engine/engineVoice';
import type { AudioGraph } from './graph';
import { mulberry } from './noise';

const TAU = 0.02;

export interface EngineDriveState {
  spool: number;
  liftTimer: number;
  nextPop: number;
  lastGear: number;
  /** Armed while on boost (throttle > 0.7, spool > 0.4); a lift below 0.2 fires the wastegate chuff once. */
  liftArmed: boolean;
  rng: { s: number };
  rand: () => number;
  params: EngineParams;
}

export function newEngineDrive(seed = 0x9e3779b9): EngineDriveState {
  const rng = { s: seed | 0 };
  return {
    spool: 0, liftTimer: 0, nextPop: 0, lastGear: 0, liftArmed: false, rng, rand: () => mulberry(rng),
    params: { rpm: 4000, throttle: 0, speed: 0, ersKw: 0, spool: 0, interior: false },
  };
}

export function driveEngine(g: AudioGraph, st: EngineDriveState, frame: RenderFrame, car: CarRenderState, t: number, dt: number): void {
  const thr = car.throttle;
  // Turbo spool: throttle smoothed τ 0.4 s up / 0.25 s down.
  const tau = thr > st.spool ? 0.4 : 0.25;
  // Wastegate / dump chuff on a lift from boost.
  if (thr > 0.7 && st.spool > 0.4) st.liftArmed = true;
  else if (thr < 0.2 && st.liftArmed) {
    st.liftArmed = false;
    if (!frame.paused) g.engine.lift(t, st.spool);
  }
  st.spool += (thr - st.spool) * (dt > 0 ? 1 - Math.exp(-dt / tau) : 0);
  const p = st.params;
  p.rpm = car.rpm;
  p.throttle = frame.paused ? 0 : thr;
  p.speed = car.speed;
  p.ersKw = car.ersKw;
  p.spool = st.spool;
  p.interior = frame.view === 'cockpit';
  // τ ≥ 1.2 frames: at low frame rates (< 60 fps) 20 ms steps would zipper.
  g.engine.set(p, t, dt * 1.2 > TAU ? dt * 1.2 : TAU);
  g.setWind(car.speed, p.interior, t, 0.05);
  let sigma = 0;
  for (let i = 0; i < 4; i++) if (car.slip[i]! > sigma) sigma = car.slip[i]!;
  g.setSqueal(frame.paused ? 0 : sigma, car.speed, car.brake > 0.5 && sigma > 2, t, 0.03);
  // Overrun crackle: for 1.2 s after a lift above 8,000 rpm, pops at 10–20 /s.
  // liftTimer: 0 = armed, > 0 = crackling, −1 = spent until the throttle is reapplied (> 0.3). It used to re-arm every
  // 1.2 s while coasting, so long lifts and part-throttle flicker crackled without end.
  if (thr < 0.05 && car.rpm > 8000) {
    if (st.liftTimer === 0) st.liftTimer = 1.2;
    else if (st.liftTimer > 0) st.liftTimer = st.liftTimer - dt > 0 ? st.liftTimer - dt : -1;
  } else if (thr > 0.3) st.liftTimer = 0;
  else if (st.liftTimer > 0) st.liftTimer = -1;
  if (st.liftTimer > 0 && !frame.paused) {
    if (st.nextPop < t) st.nextPop = t;
    // Headphone pass (2026-10-20): 7–14 pops/s at 0.15 (was 10–20 at 0.2: a continuous crackle on long lifts).
    while (st.nextPop < t + 0.1) {
      g.engine.pop(st.nextPop, 0.15);
      st.nextPop += 1 / (7 + 7 * mulberry(st.rng));
    }
  }
}

export function engineEvent(g: AudioGraph, st: EngineDriveState, e: SimEvent, playerId: number, t: number): void {
  if (e.type !== 'gear' || e.car !== playerId) return;
  if (e.gear > st.lastGear) g.engine.upshift(t);
  else if (e.gear < st.lastGear) g.engine.downshift(t, 6 + Math.floor(st.rand() * 5), st.rand);
  st.lastGear = e.gear;
}
