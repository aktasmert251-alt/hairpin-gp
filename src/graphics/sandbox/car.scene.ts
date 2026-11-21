// ?scene=car (Grafik-3B, G9): showroom turntable, livery browser (←/→), LOD browser (1/2/3, 0 = auto),
// 20-car grid view (G), wheel/steer/DRS sliders, draw-call/triangle overlay.
// URL: &team=<id> &lod=0|1|2 &grid=1 &cam=three4|front|side|rear|rear34|top|close|cockpit|low|wheel|wheelRear|far|suspF|suspR|suspSide|flank|inlet|wing|wingRear|wingSide|wingTop|chase|rearSide|rearLow &drs=0..1 &steer=rad
// &spin=rad &env=studio|day &quality=low|medium|high|ultra &freeze=1 &driver=1|2 &compound=soft|...

import GUI from 'lil-gui';
import { PerspectiveCamera, Vector3 } from 'three';
import type { Compound, QualityId } from '../../contracts/common';
import type { SandboxScene } from '../../contracts/debug';
import type { CarRenderState, CarVisualSpec, RenderFrame } from '../../contracts/render';
import { TEAMS } from '../../data/teams';
import { createCarVisuals } from '../car/carVisuals';
import { QUALITY_PRESETS } from '../presets';
import { createGraphicsSystem } from '../renderer/graphicsSystem';
import { createStage, DAY_RIG } from './showroomStage';

function carState(id: number, spec: CarVisualSpec, isPlayer: boolean): CarRenderState {
  return {
    id, visible: true, isPlayer, isGhost: false, ghostAlpha: 1, px: 0, py: 0, pz: 0, fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0,
    speed: 0, steerAngle: 0, wheelSpin: [0, 0, 0, 0], susp: [0, 0, 0, 0], rpm: 0, gear: 1, throttle: 0, brake: 0, drsFlap: 0,
    brakeGlow: [0, 0, 0, 0], rainLight: 0, compound: 'soft', slip: [0, 0, 0, 0], wheelSurface: ['asphalt', 'asphalt', 'asphalt', 'asphalt'],
    sparks: 0, inPitBox: false, teamId: spec.teamId, number: spec.number, tcam: spec.tcam, ersKw: 0, pitLimiter: false,
  };
}

