// ?scene=rain (Grafik-3B, G6/G7): a 3-car train at speed on a long wet straight under rain, seen through the real
// CameraRig, to judge rain streaks, tyre spray, rooster tails, lens droplets, wet paint and rain lights.
// URL: &rain=0..1 (default 0.9) &wet=0..1 (default 0.95) &kmh=<speed> (default 250) &cam=chaseNear|chaseFar|cockpit|tcam|nose|tv|side
//      &tod=day|sunset|night &quality=low|medium|high|ultra &t=<prewarm s> &freeze=1 &gap=<m between cars> &brake=1
// The player is the last car (id 2); cars ahead at `gap` m (default 22) offset ±0.8 m.

import { Color, Mesh, MeshStandardMaterial, PlaneGeometry, Scene } from 'three';
import type { QualityId, TimeOfDay } from '../../contracts/common';
import type { SandboxScene } from '../../contracts/debug';
import type { LightingRig } from '../../contracts/environment';
import type { CarRenderState, RenderFrame, ViewId } from '../../contracts/render';
import { TEAMS } from '../../data/teams';
import { createCameraRig } from '../camera/cameraRig';
import { createCarVisuals } from '../car/carVisuals';
import { QUALITY_PRESETS } from '../presets';
import { createGraphicsSystem } from '../renderer/graphicsSystem';
import { createStage, DAY_RIG, NIGHT_RIG, SUNSET_RIG } from '../showroom/stage';
import { createVfx } from '../vfx/vfxSystem';

function car(id: number, teamId: string, num: number): CarRenderState {
  return {
    id, visible: true, isPlayer: id === 2, isGhost: false, ghostAlpha: 1, px: 0, py: 0, pz: 0, fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0,
    speed: 0, steerAngle: 0, wheelSpin: [0, 0, 0, 0], susp: [0, 0, 0, 0], rpm: 11000, gear: 7, throttle: 1, brake: 0, drsFlap: 0,
    brakeGlow: [0, 0, 0, 0], rainLight: 1, compound: 'wet', slip: [0.3, 0.3, 0.3, 0.3], wheelSurface: ['asphalt', 'asphalt', 'asphalt', 'asphalt'],
    sparks: 0, inPitBox: false, teamId, number: num, tcam: 'black', ersKw: 0, pitLimiter: false,
  };
}

