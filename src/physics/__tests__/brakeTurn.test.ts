// User bug (2026-10-16): "braking while turning into a corner, the tyres still lock and the car slides". A binary-key bot
// (real keyboard filter, pure-pursuit steering keys on the racing line, brake key while faster than the d = 100 profile)
// arrives at 290–320 km/h at İstanbul T1 / T12 and Lombardia T1.
//   A = brake, then keep braking while turning in (trail braking to the profile speed);
//   C = brake, then release progressively towards the apex (pulsed brake key, duty falling to 0 at the apex, even if
//       still faster than the profile: İstanbul T1 then arrives ~15 km/h over the mid-corner speed).
// While the brake is applied (before any spin): no locked wheel, little tyre smoke (normalised slip σ > 1.15, the VFX
// threshold) and no slide. Assisted presets must also hold their line; on Expert (no ABS, no limiter, no steering assist)
// the keyboard lock guard keeps a held brake key from locking the wheels, and a straight stop is as short as with ABS.

import { describe, expect, it } from 'vitest';
import { lineAt } from '../../ai/line/racingLine';
import { SIM_DT } from '../../contracts/sim';
import { ASSIST_PRESETS } from '../../core/settings/defaults';
import { createSim, defaultSessionConfig } from '../../game/index';
import { teleportCar } from '../../game/sim/teleport';
import { MODULE_STATUS as TRACK_STATUS } from '../../track/index';
import { createFlatPlane } from './helpers/flatPlane';

type Preset = keyof typeof ASSIST_PRESETS;

interface Out { lock: number; smoke: number; beta: number; resets: number; /** Max body slip over the whole corner. */ betaAll: number }

function corner(trackId: 'istanbul' | 'lombardia', n: number, preset: Preset, mode: 'A' | 'C'): Out {
  const sim = createSim(defaultSessionConfig({ mode: 'timeTrial', aiCount: 0, trackId, weather: 'dry', assists: { ...ASSIST_PRESETS[preset] } }), { skipLights: true });
  const w = sim.world;
  const car = w.state.cars[0]!;
  const v = car.vehicle;
  const c = car.controls;
  const prof = w.static.ai.getProfile(0);
  const line = prof.line;
  const q = w.static.track.query;
  const L = q.length;
  const k = w.static.track.data.corners.find((x) => x.n === n)!;
  const p = w.static.params[0]!;
  const comp = p.compounds[v.compound];
  const tanF = Math.tan(comp.slipAnglePeak);
  const tanR = Math.tan(comp.slipAnglePeak * (p.tuning?.rearAlphaFactor ?? 1));
  const s0 = k.entryS - 450;
  teleportCar(w, 0, s0, lineAt(line.d, line, s0, L), 300);
  for (const t of v.tyres) { t.surfC = 95; t.coreC = 95; }
  const tgt = { x: 0, y: 0, z: 0 };
  const out: Out = { lock: 0, smoke: 0, beta: 0, resets: v.resetCount, betaAll: 0 };
  let duty = 0;
  let spun = false;
  for (let i = 0; i < 240 * 12 && q.deltaS(v.s, k.exitS + 30) > 0; i++) {
    if (i % 4 === 0) {
      const sp = v.speed;
      const ld = Math.max(10, 6 + 0.4 * sp);
      q.worldFromSD(v.s + ld, lineAt(line.d, line, v.s + ld, L), tgt);
      const dx = tgt.x - v.x, dz = tgt.z - v.z;
      const lat = dx * -Math.sin(v.yaw) + dz * -Math.cos(v.yaw);
      const want = Math.atan((3.6 * 2 * lat) / (dx * dx + dz * dz)) / 0.384;
      c.left = want > car.input.steer + 0.02;
      c.right = want < car.input.steer - 0.02;
      const vT = lineAt(prof.v, line, v.s + 0.15 * sp, L);
      let brake = sp > vT + 2;
      if (mode === 'C' && brake && q.deltaS(v.s, k.entryS) <= 0) {
        const f = q.deltaS(v.s, k.apexS) / Math.max(1, k.apexS - k.entryS);
        duty += f < 0 ? 0 : f > 1 ? 1 : f;
        brake = duty >= 1;
        if (brake) duty -= 1;
      }
      c.brake = brake;
      // A sensible keyboard driver: no full throttle with a lot of lock on.
      c.throttle = !brake && sp < vT - 0.5 && Math.abs(car.input.steer) < 0.2;
    }
    sim.step();
    const beta = Math.abs(Math.atan2(v.vLat, Math.abs(v.vLong))) * 57.3;
    if (beta > 20) spun = true;
    if (v.speed > 10 && q.deltaS(v.s, k.entryS - 250) <= 0 && beta > out.betaAll) out.betaAll = beta;
    if (spun || car.input.brake <= 0.05 || q.deltaS(v.s, k.entryS - 250) > 0) continue;
    let locked = false, smoke = false;
    for (let j = 0; j < 4; j++) {
      const wh = v.wheels[j]!;
      const sx = wh.slipRatio / comp.slipRatioPeak;
      const sy = Math.tan(wh.slipAngle) / (j >= 2 ? tanR : tanF);
      if (wh.locked || wh.slipRatio < -0.3) locked = true;
      if (Math.sqrt(sx * sx + sy * sy) > 1.15 && v.speed > 1.5) smoke = true;
    }
    if (locked) out.lock += SIM_DT;
    if (smoke) out.smoke += SIM_DT;
    if (beta > out.beta) out.beta = beta;
  }
  out.resets = v.resetCount - out.resets;
  return out;
}

