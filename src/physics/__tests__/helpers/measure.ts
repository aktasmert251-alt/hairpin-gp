// Bench measurement routines (planner-report §5.11), shared by benches.test.ts and the tuning script.

import type { VehicleParams } from '../../../contracts/vehicle';
import { createStraightTrack } from '../../../track/index';
import { createBench } from './benchWorld';
import { createFlatPlane } from './flatPlane';

const HZ = 240;

export function accelTimes(): { t100: number; t200: number; t300: number } {
  const b = createBench(createStraightTrack(20000), { assists: { tc: 'full', gearbox: 'auto' } });
  const inp = b.car.input;
  inp.throttle = 1;
  inp.ersMode = 'hotlap';
  let t100 = NaN, t200 = NaN, t300 = NaN;
  for (let i = 1; i <= 60 * HZ; i++) {
    b.step();
    const kmh = b.car.vehicle.speed * 3.6;
    const t = i / HZ;
    if (t100 !== t100 && kmh >= 100) t100 = t;
    if (t200 !== t200 && kmh >= 200) t200 = t;
    if (t300 !== t300 && kmh >= 300) { t300 = t; break; }
  }
  return { t100, t200, t300 };
}

/** Terminal speed (km/h). mode: 'ers' = ERS deploying (ES refilled), 'drs' = + DRS open, 'empty' = ES empty. */
export function topSpeed(mode: 'ers' | 'drs' | 'empty'): number {
  const b = createBench(createStraightTrack(40000), { assists: { tc: 'full', gearbox: 'auto' } });
  const inp = b.car.input;
  const v = b.car.vehicle;
  b.place(0, 0, 250);
  inp.throttle = 1;
  inp.ersMode = mode === 'empty' ? 'none' : 'hotlap';
  if (mode === 'drs') {
    b.car.race.drsZone = 0;
    inp.drsRequest = true;
  }
  let last = 0;
  for (let i = 1; i <= 120 * HZ; i++) {
    if (mode === 'empty') v.ers.socJ = 0;
    else {
      v.ers.socJ = 4e6;
      v.ers.deployedLapJ = 0;
    }
    b.step();
    if (i % (10 * HZ) === 0) {
      const kmh = v.speed * 3.6;
      if (Math.abs(kmh - last) < 0.05) break;
      last = kmh;
    }
  }
  return v.speed * 3.6;
}

/** Braking distance (m) from `fromKmh` to `toKmh` with full brake (ABS on), and the peak deceleration (g). */
export function braking(fromKmh: number, toKmh: number, abs = true): { dist: number; peakG: number } {
  const b = createBench(createStraightTrack(20000), { assists: { abs, gearbox: 'auto' } });
  b.place(100, 0, fromKmh);
  const v = b.car.vehicle;
  const inp = b.car.input;
  inp.throttle = 0;
  inp.brake = 1;
  inp.ersMode = 'none';
  const x0 = v.x;
  let peak = 0;
  let prev = v.speed;
  const win: number[] = [];
  for (let i = 0; i < 20 * HZ; i++) {
    b.step();
    const dec = (prev - v.speed) * HZ;
    prev = v.speed;
    win.push(dec);
    if (win.length > 12) win.shift();
    if (win.length === 12) {
      const avg = win.reduce((s, x) => s + x, 0) / win.length;
      if (avg > peak) peak = avg;
    }
    if (v.speed * 3.6 <= toKmh + 1e-9 || v.speed < 0.05) break;
  }
  return { dist: v.x - x0, peakG: peak / 9.81 };
}

/**
 * Steady lateral acceleration (g) at constant speed on the flat plane: slow steering ramp under a speed PI; the
 * best 0.5 s mean of v·r while the speed is held within 3 %, ignoring the last 0.75 s before a spin (rear slip
 * angle > 0.16 rad) so spin transients never count.
 */
export function lateralG(kmh: number, mod?: (p: VehicleParams) => void): { g: number; frontA: number; rearA: number; spun: boolean } {
  const b = createBench(createFlatPlane(), { assists: { tc: 'medium', abs: true, gearbox: 'auto', steering: false } });
  const p = b.world.static.params[0]!;
  mod?.(p);
  b.place(0, 0, kmh);
  const v = b.car.vehicle;
  const inp = b.car.input;
  inp.ersMode = 'none';
  const target = kmh / 3.6;
  let integ = 0;
  const steps = 14 * HZ;
  const W = HZ / 2;
  const ay: number[] = [];
  const fa: number[] = [];
  const ra: number[] = [];
  let spun = false;
  for (let i = 0; i < steps; i++) {
    const e = target - v.speed;
    integ += e / HZ;
    inp.throttle = Math.max(0, Math.min(1, 0.4 * e + 0.3 * integ + 0.2));
    inp.brake = 0;
    inp.steer = Math.min(p.maxSteerRad, (i / steps) * (kmh < 150 ? 0.3 : 0.12)) / p.maxSteerRad;
    b.step();
    if (Math.abs(v.wheels[2].slipAngle) > 0.16 || Math.abs(v.wheels[3].slipAngle) > 0.16) {
      spun = true;
      break;
    }
    ay.push(Math.abs(v.speed - target) < 0.03 * target ? Math.abs(v.speed * v.yawRate) : 0);
    fa.push(Math.max(Math.abs(v.wheels[0].slipAngle), Math.abs(v.wheels[1].slipAngle)));
    ra.push(Math.max(Math.abs(v.wheels[2].slipAngle), Math.abs(v.wheels[3].slipAngle)));
  }
  const end = spun ? ay.length - Math.round(0.75 * HZ) : ay.length;
  let best = 0;
  let at = 0;
  let sum = 0;
  for (let i = 0; i < end; i++) {
    sum += ay[i]!;
    if (i >= W) sum -= ay[i - W]!;
    if (i >= W - 1 && sum / W > best) {
      best = sum / W;
      at = i;
    }
  }
  return { g: best / 9.81, frontA: fa[at] ?? 0, rearA: ra[at] ?? 0, spun };
}
