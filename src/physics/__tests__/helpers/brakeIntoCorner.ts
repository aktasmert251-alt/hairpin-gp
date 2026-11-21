// Open-loop brake-into-corner run (real keyboard filter) for brakeIntoCorner.test.ts. Test helper.

import { lineAt } from '../../../ai/line/racingLine';
import { SIM_DT } from '../../../contracts/sim';
import type { TrackBundle } from '../../../contracts/track';
import { ASSIST_PRESETS } from '../../../core/settings/defaults';
import { createSim, defaultSessionConfig } from '../../../game/index';
import { teleportCar } from '../../../game/sim/teleport';

export type Preset = keyof typeof ASSIST_PRESETS;
export type Pedal = 'hold' | 'release' | 'none';

export interface Run {
  /** Seconds the steer input was against the held key while β < 10°. */
  wrongS: number;
  /** Max rear slip angle / rear peak slip angle while the key is held. */
  rearPk: number;
  /** Max body slip, degrees. */
  beta: number;
  /** Mean |yaw rate| while the key is held, rad/s. */
  yaw: number;
  /** Distance travelled from the brake press until the speed fell to 60 % of the start speed (m; NaN if never). */
  dist: number;
}

export interface Setup { track?: TrackBundle; trackId?: 'istanbul' | 'lombardia'; corner?: number }

export function run(preset: Preset, kmh: number, delayS: number, pedal: Pedal, left: boolean, setup: Setup = {}): Run {
  const sim = createSim(
    defaultSessionConfig({ mode: 'timeTrial', aiCount: 0, weather: 'dry', trackId: setup.trackId ?? 'istanbul', assists: { ...ASSIST_PRESETS[preset] } }),
    { skipLights: true, track: setup.track },
  );
  const w = sim.world;
  const car = w.state.cars[0]!;
  const p = w.static.params[0]!;
  const v = car.vehicle;
  const c = car.controls;
  if (setup.corner !== undefined) {
    const q = w.static.track.query;
    const line = w.static.ai.getProfile(0).line;
    const k = w.static.track.data.corners.find((x) => x.n === setup.corner)!;
    const s0 = k.entryS - 0.6 * (kmh / 3.6);
    teleportCar(w, 0, s0, lineAt(line.d, line, s0, q.length), kmh);
    left = k.dir === 'L';
  } else {
    const sp = kmh / 3.6;
    v.vx = sp; v.speed = sp; v.vLong = sp;
    for (const wh of v.wheels) wh.omega = sp / p.wheelRadius;
    v.clutch = 1;
    for (let g = 1; g <= p.gearRatios.length; g++) {
      v.gear = g;
      if ((sp / p.wheelRadius) * p.gearRatios[g - 1]! * p.finalDrive * 60 / (2 * Math.PI) < 11000) break;
    }
  }
  for (const t of v.tyres) { t.surfC = 95; t.coreC = 95; }
  const comp = p.compounds[v.compound];
  const apkR = comp.slipAnglePeak * (p.tuning?.rearAlphaFactor ?? 1);
  const out: Run = { wrongS: 0, rearPk: 0, beta: 0, yaw: 0, dist: NaN };
  let travelled = 0, px = v.x, pz = v.z;
  const v0 = v.speed;
  const delay = Math.round(delayS / SIM_DT);
  const N = delay + Math.round(1.2 / SIM_DT);
  let yawSum = 0, n = 0, duty = 0;
  for (let i = 0; i < N; i++) {
    const keyOn = i >= delay;
    if (pedal === 'hold') c.brake = true;
    else if (pedal === 'release') {
      // Progressive release once the key is down: brake-key duty falls from 1 to 0 over 1 s (pulsed in 4-tick slots).
      if (!keyOn) c.brake = true;
      else if (i % 4 === 0) {
        duty += Math.max(0, 1 - (i - delay) * SIM_DT);
        c.brake = duty >= 1;
        if (c.brake) duty -= 1;
      }
    } else c.brake = false;
    c.left = keyOn && left;
    c.right = keyOn && !left;
    sim.step();
    travelled += Math.hypot(v.x - px, v.z - pz);
    px = v.x; pz = v.z;
    if (out.dist !== out.dist && v.speed <= 0.6 * v0) out.dist = travelled;
    if (!keyOn) continue;
    if (v.wallImpulse > 0 || v.offTrackWheels >= 3) break;
    const beta = Math.abs(Math.atan2(v.vLat, Math.abs(v.vLong))) * 57.3;
    if (beta > out.beta) out.beta = beta;
    const steerSign = car.input.steer * (left ? 1 : -1);
    if (steerSign < -0.01 && beta < 10) out.wrongS += SIM_DT;
    const ar = Math.max(Math.abs(v.wheels[2].slipAngle), Math.abs(v.wheels[3].slipAngle)) / apkR;
    if (ar > out.rearPk) out.rearPk = ar;
    yawSum += Math.abs(v.yawRate);
    n++;
  }
  out.yaw = n > 0 ? yawSum / n : 0;
  return out;
}

export const fmt = (r: Run): string => `wrong ${r.wrongS.toFixed(2)} s rear ${r.rearPk.toFixed(2)}×pk β ${r.beta.toFixed(1)}° yaw ${r.yaw.toFixed(2)} dist60 ${r.dist.toFixed(1)} m`;