/** Straight-line keyboard stop from 300 km/h on the flat plane: distance and locked time. */
function straightStop(preset: Preset): { dist: number; lock: number } {
  const sim = createSim(defaultSessionConfig({ mode: 'timeTrial', aiCount: 0, weather: 'dry', assists: { ...ASSIST_PRESETS[preset] } }), { track: createFlatPlane(), skipLights: true });
  const car = sim.world.state.cars[0]!;
  const p = sim.world.static.params[0]!;
  const v = car.vehicle;
  const sp = 300 / 3.6;
  v.x = 0; v.vx = sp; v.speed = sp; v.vLong = sp; v.gear = 8; v.clutch = 1;
  for (const w of v.wheels) w.omega = sp / p.wheelRadius;
  for (const t of v.tyres) { t.surfC = 95; t.coreC = 95; }
  car.controls.brake = true;
  let lock = 0;
  for (let i = 0; i < 240 * 8 && v.speed > 0.5; i++) {
    sim.step();
    if (v.wheels.some((w) => w.locked || w.slipRatio < -0.3)) lock += SIM_DT;
  }
  return { dist: v.x, lock };
}

const CORNERS = [['istanbul', 1], ['istanbul', 12], ['lombardia', 1]] as const;

describe.skipIf(TRACK_STATUS === 'stub')('braking into a corner with the keyboard (user bug 2026-10-16)', () => {
  it.each(['beginner', 'intermediate'] as const)('%s: trail braking (A) and progressive release (C): no lock, no slide', (preset) => {
    for (const [t, n] of CORNERS) {
      for (const m of ['A', 'C'] as const) {
        const r = corner(t, n, preset, m);
        console.log(`${preset} ${t} T${n} ${m}: lock ${r.lock.toFixed(2)} s smoke ${r.smoke.toFixed(2)} s slip ${r.beta.toFixed(1)}° (whole corner ${r.betaAll.toFixed(1)}°)`);
        expect(r.lock).toBe(0);
        expect(r.smoke).toBeLessThan(0.15);
        // C at İstanbul T1 runs ~10 % over the mid-corner limit after the release: the assisted car must stay in
        // (28° before any stability help, 8° with the slide-only window; ≤ 6° since the yaw limiter and ESC-lite,
        // 2026-10-19).
        expect(r.beta).toBeLessThan(6);
        expect(r.betaAll).toBeLessThan(6);
        expect(r.resets).toBe(0);
      }
    }
  }, 120_000);

  it('expert (no ABS): the keyboard lock guard keeps the wheels rolling while braking into the corner', () => {
    for (const [t, n] of CORNERS) {
      const r = corner(t, n, 'expert', 'C');
      console.log(`expert ${t} T${n} C: lock ${r.lock.toFixed(2)} s smoke ${r.smoke.toFixed(2)} s slip ${r.beta.toFixed(1)}°`);
      expect(r.lock).toBe(0);
      expect(r.smoke).toBeLessThan(0.2);
    }
  }, 120_000);

  it('expert straight stop from 300 km/h: at most a flash of lock at the stab, as short as with ABS (± 3 %)', () => {
    const e = straightStop('expert');
    const i = straightStop('intermediate');
    console.log(`straight stop: expert ${e.dist.toFixed(1)} m lock ${e.lock.toFixed(2)} s | intermediate ${i.dist.toFixed(1)} m lock ${i.lock.toFixed(2)} s`);
    expect(e.lock).toBeLessThan(0.1);
    expect(i.lock).toBe(0);
    expect(Math.abs(e.dist - i.dist) / i.dist).toBeLessThan(0.03);
  });
});
