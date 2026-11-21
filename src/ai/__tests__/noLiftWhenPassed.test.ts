// User report 2026-10-17: "sometimes some AI cars cut the throttle in sections where I'm about to overtake them".
// A scripted player at full throttle comes up beside an AI car on a straight (and on a corner exit), 3.2 m to its left
// or right, a little faster (also with the AI 1.6 m from the edge and the player 2.8 m beside it: no room to give).
// The AI gives room laterally but keeps racing pace: it never lifts below 90 % throttle on the straight, and its speed
// stays within 3 km/h of the same car driving alone (the edge lane over the kerbs costs ~2 km/h without a lift).

import { describe, expect, it } from 'vitest';
import type { TrackFrame } from '../../contracts/track';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { teleportCar } from '../../game/sim/teleport';
import { loadTrack } from '../../track/index';
import { lineAt } from '../line/racingLine';

type Tid = 'istanbul' | 'lombardia';

function trackReady(id: Tid): boolean {
  try {
    return loadTrack(id).data.id === id;
  } catch {
    return false;
  }
}

const fr: TrackFrame = { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 };

/** Samples every 0.1 s past 30 m: AI speed, distance from s0, and whether the player was alongside (overlapping). */
interface Run { kmh: number[]; dist: number[]; level: boolean[]; minThr: number; contacts: number }

