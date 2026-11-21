// Rival ghost (rules §10): a perfect AI lap (d = 100, autodrive `perfect` mode) simulated headless once and
// cached per track and build under STORAGE_KEYS.rivalGhost(trackId, buildHash). Gives the ghost lap and its 10 m delta markers.

import type { TrackBundle } from '../../contracts/track';
import { createSim, defaultSessionConfig } from '../createSim';
import { createGhostRecorder, decodeGhost, encodeGhost, type GhostLap } from './ghost';

export interface RivalLap { ghost: GhostLap; markers: Float32Array }

/** Flying lap from L − 200 m plus one timed lap; generous cap so a broken AI can never hang loading. */
const MAX_TICKS = 240 * 200;

export function recordRivalLap(track: TrackBundle): RivalLap | null {
  const cfg = defaultSessionConfig({ mode: 'timeTrial', aiCount: 0, autodrive: true, difficulty: 100, weather: 'dry', tod: 'day', seed: 1 });
  const sim = createSim(cfg, { track, skipLights: true });
  const me = sim.world.state.cars[0]!;
  const rec = createGhostRecorder();
  rec.begin();
  let lap: RivalLap | null = null;
  for (let i = 0; i < MAX_TICKS && !lap; i++) {
    sim.step();
    sim.world.events.drain((e) => {
      if (e.type !== 'lap' || e.car !== 0 || lap) return;
      const ghost = rec.finish(e.ms);
      if (!ghost || !e.valid) return;
      // markerTimes still hold the finished lap (absolute race ms) except marker 0, which the new lap rewrote.
      const lapStart = me.race.lapStartMs - e.ms;
      const markers = new Float32Array(me.race.markerTimes.length);
      for (let k = 1; k < markers.length; k++) markers[k] = Math.max(0, me.race.markerTimes[k]! - lapStart);
      lap = { ghost, markers };
    });
    const r = me.race;
    if (!lap && r.lapStartMs >= 0) {
      const v = me.vehicle;
      rec.sample(sim.world.state.race.raceMs - r.lapStartMs, v.x, v.y, v.z, Math.cos(v.yaw), 0, -Math.sin(v.yaw), v.speed);
    }
  }
  return lap;
}

export function encodeRival(r: RivalLap): string {
  const m = new Uint8Array(r.markers.buffer, r.markers.byteOffset, r.markers.byteLength);
  let s = '';
  for (let i = 0; i < m.length; i += 0x8000) s += String.fromCharCode(...m.subarray(i, i + 0x8000));
  return JSON.stringify({ ghost: encodeGhost(r.ghost), markers: btoa(s) });
}

export function decodeRival(text: string): RivalLap | null {
  try {
    const o = JSON.parse(text) as { ghost: string; markers: string };
    const ghost = decodeGhost(o.ghost);
    const bin = atob(o.markers);
    if (!ghost || bin.length % 4 !== 0) return null;
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return { ghost, markers: new Float32Array(b.buffer) };
  } catch {
    return null;
  }
}
