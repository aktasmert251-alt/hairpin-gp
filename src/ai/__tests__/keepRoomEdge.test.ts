// D-051 #6 (user bug 2026-10-16): "AI virajlara gelirken yanımda olursam çarpışmadan kaçınmak için pist dışına taşıyor
// ve kaza yapıyor." A scripted player drives the racing line next to an AI car (3.2 m to its left or right, level,
// 100 m before the brake zone). The AI must keep room without leaving the track: no more than its centre 0.5 m past
// the white line (≤ 2 wheels over, as on its own line), no 'recover', no wall hit and no contact. It gives the corner
// up by lifting (keepRoom room-ahead / held-off-line yield, off-line speed guard) instead.

import { describe, expect, it } from 'vitest';
import type { TrackFrame } from '../../contracts/track';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { teleportCar } from '../../game/sim/teleport';
import { loadTrack } from '../../track/index';
import { lineAt } from '../line/racingLine';

type Tid = 'istanbul' | 'lombardia' | 'bosphorus';

function trackReady(id: Tid): boolean {
  try {
    return loadTrack(id).data.id === id;
  } catch {
    return false;
  }
}

const fr: TrackFrame = { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 };

interface Run { contacts: number; walls: number; maxOut: number; recoverS: number; playerOut: number }

/** Corner `ci` of `trackId`; the AI starts `aiOff` m (+ = left) from the player, who is on the racing line. */
function run(trackId: Tid, ci: number, aiOff: number): Run {
  const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 1, seed: 7, laps: 3, difficulty: 90, autodrive: false, gridPos: 1, trackId }), { skipLights: true });
  const w = sim.world;
  const q = w.static.track.query;
  const mod = w.static.ai;
  const line = mod.getRacingLine();
  const L = q.length;
  const cars = w.state.cars;
  const pl = cars.find((c) => c.isPlayer)!;
  const ai = cars.find((c) => !c.isPlayer)!;
  const c = w.static.track.data.corners[ci]!;
  const prof = mod.getProfile(ai.id);
  const at = (a: Float32Array | Uint8Array, x: number): number => a[Math.floor((((x % L) + L) % L) / line.ds) % line.count]!;
  // Start 100 m before the brake zone of the corner (on a straight).
  let s0 = c.entryS - 60;
  for (let k = 0; k < 200 && (at(prof.zone, s0) === 2 || Math.abs(lineAt(line.curvature, line, s0, L)) > 0.003); k++) s0 -= 2;
  s0 = (((s0 - 100) % L) + L) % L;
  const kmh = at(prof.v, s0) * 3.6 * 0.95;
  q.frameAt(s0, fr);
  const l0 = lineAt(line.d, line, s0, L);
  let aD = l0 + aiOff;
  if (aD > fr.halfWidthL - 1.2) aD = fr.halfWidthL - 1.2;
  if (aD < -fr.halfWidthR + 1.2) aD = -fr.halfWidthR + 1.2;
  const pOff0 = aD - aiOff - l0;
  teleportCar(w, pl.id, s0, aD - aiOff, kmh);
  teleportCar(w, ai.id, s0, aD, kmh);
  ai.ai.mode = 'race';
  ai.ai.laneOffset = aD - l0;
  ai.ai.laneTarget = aD - l0;
  // Scripted player: pure pursuit to the racing line (its start offset fading out over 3 s) at 96 % of the AI profile
  // speed. A fair driver: while overlapping it does not steer into the AI car beside it (3 m centre to centre) and
  // does not ram it from behind; held more than 2 m off its line in a curve it lifts 10 %. The run is valid only while
  // the scripted car itself stays within the same 0.5 m as the AI.
  pl.control = 'ai';
  let tick = 0;
  const orig = mod.computeInput.bind(mod);
  const tgt = { x: 0, y: 0, z: 0 };
  const p = w.static.params[pl.id]!;
  mod.computeInput = (world, carId, out) => {
    if (carId !== pl.id) return orig(world, carId, out);
    const v = pl.vehicle;
    const ld = Math.max(12, 0.45 * v.speed);
    let dT = lineAt(line.d, line, v.s + ld, L) + pOff0 * Math.max(0, 1 - tick / 720);
    const dsA = q.deltaS(v.s, ai.vehicle.s);
    if (dsA > -6.5 && dsA < 6.5) {
      const ad = ai.vehicle.d;
      if (ad > v.d && dT > ad - 3) dT = Math.min(dT, Math.max(v.d, ad - 3));
      if (ad < v.d && dT < ad + 3) dT = Math.max(dT, Math.min(v.d, ad + 3));
    }
    q.worldFromSD(v.s + ld, dT, tgt);
    const dx = tgt.x - v.x;
    const dz = tgt.z - v.z;
    const lat = dx * -Math.sin(v.yaw) + dz * -Math.cos(v.yaw);
    // Pure pursuit with yaw-rate damping (as the AI driver; undamped it weaved after the Bosphorus T1 chicane).
    const kpp = (2 * lat) / (dx * dx + dz * dz);
    out.steer = Math.max(-1, Math.min(1, (Math.atan(p.wheelbase * kpp) + 0.06 * (v.speed * kpp - v.yawRate)) / p.maxSteerRad));
    let vT = 0.96 * at(prof.v, v.s + 0.15 * v.speed);
    // Held more than 2 m off its line (beside the AI car) through a corner, it lifts 10 % (it would run wide).
    if (Math.abs(dT - lineAt(line.d, line, v.s + ld, L)) > 2 && Math.abs(lineAt(line.curvature, line, v.s + ld, L)) > 0.003) vT *= 0.9;
    if (dsA > 0 && dsA < 15 && Math.abs(ai.vehicle.d - v.d) < 2.2) vT = Math.min(vT, ai.vehicle.speed + 0.5 * (dsA - 10));
    const e = vT - v.speed;
    out.throttle = e > 0 ? Math.min(1, 0.2 + 0.3 * e) : 0;
    out.brake = e < -1 ? Math.min(1, -0.25 * e) : 0;
    out.gearUp = false; out.gearDown = false; out.drsRequest = false; out.ersOvertake = false; out.pitLimiter = false;
  };
  const r: Run = { contacts: 0, walls: 0, maxOut: -99, recoverS: 0, playerOut: -99 };
  const outOf = (s: number, d: number): number => {
    q.frameAt(s, fr);
    return d > 0 ? d - fr.halfWidthL : -d - fr.halfWidthR;
  };
  for (; tick < 10 * 240; tick++) {
    sim.step();
    w.events.drain((e) => {
      if (e.type === 'collision' && e.b >= 0) r.contacts++;
      if (e.type === 'collision' && e.b < 0 && e.a === ai.id) r.walls++;
    });
    r.maxOut = Math.max(r.maxOut, outOf(ai.vehicle.s, ai.vehicle.d));
    r.playerOut = Math.max(r.playerOut, outOf(pl.vehicle.s, pl.vehicle.d));
    if ((ai.ai.mode as string) === 'recover') r.recoverS += 1 / 240;
  }
  return r;
}

