// ?scene=cameras (Grafik-3B, G6): the player car runs a scripted lap of the track centreline with three cars
// ahead; C cycles the 5 driving cameras, T = TV, O = orbit, V (held) = look-back, K = kerb shake.
// URL: &cam=cockpit|tcam|nose|chaseNear|chaseFar|tv|orbit &kmh=<speed> &s=<start m> &t=<s> &freeze=1 &quality=...
// &behind=1: the three cars run behind / alongside instead (mirror check, D-051 #5).

import type { CameraId, QualityId } from '../../contracts/common';
import type { SandboxScene } from '../../contracts/debug';
import type { CarRenderState, CarVisualSpec, RenderFrame, ViewId } from '../../contracts/render';
import type { TrackFrame } from '../../contracts/track';
import { TEAMS } from '../../data/teams';
import { buildEnvironment, loadTrack } from '../../track/index';
import { createAIModule } from '../../ai/index';
import { defaultVehicleParams } from '../../physics/index';
import { createRacingLineVisual } from '../racingLine/racingLineVisual';
import { createCameraRig } from '../camera/cameraRig';
import { createCarVisuals } from '../car/carVisuals';
import { QUALITY_PRESETS } from '../presets';
import { createGraphicsSystem } from '../renderer/graphicsSystem';
import { createSandboxAssets } from './sandboxAssets';

function carState(spec: CarVisualSpec, isPlayer: boolean): CarRenderState {
  return {
    id: spec.id, visible: true, isPlayer, isGhost: false, ghostAlpha: 1, px: 0, py: 0, pz: 0, fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0,
    speed: 0, steerAngle: 0, wheelSpin: [0, 0, 0, 0], susp: [0, 0, 0, 0], rpm: 0, gear: 1, throttle: 1, brake: 0, drsFlap: 0,
    brakeGlow: [0, 0, 0, 0], rainLight: 0, compound: 'medium', slip: [0, 0, 0, 0], wheelSurface: ['asphalt', 'asphalt', 'asphalt', 'asphalt'],
    sparks: 0, inPitBox: false, teamId: spec.teamId, number: spec.number, tcam: spec.tcam, ersKw: 0, pitLimiter: false,
  };
}

