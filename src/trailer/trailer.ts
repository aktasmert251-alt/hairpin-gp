// Trailer engine (Sprint 5b, motion-design pipeline): everything on screen is a pure function of film time t.
// seek(t): shot -> clip (recorded replay) -> interpolated frame -> scripted camera -> VFX pre-roll -> render ->
// end card (GSAP totalTime). No wall clock and no Math.random on the render path; the only clock is the
// preview player (update(dt)), which calls the same seek().

import type { PerspectiveCamera } from 'three';
import type { QualityId } from '../contracts/common';
import type { RaceTrackId, TrackFrame, TrackQuery } from '../contracts/track';
import type { EnvironmentHandle } from '../contracts/environment';
import type { CameraPose, CarRenderState, RenderFrame } from '../contracts/render';
import type { ReplayData, ReplayFrame, ReplayPlayer } from '../contracts/replay';
import { createReplayPlayer } from '../game/index';
import { createCameraRig, createCarVisuals, createGraphicsSystem, createVfx, QUALITY_PRESETS } from '../graphics/index';
import { buildEnvironment, loadTrack } from '../track/index';
import type { AssetLoader } from '../contracts/render';
import { renderReplayAudio } from '../audio/index';
import { createEndCard } from './endCard';
import { CLIPS, recordClip, type Clip, type ClipId } from './clips';
import { DURATION, SHOTS, shotAt, type Anchor, type Cam, type Ease, type Shot } from './shots';

const VFX_PREROLL_FRAMES = 48;
/** An empty replay frame; ReplayPlayer.frameAt sizes it on first use. */
const emptyFrame = (): ReplayFrame => ({
  t: 0, raceMs: 0, phase: 'grid', lights: { lit: 0, out: false },
  conditions: { tod: 'day', rain: 0, wetness: 0, lineWetness: 0, cloud: 0, time: 0 }, cars: [], order: [], laps: [],
});
const ease = (k: Ease | undefined, x: number): number => {
  const u = x <= 0 ? 0 : x >= 1 ? 1 : x;
  if (k === 'lin') return u;
  if (k === 'out') return 1 - (1 - u) ** 3;
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
};

interface ClipRt {
  clip: Clip;
  player: ReplayPlayer;
  rf: ReplayFrame;
  aux: ReplayFrame;
  /** clip car index -> canonical visual id (cars are shared across clips by driver). */
  canon: number[];
  /** canonical id -> clip car index. */
  local: number[];
}

export interface Trailer {
  seek(t: number): Promise<void>;
  /** Game audio (engines, tyres, crowd) for the whole film, stereo interleaved at `sr`. */
  renderAudio(sr: number): Promise<Float32Array>;
  update(dt: number): void;
  dispose(): void;
}