const CAMS: Record<string, { pos: [number, number, number]; target: [number, number, number]; fov: number }> = {
  three4: { pos: [6.2, 1.1, 8.6], target: [0, 0.42, 0.15], fov: 32 },
  front: { pos: [0, 0.75, 9.5], target: [0, 0.45, 0], fov: 30 },
  side: { pos: [11, 0.75, 0.25], target: [0, 0.45, 0.25], fov: 32 },
  rear: { pos: [-4.5, 1.4, -8.5], target: [0, 0.5, -0.4], fov: 32 },
  top: { pos: [0.01, 13, 0.25], target: [0, 0, 0.25], fov: 30 },
  close: { pos: [2.3, 1.25, 3.2], target: [0, 0.55, 0.6], fov: 32 },
  low: { pos: [4.5, 0.32, 6.5], target: [0, 0.35, 0.3], fov: 30 },
  rear34: { pos: [5.5, 1.6, -7.5], target: [0, 0.45, -0.5], fov: 32 },
  cockpit: { pos: [0, 0.77, 0.36], target: [0, 0.6, 10], fov: 75 },
  // Front-left wheel close-up (model +x = left) and the same wheel from the rear quarter (disc/caliper behind spokes).
  wheel: { pos: [2.35, 0.55, 3.0], target: [0.8, 0.36, 1.962], fov: 24 },
  wheelRear: { pos: [2.2, 0.5, -0.4], target: [0.775, 0.36, -1.638], fov: 26 },
  // Suspension close-ups (front / rear corner, slightly ahead of / behind the axle so the links show past the tyre).
  suspF: { pos: [3.4, 0.62, 3.9], target: [0.42, 0.33, 1.95], fov: 26 },
  suspR: { pos: [3.3, 0.7, -3.9], target: [0.42, 0.36, -1.62], fov: 26 },
  suspSide: { pos: [5.5, 0.4, 0.15], target: [0.2, 0.36, 0.15], fov: 52 },
  // Sidepod inlet close-up (front 3/4, left pod).
  inlet: { pos: [2.5, 0.8, 2.6], target: [0.45, 0.45, 0.6], fov: 22 },
    // Sponsor close-up: sidepod flank and engine cover (left side).
  flank: { pos: [3.6, 0.85, -0.2], target: [0.3, 0.45, -0.6], fov: 34 },
    // Rear-wing close-ups (DRS open/closed checks).
  wing: { pos: [1.7, 1.3, -3.7], target: [0, 0.82, -2.35], fov: 28 },
  wingRear: { pos: [1.25, 0.98, -4.3], target: [0, 0.82, -2.4], fov: 24 },
  wingSide: { pos: [2.1, 1.02, -2.4], target: [0, 0.83, -2.38], fov: 20 },
  wingTop: { pos: [0.7, 1.75, -3.25], target: [0, 0.83, -2.4], fov: 28 },
  // Rear floor / diffuser close-ups: side and low rear 3/4.
  rearSide: { pos: [3.6, 0.55, -1.9], target: [0, 0.32, -1.95], fov: 40 },
  rearLow: { pos: [2.4, 0.4, -4.6], target: [0, 0.3, -1.9], fov: 34 },
  // Race chase-camera framing (behind and above the car).
  chase: { pos: [0, 1.6, -5.4], target: [0, 0.8, 1.5], fov: 50 },
  // Distant views for the LOD checks (with &lod=1 / &lod=2).
  far: { pos: [16, 3.0, 24], target: [0, 0.45, 0], fov: 18 },
  // Front wing / nose close-ups (Grafik-3 front module): 3/4, head-on and side.
  fw34: { pos: [2.9, 1.0, 5.4], target: [0.15, 0.2, 2.65], fov: 30 },
  fwFront: { pos: [0, 0.55, 7.2], target: [0, 0.25, 2.6], fov: 22 },
  fwSide: { pos: [4.2, 0.35, 2.6], target: [0, 0.22, 2.6], fov: 30 },
};