/** AI car from `s0` (on its line) for `ticks`; a scripted player 3.2 m to the side (`side` ±1, 0 = no player) starts 4 km/h faster, at full throttle on its own lane. Speed samples while the AI is on the straight. */
function run(trackId: Tid, s0: number, sEnd: number, side: number, edge = false, corner = false): Run {
  const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 1, seed: 7, laps: 3, difficulty: 70, autodrive: false, gridPos: 1, trackId }), { skipLights: true });
  const w = sim.world;
  const q = w.static.track.query;
  const mod = w.static.ai;
  const line = mod.getRacingLine();
  const L = q.length;
  const pl = w.state.cars.find((c) => c.isPlayer)!;
  const ai = w.state.cars.find((c) => !c.isPlayer)!;
  const prof = mod.getProfile(ai.id);
  const at = (a: Float32Array, x: number): number => a[Math.floor((((x % L) + L) % L) / line.ds) % line.count]!;
  // Past the start reaction time.
  for (let t = 0; t < 240; t++) {
    sim.step();
    w.events.drain(() => {});
  }
  const kmh = at(prof.v, s0) * 3.6 * 0.9;
  const l0 = lineAt(line.d, line, s0, L);
  q.frameAt(s0, fr);
  let pD = l0 + 3.2 * side;
  if (pD > fr.halfWidthL - 1.2) pD = fr.halfWidthL - 1.2;
  if (pD < -fr.halfWidthR + 1.2) pD = -fr.halfWidthR + 1.2;
  let aiD = side !== 0 && Math.abs(pD - l0) < 3 ? pD - 3.2 * side : l0;
  // Edge case: the AI 1.6 m inside the white line on the far side, the player 2.8 m beside it (no room to give).
  if (edge) {
    aiD = side > 0 ? -(fr.halfWidthR - 1.6) : fr.halfWidthL - 1.6;
    pD = aiD + 2.8 * side;
  }
  teleportCar(w, ai.id, s0, aiD, kmh);
  teleportCar(w, pl.id, side === 0 ? s0 - 600 : corner ? s0 : s0 - 8, side === 0 ? 0 : pD, side === 0 ? 0 : corner ? kmh : kmh + 4);
  ai.ai.mode = 'race';
  ai.ai.laneOffset = aiD - l0;
  ai.ai.laneTarget = 0;
  pl.control = 'ai';
  const orig = mod.computeInput.bind(mod);
  const p = w.static.params[pl.id]!;
  const tgt = { x: 0, y: 0, z: 0 };
  const off = pD - l0;
  mod.computeInput = (world, carId, out) => {
    if (carId !== pl.id) return orig(world, carId, out);
    const v = pl.vehicle;
    out.throttle = 0;
    out.brake = side === 0 ? 1 : 0;
    out.steer = 0;
    if (side === 0) return;
    const ld = Math.max(12, 0.45 * v.speed);
    // A fair driver (as keepRoomEdge): while overlapping it does not steer within 2.8 m (centre to centre) of the AI car;
    // its lane follows the racing line, which converges onto an AI car held at the edge (it leaned on it into the grass).
    let dL = lineAt(line.d, line, v.s + ld, L) + off;
    const dsA = q.deltaS(v.s, ai.vehicle.s);
    if (dsA > -6.5 && dsA < 6.5) {
      const ad = ai.vehicle.d;
      if (ad > v.d && dL > ad - 2.8) dL = Math.min(dL, Math.max(v.d, ad - 2.8));
      if (ad < v.d && dL < ad + 2.8) dL = Math.max(dL, Math.min(v.d, ad + 2.8));
    }
    q.worldFromSD(v.s + ld, dL, tgt);
    const dx = tgt.x - v.x;
    const dz = tgt.z - v.z;
    const lat = dx * -Math.sin(v.yaw) + dz * -Math.cos(v.yaw);
    out.steer = Math.max(-1, Math.min(1, Math.atan((p.wheelbase * 2 * lat) / (dx * dx + dz * dz)) / p.maxSteerRad));
    out.throttle = 1;
    // Corner case: the player holds the outside level with the AI car, 3.2 m beside it (clamped 1.2 m inside the white
    // line), at the AI's speed (+ a term that keeps it level) capped by what its own lane allows (2.5 g, 30 m/s² braking).
    if (corner) {
      const ad = ai.vehicle.d;
      q.frameAt(v.s + ld, fr);
      const dT = Math.max(-fr.halfWidthR + 1.2, Math.min(fr.halfWidthL - 1.2, ad + 3.2 * side));
      q.worldFromSD(v.s + ld, dT, tgt);
      const ex = tgt.x - v.x;
      const ez = tgt.z - v.z;
      const el = ex * -Math.sin(v.yaw) + ez * -Math.cos(v.yaw);
      out.steer = Math.max(-1, Math.min(1, Math.atan((p.wheelbase * 2 * el) / (ex * ex + ez * ez)) / p.maxSteerRad));
      let vT = ai.vehicle.speed + 0.8 * q.deltaS(v.s, ai.vehicle.s);
      for (let k = 0; k < 1.2 * v.speed + 20; k += 2) {
        const kap = q.frameAt(v.s + k, fr).curvature;
        const kd = Math.abs(kap / (1 - kap * v.d));
        const vc = Math.sqrt(25 / (kd > 1e-4 ? kd : 1e-4) + 2 * 30 * Math.max(0, k - 0.3 * v.speed));
        if (vc < vT) vT = vc;
      }
      const e = vT - v.speed;
      out.throttle = e > 0 ? Math.min(1, 0.2 + 0.3 * e) : 0;
      out.brake = e < -1 ? Math.min(1, -0.25 * e) : 0;
    }
    out.gearUp = false; out.gearDown = false; out.drsRequest = false; out.ersOvertake = false; out.pitLimiter = false;
  };
  const r: Run = { kmh: [], dist: [], level: [], minThr: 1, contacts: 0 };
  for (let t = 0; t < 20 * 240; t++) {
    sim.step();
    w.events.drain((e) => {
      if (e.type === 'collision' && e.b >= 0) r.contacts++;
    });
    const ds = q.deltaS(s0, ai.vehicle.s);
    if (ds > q.deltaS(s0, sEnd)) break;
    if (ds > 30 && t % 24 === 0) {
      r.kmh.push(ai.vehicle.speed * 3.6);
      r.dist.push(ds);
      const lv = side !== 0 && Math.abs(q.deltaS(ai.vehicle.s, pl.vehicle.s)) < 5.6 && Math.abs(pl.vehicle.d - ai.vehicle.d) > 1.5;
      r.level.push(lv);
      if (ai.input.throttle < r.minThr) r.minThr = ai.input.throttle;
    }
  }
  return r;
}

