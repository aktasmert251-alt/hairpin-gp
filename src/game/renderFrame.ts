// RenderFrame builder (glue, docs/ARCHITECTURE.md §5.3): one long-lived RenderFrame refilled in place each
// frame by interpolating the previous and current sim poses with `alpha`. Allocation-free in build().

import type { SpeedProfile } from '../contracts/ai';
import type { ConditionsFrame } from '../contracts/conditions';
import { wrapAngle } from '../contracts/frames';
import type { CarRenderState, RenderFrame } from '../contracts/render';
import { SIM_DT, type SimRunner, type SimWorld } from '../contracts/sim';
import { conditionsFrame } from '../race/conditions';
import { PARK_X } from '../race/rules';

export interface CarStaticSpec { number: number; tcam: 'black' | 'yellow' }

/** D-056: team id of the safety car's render slot (graphics: a dedicated livery; unknown teams fall back to the first team). */
export const SAFETY_CAR_TEAM = 'safetyCar';

export interface RenderFrameBuilder {
  readonly frame: RenderFrame;
  /** Before every tick: remember the current pose as the previous one. */
  savePrev(): void;
  /** After a teleport/restore: make prev = current so nothing smears (one car or all). */
  snapPrev(car?: number): void;
  build(alpha: number, frameDt: number, paused: boolean): RenderFrame;
}

function newCarState(id: number, isPlayer: boolean, teamId: string, spec: CarStaticSpec): CarRenderState {
  return {
    id, visible: true, isPlayer, isGhost: false, ghostAlpha: 1,
    px: 0, py: 0, pz: 0, fx: 1, fy: 0, fz: 0, ux: 0, uy: 1, uz: 0,
    speed: 0, steerAngle: 0, wheelSpin: [0, 0, 0, 0], susp: [0, 0, 0, 0], rpm: 0, gear: 1, throttle: 0, brake: 0,
    drsFlap: 0, brakeGlow: [0, 0, 0, 0], rainLight: 0, compound: 'medium', slip: [0, 0, 0, 0],
    wheelSurface: ['asphalt', 'asphalt', 'asphalt', 'asphalt'], sparks: 0, inPitBox: false, teamId, number: spec.number, tcam: spec.tcam,
    ersKw: 0, pitLimiter: false,
  };
}

/**
 * Fills one car's render state from the sim at the given (interpolated) pose. Shared by the live frame builder and
 * the replay recorder (CR-01), so both describe a car identically. Allocation-free.
 */
