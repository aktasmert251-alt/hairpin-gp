// User bug (2026-10-13): T1 pit-wall entry collision regression.
// ışınlanıyor ve takılıyor". A keyboard player hugging the pit side of the track from the end of the pit entry to past
// the pit exit merge (İstanbul: pit wall on the left through T1, exit lane merging at T2) must stay a main-track car:
// main ribbon, no pit phase, keyboard control kept, no position jump, no reset. All three tracks.

import { describe, expect, it } from 'vitest';
import type { SimWorld } from '../../contracts/sim';
import type { RaceTrackId as TrackId, TrackFrame } from '../../contracts/track';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { teleportCar } from '../../game/sim/teleport';
import { getTrackExtras } from '../../track/build/extras';
import { loadTrack } from '../../track/index';

function ready(id: TrackId): boolean {
  try {
    return loadTrack(id).data.id === id && loadTrack(id).data.pit.count > 1;
  } catch {
    return false;
  }
}

interface Hug { pitTicks: number; phases: string[]; controlLost: boolean; maxJump: number; resets: number; progress: number; maxD: number }

/** Keyboard player (alone) hugging the pit side: `gap` m from the pit wall face where there is one, else `wide` m past
 * the white line; from the start of the pit wall after the entry gate to 150 m past the merge. */
function hug(trackId: TrackId, gap: number, wide: number, from?: number): Hug {
  const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 0, seed: 3, laps: 3, trackId }), { skipLights: true });
  const w: SimWorld = sim.world;
  const q = w.static.track.query;
  const data = w.static.track.data;
  const ex = getTrackExtras(data)!;
  const side = ex.pitSide;
  const car = w.state.cars[0]!;
  const v = car.vehicle;
  const c = car.controls;
  const split = data.pit.mainSAtSplit;
  const merge = data.pit.mainSAtMerge;
  // Start where the pit wall begins after the entry gate (driving onto the entry lane before it is a pit entry).
  let s0 = split;
  while (ex.pitWallD[Math.floor(q.wrapS(s0)) % data.count]! !== ex.pitWallD[Math.floor(q.wrapS(s0)) % data.count]!) s0 += 1;
  s0 += 5;
  if (from !== undefined) s0 = from;
  const dist = q.deltaS(s0, merge) + (q.deltaS(s0, merge) < 0 ? q.length : 0) + 150;
  const frame: TrackFrame = { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 };
  const target = (s: number): number => {
    const i = Math.floor(q.wrapS(s)) % data.count;
    const wd = ex.pitWallD[i]!;
    q.frameAt(s, frame);
    const hw = side > 0 ? frame.halfWidthL : frame.halfWidthR;
    return side * (wd === wd ? Math.abs(wd) - gap : hw + wide);
  };
  teleportCar(w, 0, s0, target(s0), 120);
  const p = w.static.params[0]!;
  const tp = { x: 0, y: 0, z: 0 };
  const r: Hug = { pitTicks: 0, phases: [], controlLost: false, maxJump: 0, resets: 0, progress: 0, maxD: 0 };
  let px = v.x;
  let pz = v.z;
  let travelled = 0;
  let prevS = v.s;
  for (let i = 0; i < 240 * 90 && travelled < dist; i++) {
    // Keys track a pure-pursuit steer toward the target d (left/right while the filtered steer is short of it).
    const ld = Math.max(8, 0.45 * v.speed);
    q.worldFromSD(v.s + ld, target(v.s + ld), tp);
    const dx = tp.x - v.x;
    const dz = tp.z - v.z;
    const lat = dx * -Math.sin(v.yaw) + dz * -Math.cos(v.yaw);
    const want = Math.atan((p.wheelbase * 2 * lat) / (dx * dx + dz * dz)) / p.maxSteerRad;
    c.left = want > car.input.steer + 0.02;
    c.right = want < car.input.steer - 0.02;
    let vT = 140 / 3.6;
    for (let k = 0; k < 1.2 * v.speed + 30; k += 2) {
      const kk = q.frameAt(v.s + k, frame).curvature;
      const kd = Math.abs(kk / (1 - kk * target(v.s + k)));
      const vc = Math.sqrt(16 / (kd > 1e-4 ? kd : 1e-4) + 2 * 20 * Math.max(0, k - 0.3 * v.speed));
      if (vc < vT) vT = vc;
    }
    c.throttle = v.speed < vT - 0.5;
    c.brake = v.speed > vT + 1.5;
    sim.step();
    w.events.drain((e) => {
      if (e.type === 'carReset') r.resets++;
      if (e.type === 'pit') r.phases.push(e.phase);
    });
    if (v.hint.ribbon === "pit") r.pitTicks++;
    if (car.control !== 'player') r.controlLost = true;
    const jump = Math.hypot(v.x - px, v.z - pz) - v.speed / 240;
    if (jump > r.maxJump) r.maxJump = jump;
    px = v.x;
    pz = v.z;
    if (v.hint.ribbon === 'main') {
      const ds = q.deltaS(prevS, v.s);
      if (ds > 0) travelled += ds;
      prevS = v.s;
      if (Math.abs(v.d) > r.maxD) r.maxD = Math.abs(v.d);
    }
  }
  r.progress = travelled / dist;
  return r;
}

const TRACKS: TrackId[] = ['istanbul', 'lombardia', 'bosphorus'];

describe('pit side: a main-track car hugging the pit wall / exit lane stays on the main track', () => {
  // The user's case: İstanbul from the S/F straight, along the pit wall through T1 and past its exit-end nose
  // (s ≈ 355) onto T2 where the exit lane merges (s ≈ 419). Old query: pushed through the wall nose into the lane,
  // then the exit lane read as an unrequested pit entry (pitAuto, stuck).
  it.skipIf(!ready('istanbul'))('istanbul T1: hugging the pit wall from s 100 through T1 / T2', () => {
    for (const [gap, wide] of [[1.15, 1.5], [1.3, 2.0], [1.6, 2.5]] as const) {
      const r = hug('istanbul', gap, wide, 100);
      console.log(`istanbul T1 gap ${gap} wide ${wide}: pit ticks ${r.pitTicks} phases [${r.phases.join(',')}] control lost ${r.controlLost} max jump ${r.maxJump.toFixed(2)} m resets ${r.resets}`);
      expect(r.pitTicks).toBe(0);
      expect(r.phases).toEqual([]);
      expect(r.controlLost).toBe(false);
      expect(r.resets).toBe(0);
      expect(r.maxJump).toBeLessThan(0.5);
    }
  }, 60_000);

  for (const id of TRACKS) {
    it.skipIf(!ready(id))(`${id}: wall 1.2 m, exit lane 1.5 m past the line`, () => {
      const r = hug(id, 1.2, 1.5);
      console.log(`${id}: pit ticks ${r.pitTicks} phases [${r.phases.join(',')}] control lost ${r.controlLost} max jump ${r.maxJump.toFixed(2)} m resets ${r.resets} progress ${(100 * r.progress).toFixed(0)} % max |d| ${r.maxD.toFixed(1)}`);
      expect(r.progress).toBeGreaterThan(0.99);
      expect(r.pitTicks).toBe(0);
      expect(r.phases).toEqual([]);
      expect(r.controlLost).toBe(false);
      expect(r.resets).toBe(0);
      expect(r.maxJump).toBeLessThan(0.5);
    }, 60_000);
  }
});