export async function createTrailer(o: {
  canvas: HTMLCanvasElement; uiRoot: HTMLElement; assets: AssetLoader; quality: QualityId; onStatus(s: string): void;
}): Promise<Trailer> {
  const graphics = createGraphicsSystem();
  const ctx = await graphics.init(o.canvas, QUALITY_PRESETS[o.quality] ?? QUALITY_PRESETS.ultra);
  const camera: PerspectiveCamera = ctx.camera;
  const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
  /**
   * Renders and makes sure the frame was not dropped by the GPU frame-queue guard (fences only report signalled
   * after control returns to the event loop): finish, yield one frame, render, retry if it was skipped.
   */
  const renderSure = async (f: RenderFrame): Promise<void> => {
    for (let i = 0; i < 20; i++) {
      (ctx.renderer.getContext() as WebGL2RenderingContext).finish();
      await raf();
      const before = graphics.frameQueueStats().skipped;
      graphics.render(f);
      if (graphics.frameQueueStats().skipped === before) return;
    }
    throw new Error('[trailer] renderer kept skipping frames');
  };

  // ---- recordings ----
  const clips = {} as Record<ClipId, ClipRt>;
  let canonKeys: string[] = [];
  for (const id of Object.keys(CLIPS) as ClipId[]) {
    o.onStatus(`recording ${id}`);
    await new Promise((r) => setTimeout(r, 0));
    const clip = recordClip(CLIPS[id]);
    const keys = clip.data.meta.map((m) => `${m.teamId}#${m.number}`);
    if (canonKeys.length === 0) canonKeys = keys;
    const canon = keys.map((k) => canonKeys.indexOf(k));
    const local = canonKeys.map((k) => keys.indexOf(k));
    if (canon.some((c) => c < 0)) throw new Error(`[trailer] clip ${id} has a different lineup`);
    clips[id] = { clip, player: createReplayPlayer(clip.data), rf: emptyFrame(), aux: emptyFrame(), canon, local };
  }
  const meta0 = clips.start.clip.data.meta;

  // ---- cars, camera rig, VFX ----
  const visuals = createCarVisuals();
  await visuals.init(ctx, meta0.map((m, i) => ({ id: i, teamId: m.teamId, number: m.number, tcam: m.tcam, isGhost: false })));
  const rig = createCameraRig(ctx);
  rig.setMotionEffects(false);
  const vfx = createVfx();
  vfx.init(ctx);
  const endCard = await createEndCard(o.uiRoot);

  const frame: RenderFrame = {
    time: 0, frameDt: 1 / 60, alpha: 1, cars: [], playerId: 0,
    conditions: { tod: 'day', rain: 0, wetness: 0, lineWetness: 0, cloud: 0, time: 0 },
    lights: { lit: 0, out: false }, yellowSectors: [false, false, false], paused: false,
    racingLine: { mode: 'off', profile: null, playerS: 0, playerSpeed: 0 }, view: 'trailer', lookBack: false,
  };
  const cars: CarRenderState[] = new Array(meta0.length);

  // ---- environments (one per track, kept; only the active one is in the scene) ----
  const envs = new Map<RaceTrackId, EnvironmentHandle>();
  const tracks = new Map<RaceTrackId, TrackQuery>();
  let activeClip: ClipId | null = null;
  const envFor = async (c: ClipRt): Promise<EnvironmentHandle> => {
    const id = c.clip.data.trackId as RaceTrackId;
    let env = envs.get(id);
    if (!env) {
      o.onStatus(`building ${id}`);
      const bundle = loadTrack(id);
      tracks.set(id, bundle.query);
      env = await buildEnvironment({ track: bundle, quality: ctx.quality, conditions: { ...frame.conditions, tod: c.clip.data.config.tod }, ctx, assets: o.assets, onProgress: () => {} });
      envs.set(id, env);
    }
    return env;
  };
  let env: EnvironmentHandle | null = null;

  /** Fills `frame` from clip `c` at replay time rt (cars in canonical order). */
  const fill = (c: ClipRt, rt: number, focusLocal: number): void => {
    c.player.frameAt(rt, c.rf);
    for (let k = 0; k < c.rf.cars.length; k++) {
      const cs = c.rf.cars[k]!;
      const id = c.canon[k]!;
      cs.id = id;
      cs.isPlayer = k === focusLocal;
      cars[id] = cs;
    }
    frame.cars = cars;
    frame.playerId = c.canon[focusLocal]!;
    const cd = c.rf.conditions;
    Object.assign(frame.conditions, cd);
    frame.conditions.tod = c.clip.data.config.tod;
    frame.lights.lit = c.rf.lights.lit;
    frame.lights.out = c.rf.lights.out;
    frame.time = c.clip.data.startTime + rt;
  };

  const switchClip = async (id: ClipId): Promise<void> => {
    if (activeClip === id) return;
    const c = clips[id];
    const next = await envFor(c);
    if (env !== next) {
      if (env) ctx.scene.remove(env.root);
      ctx.scene.add(next.root);
      env = next;
      visuals.setTrack(tracks.get(c.clip.data.trackId as RaceTrackId)!);
    }
    activeClip = id;
    vfx.clear();
    // Conditions + lighting for this clip, then a 1.2 s settle of the grade / exposure at 10 Hz (deterministic).
    const s0 = SHOTS.find((s) => s.clip === id)!;
    fill(c, s0.rt0, s0.car);
    env.applyConditions(frame.conditions);
    graphics.setLighting(env.rig, env.envScene);
    rig.setOverride(null);
    rig.setView('trailer');
    for (let i = 0; i < 12; i++) {
      frame.frameDt = 0.1;
      env.update(camera, frame, 0.1);
      visuals.update(frame, camera);
      await renderSure(frame);
    }
  };

  // ---- camera ----
  const P = { x: 0, y: 0, z: 0 };
  const tf: TrackFrame = { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: 1, halfWidthL: 7, halfWidthR: 7, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 };
  const carAt = (c: ClipRt, car: number, rt: number): CarRenderState => c.player.frameAt(rt, c.aux).cars[car]!;
  const anchor = (c: ClipRt, a: Anchor, out: { x: number; y: number; z: number }): void => {
    if ('car' in a) {
      const cs = carAt(c, a.car, a.at);
      const fl = Math.hypot(cs.fx, cs.fz) || 1;
      const fx = cs.fx / fl, fz = cs.fz / fl;
      // Model +x is left: left = up × forward = (fz, 0, -fx).
      out.x = cs.px + fx * a.fwd + fz * a.left;
      out.y = cs.py + a.up;
      out.z = cs.pz + fz * a.fwd - fx * a.left;
    } else {
      const q = tracks.get(c.clip.data.trackId as RaceTrackId)!;
      q.frameAt(q.wrapS(a.s), tf);
      out.x = tf.px + tf.lx * a.d;
      out.y = tf.py + tf.crossSlope * a.d + a.h;
      out.z = tf.pz + tf.lz * a.d;
    }
  };
  const A = { x: 0, y: 0, z: 0 }, B = { x: 0, y: 0, z: 0 };
  const pose: CameraPose = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, fov: 50, roll: 0 };
  /** Scripted camera pose for shot s at local progress u and replay time rt (pure). */
  const camPose = (s: Shot, c: ClipRt, u: number, rt: number): CameraPose => {
    const cam = s.cam as Exclude<Cam, { k: 'onboard' }>;
    const dir = s.rate < 0 ? -1 : 1;
    if (cam.k === 'fixed') {
      anchor(c, cam.from, A);
      const e = ease(cam.ease, u);
      if (cam.to) {
        anchor(c, cam.to, B);
        A.x += (B.x - A.x) * e; A.y += (B.y - A.y) * e; A.z += (B.z - A.z) * e;
      }
      pose.px = A.x; pose.py = A.y; pose.pz = A.z;
      if (cam.look === 'car') {
        const cs = carAt(c, s.car, rt - (cam.lag ?? 0) * dir);
        pose.tx = cs.px; pose.ty = cs.py + (cam.aimUp ?? 0.6); pose.tz = cs.pz;
      } else {
        anchor(c, cam.look, B);
        if (cam.lookTo) {
          anchor(c, cam.lookTo, P);
          B.x += (P.x - B.x) * e; B.y += (P.y - B.y) * e; B.z += (P.z - B.z) * e;
        }
        pose.tx = B.x; pose.ty = B.y; pose.tz = B.z;
      }
      pose.fov = cam.fov + ((cam.fovTo ?? cam.fov) - cam.fov) * e;
      pose.roll = cam.roll ?? 0;
    } else {
      const back = cam.back + ((cam.backTo ?? cam.back) - cam.back) * ease('io', u);
      const lagged = carAt(c, s.car, rt - cam.lag * dir);
      const fl = Math.hypot(lagged.fx, lagged.fz) || 1;
      const fx = lagged.fx / fl, fz = lagged.fz / fl;
      pose.px = lagged.px - fx * back + fz * cam.side;
      pose.py = lagged.py + cam.up;
      pose.pz = lagged.pz - fz * back - fx * cam.side;
      const now = carAt(c, s.car, rt);
      const al = cam.aimLeft ?? 0;
      pose.tx = now.px + fx * cam.aim + fz * al; pose.ty = now.py + 0.7; pose.tz = now.pz + fz * cam.aim - fx * al;
      pose.fov = cam.fov;
      pose.roll = 0;
    }
    return pose;
  };

  const rtOf = (s: Shot, t: number): number => s.rt0 + (t - s.t0) * s.rate;
  /** Clamp sub-frame samples to their own side of a hard cut (motion-design §9c). */
  const shotFor = (t: number): Shot => shotAt(Math.min(DURATION - 1e-6, Math.max(0, t)));

  const applyCamera = (s: Shot, c: ClipRt, t: number, rt: number): void => {
    if (s.cam.k === 'onboard') {
      rig.setOverride(null);
      rig.setView(s.cam.view);
      rig.snap();
      visuals.setCockpitCar(s.cam.view === 'cockpit' ? c.canon[s.car]! : null);
      rig.update(frame, 1 / 60);
      frame.view = s.cam.view;
    } else {
      visuals.setCockpitCar(null);
      rig.setView('trailer');
      rig.setOverride(camPose(s, c, (t - s.t0) / (s.t1 - s.t0), rt));
      rig.update(frame, 0);
      frame.view = 'trailer';
    }
  };

  let busy: Promise<void> = Promise.resolve();
  const seekNow = async (t: number): Promise<void> => {
    const s = shotFor(t);
    await switchClip(s.clip);
    const c = clips[s.clip];
    const rt = rtOf(s, t);
    // VFX pre-roll: particles and skid marks rebuilt from the last 0.8 s of replay, so any t renders the same.
    vfx.clear();
    const dir = s.rate < 0 ? -1 : 1;
    for (let k = VFX_PREROLL_FRAMES; k >= 1; k--) {
      fill(c, rt - (k / 60) * dir, s.car);
      applyCamera(s, c, t, rt - (k / 60) * dir);
      vfx.update(frame, camera, 1 / 60);
    }
    fill(c, rt, s.car);
    applyCamera(s, c, t, rt);
    vfx.update(frame, camera, 1 / 60);
    frame.frameDt = 1 / 60;
    env!.update(camera, frame, 1 / 60);
    visuals.update(frame, camera);
    // dt 0 in the post chain: exposure lands on its target (no history), no GPU frame skipping.
    frame.frameDt = 0;
    await renderSure(frame);
    endCard.seek(t);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
  };

  // ---- game audio (CR-08), listener = the shot camera ----
  const renderAudio = async (sr: number): Promise<Float32Array> => {
    const outBuf = new Float32Array(Math.round(DURATION * sr) * 2);
    for (const s of SHOTS) {
      if (s.rate <= 0.5 && s.rate >= 0) continue;
      const c = clips[s.clip];
      const len = s.t1 - s.t0;
      const a = s.rate > 0 ? s.rt0 : s.rt0 - len;
      // The focus car becomes the replay's "player" so its engine voice is the one we hear.
      const data: ReplayData = { ...c.clip.data, meta: c.clip.data.meta.map((m, i) => ({ ...m, isPlayer: i === s.car })) };
      const onboard = s.cam.k === 'onboard';
      // renderReplayAudio's buffer starts at `from` (pre-roll trimmed inside since ba9be1d), but an off-grid `from`
      // still yields a -4e-16 s schedule time in src/audio/offline.ts (`at = rt - t0`) and throws: keep `from` on a
      // 0.25 s grid (exact in 1/60 s) and skip the extra samples here.
      const a0 = Math.floor(a * 4) / 4;
      const skip = Math.round((a - a0) * sr);
      const buf = await renderReplayAudio(data, {
        from: a0, to: a + len + 0.05, sampleRate: sr,
        volumes: { master: 1, engine: 1, sfx: 1, ambience: 1, ui: 0 },
        listener: (rt, out) => {
          const t = s.rate > 0 ? s.t0 + (rt - s.rt0) : s.t0 + (s.rt0 - rt);
          const cs = carAt(c, s.car, rt);
          if (onboard) {
            out.px = cs.px; out.py = cs.py + 1; out.pz = cs.pz;
            out.fx = cs.fx; out.fy = cs.fy; out.fz = cs.fz;
          } else {
            const p = camPose(s, c, (t - s.t0) / len, rt);
            out.px = p.px; out.py = p.py; out.pz = p.pz;
            const dx = p.tx - p.px, dy = p.ty - p.py, dz = p.tz - p.pz, l = Math.hypot(dx, dy, dz) || 1;
            out.fx = dx / l; out.fy = dy / l; out.fz = dz / l;
          }
          out.ux = 0; out.uy = 1; out.uz = 0; out.vx = 0; out.vy = 0; out.vz = 0;
          out.camera = onboard ? 'tcam' : 'chaseFar';
          return out;
        },
      });
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      const n = Math.min(L.length - skip, Math.round(len * sr));
      const off = Math.round(s.t0 * sr);
      const fade = Math.round(0.01 * sr);
      for (let i = 0; i < n; i++) {
        const j = skip + (s.rate > 0 ? i : n - 1 - i);
        const g = Math.min(1, i / fade, (n - 1 - i) / fade);
        outBuf[(off + i) * 2] = L[j]! * g;
        outBuf[(off + i) * 2 + 1] = R[j]! * g;
      }
    }
    return outBuf;
  };

  // ---- preview player: Space play/pause, Left/Right one frame, R replay (the only clock) ----
  let playing = false;
  let playT = 0;
  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'Space') playing = !playing;
    else if (e.code === 'ArrowLeft') playT = Math.max(0, playT - 1 / 30);
    else if (e.code === 'ArrowRight') playT = Math.min(DURATION, playT + 1 / 30);
    else if (e.code === 'KeyR') playT = 0;
    else return;
    e.preventDefault();
    void seek(playT);
  };
  window.addEventListener('keydown', onKey);
  const onResize = (): void => {
    graphics.resize();
    endCard.layout();
  };
  window.addEventListener('resize', onResize);

  const seek = (t: number): Promise<void> => {
    busy = busy.then(() => seekNow(t));
    return busy;
  };

  // Build every environment up front (load time, not render time).
  for (const id of ['night', 'start', 'sunset'] as ClipId[]) await switchClip(id);
  await seek(0);

  let inFlight = false;
  return {
    seek,
    renderAudio,
    update(dt) {
      if (!playing || inFlight) return;
      playT = (playT + Math.min(dt, 0.1)) % DURATION;
      inFlight = true;
      void seek(playT).then(() => {
        inFlight = false;
      });
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      endCard.dispose();
      vfx.dispose();
      visuals.dispose();
      for (const e of envs.values()) e.dispose();
      graphics.dispose();
    },
  };
}
