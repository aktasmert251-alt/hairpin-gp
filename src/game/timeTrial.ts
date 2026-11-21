// Time Trial (YÖN glue; rules §1, §10): PB with sectors + delta markers in STORAGE_KEYS.tt(track), local top 10,
// TimeTrialModel store, PB ghost (record every tick, play back as an extra isGhost car), restartLap (Backspace).
// Only dry sessions store anything.

import type { CarRenderState } from '../contracts/render';
import { SIM_HZ, type SimEvent, type SimWorld } from '../contracts/sim';
import type { Store, TimeTrialModel } from '../contracts/ui';
import { STORAGE_KEYS } from '../core/settings/defaults';
import { TT_START_BEFORE_LINE_M, TT_START_KMH } from './createSim';
import { createGhostRecorder, decodeGhost, encodeGhost, ghostAlphaAt, ghostPoseAt, type GhostLap, type GhostPose } from './ghost/ghost';
import { decodeRival, encodeRival, recordRivalLap, type RivalLap } from './ghost/rival';
import { teleportCar } from './sim/teleport';
import { BUILD_HASH } from '../core/buildInfo';

const TOP_N = 10;

interface PbRecord {
  pbMs: number;
  sectors: [number, number, number];
  /** base64 Float32Array of lap-relative 10 m marker times (delta reference). */
  markers: string;
  top10: TimeTrialModel['top10'];
}