const scene: SandboxScene = {
  id: 'car',
  title: 'Car showroom',
  async create({ canvas, uiRoot, params }) {
    const qid = (params.get('quality') as QualityId | null) ?? 'high';
    const quality = QUALITY_PRESETS[qid] ?? QUALITY_PRESETS.high;
    const graphics = createGraphicsSystem();
    const ctx = await graphics.init(canvas, quality);
    const onResize = (): void => graphics.resize();
    window.addEventListener('resize', onResize);
    const stage = createStage(true);
    const envMode = params.get('env') === 'day' ? 'day' : 'studio';
    stage.setMode(envMode);
    ctx.scene.add(stage.root);
    const rig = { ...DAY_RIG, exposure: envMode === 'studio' ? 1.05 : 1.0, envIntensity: envMode === 'studio' ? 1.0 : 1.0 };
    graphics.setLighting(rig, stage.envScene);
    ctx.scene.fog = null;

    // 20 cars: every driver (team order); car 0 is the showroom car.
    const teamParam = params.get('team') ?? 'anka';
    const driverIdx = params.get('driver') === '2' ? 1 : 0;
    const specs: CarVisualSpec[] = [];
    let id = 0;
    const startTeam = Math.max(0, TEAMS.findIndex((t) => t.id === teamParam));
    for (let k = 0; k < TEAMS.length; k++) {
      const t = TEAMS[(startTeam + k) % TEAMS.length]!;
      for (const di of k === 0 ? [driverIdx, 1 - driverIdx] : [0, 1]) {
        const d = t.drivers[di]!;
        specs.push({ id: id++, teamId: t.id, number: d.number, tcam: d.tcam, isGhost: false });
      }
    }
    const visuals = createCarVisuals();
    if (teamParam === 'safetyCar') specs[0] = { ...specs[0]!, teamId: 'safetyCar', number: 0 };
    await visuals.init(ctx, specs);
    const cars = specs.map((s, i) => carState(s.id, s, i === 0));

    const frame: RenderFrame = {
      time: 0, frameDt: 0, alpha: 0, cars, playerId: 0,
      conditions: { tod: 'day', rain: 0, wetness: 0, lineWetness: 0, cloud: 0, time: 0 },
      lights: { lit: 0, out: false }, yellowSectors: [false, false, false], paused: false,
      racingLine: { mode: 'off', profile: null, playerS: 0, playerSpeed: 0 }, view: 'orbit', lookBack: false,
    };

    const ui = {
      lod: params.get('lod') ?? 'auto',
      grid: params.get('grid') === '1',
      steer: Number(params.get('steer') ?? 0),
      drs: Number(params.get('drs') ?? 0),
      spin: Number(params.get('spin') ?? 0),
      speed: Number(params.get('speed') ?? 0),
      glow: Number(params.get('glow') ?? 0),
      rain: Number(params.get('rain') ?? 0),
      turntable: params.get('freeze') !== '1',
      angle: Number(params.get('angle') ?? 0),
      cam: params.get('cam') ?? 'three4',
      quality: qid,
      compound: (params.get('compound') as Compound | null) ?? 'soft',
    };
    const applyLod = (): void => visuals.forceLod(ui.lod === 'auto' ? null : (Number(ui.lod) as 0 | 1 | 2));
    applyLod();

    const cam = ctx.camera;
    const placeCam = (): void => {
      if (ui.grid) {
        cam.fov = 55;
        cam.near = 0.1;
        cam.position.set(2.2, 2.4, -14);
        cam.lookAt(0, 0.6, 30);
      } else {
        const c = CAMS[ui.cam] ?? CAMS['three4']!;
        cam.fov = c.fov;
        cam.near = ui.cam === 'cockpit' ? 0.05 : 0.1;
        cam.position.set(...c.pos);
        cam.lookAt(new Vector3(...c.target));
      }
      cam.updateProjectionMatrix();
    };
    placeCam();
    visuals.setCockpitCar(ui.cam === 'cockpit' && !ui.grid ? 0 : null);

    const layout = (time: number): void => {
      for (let i = 0; i < cars.length; i++) {
        const cs = cars[i]!;
        if (ui.grid) {
          // Staggered 2-wide grid, 8 m between rows, facing +z.
          const row = Math.floor(i / 2);
          cs.px = i % 2 === 0 ? -2.2 : 2.2;
          cs.pz = row * 8 + (i % 2) * 4;
          cs.fx = 0;
          cs.fz = 1;
          cs.visible = true;
        } else {
          cs.visible = i === 0;
          const a = ui.angle + (ui.turntable ? time * ((6 * Math.PI) / 180) : 0);
          cs.px = 0;
          cs.pz = 0;
          cs.fx = Math.sin(a);
          cs.fz = Math.cos(a);
        }
        cs.py = 0;
        cs.steerAngle = ui.steer;
        cs.drsFlap = ui.drs;
        cs.speed = ui.speed;
        cs.compound = ui.compound;
        cs.rainLight = ui.rain >= 2 ? 2 : ui.rain >= 1 ? 1 : 0;
        for (let w = 0; w < 4; w++) {
          cs.wheelSpin[w] = ui.spin + (ui.speed / 0.36) * time;
          cs.brakeGlow[w] = ui.glow;
        }
      }
      stage.turntable.visible = !ui.grid;
    };

    // Overlay (sandbox-only numbers).
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;left:12px;bottom:12px;padding:6px 10px;background:rgba(9,11,14,.8);color:#F2F4F7;font:12px/1.45 ui-monospace,Consolas,monospace;white-space:pre;pointer-events:none;z-index:40';
    uiRoot.appendChild(overlay);
    const gui = new GUI({ title: 'car', container: uiRoot });
    gui.domElement.style.cssText = 'position:absolute;right:12px;top:12px;z-index:40';
    gui.add(ui, 'lod', ['auto', '0', '1', '2']).onChange(applyLod);
    gui.add(ui, 'grid').onChange(placeCam);
    gui.add(ui, 'cam', Object.keys(CAMS)).onChange(() => {
      placeCam();
      visuals.setCockpitCar(ui.cam === 'cockpit' ? 0 : null);
    });
    gui.add(ui, 'steer', -0.4, 0.4, 0.01);
    gui.add(ui, 'drs', 0, 1, 0.01);
    gui.add(ui, 'speed', 0, 90, 1);
    gui.add(ui, 'glow', 0, 1, 0.01);
    gui.add(ui, 'rain', 0, 2, 1);
    gui.add(ui, 'turntable');
    gui.add(ui, 'compound', ['soft', 'medium', 'hard', 'inter', 'wet']);
    gui.add(ui, 'quality', ['low', 'medium', 'high', 'ultra']).onChange((v: QualityId) => {
      graphics.setQuality(QUALITY_PRESETS[v]);
      visuals.setQuality(QUALITY_PRESETS[v]);
    });
    if (params.get('freeze') === '1') gui.close();
    if (params.get('gui') === '0') gui.hide();

    // Livery browser: rebuild the visuals with the next/previous team as car 0.
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        e.preventDefault();
        const i = TEAMS.findIndex((t) => t.id === (params.get('team') ?? 'anka'));
        const n = TEAMS[(i + (e.code === 'ArrowRight' ? 1 : TEAMS.length - 1)) % TEAMS.length]!;
        params.set('team', n.id);
        window.location.search = params.toString();
      } else if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3' || e.code === 'Digit0') {
        ui.lod = e.code === 'Digit0' ? 'auto' : String(Number(e.code.slice(5)) - 1);
        applyLod();
        gui.controllersRecursive().forEach((c) => c.updateDisplay());
      } else if (e.code === 'KeyG') {
        ui.grid = !ui.grid;
        placeCam();
      }
    };
    window.addEventListener('keydown', onKey);

    let t = 0;
    let overlayTimer = 0;
    const st = visuals.stats();
    return {
      update(dt) {
        t += ui.turntable ? dt : 0;
        frame.time = t;
        frame.frameDt = dt;
        layout(t);
        visuals.update(frame, ctx.camera);
        graphics.render(frame);
        overlayTimer -= dt;
        if (overlayTimer <= 0) {
          overlayTimer = 0.25;
          const p = graphics.getPerf();
          const s = visuals.stats();
          overlay.textContent = [
            `team ${specs[0]!.teamId} #${specs[0]!.number}  lod ${ui.lod}  quality ${ui.quality}`,
            `body tris L0 ${st.triangles[0]}  L1 ${st.triangles[1]}  L2 ${st.triangles[2]}`,
            `wheel tris (x4) L0 ${st.wheelTriangles[0]}  L1 ${st.wheelTriangles[1]}  L2 ${st.wheelTriangles[2]}`,
            `cars per LOD ${s.lodCounts.join(' / ')}  car draws (main) ${visuals.drawCalls()}`,
            `renderer calls ${p.calls}  tris ${p.triangles}  programs ${p.programs}  tex ${p.textures}  geo ${p.geometries}`,
          ].join('\n');
          (window as unknown as { __carStats?: unknown }).__carStats = { stats: s, static: st, carDraws: visuals.drawCalls(), perf: p };
        }
      },
      dispose() {
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('resize', onResize);
        gui.destroy();
        overlay.remove();
        visuals.dispose();
        stage.dispose();
        graphics.dispose();
      },
    };
  },
};

export default scene;

void PerspectiveCamera;
