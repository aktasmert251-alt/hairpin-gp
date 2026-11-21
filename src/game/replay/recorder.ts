// Replay recorder (CR-01, L8): every 4th sim tick (240 / 4 = 60 Hz) every car's render state goes into
// pre-allocated 600-frame chunks; capped at 8 min (28,800 frames). Glue-only extras: `event` (sim events with their
// time) and `truncate` (flashback drops frames after the restore point).

import type { Compound, SurfaceType } from '../../contracts/common';
import type { ConditionsFrame } from '../../contracts/conditions';
import type { RacePhase } from '../../contracts/race';
import type { CarRenderState } from '../../contracts/render';
import { REPLAY_CAR_STRIDE, REPLAY_HZ, type ReplayCarMeta, type ReplayData, type ReplayRecorder } from '../../contracts/replay';
import { SIM_HZ, type SimEvent, type SimWorld } from '../../contracts/sim';
import { BUILD_HASH } from '../../core/buildInfo';
import { TEAMS } from '../../data/teams';
import { conditionsFrame } from '../../race/conditions';
import { fillCarRenderState } from '../renderFrame';

export const TICKS_PER_FRAME = SIM_HZ / REPLAY_HZ;
export const CHUNK_FRAMES = 600;
export const MAX_FRAMES = 8 * 60 * REPLAY_HZ;
export const GLOBAL_STRIDE = 8;

/** Float offsets inside one car record (contracts/replay.ts layout). */
export const O = {
  pos: 0, fwd: 3, up: 6, speed: 9, steer: 10, wheelSpin: 11, susp: 15, rpm: 19, gear: 20, throttle: 21, brake: 22, drsFlap: 23,
  brakeGlow: 24, rainLight: 28, compound: 29, slip: 30, surface: 34, sparks: 38,
  /** bit 0 inPitBox, bit 1 pit limiter (CarRenderState.pitLimiter has no slot of its own in the 44-float layout) */
  pitFlags: 39,
  ersKw: 40, position: 41, laps: 42, visible: 43,
} as const;

export const COMPOUNDS: readonly Compound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];
export const SURFACES: readonly SurfaceType[] = ['asphalt', 'line', 'kerbFlat', 'kerbSausage', 'astroturf', 'runoffAsphalt', 'grass', 'gravel', 'pitAsphalt', 'concrete', 'ash'];
export const PHASES: readonly RacePhase[] = ['grid', 'lights', 'running', 'finishing', 'finished'];

export interface ReplayRecorderImpl extends ReplayRecorder {
  /** Sim event drained at sim time `world.state.time`. */
  event(world: SimWorld, e: SimEvent): void;
  /** Flashback apply: drops frames and events after sim time `time`. */
  truncate(time: number): void;
  frameCount(): number;
}