export function fillCarRenderState(world: SimWorld, i: number, cs: CarRenderState, x: number, y: number, z: number, yaw: number, pitch: number, roll: number): void {
  const car = world.state.cars[i]!;
  const v = car.vehicle;
  const wet = world.state.conditions.wetness;
  const rain = world.state.conditions.rain;
  // D-056: a retired car the marshals removed is parked far off the map; do not draw it (online also an absent remote car).
  cs.visible = !(car.vehicle.x >= PARK_X * 0.5);
  cs.px = x;
  cs.py = y;
  cs.pz = z;
  // Ground normal n, horizontal heading h projected onto the ground plane, then pitch and roll.
  let nx = v.nx, ny = v.ny, nz = v.nz;
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  const hx = Math.cos(yaw), hz = -Math.sin(yaw);
  const hn = hx * nx + hz * nz;
  let f0x = hx - hn * nx, f0y = -hn * ny, f0z = hz - hn * nz;
  const fl = Math.sqrt(f0x * f0x + f0y * f0y + f0z * f0z) || 1;
  f0x /= fl; f0y /= fl; f0z /= fl;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const fx = f0x * cp + nx * sp, fy = f0y * cp + ny * sp, fz = f0z * cp + nz * sp;
  const u0x = nx * cp - f0x * sp, u0y = ny * cp - f0y * sp, u0z = nz * cp - f0z * sp;
  // left = up × fwd
  const lx = u0y * fz - u0z * fy, ly = u0z * fx - u0x * fz, lz = u0x * fy - u0y * fx;
  const cr = Math.cos(roll), sr = Math.sin(roll);
  cs.fx = fx; cs.fy = fy; cs.fz = fz;
  cs.ux = u0x * cr - lx * sr; cs.uy = u0y * cr - ly * sr; cs.uz = u0z * cr - lz * sr;
  cs.speed = v.speed;
  cs.steerAngle = v.steerAngle;
  cs.rpm = v.rpm;
  cs.gear = v.gear;
  cs.throttle = car.input.throttle;
  cs.brake = car.input.brake;
  cs.drsFlap = v.drs.flap;
  cs.compound = v.compound;
  cs.sparks = v.sparks;
  cs.inPitBox = car.pit.phase === 'stationary';
  cs.ersKw = v.ers.deployKw - v.ers.harvestKw;
  cs.pitLimiter = v.pitLimiterOn;
  const p = world.static.params[i]!;
  const comp = p.compounds[v.compound];
  // D-023: the rear tyres peak at αpk × rearAlphaFactor.
  const tanPkF = Math.tan(comp.slipAnglePeak);
  const tanPkR = Math.tan(comp.slipAnglePeak * (p.tuning?.rearAlphaFactor ?? 1));
  for (let k = 0; k < 4; k++) {
    const w = v.wheels[k]!;
    cs.wheelSpin[k] = w.spin;
    cs.susp[k] = w.susp;
    const g = (w.brakeTempC - 550) / 450;
    cs.brakeGlow[k] = g < 0 ? 0 : g > 1 ? 1 : g;
    const sx = w.slipRatio / comp.slipRatioPeak;
    const sy = Math.tan(w.slipAngle) / (k >= 2 ? tanPkR : tanPkF);
    cs.slip[k] = Math.sqrt(sx * sx + sy * sy);
    cs.wheelSurface[k] = w.surface;
  }
  cs.rainLight = v.pitLimiterOn || (v.ers.harvestKw > 100 && car.input.throttle > 0.9) ? 2 : wet > 0.15 || rain > 0.1 ? 1 : 0;
}

