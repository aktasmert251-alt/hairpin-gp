// ?scene=post (Grafik-3B, G2): car on a turntable over an asphalt disc with HDR emissive bars (bloom), post chain
// A/B per effect (lil-gui), preset switch, LUT preview per grade.
// URL: &quality=low|medium|high|ultra &lut=day|sunset|night|overcast &tod=day|sunset|night &nopost=1 &freeze=1
// &leaktest=1 cycles the four presets 20 times and stores renderer.info.memory before/after in window.__leak.

import GUI from 'lil-gui';
import { BoxGeometry, CircleGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, type Material, type BufferGeometry } from 'three';
import type { QualityId } from '../../contracts/common';
import type { SandboxScene } from '../../contracts/debug';
import type { LightingRig } from '../../contracts/environment';
import type { CarRenderState, QualityPreset, RenderFrame } from '../../contracts/render';
import { TEAMS } from '../../data/teams';
import { createCarVisuals } from '../car/carVisuals';
import { QUALITY_PRESETS } from '../presets';
import { createGraphicsSystem } from '../renderer/graphicsSystem';
import { createStage, DAY_RIG, NIGHT_RIG, SUNSET_RIG } from './showroomStage';

type Grade = 'day' | 'sunset' | 'night' | 'overcast';

const scene: SandboxScene = {
  id: 'post',
  title: 'Post chain',
  async create({ canvas, uiRoot, params }) {
    const qid = (params.get('quality') as QualityId | null) ?? 'high';
    let preset: QualityPreset = { ...(QUALITY_PRESETS[qid] ?? QUALITY_PRESETS.high) };
    const graphics = createGraphicsSystem();
    const ctx = await graphics.init(canvas, preset);
    const onResize = (): void => graphics.resize();
    window.addEventListener('resize', onResize);
    const stage = createStage(true);
    stage.setMode('day');
    ctx.scene.add(stage.root);
    const tod = (params.get('tod') as 'day' | 'sunset' | 'night' | null) ?? 'day';
    const rig: LightingRig = { ...(tod === 'sunset' ? SUNSET_RIG : tod === 'night' ? NIGHT_RIG : DAY_RIG) };
    graphics.setLighting(rig, stage.envScene);
    ctx.scene.fog = null;
    stage.key.color.setHex(rig.sunColor);
    stage.key.intensity = rig.sunIntensity;
    stage.key.position.set(rig.sunDir.x * 15, Math.max(2, rig.sunDir.y * 15), rig.sunDir.z * 15);

    // Asphalt disc and HDR emissive bars (bloom test) behind the car.
    const owned: { g: BufferGeometry; m: Material }[] = [];
    const disc = new Mesh(new CircleGeometry(9, 64), new MeshStandardMaterial({ color: 0x2f3236, roughness: 0.92, metalness: 0 }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.001;
    disc.receiveShadow = true;
    ctx.scene.add(disc);
    owned.push({ g: disc.geometry, m: disc.material });
    const barColors = [0xff3a1a, 0xffffff, 0x2a7bff, 0xffb000];
    barColors.forEach((c, i) => {
      const m = new MeshBasicMaterial({ color: c });
      m.color.multiplyScalar(6);
      const bar = new Mesh(new BoxGeometry(0.12, 2.2, 0.12), m);
      bar.position.set(-4.5 + i * 3, 1.1, -5.5);
      ctx.scene.add(bar);
      owned.push({ g: bar.geometry, m });
    });

    const team = TEAMS.find((t) => t.id === (params.get('team') ?? 'anka')) ?? TEAMS[0]!;
    const visuals = createCarVisuals();
    await visuals.init(ctx, [{ id: 0, teamId: team.id, number: team.drivers[0].number, tcam: team.drivers[0].tcam, isGhost: false }]);
    const cs: CarRenderState = {
      id: 0, visible: true, isPlayer: true, isGhost: false, ghostAlpha: 1, px: 0, py: 0, pz: 0, fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0,
      speed: 0, steerAngle: 0.12, wheelSpin: [0, 0, 0, 0], susp: [0, 0, 0, 0], rpm: 0, gear: 1, throttle: 0, brake: 0, drsFlap: 0,
      brakeGlow: [0.9, 0.9, 0.5, 0.5], rainLight: 1, compound: 'soft', slip: [0, 0, 0, 0], wheelSurface: ['asphalt', 'asphalt', 'asphalt', 'asphalt'],
      sparks: 0, inPitBox: false, teamId: team.id, number: team.drivers[0].number, tcam: team.drivers[0].tcam, ersKw: 0, pitLimiter: false,
    };
    const frame: RenderFrame = {
      time: 0, frameDt: 0, alpha: 0, cars: [cs], playerId: 0,
      conditions: { tod: rig.tod, rain: 0, wetness: 0, lineWetness: 0, cloud: 0, time: 0 },
      lights: { lit: 0, out: false }, yellowSectors: [false, false, false], paused: false,
      racingLine: { mode: 'off', profile: null, playerS: 0, playerSpeed: 0 }, view: 'orbit', lookBack: false,
    };
    const cam = ctx.camera;
    cam.fov = 34;
    cam.position.set(6.4, 1.6, 7.8);
    cam.lookAt(0, 0.6, -0.6);
    cam.updateProjectionMatrix();

    const ui = {
      quality: qid as QualityId,
      post: params.get('nopost') !== '1',
      bloom: preset.bloom,
      lut: preset.lut,
      ao: preset.ao,
      aa: preset.aa,
      grade: (params.get('lut') as Grade | null) ?? 'auto',
      exposure: rig.exposure,
      turntable: params.get('freeze') !== '1',
    };
    const apply = (): void => {
      preset = { ...QUALITY_PRESETS[ui.quality], bloom: ui.bloom, lut: ui.lut, ao: ui.ao, aa: ui.aa };
      graphics.setQuality(preset);
      visuals.setQuality(preset);
    };
    graphics.setPostEnabled(ui.post);
    graphics.post()?.forceGrade(ui.grade === 'auto' ? null : (ui.grade as Grade));

    const gui = new GUI({ title: 'post', container: uiRoot });
    gui.domElement.style.cssText = 'position:absolute;right:12px;top:12px;z-index:40';
    gui.add(ui, 'quality', ['low', 'medium', 'high', 'ultra']).onChange((v: QualityId) => {
      const p = QUALITY_PRESETS[v];
      ui.bloom = p.bloom;
      ui.lut = p.lut;
      ui.ao = p.ao;
      ui.aa = p.aa;
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      apply();
    });
    gui.add(ui, 'post').onChange((v: boolean) => graphics.setPostEnabled(v));
    gui.add(ui, 'bloom').onChange(apply);
    gui.add(ui, 'lut').onChange(apply);
    gui.add(ui, 'ao', ['off', 'half', 'full']).onChange(apply);
    gui.add(ui, 'aa', ['fxaa', 'smaa']).onChange(apply);
    gui.add(ui, 'grade', ['auto', 'day', 'sunset', 'night', 'overcast']).onChange((v: string) => graphics.post()?.forceGrade(v === 'auto' ? null : (v as Grade)));
    gui.add(ui, 'exposure', 0.3, 2.5, 0.01).onChange((v: number) => (rig.exposure = v));
    gui.add(ui, 'turntable');
    if (params.get('freeze') === '1') gui.close();
    if (params.get('gui') === '0') gui.hide();

    // Leak test (G1 acceptance): 20 preset switches, compare renderer.info.memory.
    const leak = params.get('leaktest') === '1';
    const order: QualityId[] = ['low', 'medium', 'high', 'ultra'];
    let leakStep = -1;
    let before: { geometries: number; textures: number; programs: number } | null = null;

    let t = 0;
    return {
      update(dt) {
        if (ui.turntable) t += dt;
        const a = 0.7 + t * ((6 * Math.PI) / 180);
        cs.fx = Math.sin(a);
        cs.fz = Math.cos(a);
        frame.time = t;
        frame.frameDt = dt;
        visuals.update(frame, cam);
        graphics.render(frame);
        if (leak) {
          (window as unknown as { __leakStep?: number }).__leakStep = leakStep;
          const info = ctx.renderer.info;
          if (leakStep === -1 && t >= 0) {
            leakStep = 0;
          } else if (leakStep >= 0 && leakStep < 80) {
            // 4 presets × 20 cycles, one switch every frame; snapshot after the first full cycle.
            if (leakStep === 4) before = { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0 };
            const id = order[leakStep % 4]!;
            ui.quality = id;
            preset = QUALITY_PRESETS[id];
            graphics.setQuality(preset);
            visuals.setQuality(preset);
            leakStep++;
          } else if (leakStep === 80) {
            const after = { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0 };
            (window as unknown as { __leak?: unknown }).__leak = { switches: 80, before, after };
            leakStep++;
          }
        }
      },
      dispose() {
        window.removeEventListener('resize', onResize);
        gui.destroy();
        visuals.dispose();
        for (const o of owned) {
          o.g.dispose();
          o.m.dispose();
        }
        stage.dispose();
        graphics.dispose();
      },
    };
  },
};

export default scene;