/** Straights: [start s, end s] where the line is straight and the profile flat out (no brake zone). */
function straights(trackId: Tid): [number, number][] {
  const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 1, seed: 7, laps: 3, difficulty: 70, trackId }), { skipLights: true });
  const mod = sim.world.static.ai;
  const line = mod.getRacingLine();
  const prof = mod.getProfile(1);
  const out: [number, number][] = [];
  let a = -1;
  for (let i = 0; i <= line.count; i++) {
    const k = i % line.count;
    const ok = i < line.count && prof.zone[k] !== 2 && Math.abs(line.curvature[k]!) < 0.003;
    if (ok && a < 0) a = i;
    if (!ok && a >= 0) {
      if ((i - a) * line.ds > 500) out.push([a * line.ds, (i - 1) * line.ds - 60]);
      a = -1;
    }
  }
  return out.sort((x, y) => y[1] - y[0] - (x[1] - x[0])).slice(0, 2);
}

for (const tid of ['istanbul', 'lombardia'] as const) {
  describe.skipIf(!trackReady(tid))(`AI keeps racing pace while being passed (${tid})`, () => {
    it('player coming past on a straight, either side: no lift, speed as when alone', () => {
      const bad: string[] = [];
      // From the corner exit, and over the last 250 m before the brake zone (the next corner within reach).
      for (const [s0, s1] of straights(tid).flatMap(([a, b]) => [[a, b], [b - 250, b]] as [number, number][])) {
        const solo = run(tid, s0, s1, 0);
        for (const [side, edge] of [[1, false], [-1, false], [1, true], [-1, true]] as [number, boolean][]) {
          const r = run(tid, s0, s1, side, edge);
          let worst = 0;
          for (let k = 0; k < Math.min(r.kmh.length, solo.kmh.length); k++) worst = Math.max(worst, solo.kmh[k]! - r.kmh[k]!);
          if (worst > 3 || r.minThr < 0.9) bad.push(`${tid} s ${s0.toFixed(0)}–${s1.toFixed(0)} ${side > 0 ? 'L' : 'R'}: −${worst.toFixed(1)} km/h vs alone, min throttle ${r.minThr.toFixed(2)}`);
        }
      }
      expect(bad).toEqual([]);
    }, 120_000);

    // User 2026-10-21: the AI fights for its place instead of lifting. A player level with it on the outside through a
    // corner: while the player is alongside, the AI on its line (the inside) carries the speed it has alone at the same
    // point (within 3 km/h; compared by distance, not time: once the player is clear the run is no longer a 'level' case).
    it('player alongside on the outside through a corner: the AI keeps its corner speed', () => {
      const corners = loadTrack(tid).data.corners;
      const bad: string[] = [];
      for (const c of [corners[2]!, corners[Math.floor(corners.length / 2)]!]) {
        const s0 = c.entryS - 120;
        const outside = c.dir === 'L' ? -1 : 1;
        const solo = run(tid, s0, c.exitS, 0);
        const r = run(tid, s0, c.exitS, outside, false, true);
        let worst = 0;
        let level = 0;
        for (let k = 0; k < r.kmh.length; k++) {
          if (!r.level[k]) continue;
          level++;
          let j = 1;
          while (j < solo.dist.length - 1 && solo.dist[j]! < r.dist[k]!) j++;
          const a = solo.dist[j - 1]!;
          const b = solo.dist[j]!;
          const f = b > a ? Math.min(1, Math.max(0, (r.dist[k]! - a) / (b - a))) : 0;
          worst = Math.max(worst, solo.kmh[j - 1]! + f * (solo.kmh[j]! - solo.kmh[j - 1]!) - r.kmh[k]!);
        }
        if (worst > 3 || level < 10 || r.contacts > 0) bad.push(`${tid} T${c.n}: −${worst.toFixed(1)} km/h vs alone over ${level} level samples, ${r.contacts} contacts`);
      }
      expect(bad).toEqual([]);
    }, 120_000);
  });
}