export function createReplayRecorder(): ReplayRecorderImpl {
  let world: SimWorld | null = null;
  let meta: ReplayCarMeta[] = [];
  let nCars = 0;
  let carChunks: Float32Array[] = [];
  let globalChunks: Float32Array[] = [];
  let frames = 0;
  let startTime = -1;
  let events: { t: number; e: SimEvent }[] = [];
  let scratch: CarRenderState | null = null;
  const cond: ConditionsFrame = { tod: 'day', rain: 0, wetness: 0, lineWetness: 0, cloud: 0, time: 0 };

  const newScratch = (): CarRenderState => ({
    id: 0, visible: true, isPlayer: false, isGhost: false, ghostAlpha: 1, px: 0, py: 0, pz: 0, fx: 1, fy: 0, fz: 0, ux: 0, uy: 1, uz: 0,
    speed: 0, steerAngle: 0, wheelSpin: [0, 0, 0, 0], susp: [0, 0, 0, 0], rpm: 0, gear: 1, throttle: 0, brake: 0, drsFlap: 0,
    brakeGlow: [0, 0, 0, 0], rainLight: 0, compound: 'medium', slip: [0, 0, 0, 0], wheelSurface: ['asphalt', 'asphalt', 'asphalt', 'asphalt'],
    sparks: 0, inPitBox: false, teamId: '', number: 0, tcam: 'black', ersKw: 0, pitLimiter: false,
  });

  return {
    begin(w) {
      world = w;
      nCars = w.state.cars.length;
      meta = w.state.cars.map((c) => {
        const d = TEAMS.find((t) => t.id === c.teamId)?.drivers.find((x) => x.id === c.driverId);
        return { id: c.id, driverId: c.driverId, teamId: c.teamId, number: d?.number ?? 0, tcam: d?.tcam ?? 'black', isPlayer: c.isPlayer };
      });
      carChunks = [];
      globalChunks = [];
      frames = 0;
      startTime = -1;
      events = [];
      scratch = newScratch();
    },
    sample(w) {
      if (w !== world || frames >= MAX_FRAMES || w.state.tick % TICKS_PER_FRAME !== 0) return;
      const st = w.state;
      if (startTime < 0) startTime = st.time;
      const chunk = Math.floor(frames / CHUNK_FRAMES);
      if (chunk >= carChunks.length) {
        carChunks.push(new Float32Array(CHUNK_FRAMES * nCars * REPLAY_CAR_STRIDE));
        globalChunks.push(new Float32Array(CHUNK_FRAMES * GLOBAL_STRIDE));
      }
      const local = frames - chunk * CHUNK_FRAMES;
      const cars = carChunks[chunk]!;
      const cs = scratch!;
      for (let i = 0; i < nCars; i++) {
        const c = st.cars[i]!;
        const v = c.vehicle;
        fillCarRenderState(w, i, cs, v.x, v.y, v.z, v.yaw, v.pitch, v.roll);
        const o = (local * nCars + i) * REPLAY_CAR_STRIDE;
        cars[o] = cs.px; cars[o + 1] = cs.py; cars[o + 2] = cs.pz;
        cars[o + 3] = cs.fx; cars[o + 4] = cs.fy; cars[o + 5] = cs.fz;
        cars[o + 6] = cs.ux; cars[o + 7] = cs.uy; cars[o + 8] = cs.uz;
        cars[o + O.speed] = cs.speed;
        cars[o + O.steer] = cs.steerAngle;
        for (let k = 0; k < 4; k++) {
          cars[o + O.wheelSpin + k] = cs.wheelSpin[k];
          cars[o + O.susp + k] = cs.susp[k];
          cars[o + O.brakeGlow + k] = cs.brakeGlow[k];
          cars[o + O.slip + k] = cs.slip[k];
          cars[o + O.surface + k] = SURFACES.indexOf(cs.wheelSurface[k]);
        }
        cars[o + O.rpm] = cs.rpm;
        cars[o + O.gear] = cs.gear;
        cars[o + O.throttle] = cs.throttle;
        cars[o + O.brake] = cs.brake;
        cars[o + O.drsFlap] = cs.drsFlap;
        cars[o + O.rainLight] = cs.rainLight;
        cars[o + O.compound] = COMPOUNDS.indexOf(cs.compound);
        cars[o + O.sparks] = cs.sparks;
        cars[o + O.pitFlags] = (cs.inPitBox ? 1 : 0) + (cs.pitLimiter ? 2 : 0);
        cars[o + O.ersKw] = cs.ersKw;
        cars[o + O.position] = c.race.position;
        cars[o + O.laps] = c.race.lapsCompleted;
        cars[o + O.visible] = c.race.status === 'dnf' ? 0 : 1;
      }
      const g = globalChunks[chunk]!;
      const go = local * GLOBAL_STRIDE;
      const race = st.race;
      conditionsFrame(st.conditions, st.time, cond);
      g[go] = race.raceMs;
      g[go + 1] = PHASES.indexOf(race.phase);
      g[go + 2] = race.lightsLit;
      g[go + 3] = race.phase !== 'grid' && race.phase !== 'lights' && race.raceMs - race.lightsOutAtMs < 2000 && race.lightsOutAtMs > 0 ? 1 : 0;
      g[go + 4] = cond.rain;
      g[go + 5] = cond.wetness;
      g[go + 6] = cond.lineWetness;
      g[go + 7] = cond.cloud;
      frames++;
    },
    event(w, e) {
      if (w !== world || startTime < 0 || frames >= MAX_FRAMES) return;
      events.push({ t: w.state.time - startTime, e: { ...e } });
    },
    truncate(time) {
      if (startTime < 0) return;
      const keep = Math.max(0, Math.floor((time - startTime) * REPLAY_HZ + 1e-6) + 1);
      if (keep < frames) frames = keep;
      const tRel = time - startTime;
      events = events.filter((x) => x.t <= tRel);
    },
    frameCount: () => frames,
    end(): ReplayData {
      const w = world;
      if (!w) throw new Error('[replay] end() before begin()');
      const per = nCars * REPLAY_CAR_STRIDE;
      const cars = new Float32Array(frames * per);
      const global = new Float32Array(frames * GLOBAL_STRIDE);
      for (let c = 0; c * CHUNK_FRAMES < frames; c++) {
        const n = Math.min(CHUNK_FRAMES, frames - c * CHUNK_FRAMES);
        cars.set(carChunks[c]!.subarray(0, n * per), c * CHUNK_FRAMES * per);
        global.set(globalChunks[c]!.subarray(0, n * GLOBAL_STRIDE), c * CHUNK_FRAMES * GLOBAL_STRIDE);
      }
      return {
        version: 1, buildHash: BUILD_HASH, trackId: w.static.track.data.id, config: structuredClone(w.static.config), hz: REPLAY_HZ,
        startTime: Math.max(0, startTime), frameCount: frames, meta: meta.map((m) => ({ ...m })), cars, global, events: events.slice(),
      };
    },
  };
}