/** `ghost`: appends one isGhost car (id = car count) after the sim cars; its pose is written by the Time Trial glue. */
export function createRenderFrameBuilder(
  sim: SimRunner, specs: readonly CarStaticSpec[], playerId: number, profile: SpeedProfile | null, ghost?: { teamId: string; spec: CarStaticSpec },
  safetyCar?: CarStaticSpec,
): RenderFrameBuilder {
  const cars = sim.world.state.cars;
  const n = cars.length;
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const pz = new Float64Array(n);
  const pyaw = new Float64Array(n);
  const ppitch = new Float64Array(n);
  const proll = new Float64Array(n);
  const conditions: ConditionsFrame = { tod: 'day', rain: 0, wetness: 0, lineWetness: 0, cloud: 0, time: 0 };
  const frame: RenderFrame = {
    time: 0, frameDt: 0, alpha: 0,
    cars: cars.map((c, i) => newCarState(c.id, c.isPlayer, c.teamId, specs[i]!)),
    playerId, conditions,
    lights: { lit: 0, out: false },
    yellowSectors: [false, false, false],
    paused: false,
    racingLine: { mode: 'off', profile, playerS: 0, playerSpeed: 0 },
    // CR-02: filled by the session after cameraRig.update.
    view: 'chaseNear',
    lookBack: false,
  };

  const savePrev = (): void => {
    for (let i = 0; i < n; i++) {
      const v = cars[i]!.vehicle;
      px[i] = v.x; py[i] = v.y; pz[i] = v.z;
      pyaw[i] = v.yaw; ppitch[i] = v.pitch; proll[i] = v.roll;
    }
  };

  const snapPrev = (car?: number): void => {
    if (car === undefined) {
      savePrev();
      return;
    }
    const v = cars[car]!.vehicle;
    px[car] = v.x; py[car] = v.y; pz[car] = v.z;
    pyaw[car] = v.yaw; ppitch[car] = v.pitch; proll[car] = v.roll;
  };

  const build = (alpha: number, frameDt: number, paused: boolean): RenderFrame => {
    const st = sim.world.state;
    const race = st.race;
    const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    for (let i = 0; i < n; i++) {
      const v = cars[i]!.vehicle;
      const yaw = pyaw[i]! + wrapAngle(v.yaw - pyaw[i]!) * a;
      fillCarRenderState(sim.world, i, frame.cars[i]!,
        px[i]! + (v.x - px[i]!) * a, py[i]! + (v.y - py[i]!) * a, pz[i]! + (v.z - pz[i]!) * a,
        yaw, ppitch[i]! + (v.pitch - ppitch[i]!) * a, proll[i]! + (v.roll - proll[i]!) * a);
    }
    frame.time = st.time;
    frame.frameDt = frameDt;
    frame.alpha = a;
    conditionsFrame(st.conditions, st.time, conditions);
    frame.lights.lit = race.lightsLit;
    frame.lights.out = race.phase !== 'grid' && race.phase !== 'lights' && race.raceMs - race.lightsOutAtMs < 2000 && race.lightsOutAtMs > 0;
    frame.yellowSectors[0] = race.yellow[0];
    frame.yellowSectors[1] = race.yellow[1];
    frame.yellowSectors[2] = race.yellow[2];
    frame.paused = paused;
    const pv = cars[playerId]!.vehicle;
    frame.racingLine.playerS = pv.s;
    frame.racingLine.playerSpeed = pv.speed;
    poseSafetyCar(a, frameDt);
    return frame;
  };

  if (ghost) {
    const g = newCarState(n, false, ghost.teamId, ghost.spec);
    g.isGhost = true;
    g.visible = false;
    frame.cars.push(g);
  }
  // D-056: the safety car, an extra render slot posed on the AI racing line from race.sc (races only).
  const scCar = safetyCar ? newCarState(frame.cars.length, false, SAFETY_CAR_TEAM, safetyCar) : null;
  if (scCar) {
    scCar.visible = false;
    frame.cars.push(scCar);
  }
  const line = scCar ? sim.world.static.ai.getRacingLine() : null;
  let scSpin = 0;
  const poseSafetyCar = (a: number, frameDt: number): void => {
    if (!scCar || !line || line.count < 2) return;
    const sc = sim.world.state.race.sc;
    scCar.visible = sc.phase !== 'none' && sc.onTrack;
    if (!scCar.visible) return;
    const L = sim.world.static.track.query.length;
    const p = sc.progress - sc.speed * SIM_DT * (1 - a);
    const s = p - Math.floor(p / L) * L;
    const f = s / line.ds;
    const i0 = Math.floor(f) % line.count;
    const i1 = (i0 + 1) % line.count;
    const k = f - Math.floor(f);
    scCar.px = line.x[i0]! + (line.x[i1]! - line.x[i0]!) * k;
    scCar.py = line.y[i0]! + (line.y[i1]! - line.y[i0]!) * k;
    scCar.pz = line.z[i0]! + (line.z[i1]! - line.z[i0]!) * k;
    let dx = line.x[i1]! - line.x[i0]!;
    let dy = line.y[i1]! - line.y[i0]!;
    let dz = line.z[i1]! - line.z[i0]!;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= dl;
    dy /= dl;
    dz /= dl;
    scCar.fx = dx;
    scCar.fy = dy;
    scCar.fz = dz;
    scCar.ux = 0;
    scCar.uy = 1;
    scCar.uz = 0;
    scCar.speed = sc.speed;
    scSpin = (scSpin + (sc.speed / 0.33) * frameDt) % (Math.PI * 2);
    scCar.wheelSpin[0] = scCar.wheelSpin[1] = scCar.wheelSpin[2] = scCar.wheelSpin[3] = scSpin;
    scCar.gear = 5;
    scCar.rpm = 8500;
    scCar.throttle = 0.4;
    scCar.rainLight = 2;
  };
  savePrev();
  return { frame, savePrev, snapPrev, build };
}
