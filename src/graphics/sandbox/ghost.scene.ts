// ?scene=ghost (Grafik-3B, G4): the player car on an asphalt apron with its Time Trial ghost 3.2 m ahead and 2.3 m
// to the left. URL: &alpha=<ghostAlpha 0..1> &team=<id> &cam=chase|side|cockpit &quality=… &freeze=1
// The ghost is LOD1 in one draw, dithered at ghostAlpha, on GHOST_LAYER (no shadow, no VFX, not in mirrors).

import { Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import type { QualityId } from '../../contracts/common';
import type { SandboxScene } from '../../contracts/debug';
import type { CarRenderState, RenderFrame } from '../../contracts/render';
import { TEAMS } from '../../data/teams';
import { createCarVisuals } from '../car/carVisuals';
import { QUALITY_PRESETS } from '../presets';
import { createGraphicsSystem } from '../renderer/graphicsSystem';
import { createVfx } from '../vfx/vfxSystem';
import { createStage, DAY_RIG } from '../showroom/stage';

function car(id: number, teamId: string, num: number, ghost: boolean, x: number, z: number): CarRenderState {
  return {
    id, visible: true, isPlayer: !ghost, isGhost: ghost, ghostAlpha: 1, px: x, py: 0, pz: z, fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0,
    speed: 40, steerAngle: 0, wheelSpin: [0, 0, 0, 0], susp: [0, 0, 0, 0], rpm: 11000, gear: 5, throttle: 1, brake: 0, drsFlap: 0,
    brakeGlow: [0, 0, 0, 0], rainLight: 0, compound: 'soft', slip: [0, 0, 0, 0], wheelSurface: ['asphalt', 'asphalt', 'asphalt', 'asphalt'],
    sparks: ghost ? 1 : 0, inPitBox: false, teamId, number: num, tcam: 'black', ersKw: 0, pitLimiter: false,
  };
}

const scene: SandboxScene = {
  id: 'ghost',
  title: 'TT ghost',
  async create({ canvas, uiRoot, params }) {
    const qid = (params.get('quality') as QualityId | null) ?? 'high';
    const graphics = createGraphicsSystem();
    const ctx = await graphics.init(canvas, QUALITY_PRESETS[qid] ?? QUALITY_PRESETS.high);
    const onResize = (): void => graphics.resize();
    window.addEventListener('resize', onResize);
    const stage = createStage(false);
    stage.setMode('day');
    stage.key.shadow.camera.left = stage.key.shadow.camera.bottom = -20;
    stage.key.shadow.camera.right = stage.key.shadow.camera.top = 20;
    stage.key.shadow.camera.far = 60;
    stage.key.shadow.camera.updateProjectionMatrix();
    ctx.scene.add(stage.root);
    graphics.setLighting({ ...DAY_RIG }, stage.envScene);
    ctx.scene.fog = null;
    const asphalt = new Mesh(new PlaneGeometry(400, 400), new MeshStandardMaterial({ color: 0x3b3e43, roughness: 0.92 }));
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.position.y = 0.002;
    asphalt.receiveShadow = true;
    ctx.scene.add(asphalt);

    const team = TEAMS.find((t) => t.id === (params.get('team') ?? 'anka')) ?? TEAMS[0]!;
    const num = team.drivers[0].number;
    const visuals = createCarVisuals();
    await visuals.init(ctx, [
      { id: 0, teamId: team.id, number: num, tcam: 'black', isGhost: false },
      { id: 1, teamId: team.id, number: num, tcam: 'black', isGhost: true },
    ]);
    const vfx = createVfx();
    vfx.init(ctx);
    const alpha = Number(params.get('alpha') ?? 0.45);
    const cars = [car(0, team.id, num, false, 0, 0), car(1, team.id, num, true, 2.3, 3.2)];
    cars[1]!.ghostAlpha = alpha;
    const frame: RenderFrame = {
      time: 0, frameDt: 0, alpha: 0, cars, playerId: 0,
      conditions: { tod: 'day', rain: 0, wetness: 0, lineWetness: 0, cloud: 0, time: 0 },
      lights: { lit: 0, out: false }, yellowSectors: [false, false, false], paused: false,
      racingLine: { mode: 'off', profile: null, playerS: 0, playerSpeed: 0 }, view: 'chaseNear', lookBack: false,
    };
    const camMode = params.get('cam') ?? 'chase';
    const cam = ctx.camera;
    if (camMode === 'side') cam.position.set(9, 1.6, 4), cam.lookAt(0.8, 0.5, 3);
    else if (camMode === 'cockpit') {
      cam.position.set(0, 0.77, 0.36), cam.lookAt(0.4, 0.6, 10);
      visuals.setCockpitCar(0);
    } else cam.position.set(-1.2, 2.3, -6.2), cam.lookAt(1.0, 0.6, 2.5);
    cam.fov = camMode === 'cockpit' ? 75 : 60;
    cam.updateProjectionMatrix();
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;left:12px;bottom:12px;padding:6px 10px;background:rgba(9,11,14,.8);color:#F2F4F7;font:12px/1.45 ui-monospace,Consolas,monospace;white-space:pre;pointer-events:none';
    uiRoot.appendChild(overlay);
    const freeze = params.get('freeze') === '1';
    let t = 0;
    return {
      update(dt) {
        if (!freeze) t += dt;
        frame.time = t;
        frame.frameDt = freeze ? 0 : dt;
        for (const c of cars) for (let w = 0; w < 4; w++) c.wheelSpin[w] = (t * 120) % (Math.PI * 2);
        visuals.update(frame, cam);
        vfx.update(frame, cam, freeze ? 0 : dt);
        graphics.render(frame);
        const p = graphics.getPerf();
        overlay.textContent = `ghostAlpha ${alpha}  car draws ${visuals.drawCalls()}\ncalls ${p.calls}  tris ${p.triangles}`;
      },
      dispose() {
        window.removeEventListener('resize', onResize);
        overlay.remove();
        vfx.dispose();
        visuals.dispose();
        asphalt.geometry.dispose();
        (asphalt.material as MeshStandardMaterial).dispose();
        stage.dispose();
        graphics.dispose();
      },
    };
  },
};

export default scene;