const scene: SandboxScene = {
  id: 'cameras',
  title: 'Camera rig',
  async create({ canvas, params }) {
    const qid = (params.get('quality') as QualityId | null) ?? 'high';
    const quality = QUALITY_PRESETS[qid] ?? QUALITY_PRESETS.high;
    const graphics = createGraphicsSystem();
    const ctx = await graphics.init(canvas, quality);
    const onResize = (): void => graphics.resize();
    window.addEventListener('resize', onResize);
    const track = loadTrack();
    const q = track.query;
    const assets = createSandboxAssets();
    const conditions = { tod: 'day' as const, rain: 0, wetness: 0, lineWetness: 0, cloud: 0, time: 0 };
    const env = await buildEnvironment({ track, quality, conditions, ctx, assets, onProgress: () => {} });
    ctx.scene.add(env.root);
    graphics.setLighting(env.rig, env.envScene);

    // &team=<id>: the player car's team (the other three follow in team order).
    const t0 = Math.max(0, TEAMS.findIndex((t) => t.id === params.get('team')));
    const specs: CarVisualSpec[] = [0, 2, 4, 6].map((ti, i) => {
      const t = TEAMS[(t0 + ti) % TEAMS.length]!;
      return { id: i, teamId: t.id, number: t.drivers[0].number, tcam: t.drivers[0].tcam, isGhost: false };
    });
    const visuals = createCarVisuals();
    await visuals.init(ctx, specs);
    const cars = specs.map((s, i) => carState(s, i === 0));
    const frame: RenderFrame = {
      time: 0, frameDt: 0, alpha: 0, cars, playerId: 0, conditions,
      lights: { lit: 0, out: false }, yellowSectors: [false, false, false], paused: false,
      racingLine: { mode: 'off', profile: null, playerS: 0, playerSpeed: 0 }, view: 'chaseNear', lookBack: false,
    };
    // Racing line (G8): AI line + player speed profile, &line=corners|full.
    const ai = createAIModule();
    ai.prepare(q, specs.map(() => defaultVehicleParams(0)));
    const racingLine = createRacingLineVisual();
    racingLine.init(ctx, ai.getRacingLine());
    frame.racingLine.mode = (params.get('line') as 'corners' | 'full' | null) ?? 'off';
    frame.racingLine.profile = ai.getProfile(0);
    const rig = createCameraRig(ctx);
    rig.setTrack(q);
    const camParam = (params.get('cam') ?? 'chaseNear') as ViewId;
    rig.setView(camParam);
    visuals.setCockpitCar(camParam === 'cockpit' ? 0 : null);

    const kmh = Number(params.get('kmh') ?? 220);
    let s0 = Number(params.get('s') ?? 600);
    const tf: TrackFrame = { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: 1, halfWidthL: 7, halfWidthR: 7, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 };
    const place = (cs: CarRenderState, s: number, d: number, v: number, dt: number): void => {
      q.frameAt(q.wrapS(s), tf);
      cs.px = tf.px + tf.lx * d;
      cs.pz = tf.pz + tf.lz * d;
      cs.py = tf.py + tf.crossSlope * d;
      const g = tf.grade;
      const l = Math.hypot(1, g);
      cs.fx = tf.tx / l;
      cs.fy = g / l;
      cs.fz = tf.tz / l;
      cs.ux = 0;
      cs.uy = 1;
      cs.uz = 0;
      cs.speed = v;
      cs.steerAngle = Math.max(-0.35, Math.min(0.35, tf.curvature * 3.6));
      for (let w = 0; w < 4; w++) cs.wheelSpin[w] += (v / 0.36) * dt;
    };

    let t = Number(params.get('t') ?? 0);
    const freeze = params.get('freeze') === '1';
    const behind = params.get('behind') === '1';
    let shotFrames = 0;
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'KeyC') {
        const m: CameraId = rig.next();
        visuals.setCockpitCar(m === 'cockpit' ? 0 : null);
      } else if (e.code === 'KeyT') {
        rig.setView('tv');
        visuals.setCockpitCar(null);
      } else if (e.code === 'KeyO') {
        rig.setView('orbit');
        visuals.setCockpitCar(null);
      } else if (e.code === 'KeyV') rig.setLookBack(e.type === 'keydown');
      else if (e.code === 'KeyK' && e.type === 'keydown') rig.onSimEvent({ type: 'kerb', car: 0, wheel: 0, sausage: true });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    return {
      update(dt) {
        const step = freeze && shotFrames > 3 ? 0 : dt;
        shotFrames++;
        t += freeze ? 0 : step;
        const v = kmh / 3.6;
        const sp = s0 + v * t;
        place(cars[0]!, sp, 0, v, step);
        if (behind) {
          place(cars[1]!, sp - 14, 2.2, v, step);
          place(cars[2]!, sp - 30, -2.0, v, step);
          place(cars[3]!, sp - 4, -3.4, v, step);
        } else {
          place(cars[1]!, sp + 22, 1.6, v, step);
          place(cars[2]!, sp + 45, -1.4, v, step);
          place(cars[3]!, sp + 80, 0.8, v, step);
        }
        frame.time = t;
        frame.frameDt = step;
        frame.racingLine.playerS = q.wrapS(sp);
        frame.racingLine.playerSpeed = v;
        rig.update(frame, freeze ? 1 / 60 : step);
        frame.view = rig.view();
        env.update(ctx.camera, frame, step);
        visuals.update(frame, ctx.camera);
        racingLine.update(frame);
        graphics.render(frame);
        (window as unknown as { __camDbg?: unknown }).__camDbg = { p: ctx.camera.position.toArray(), fov: ctx.camera.fov, view: rig.view() };
      },
      dispose() {
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
        window.removeEventListener('resize', onResize);
        visuals.dispose();
        racingLine.dispose();
        env.dispose();
        assets.dispose();
        graphics.dispose();
        void s0;
        s0 = 0;
      },
    };
  },
};

export default scene;