const scene: SandboxScene = {
  id: 'rain',
  title: 'Rain',
  async create({ canvas, uiRoot, params }) {
    const qid = (params.get('quality') as QualityId | null) ?? 'high';
    const tod = (params.get('tod') as TimeOfDay | null) ?? 'day';
    const rainK = Number(params.get('rain') ?? 0.9);
    const wetK = Number(params.get('wet') ?? 0.95);
    const kmh = Number(params.get('kmh') ?? 250);
    const gap = Number(params.get('gap') ?? 22);
    const brake = params.get('brake') === '1';
    const graphics = createGraphicsSystem();
    const ctx = await graphics.init(canvas, QUALITY_PRESETS[qid] ?? QUALITY_PRESETS.high);
    const onResize = (): void => graphics.resize();
    window.addEventListener('resize', onResize);
    const stage = createStage(false);
    stage.setMode('day');
    stage.floor.visible = false;
    ctx.scene.add(stage.root);
    // Overcast rain rig (rendering.md §5.3 flavour): sun × 0.25, dense grey fog.
    const base = tod === 'night' ? NIGHT_RIG : tod === 'sunset' ? SUNSET_RIG : DAY_RIG;
    const rig: LightingRig = { ...base, sunIntensity: base.sunIntensity * (tod === 'night' ? 1 : 0.25), fogColor: tod === 'night' ? 0x10141c : 0x9aa1a8, fogDensity: 0.0016, exposure: tod === 'night' ? 0.9 : 0.85 };
    stage.key.intensity = rig.sunIntensity;
    stage.key.shadow.camera.left = stage.key.shadow.camera.bottom = -30;
    stage.key.shadow.camera.right = stage.key.shadow.camera.top = 30;
    stage.key.shadow.camera.far = 80;
    stage.key.shadow.camera.updateProjectionMatrix();
    // Overcast env (the stage's RoomEnvironment panels would mirror as bright boxes in the wet asphalt).
    const envScene = new Scene();
    envScene.background = new Color(tod === 'night' ? 0x0a0d14 : 0x8e959d);
    graphics.setLighting(rig, envScene);
    // Overcast sky: flat background (the stage backdrop dome is centred on the origin, far from the straight).
    stage.root.children[0]!.visible = false;
    ctx.scene.background = new Color(tod === 'night' ? 0x05070d : 0x8e959d);
    // Wet asphalt strip (placeholder for ÇEV's wet track): dark, low roughness.
    const asphalt = new Mesh(new PlaneGeometry(80, 6000), new MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.18 + 0.6 * (1 - wetK), metalness: 0 }));
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.position.y = 0.002;
    asphalt.receiveShadow = true;
    ctx.scene.add(asphalt);

    const teams = ['kestrel', 'solaris', params.get('team') ?? 'anka'];
    const specs = teams.map((t, i) => {
      const team = TEAMS.find((x) => x.id === t) ?? TEAMS[0]!;
      return { id: i, teamId: team.id, number: team.drivers[0].number, tcam: team.drivers[0].tcam, isGhost: false };
    });
    const visuals = createCarVisuals();
    await visuals.init(ctx, specs);
    const vfx = createVfx();
    vfx.init(ctx);
    const cars = specs.map((s) => car(s.id, s.teamId, s.number));
    const frame: RenderFrame = {
      time: 0, frameDt: 0, alpha: 0, cars, playerId: 2,
      conditions: { tod, rain: rainK, wetness: wetK, lineWetness: wetK, cloud: 1, time: 0 },
      lights: { lit: 0, out: true }, yellowSectors: [false, false, false], paused: false,
      racingLine: { mode: 'off', profile: null, playerS: 0, playerSpeed: 0 }, view: 'chaseNear', lookBack: false,
    };
    const camRig = createCameraRig(ctx);
    const camId = params.get('cam') ?? 'chaseNear';
    const side = camId === 'side';
    if (!side) camRig.setView(camId as ViewId);
    if (camId === 'cockpit') visuals.setCockpitCar(2);
    frame.view = side ? 'tv' : (camId as ViewId);

    const v = kmh / 3.6;
    const script = (t: number): void => {
      const z0 = -2800 + v * t;
      for (let i = 0; i < 3; i++) {
        const c = cars[i]!;
        c.speed = brake ? Math.max(20, v - 30 * Math.max(0, t - 2.5)) : v;
        c.pz = z0 + (2 - i) * gap;
        c.px = i === 2 ? 0 : i === 1 ? 0.8 : -0.8;
        c.brake = brake && t > 2.5 ? 1 : 0;
        c.brakeGlow.fill(brake ? Math.min(1, Math.max(0, (t - 2.5) * 0.8)) : 0);
        for (let w = 0; w < 4; w++) c.wheelSpin[w] = (t * c.speed / 0.36) % (Math.PI * 2);
      }
    };
    const cam = ctx.camera;
    const aimSide = (): void => {
      const c = cars[1]!;
      cam.position.set(c.px + 11, 2.2, c.pz + 9);
      cam.lookAt(c.px, 0.9, c.pz - 6);
      cam.fov = 40;
      cam.updateProjectionMatrix();
    };
    const step = 1 / 60;
    const prewarm = Number(params.get('t') ?? 3);
    let t = 0;
    for (let i = 0; i < Math.round(prewarm / step); i++) {
      t += step;
      script(t);
      frame.time = t;
      frame.frameDt = step;
      if (side) aimSide();
      else camRig.update(frame, step);
      visuals.update(frame, cam);
      vfx.update(frame, cam, step);
    }
    const freeze = params.get('freeze') === '1';
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;left:12px;bottom:12px;padding:6px 10px;background:rgba(9,11,14,.8);color:#F2F4F7;font:12px/1.45 ui-monospace,Consolas,monospace;white-space:pre;pointer-events:none';
    uiRoot.appendChild(overlay);
    (window as unknown as { __rain?: unknown }).__rain = { frame, vfx, visuals, graphics };
    let acc = 0;
    return {
      update(dt) {
        const d = freeze ? 0 : dt;
        t += d;
        script(t);
        frame.time = t;
        frame.frameDt = d;
        if (side) aimSide();
        else camRig.update(frame, d);
        visuals.update(frame, cam);
        vfx.update(frame, cam, d);
        graphics.render(frame);
        acc += dt;
        if (acc > 0.25) {
          acc = 0;
          const p = graphics.getPerf();
          const c = vfx.counts();
          overlay.textContent = `rain ${rainK} wet ${wetK} ${kmh} km/h  cam ${camId}  ${qid}\nstreaks ${c.rain}  spray pool ${c.spray}\ncalls ${p.calls}  tris ${p.triangles}  programs ${p.programs}`;
        }
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