function load(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function save(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch (err) {
    console.warn('[tt] storage unavailable', err);
  }
}

function f32ToB64(a: Float32Array): string {
  const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function b64ToF32(s: string): Float32Array | null {
  try {
    const bin = atob(s);
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b.length % 4 === 0 ? new Float32Array(b.buffer) : null;
  } catch {
    return null;
  }
}

function readPb(trackId: string): PbRecord | null {
  try {
    const raw = load(STORAGE_KEYS.tt(trackId));
    return raw ? (JSON.parse(raw) as PbRecord) : null;
  } catch {
    return null;
  }
}

/** The stored PB and top 10 of a track, for the tt store at boot (main-menu info card) before any session. */
export function storedTimeTrial(trackId: string): TimeTrialModel {
  const pb = readPb(trackId);
  return { laps: [], pbMs: pb?.pbMs ?? 0, top10: pb?.top10 ?? [] };
}

/** Rules §10 rival ghost: cached per track and build; on a miss it is simulated headless (≈ 1 s) and older builds' copies of this track are dropped. */
function loadRival(world: SimWorld): RivalLap | null {
  const trackId = world.static.track.data.id;
  const key = STORAGE_KEYS.rivalGhost(trackId, BUILD_HASH);
  const cached = load(key);
  const hit = cached ? decodeRival(cached) : null;
  if (hit) return hit;
  const lap = recordRivalLap(world.static.track);
  if (!lap) return null;
  try {
    const ls = globalThis.localStorage;
    const prefix = STORAGE_KEYS.rivalGhost(trackId, '');
    for (let i = ls.length - 1; i >= 0; i--) {
      const k = ls.key(i);
      if (k && k.startsWith(prefix) && k !== key) ls.removeItem(k);
    }
  } catch {
    // no storage: the lap is still used for this session
  }
  save(key, encodeRival(lap));
  return lap;
}

export interface TimeTrialDeps {
  world: SimWorld;
  playerId: number;
  store: Store<TimeTrialModel>;
  /** Delta reference (stored PB or rival lap markers) and all-time sectors (stored PB) for the HUD. */
  setReference(kind: 'pb' | 'rival' | null, markers: Float32Array | null, sectors: [number, number, number] | null): void;
  /** The presenter's recording of the player's best lap this session (markers of the PB lap once it ran). */
  bestLapMarkers(): Float32Array | null;
}

export interface TimeTrialController {
  /** The ghost's render slot (isGhost); null when ghosts are off. */
  readonly ghostCar: CarRenderState | null;
  /** Every tick, before stepping: ghost recording. */
  beforeTick(): void;
  onSimEvent(e: SimEvent): void;
  /** Every frame after the presenter update: ghost pose and pending PB saves. */
  frame(alpha: number): void;
  /** Backspace: back to s = L − 200 m at 200 km/h, the current lap is aborted (not listed). */
  restartLap(): void;
  /** Flashback apply: recorded samples after the restore point are dropped. */
  onRestored(): void;
}

export function createTimeTrial(d: TimeTrialDeps, ghostCar: CarRenderState | null): TimeTrialController {
  const { world, playerId, store } = d;
  const cfg = world.static.config;
  const trackId = world.static.track.data.id;
  const dry = cfg.weather === 'dry';
  const me = world.state.cars[playerId]!;
  const rec = createGhostRecorder();
  const pose: GhostPose = { px: 0, py: 0, pz: 0, fx: 1, fy: 0, fz: 0, speed: 0 };

  let pb = readPb(trackId);
  const rival = cfg.ghost === 'rival' ? loadRival(world) : null;
  let ghost: GhostLap | null = cfg.ghost === 'pb' ? (() => {
    const raw = load(STORAGE_KEYS.ghost(trackId));
    return raw ? decodeGhost(raw) : null;
  })() : rival?.ghost ?? null;
  let lastLap: GhostLap | null = null;
  let recLapStart = -2;
  let pendingPb = false;
  const laps: TimeTrialModel['laps'] = [];

  const publish = (): void => store.set({ laps: laps.slice(), pbMs: pb?.pbMs ?? 0, top10: pb?.top10 ?? [] });
  const reference = (): void => {
    if (rival) {
      d.setReference('rival', rival.markers, pb ? pb.sectors : null);
      return;
    }
    const m = pb?.markers ? b64ToF32(pb.markers) : null;
    d.setReference(m ? 'pb' : null, m, pb ? pb.sectors : null);
  };
  reference();
  publish();

  /** A new lap began: keep the finished one for a possible PB, start recording the next. */
  const rollover = (): void => {
    const r = me.race;
    if (r.lapStartMs === recLapStart) return;
    if (recLapStart >= 0 && r.lapStartMs > recLapStart) lastLap = rec.finish(r.lapStartMs - recLapStart);
    rec.begin();
    recLapStart = r.lapStartMs;
  };

  const onLap = (e: Extract<SimEvent, { type: 'lap' }>): void => {
    rollover();
    const r = me.race;
    laps.push({ n: e.lap, ms: e.ms, valid: e.valid, sectors: [r.curSectors[0], r.curSectors[1], r.curSectors[2]] });
    if (e.valid && dry) {
      const top10 = [...(pb?.top10 ?? []), { ms: e.ms, date: new Date().toISOString().slice(0, 10), teamId: me.teamId }]
        .sort((a, b) => a.ms - b.ms).slice(0, TOP_N);
      if (!pb || pb.pbMs <= 0 || e.ms < pb.pbMs) {
        pb = { pbMs: e.ms, sectors: [r.curSectors[0], r.curSectors[1], r.curSectors[2]], markers: pb?.markers ?? '', top10 };
        pendingPb = true;
        const g = lastLap && Math.abs(lastLap.lapMs - e.ms) < 100 ? lastLap : null;
        if (g) {
          save(STORAGE_KEYS.ghost(trackId), encodeGhost(g));
          if (cfg.ghost === 'pb') ghost = g;
        }
      } else pb = { ...pb, top10 };
      save(STORAGE_KEYS.tt(trackId), JSON.stringify(pb));
    }
    publish();
  };

  return {
    ghostCar,
    beforeTick() {
      const r = me.race;
      rollover();
      if (r.lapStartMs < 0) return;
      const v = me.vehicle;
      rec.sample(world.state.race.raceMs - r.lapStartMs, v.x, v.y, v.z, Math.cos(v.yaw), 0, -Math.sin(v.yaw), v.speed);
    },
    onSimEvent(e) {
      if (e.type === 'lap' && e.car === playerId) onLap(e);
    },
    frame(alpha) {
      if (pendingPb && pb) {
        const m = d.bestLapMarkers();
        if (m) {
          pb.markers = f32ToB64(m);
          save(STORAGE_KEYS.tt(trackId), JSON.stringify(pb));
          pendingPb = false;
          reference();
        }
      }
      if (!ghostCar) return;
      const r = me.race;
      const lapMs = world.state.race.raceMs - ((1 - alpha) * 1000) / SIM_HZ - r.lapStartMs;
      if (!ghost || r.lapStartMs < 0 || !ghostPoseAt(ghost, lapMs, pose)) {
        ghostCar.visible = false;
        return;
      }
      ghostCar.visible = true;
      ghostCar.px = pose.px; ghostCar.py = pose.py; ghostCar.pz = pose.pz;
      ghostCar.fx = pose.fx; ghostCar.fy = pose.fy; ghostCar.fz = pose.fz;
      ghostCar.ux = 0; ghostCar.uy = 1; ghostCar.uz = 0;
      ghostCar.speed = pose.speed;
      const v = me.vehicle;
      ghostCar.ghostAlpha = ghostAlphaAt(Math.hypot(pose.px - v.x, pose.pz - v.z));
    },
    restartLap() {
      const r = me.race;
      teleportCar(world, playerId, -TT_START_BEFORE_LINE_M, 0, TT_START_KMH);
      me.vehicle.lapWraps = r.lapsCompleted - 1;
      r.progress = me.vehicle.lapWraps * world.static.track.query.length + me.vehicle.s;
      r.lapStartMs = -1;
      r.sectorStartMs = -1;
      r.sector = 0;
      r.lapValid = true;
      rec.begin();
      recLapStart = -1;
    },
    onRestored() {
      const r = me.race;
      if (r.lapStartMs !== recLapStart) {
        rec.begin();
        recLapStart = r.lapStartMs;
      } else rec.truncate(world.state.race.raceMs - r.lapStartMs);
    },
  };
}
