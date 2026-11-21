// Offline rendering (audio.md §9): renderEngineOffline (sandbox bench) and CR-08 renderReplayAudio, both on the same
// createAudioGraph as the live system.

import type { AudioSettings } from '../contracts/audio';
import type { SurfaceType } from '../contracts/common';
import type { ReplayAudioOptions } from '../contracts/modules';
import type { CarRenderState, ListenerPose, RenderFrame } from '../contracts/render';
import { REPLAY_CAR_STRIDE, type ReplayData } from '../contracts/replay';
import { driveEngine, engineEvent, newEngineDrive } from './engineDrive';
import { createSceneAudio } from './scene';
import type { EngineParams } from './engine/engineVoice';
import { createAudioGraph } from './graph';

export interface OfflineEngineScript {
  /** Fills `out` with the engine state at time t (s). */
  at(t: number, out: EngineParams): void;
  /** Gear-change times (s) with direction (+1 up, −1 down). */
  shifts?: readonly { t: number; dir: 1 | -1 }[];
  /** Overrun pop times (s). */
  pops?: readonly number[];
}

export async function renderEngineOffline(seconds: number, script: OfflineEngineScript, sampleRate = 48000, volumes?: AudioSettings): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.round(seconds * sampleRate), sampleRate);
  const g = createAudioGraph(ctx, { offline: true });
  g.setVolumes(volumes ?? { master: 1, engine: 1, sfx: 1, ambience: 1, ui: 1 }, 0);
  const p: EngineParams = { rpm: 4000, throttle: 0, speed: 0, ersKw: 0, spool: 0, interior: false };
  for (let i = 0; i <= seconds * 60; i++) {
    const t = i / 60;
    script.at(t, p);
    g.engine.set(p, t, 0.02);
    g.setWind(p.speed, p.interior, t, 0.05);
  }
  let s = 1;
  const rand = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (const sh of script.shifts ?? []) {
    if (sh.dir > 0) g.engine.upshift(sh.t);
    else g.engine.downshift(sh.t, 8, rand);
  }
  for (const t of script.pops ?? []) g.engine.pop(t, 0.2);
  g.start(0);
  return ctx.startRendering();
}

// ---- CR-08 renderReplayAudio (S2-S9, audio.md §9) ----
// The replay's 60 Hz car records (contracts/replay.ts layout) are turned into RenderFrame-shaped samples and fed
// through the same engine driver and scene audio as the live system, with the sample time as audio time. 2 s of
// pre-roll (filter warm-up) are rendered and trimmed. Deterministic: no wall clock, no Math.random.

const SURFACES: readonly SurfaceType[] = ['asphalt', 'line', 'kerbFlat', 'kerbSausage', 'astroturf', 'runoffAsphalt', 'grass', 'gravel', 'pitAsphalt', 'concrete', 'ash'];
const PRE_ROLL_S = 2;

function mutableCar(id: number, isPlayer: boolean): CarRenderState {
  return {
    id, visible: true, isPlayer, isGhost: false, ghostAlpha: 1, px: 0, py: 0, pz: 0, fx: 1, fy: 0, fz: 0, ux: 0, uy: 1, uz: 0,
    speed: 0, steerAngle: 0, wheelSpin: [0, 0, 0, 0], susp: [0, 0, 0, 0], rpm: 4000, gear: 1, throttle: 0, brake: 0, drsFlap: 0,
    brakeGlow: [0, 0, 0, 0], rainLight: 0, compound: 'medium', slip: [0, 0, 0, 0], wheelSurface: ['asphalt', 'asphalt', 'asphalt', 'asphalt'],
    sparks: 0, inPitBox: false, teamId: '', number: 0, tcam: 'black', ersKw: 0, pitLimiter: false,
  };
}

