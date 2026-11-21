// Replay player (CR-01, L8): interpolated, allocation-free frameAt (after the first call sized `out`).
// `t` is seconds since the first recorded frame. Continuous fields lerp (direction vectors nlerp); discrete fields
// (gear, compound, surfaces, flags, order) and wheel spin angles (they alias at 60 Hz) come from the earlier frame.

import type { CarRenderState, RenderFrame } from '../../contracts/render';
import { REPLAY_CAR_STRIDE, type ReplayData, type ReplayFrame, type ReplayPlayer } from '../../contracts/replay';
import type { SimEvent } from '../../contracts/sim';
import { COMPOUNDS, GLOBAL_STRIDE, O, PHASES, SURFACES } from './recorder';

function newCar(id: number, teamId: string, num: number, tcam: 'black' | 'yellow', isPlayer: boolean): CarRenderState {
  return {
    id, visible: true, isPlayer, isGhost: false, ghostAlpha: 1, px: 0, py: 0, pz: 0, fx: 1, fy: 0, fz: 0, ux: 0, uy: 1, uz: 0,
    speed: 0, steerAngle: 0, wheelSpin: [0, 0, 0, 0], susp: [0, 0, 0, 0], rpm: 0, gear: 1, throttle: 0, brake: 0, drsFlap: 0,
    brakeGlow: [0, 0, 0, 0], rainLight: 0, compound: 'medium', slip: [0, 0, 0, 0], wheelSurface: ['asphalt', 'asphalt', 'asphalt', 'asphalt'],
    sparks: 0, inPitBox: false, teamId, number: num, tcam, ersKw: 0, pitLimiter: false,
  };
}

/** An empty frame sized for `d` (callers reuse it with frameAt). */
export function createReplayFrame(d: ReplayData): ReplayFrame {
  return {
    t: 0, raceMs: 0, phase: 'grid', lights: { lit: 0, out: false },
    conditions: { tod: d.config.tod, rain: 0, wetness: 0, lineWetness: 0, cloud: 0, time: 0 },
    cars: d.meta.map((m) => newCar(m.id, m.teamId, m.number, m.tcam, m.isPlayer)),
    order: d.meta.map((_, i) => i), laps: d.meta.map(() => 0),
  };
}

