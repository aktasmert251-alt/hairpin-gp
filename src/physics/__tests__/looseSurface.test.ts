// User request 2026-10-17: the assisted presets are stable on asphalt, but on gravel/grass the car must be loose. Flat
// plane at 120 km/h, Intermediate assists, real keyboard filter; the surface under chosen wheels is gravel (set in the car's
// own frame, so it follows the car):
//   exit  = steer left + throttle; asphalt vs the outside REAR wheel on gravel → the rear steps out (more body slip);
//   entry = steer left + brake; asphalt vs both FRONT wheels on gravel → understeer/scrub (less yaw, no spin);
//   all   = steer left, coasting, every wheel on gravel → slides and scrubs speed more than on asphalt, no reset.

import { describe, expect, it } from 'vitest';
import type { GroundHit, TrackHint } from '../../contracts/track';
import { SIM_DT } from '../../contracts/sim';
import { ASSIST_PRESETS } from '../../core/settings/defaults';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { createFlatPlane } from './helpers/flatPlane';

type Where = 'none' | 'rearRight' | 'fronts' | 'all';

interface Out { beta: number; yaw: number; kmh: number; resets: number; /** Body slip at the end. */ betaEnd: number }

function run(where: Where, pedal: 'throttle' | 'brake' | 'none', seconds: number, steerS = seconds): Out {
  const track = createFlatPlane();
  const q = track.query;
  const base = q.ground.bind(q);
  // Car pose for the surface rule (updated before every tick).
  const pose = { x: 0, z: 0, yaw: 0 };
  q.ground = (x: number, z: number, hint: TrackHint, out: GroundHit): GroundHit => {
    base(x, z, hint, out);
    const dx = x - pose.x, dz = z - pose.z;
    const fwd = dx * Math.cos(pose.yaw) - dz * Math.sin(pose.yaw);
    const left = -dx * Math.sin(pose.yaw) - dz * Math.cos(pose.yaw);
    const loose = where === 'all' || (where === 'fronts' && fwd > 0.5) || (where === 'rearRight' && fwd < -0.5 && left < -0.3);
    if (loose) { out.surface = 'gravel'; out.inLimits = false; }
    return out;
  };
  const sim = createSim(
    defaultSessionConfig({ mode: 'timeTrial', aiCount: 0, weather: 'dry', assists: { ...ASSIST_PRESETS.intermediate } }),
    { track, skipLights: true },
  );
  const car = sim.world.state.cars[0]!;
  const p = sim.world.static.params[0]!;
  const v = car.vehicle;
  const sp = 120 / 3.6;
  v.x = 0; v.z = 0; v.yaw = 0; v.vx = sp; v.vz = 0; v.speed = sp; v.vLong = sp; v.vLat = 0; v.s = 0; v.d = 0; v.hint.s = 0;
  for (const w of v.wheels) w.omega = sp / p.wheelRadius;
  for (const t of v.tyres) { t.surfC = 95; t.coreC = 95; }
  v.gear = 3; v.clutch = 1;
  const resets = v.resetCount;
  const out: Out = { beta: 0, yaw: 0, kmh: 0, resets: 0, betaEnd: 0 };
  const c = car.controls;
  c.left = true;
  c.throttle = pedal === 'throttle';
  c.brake = pedal === 'brake';
  const N = Math.round(seconds / SIM_DT);
  let yaw = 0;
  for (let i = 0; i < N; i++) {
    pose.x = v.x; pose.z = v.z; pose.yaw = v.yaw;
    if (i === Math.round(steerS / SIM_DT)) c.left = false;
    sim.step();
    if (v.speed > 5) out.beta = Math.max(out.beta, Math.abs(Math.atan2(v.vLat, Math.abs(v.vLong))) * 57.3);
    yaw += Math.abs(v.yawRate) * SIM_DT;
  }
  out.yaw = yaw / seconds;
  out.kmh = v.speed * 3.6;
  out.betaEnd = Math.abs(Math.atan2(v.vLat, Math.abs(v.vLong))) * 57.3;
  out.resets = v.resetCount - resets;
  return out;
}

const fmt = (o: Out): string => `slip ${o.beta.toFixed(1)}° (end ${o.betaEnd.toFixed(1)}°) yaw ${o.yaw.toFixed(2)} rad/s end ${o.kmh.toFixed(0)} km/h`;

describe('loose surfaces on the assisted presets (gravel/grass)', () => {
  it('exit: the outside rear wheel on gravel lets the rear step out, and the car comes back', () => {
    // Turn in for 0.8 s, then unwind (the driver straightens up) with the throttle held.
    const a = run('none', 'throttle', 2.5, 0.8);
    const g = run('rearRight', 'throttle', 2.5, 0.8);
    console.log(`exit: asphalt ${fmt(a)} | rear-right on gravel ${fmt(g)}`);
    expect(a.beta).toBeLessThan(6);
    expect(g.beta).toBeGreaterThan(a.beta + 15);
    expect(g.beta).toBeLessThan(45); // a slide, not a spin
    expect(g.betaEnd).toBeLessThan(10);
    expect(g.resets).toBe(0);
  });

  it('entry: both fronts on gravel = understeer and scrub, no spin', () => {
    const a = run('none', 'brake', 1.5);
    const g = run('fronts', 'brake', 1.5);
    console.log(`entry: asphalt ${fmt(a)} | fronts on gravel ${fmt(g)}`);
    expect(g.yaw).toBeLessThan(0.8 * a.yaw);
    expect(g.beta).toBeLessThan(6);
    expect(g.resets).toBe(0);
  });

  it('all four on gravel while steering: slides and scrubs more speed than on asphalt, then no reset', () => {
    const a = run('none', 'none', 2.5);
    const g = run('all', 'none', 2.5);
    console.log(`all: asphalt ${fmt(a)} | gravel ${fmt(g)}`);
    expect(g.beta).toBeGreaterThan(a.beta + 15); // before the change: 7.8° (planted)
    expect(g.kmh).toBeLessThan(a.kmh - 15);
    expect(g.resets).toBe(0);
  });
});