// [corner index, AI side]: inside and outside at several corner types (hairpin, fast sweeper, chicane entry).
const CASES: Record<Tid, [number, number][]> = {
  istanbul: [[2, 3.2], [2, -3.2], [3, -3.2], [8, -3.2], [10, 3.2], [11, -3.2], [12, -3.2]],
  lombardia: [[2, 3.2], [6, 3.2], [10, 3.2]],
  bosphorus: [[0, 3.2], [0, -3.2], [4, -3.2], [7, 3.2], [9, -3.2], [10, -3.2]],
};

for (const tid of ['istanbul', 'lombardia', 'bosphorus'] as const) {
  describe.skipIf(!trackReady(tid))(`AI keeps room inside the track (${tid})`, () => {
    it('player alongside on the inside / outside into a corner: AI stays on track, no contact', () => {
      const bad: string[] = [];
      for (const [ci, off] of CASES[tid]) {
        const r = run(tid, ci, off);
        const tag = `${tid} c${ci} ${off > 0 ? 'L' : 'R'}`;
        if (r.playerOut > 0.5) bad.push(`${tag}: scripted player off (${r.playerOut.toFixed(2)})`);
        if (r.maxOut > 0.5 || r.recoverS > 0 || r.walls > 0 || r.contacts > 0) {
          bad.push(`${tag}: out ${r.maxOut.toFixed(2)} m, recover ${r.recoverS.toFixed(1)} s, walls ${r.walls}, contacts ${r.contacts}`);
        }
      }
      expect(bad).toEqual([]);
    }, 120_000);
  });
}