export function createReplayPlayer(d: ReplayData): ReplayPlayer {
  const n = d.meta.length;
  const S = REPLAY_CAR_STRIDE;
  const cars = d.cars;
  const g = d.global;
  const last = Math.max(0, d.frameCount - 1);
  // Layout offsets as locals (≈ 3× faster frameAt than namespace lookups under the vitest/Vite module transform).
  const { brake: o_brake, brakeGlow: o_brakeGlow, compound: o_compound, drsFlap: o_drsFlap, ersKw: o_ersKw, gear: o_gear, laps: o_laps, pitFlags: o_pitFlags, position: o_position, rainLight: o_rainLight, rpm: o_rpm, slip: o_slip, sparks: o_sparks, speed: o_speed, steer: o_steer, surface: o_surface, susp: o_susp, throttle: o_throttle, visible: o_visible, wheelSpin: o_wheelSpin } = O;
  const surfaces = SURFACES, compounds = COMPOUNDS, phases = PHASES, GS = GLOBAL_STRIDE;

  return {
    data: d,
    duration: () => last / d.hz,
    frameAt(t, out) {
      if (out.cars.length !== n) {
        const fresh = createReplayFrame(d);
        out.cars = fresh.cars;
        out.order = fresh.order;
        out.laps = fresh.laps;
      }
      const x = Math.min(last, Math.max(0, t * d.hz));
      let i = Math.floor(x + 1e-6);
      let f = x - i;
      if (f < 1e-6) f = 0;
      if (i >= last) {
        i = last;
        f = 0;
      }
      const j = f > 0 ? i + 1 : i;
      const u = 1 - f;
      out.t = i / d.hz + f / d.hz;
      const ga = i * GS, gb = j * GS;
      out.raceMs = (g[ga + 0]! * u + g[gb + 0]! * f);
      out.phase = phases[g[ga + 1]! | 0] ?? 'running';
      out.lights.lit = g[ga + 2]!;
      out.lights.out = g[ga + 3]! > 0.5;
      const c = out.conditions;
      c.tod = d.config.tod;
      c.rain = (g[ga + 4]! * u + g[gb + 4]! * f);
      c.wetness = (g[ga + 5]! * u + g[gb + 5]! * f);
      c.lineWetness = (g[ga + 6]! * u + g[gb + 6]! * f);
      c.cloud = (g[ga + 7]! * u + g[gb + 7]! * f);
      c.time = d.startTime + out.t;
      for (let k = 0; k < n; k++) {
        const a = (i * n + k) * S, b = (j * n + k) * S;
        const cs = out.cars[k]!;
        cs.px = (cars[a + 0]! * u + cars[b + 0]! * f); cs.py = (cars[a + 1]! * u + cars[b + 1]! * f); cs.pz = (cars[a + 2]! * u + cars[b + 2]! * f);
        let fx = (cars[a + 3]! * u + cars[b + 3]! * f), fy = (cars[a + 4]! * u + cars[b + 4]! * f), fz = (cars[a + 5]! * u + cars[b + 5]! * f), ux = (cars[a + 6]! * u + cars[b + 6]! * f), uy = (cars[a + 7]! * u + cars[b + 7]! * f), uz = (cars[a + 8]! * u + cars[b + 8]! * f);
        if (f > 0) {
          const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1; // not Math.hypot: it boxes its arguments
          fx /= fl; fy /= fl; fz /= fl;
          const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
          ux /= ul; uy /= ul; uz /= ul;
        }
        cs.fx = fx; cs.fy = fy; cs.fz = fz; cs.ux = ux; cs.uy = uy; cs.uz = uz;
        cs.speed = (cars[a + o_speed]! * u + cars[b + o_speed]! * f);
        cs.steerAngle = (cars[a + o_steer]! * u + cars[b + o_steer]! * f);
        for (let w = 0; w < 4; w++) {
          cs.wheelSpin[w] = cars[a + o_wheelSpin + w]!;
          cs.susp[w] = (cars[a + o_susp + w]! * u + cars[b + o_susp + w]! * f);
          cs.brakeGlow[w] = (cars[a + o_brakeGlow + w]! * u + cars[b + o_brakeGlow + w]! * f);
          cs.slip[w] = (cars[a + o_slip + w]! * u + cars[b + o_slip + w]! * f);
          cs.wheelSurface[w] = surfaces[cars[a + o_surface + w]! | 0] ?? 'asphalt';
        }
        cs.rpm = (cars[a + o_rpm]! * u + cars[b + o_rpm]! * f);
        cs.gear = cars[a + o_gear]!;
        cs.throttle = (cars[a + o_throttle]! * u + cars[b + o_throttle]! * f);
        cs.brake = (cars[a + o_brake]! * u + cars[b + o_brake]! * f);
        cs.drsFlap = (cars[a + o_drsFlap]! * u + cars[b + o_drsFlap]! * f);
        cs.rainLight = cars[a + o_rainLight]! as 0 | 1 | 2;
        cs.compound = compounds[cars[a + o_compound]! | 0] ?? 'medium';
        cs.sparks = (cars[a + o_sparks]! * u + cars[b + o_sparks]! * f);
        const pf = cars[a + o_pitFlags]!;
        cs.inPitBox = (pf & 1) !== 0;
        cs.pitLimiter = (pf & 2) !== 0;
        cs.ersKw = (cars[a + o_ersKw]! * u + cars[b + o_ersKw]! * f);
        cs.visible = cars[a + o_visible]! > 0.5;
        const pos = cars[a + o_position]! | 0;
        if (pos >= 1 && pos <= n) out.order[pos - 1] = k;
        out.laps[k] = cars[a + o_laps]!;
      }
      return out;
    },
    toRenderFrame(f, playerId, out: RenderFrame) {
      out.time = d.startTime + f.t;
      out.alpha = 1;
      out.cars = f.cars;
      for (let k = 0; k < f.cars.length; k++) f.cars[k]!.isPlayer = f.cars[k]!.id === playerId;
      out.playerId = playerId;
      out.conditions = f.conditions;
      out.lights.lit = f.lights.lit;
      out.lights.out = f.lights.out;
      out.paused = false;
      return out;
    },
    eventsIn(t0, t1, cb: (t: number, e: SimEvent) => void) {
      const ev = d.events;
      for (let k = 0; k < ev.length; k++) {
        const x = ev[k]!;
        if (x.t >= t0 && x.t < t1) cb(x.t, x.e);
      }
    },
  };
}
