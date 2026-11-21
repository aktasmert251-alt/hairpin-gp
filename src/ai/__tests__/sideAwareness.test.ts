// User bug (2026-10-13): "AI çizgiye gelirken yanında ben olsam da ben yokmuşum gibi bana temas ediyor". An AI car
// returning to its racing line (after a move, on corner entry, rejoining) drove into the player's car alongside it.
// A scripted keyboard player holds a fixed lateral position next to an AI car; the AI must leave room (no contact,
// ≥ 0.8 m body-to-body while overlapping; its own target is 1.2 m) and still race its line once clear.

import { describe, expect, it } from 'vitest';
import type { SimRunner, SimWorld } from '../../contracts/sim';
import type { TrackFrame } from '../../contracts/track';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { teleportCar } from '../../game/sim/teleport';
import { MODULE_STATUS as TRACK_STATUS, loadTrack } from '../../track/index';
import { lineAt } from '../line/racingLine';

const istanbulReady = TRACK_STATUS !== 'stub' && loadTrack().data.id === 'istanbul';
const WIDTH = 2.0;
const LEN = 5.6;

interface Run { contacts: number; minGap: number; overlapS: number; aiFinalOff: number; playerErr: number }

/** The player car (scripted) holds main-track d = `pd` and keeps level with the AI (car 1), which starts at line + `aiOff`. */
function run(s0: number, pd: number, aiOff: number, kmh: number, seconds: number, ds0 = 0, fromGrid = false): Run {
  const sim: SimRunner = createSim(
    defaultSessionConfig({ mode: 'race', aiCount: 1, seed: 7, laps: 3, difficulty: 90, autodrive: false, gridPos: 1 }),
    { skipLights: !fromGrid },
  );
  const w: SimWorld = sim.world;
  const q = w.static.track.query;
  const line = w.static.ai.getRacingLine();
  const L = q.length;
  const cars = w.state.cars;
  const pl = cars.find((c) => c.isPlayer)!;
  const ai = cars.find((c) => !c.isPlayer)!;
  if (fromGrid) {
    // Standing start from the grid: the player keeps its grid lateral position into T1, the AI starts beside / behind.
    pd = pl.vehicle.d;
    ds0 = q.deltaS(pl.vehicle.s, ai.vehicle.s);
  } else {
    teleportCar(w, pl.id, s0, pd, kmh);
    const aiD = lineAt(line.d, line, s0 + ds0, L) + aiOff;
    teleportCar(w, ai.id, s0 + ds0, aiD, kmh);
    ai.ai.mode = 'race';
    ai.ai.laneOffset = aiOff;
    ai.ai.laneTarget = aiOff;
  }
  // Scripted 'player' (the player's car, driven by this script instead of the keyboard so it holds its line exactly):
  // pure pursuit to main d = pd 20–40 m ahead, level with the AI car (speed target = AI speed + gap term), capped by
  // what its own constant-d line allows (2.5 g, 30 m/s² braking).
  pl.control = 'ai';
  const mod = w.static.ai;
  const orig = mod.computeInput.bind(mod);
  const tgt = { x: 0, y: 0, z: 0 };
  const p = w.static.params[pl.id]!;
  mod.computeInput = (world, carId, out) => {
    if (carId !== pl.id) return orig(world, carId, out);
    const v = pl.vehicle;
    const ld = Math.max(20, 0.6 * v.speed);
    q.worldFromSD(v.s + ld, pd, tgt);
    const dx = tgt.x - v.x, dz = tgt.z - v.z;
    const lat = dx * -Math.sin(v.yaw) + dz * -Math.cos(v.yaw);
    const kpp = (2 * lat) / (dx * dx + dz * dz);
    out.steer = Math.max(-1, Math.min(1, Math.atan(p.wheelbase * kpp) / p.maxSteerRad));
    const dsA = q.deltaS(v.s, ai.vehicle.s);
    let vT = ai.vehicle.speed + 0.8 * (dsA - ds0);
    // A driver, not a ram: with the AI car ahead in its lane, drop back to a 10 m gap.
    if (dsA > 0 && Math.abs(ai.vehicle.d - v.d) < 2.2) vT = Math.min(vT, ai.vehicle.speed + 0.5 * (dsA - 10));
    for (let k = 0; k < 1.2 * v.speed + 20; k += 2) {
      const kap = q.frameAt(v.s + k, look).curvature;
      const kd = Math.abs(kap / (1 - kap * pd));
      const vc = Math.sqrt(20 / (kd > 1e-4 ? kd : 1e-4) + 2 * 30 * Math.max(0, k - 0.3 * v.speed));
      if (vc < vT) vT = vc;
    }
    const ph = world.state.race.phase;
    if (ph === 'grid' || ph === 'lights') vT = 0;
    const e = vT - v.speed;
    out.throttle = e > 0 ? Math.min(1, 0.2 + 0.3 * e) : 0;
    out.brake = e < -1 ? Math.min(1, -0.15 * e) : 0;
    out.gearUp = false; out.gearDown = false; out.drsRequest = false; out.ersOvertake = false; out.pitLimiter = false;
  };
  const r: Run = { contacts: 0, minGap: Infinity, overlapS: 0, aiFinalOff: 0, playerErr: 0 };
  const steps = seconds * 240;
  for (let i = 0; i < steps; i++) {
    sim.step();
    w.events.drain((e) => {
      if (e.type === 'collision' && e.b >= 0) r.contacts++;
    });
    const dsN = q.deltaS(pl.vehicle.s, ai.vehicle.s);
    if (Math.abs(dsN) < LEN - 1) {
      const gap = Math.abs(ai.vehicle.d - pl.vehicle.d) - WIDTH;
      if (gap < r.minGap) r.minGap = gap;
      r.overlapS += 1 / 240;
    }
    if (i > 240) r.playerErr = Math.max(r.playerErr, Math.abs(pl.vehicle.d - pd));
  }
  r.aiFinalOff = ai.vehicle.d - lineAt(line.d, line, ai.vehicle.s, L);
  return r;
}

