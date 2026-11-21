// Trailer recordings (Sprint 5b): each clip runs the real sim headless (createSim, real AI) with a fixed seed and
// records a CR-01 replay. Same inputs -> same replay, so every frame of the trailer is reproducible.

import type { RaceTrackId } from '../contracts/track';
import type { ReplayData } from '../contracts/replay';
import type { SessionConfig } from '../contracts/race';
import { createReplayRecorder, createSim, defaultSessionConfig } from '../game/index';

export type ClipId = 'start' | 'sunset' | 'rain' | 'night';

export interface ClipDef {
  id: ClipId;
  cfg: Partial<SessionConfig> & { trackId: RaceTrackId };
  skipLights: boolean;
  /** Sim seconds simulated before recording starts / recording stops. */
  from: number;
  to: number;
  /** Sim second at which the player (autodriven) asks for a pit stop. */
  boxAt?: number;
}

export const CLIPS: Record<ClipId, ClipDef> = {
  // Seed 115: lights out 0.50 s after lamp 5, so every lamp and the drop sit on the 120 BPM grid (BEATMAP.md).
  start: { id: 'start', cfg: { trackId: 'istanbul', tod: 'day', weather: 'dry', seed: 115 }, skipLights: false, from: 0, to: 28 },
  sunset: { id: 'sunset', cfg: { trackId: 'lombardia', tod: 'sunset', weather: 'dry', seed: 22 }, skipLights: true, from: 8, to: 48 },
  rain: { id: 'rain', cfg: { trackId: 'istanbul', tod: 'day', weather: 'heavy', seed: 33 }, skipLights: true, from: 20, to: 50 },
  night: { id: 'night', cfg: { trackId: 'bosphorus', tod: 'night', weather: 'dry', seed: 47 }, skipLights: true, from: 10, to: 100, boxAt: 12 },
};

export interface Clip {
  def: ClipDef;
  data: ReplayData;
  /** Main-track s per recorded frame and car: sTab[frame * n + car]. */
  sTab: Float32Array;
  /** Sim time of replay t = 0. */
  simT0: number;
}

export function recordClip(def: ClipDef): Clip {
  const cfg = defaultSessionConfig({ mode: 'race', aiCount: 19, laps: 5, autodrive: true, ...def.cfg });
  const sim = createSim(cfg, { skipLights: def.skipLights });
  const w = sim.world;
  const rec = createReplayRecorder();
  const n = w.state.cars.length;
  const hz = 240;
  const s: number[] = [];
  let recording = false;
  const total = Math.round(def.to * hz);
  for (let i = 0; i < total; i++) {
    if (!recording && w.state.time >= def.from - 1e-9) {
      rec.begin(w);
      recording = true;
    }
    if (def.boxAt !== undefined && i === Math.round(def.boxAt * hz)) w.state.cars[0]!.controls.boxRequest = true;
    sim.step();
    if (recording) {
      rec.sample(w);
      if (w.state.tick % 4 === 0) for (let c = 0; c < n; c++) s.push(w.state.cars[c]!.vehicle.s);
      w.events.drain((e) => rec.event(w, e));
    } else w.events.drain(() => {});
  }
  const data = rec.end();
  const sTab = new Float32Array(data.frameCount * n);
  sTab.set(s.slice(0, sTab.length));
  return { def, data, sTab, simT0: data.startTime };
}
