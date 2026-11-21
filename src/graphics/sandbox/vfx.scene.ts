// ?scene=vfx (Grafik-3B, G7): scripted car states on an asphalt/gravel apron to exercise each VFX family.
// URL: &fx=smoke|sparks|dust|skids &t=<prewarm s> &freeze=1 &quality=low|medium|high|ultra
//   smoke: rear-wheel burnout circling;  sparks: 290 km/h bottoming pass;  dust: car running wide on gravel;
//   skids: hard braking with locked fronts through a curve. Overlay shows pool sizes for the preset.

import { CircleGeometry, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import type { QualityId, SurfaceType } from '../../contracts/common';
import type { SandboxScene } from '../../contracts/debug';
import type { CarRenderState, RenderFrame } from '../../contracts/render';
import { TEAMS } from '../../data/teams';
import { createCarVisuals } from '../car/carVisuals';
import { QUALITY_PRESETS } from '../presets';
import { createGraphicsSystem } from '../renderer/graphicsSystem';
import { createVfx } from '../vfx/vfxSystem';
import { createStage, DAY_RIG } from './showroomStage';

type Fx = 'smoke' | 'sparks' | 'dust' | 'skids';

const scene: SandboxScene = {
  id: 'vfx',
  title: 'VFX',
  async create({ canvas, uiRoot, params }) {
    const qid = (params.get('quality') as QualityId | null) ?? 'high';
    const quality = QUALITY_PRESETS[qid] ?? QUALITY_PRESETS.high;
    const fx = (params.get('fx') as Fx | null) ?? 'smoke';
    const graphics = createGraphicsSystem();
    const ctx = await graphics.init(canvas, quality);
    const onResize = (): void => graphics.resize();
    window.addEventListener('resize', onResize);
    const stage = createStage(false);
    stage.setMode('day');
    ctx.scene.add(stage.root);
    graphics.setLighting({ ...DAY_RIG }, stage.envScene);
    ctx.scene.fog = null;
    stage.key.shadow.camera.left = stage.key.shadow.camera.bottom = -40;
    stage.key.shadow.camera.right = stage.key.shadow.camera.top = 40;
    stage.key.shadow.camera.far = 80;
    stage.key.shadow.camera.updateProjectionMatrix();
    const asphalt = new Mesh(new PlaneGeometry(400, 400), new MeshStandardMaterial({ color: 0x3b3e43, roughness: 0.92 }));
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.position.y = 0.002;
    asphalt.receiveShadow = true;
    const gravel = new Mesh(new CircleGeometry(25, 48), new MeshStandardMaterial({ color: 0x9c8b70, roughness: 1 }));
    gravel.rotation.x = -Math.PI / 2;
    gravel.position.set(0, 0.004, 60);
    gravel.receiveShadow = true;
    ctx.scene.add(asphalt, gravel);

    const team = TEAMS.find((t) => t.id === (params.get('team') ?? 'anka')) ?? TEAMS[0]!;
    const visuals = createCarVisuals();
    await visuals.init(ctx, [{ id: 0, teamId: team.id, number: team.drivers[0].number, tcam: team.drivers[0].tcam, isGhost: false }]);
    const vfx = createVfx();
    vfx.init(ctx);
    const cs: CarRenderState = {
      id: 0, visible: true, isPlayer: true, isGhost: false, ghostAlpha: 1, px: 0, py: 0, pz: 0, fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0,
      speed: 0, steerAngle: 0, wheelSpin: [0, 0, 0, 0], susp: [0, 0, 0, 0], rpm: 0, gear: 1, throttle: 1, brake: 0, drsFlap: 0,
      brakeGlow: [0, 0, 0, 0], rainLight: 0, compound: 'soft', slip: [0, 0, 0, 0], wheelSurface: ['asphalt', 'asphalt', 'asphalt', 'asphalt'],
      sparks: 0, inPitBox: false, teamId: team.id, number: team.drivers[0].number, tcam: team.drivers[0].tcam, ersKw: 0, pitLimiter: false,
    };
    const frame: RenderFrame = {
      time: 0, frameDt: 0, alpha: 0, cars: [cs], playerId: 0,
      conditions: { tod: 'day', rain: 0, wetness: 0, lineWetness: 0, cloud: 0, time: 0 },
      lights: { lit: 0, out: false }, yellowSectors: [false, false, false], paused: false,
      racingLine: { mode: 'off', profile: null, playerS: 0, playerSpeed: 0 }, view: 'tv', lookBack: false,
    };
    const setSurf = (s: SurfaceType): void => {
      for (let i = 0; i < 4; i++) cs.wheelSurface[i] = s;
    };

    /** Scripted car state at time t for the chosen family. */
    const script = (t: number): void => {
      cs.sparks = 0;
      cs.slip.fill(0.4);
      setSurf('asphalt');
      if (fx === 'smoke') {
        // Burnout donut: radius 6 m around the origin, yaw rate 1.2 rad/s, rear wheels spinning.
        const a = t * 1.2;
        cs.px = Math.sin(a) * 6;
        cs.pz = Math.cos(a) * 6;
        cs.fx = Math.cos(a) * 0.6 + Math.sin(a) * 0.8;
        cs.fz = -Math.sin(a) * 0.6 + Math.cos(a) * 0.8;
        const l = Math.hypot(cs.fx, cs.fz);
        cs.fx /= l;
        cs.fz /= l;
        cs.speed = 7.2;
        cs.slip[2] = cs.slip[3] = 2.0;
        cs.steerAngle = 0.3;
      } else if (fx === 'sparks') {
        cs.px = 0;
        cs.pz = -60 + ((t * 80) % 160);
        cs.fx = 0;
        cs.fz = 1;
        cs.speed = 80.5;
        cs.sparks = 1;
        cs.steerAngle = 0;
      } else if (fx === 'dust') {
        cs.px = Math.sin(t * 0.5) * 8;
        cs.pz = 40 + ((t * 33) % 40);
        cs.fx = Math.cos(t * 0.5) * 0.25;
        cs.fz = 1;
        const l = Math.hypot(cs.fx, cs.fz);
        cs.fx /= l;
        cs.fz /= l;
        cs.speed = 33;
        if (cs.pz > 42) setSurf('gravel');
      } else {
        // Skids: braking through a gentle left curve with locked fronts and sliding rears.
        const r = 40;
        const a = Math.min(t, 4) * 0.35;
        cs.px = r - Math.cos(a) * r;
        cs.pz = Math.sin(a) * r - 20;
        cs.fx = Math.sin(a);
        cs.fz = Math.cos(a);
        cs.speed = Math.max(4, 55 - t * 12);
        cs.slip[0] = cs.slip[1] = 1.6;
        cs.slip[2] = cs.slip[3] = 1.25;
        cs.brakeGlow.fill(0.9);
        cs.steerAngle = 0.12;
      }
      for (let w = 0; w < 4; w++) cs.wheelSpin[w] = (fx === 'skids' && w < 2 ? 0 : t * 30) % (Math.PI * 2);
    };

    const cam = ctx.camera;
    const aim = (): void => {
      cam.fov = 42;
      if (fx === 'smoke') cam.position.set(14, 4.5, 14), cam.lookAt(0, 1, 0);
      else if (fx === 'sparks') cam.position.set(cs.px + 4.5, 1.1, cs.pz - 9), cam.lookAt(cs.px, 0.4, cs.pz + 2);
      else if (fx === 'dust') cam.position.set(cs.px + 12, 3.5, cs.pz - 12), cam.lookAt(cs.px, 1, cs.pz + 2);
      else cam.position.set(cs.px + 9, 6.5, cs.pz + 4), cam.lookAt(cs.px - 2, 0, cs.pz - 9);
      cam.updateProjectionMatrix();
    };

    // Prewarm: run `t` seconds at a fixed 60 Hz so emission and ring buffers fill deterministically.
    const prewarm = Number(params.get('t') ?? (fx === 'skids' ? 3.6 : fx === 'sparks' ? 1.4 : 4));
    let t = 0;
    const step = 1 / 60;
    for (let i = 0; i < Math.round(prewarm / step); i++) {
      t += step;
      script(t);
      frame.time = t;
      vfx.update(frame, cam, step);
    }
    const freeze = params.get('freeze') === '1';
    (window as unknown as { __vfx?: unknown }).__vfx = { vfx, cs, cam };
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;left:12px;bottom:12px;padding:6px 10px;background:rgba(9,11,14,.8);color:#F2F4F7;font:12px/1.45 ui-monospace,Consolas,monospace;white-space:pre;pointer-events:none';
    uiRoot.appendChild(overlay);

    return {
      update(dt) {
        if (!freeze) {
          t += dt;
          script(t);
        }
        frame.time = t;
        frame.frameDt = freeze ? 0 : dt;
        aim();
        visuals.update(frame, cam);
        vfx.update(frame, cam, freeze ? 0 : dt);
        graphics.render(frame);
        const c = vfx.counts();
        const p = graphics.getPerf();
        overlay.textContent = `fx ${fx}  quality ${qid}\npools smoke ${c.smoke}  sparks ${c.sparks}  dust ${c.dust}  skids ${c.skids}\ncalls ${p.calls}  tris ${p.triangles}`;
      },
      dispose() {
        window.removeEventListener('resize', onResize);
        overlay.remove();
        vfx.dispose();
        visuals.dispose();
        asphalt.geometry.dispose();
        (asphalt.material as MeshStandardMaterial).dispose();
        gravel.geometry.dispose();
        (gravel.material as MeshStandardMaterial).dispose();
        stage.dispose();
        graphics.dispose();
      },
    };
  },
};

export default scene;