const look: TrackFrame = { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 };

describe.skipIf(!istanbulReady)('AI side awareness vs a player car alongside', () => {
  it('straight merge: AI 3.2 m off its line beside the player on the line does not merge into the player', () => {
    // Back straight before T9 (line −6.1 m): the player sits on the racing line, the AI just finished a move 2.8 m left.
    const r = run(2860, -6.0, 3.2, 250, 5);
    console.log(`straight merge: contacts ${r.contacts} min body gap ${r.minGap.toFixed(2)} m overlap ${r.overlapS.toFixed(1)} s player err ${r.playerErr.toFixed(2)}`);
    expect(r.overlapS).toBeGreaterThan(2);
    expect(r.contacts).toBe(0);
    expect(r.minGap).toBeGreaterThan(0.8);
  });

  it('corner entry: AI on the line outside does not turn in across the player on the inside (T11)', () => {
    // T11 (right, R 71 m): line +6 m at 3700 → apex −6 m at 3880. Player holds −1.5 m (inside), AI on its line.
    const r = run(3690, -1.5, 0, 200, 5);
    console.log(`corner entry: contacts ${r.contacts} min body gap ${r.minGap.toFixed(2)} m overlap ${r.overlapS.toFixed(1)} s player err ${r.playerErr.toFixed(2)}`);
    expect(r.overlapS).toBeGreaterThan(2);
    expect(r.contacts).toBe(0);
    expect(r.minGap).toBeGreaterThan(0.8);
  });

  it('start: the AI does not cut across the player holding its grid column into T1', () => {
    // Lights (~8 s) to the T1 apex: the scripted player cannot hold the inside of the 20 m T1 apex itself.
    const r = run(0, 0, 0, 0, 16, 0, true);
    console.log(`start: contacts ${r.contacts} min body gap ${r.minGap.toFixed(2)} m overlap ${r.overlapS.toFixed(1)} s player err ${r.playerErr.toFixed(2)}`);
    expect(r.contacts).toBe(0);
    if (r.overlapS > 0) expect(r.minGap).toBeGreaterThan(0.8);
  });

  it('once clear (no car alongside) the AI is back on its line', () => {
    // Player far away (100 m behind): nothing to respect, the AI returns from 2.8 m to its line within 4 s.
    const r = run(2760, -6.0, 2.8, 250, 4, 100);
    expect(Math.abs(r.aiFinalOff)).toBeLessThan(0.6);
  });
});