/** Writes replay frame `f` into `frame` (cars + conditions + lights). */
function fillFrame(r: ReplayData, f: number, frame: RenderFrame): void {
  const n = r.meta.length;
  const S = REPLAY_CAR_STRIDE;
  for (let c = 0; c < n; c++) {
    const a = (f * n + c) * S;
    const d = r.cars;
    const cs = frame.cars[c]!;
    cs.px = d[a]!; cs.py = d[a + 1]!; cs.pz = d[a + 2]!;
    cs.fx = d[a + 3]!; cs.fy = d[a + 4]!; cs.fz = d[a + 5]!;
    cs.speed = d[a + 9]!;
    cs.rpm = d[a + 19]!; cs.gear = d[a + 20]!; cs.throttle = d[a + 21]!; cs.brake = d[a + 22]!;
    for (let w = 0; w < 4; w++) {
      cs.slip[w] = d[a + 30 + w]!;
      cs.wheelSurface[w] = SURFACES[d[a + 34 + w]! | 0] ?? 'asphalt';
    }
    cs.pitLimiter = ((d[a + 39]! | 0) & 2) !== 0;
    cs.ersKw = d[a + 40]!;
    cs.visible = d[a + 43]! > 0.5;
  }
  const g = f * 8;
  frame.lights.lit = r.global[g + 2]!;
  frame.lights.out = r.global[g + 3]! > 0.5;
  frame.conditions.rain = r.global[g + 4]!;
  frame.conditions.wetness = r.global[g + 5]!;
  frame.conditions.lineWetness = r.global[g + 6]!;
  frame.conditions.cloud = r.global[g + 7]!;
}

export async function renderReplayAudio(replay: ReplayData, o: ReplayAudioOptions): Promise<AudioBuffer> {
  const sr = o.sampleRate > 0 ? o.sampleRate : 48000;
  const hz = replay.hz;
  const dur = replay.frameCount / hz;
  const to = Math.min(o.to, dur);
  const from = Math.max(0, Math.min(o.from, to));
  const pre = Math.min(PRE_ROLL_S, from);
  const t0 = from - pre;
  const len = Math.max(1, Math.round((to - t0) * sr));
  const ctx = new OfflineAudioContext(2, len, sr);
  const g = createAudioGraph(ctx, { offline: true });
  const scene = createSceneAudio(g, { hrtf: false });
  g.setVolumes(o.volumes, 0);
  const playerId = Math.max(0, replay.meta.findIndex((m) => m.isPlayer));
  const frame = {
    time: 0, frameDt: 1 / hz, alpha: 0, cars: replay.meta.map((m) => mutableCar(m.id, m.isPlayer)), playerId,
    conditions: { tod: replay.config.tod, rain: 0, wetness: 0, lineWetness: 0, cloud: 0, time: 0 }, lights: { lit: 0, out: true },
    yellowSectors: [false, false, false], paused: false, view: 'tv', lookBack: false,
    racingLine: { mode: 'off', profile: null, playerS: NaN, playerSpeed: 0 },
  } as RenderFrame;
  const lis: ListenerPose = { px: 0, py: 0, pz: 0, fx: 1, fy: 0, fz: 0, ux: 0, uy: 1, uz: 0, vx: 0, vy: 0, vz: 0, camera: 'tcam' };
  const drive = newEngineDrive();
  const fStart = Math.ceil(t0 * hz - 1e-9) // ceil: a frame before t0 would schedule at a negative context time;
  const fEnd = Math.min(replay.frameCount - 1, Math.ceil(to * hz));
  // Events: t is relative to the replay start (recorder), like `from` / `to`.
  const ev = replay.events;
  let ei = 0;
  while (ei < ev.length && ev[ei]!.t < t0) ei++;
  for (let f = fStart; f <= fEnd; f++) {
    const rt = f / hz;
    const at = Math.max(0, rt - t0);
    fillFrame(replay, f, frame);
    frame.time = rt;
    o.listener(rt, lis);
    const pc = frame.cars[playerId];
    if (pc) driveEngine(g, drive, frame, pc, at, 1 / hz);
    scene.update(frame, lis, at, 1 / hz);
    while (ei < ev.length && ev[ei]!.t < rt + 1 / hz) {
      const e = ev[ei++]!;
      const et = Math.max(0, e.t - t0);
      scene.event(e.e, playerId, et);
      engineEvent(g, drive, e.e, playerId, et);
    }
  }
  g.start(0);
  scene.start(0);
  const full = await ctx.startRendering();
  const skip = Math.round(pre * sr);
  const out = new AudioBuffer({ numberOfChannels: 2, length: Math.max(1, full.length - skip), sampleRate: sr });
  for (let ch = 0; ch < 2; ch++) out.copyToChannel(full.getChannelData(ch).subarray(skip), ch);
  return out;
}
