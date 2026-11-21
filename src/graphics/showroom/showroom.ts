// Showroom (CR-15, DESIGN.md §1.4.5, rendering.md §9.3): main-menu 3D backdrop. One car on a matte turntable on
// dark glossy concrete, studio light (key softbox front-left 5600 K, cool rim right 7000 K, overhead strip).
// Camera 3/4 front, eye 1.1 m, FOV 32°, car centred at x ≈ 62 % of the screen. Turntable 6°/s, static under
// reduced motion. All 10 liveries are built and uploaded in init(), so setTeam() swaps within one frame.
// Renders through the GraphicsSystem that owns ctx.renderer (post chain, grade), found via the registry.

import { MathUtils, Vector3 } from 'three';
import type { LightingRig } from '../../contracts/environment';
import type { CarRenderState, CarVisualSpec, RenderContext, RenderFrame, Showroom } from '../../contracts/render';
import { TEAMS } from '../../data/teams';
import { createCarVisuals, type CarVisualsImpl } from '../car/carVisuals';
import { PRESET_DERIVED } from '../presets';
import { graphicsFor } from '../renderer/registry';
import { createReflectiveFloor, type ReflectiveFloor } from './reflectiveFloor';
import { createStage, DAY_RIG, type Stage } from './stage';

export interface ShowroomImpl extends Showroom {
  /** false = reduced motion: static 3/4 front pose (default follows prefers-reduced-motion). */
  setMotion(on: boolean): void;
  team(): string;
  /** renderer.info.render.calls of the last render (main + shadow + post). */
  drawCalls(): number;
  /** Turntable angle in rad (tests / screenshots). */
  setAngle(rad: number): void;
}

/** Studio rig: no fog, a touch over-exposed for the dark stage, bloom only on specular hits. */
export const STUDIO_RIG: Readonly<LightingRig> = {
  ...DAY_RIG, exposure: 1.1, envIntensity: 1.0, fogDensity: 0, bloomIntensity: 0.3, bloomThreshold: 0.9,
};

const TURN_RAD_S = MathUtils.degToRad(6);
const EYE = new Vector3(6.2, 1.1, 8.6);
const AIM = new Vector3(0, 0.42, 0.1);
const FOV = 32;
/** Screen x of the car centre (0..1). */
const CAR_X = 0.66; // aim point; perspective (nose nearer) puts the visual centre at ≈ 62 %

function carState(id: number, spec: CarVisualSpec): CarRenderState {
  return {
    id, visible: false, isPlayer: false, isGhost: false, ghostAlpha: 1, px: 0, py: 0, pz: 0, fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0,
    speed: 0, steerAngle: 0, wheelSpin: [0, 0, 0, 0], susp: [0, 0, 0, 0], rpm: 0, gear: 0, throttle: 0, brake: 0, drsFlap: 0,
    brakeGlow: [0, 0, 0, 0], rainLight: 0, compound: 'soft', slip: [0, 0, 0, 0], wheelSurface: ['asphalt', 'asphalt', 'asphalt', 'asphalt'],
    sparks: 0, inPitBox: false, teamId: spec.teamId, number: spec.number, tcam: spec.tcam, ersKw: 0, pitLimiter: false,
  };
}

export function createShowroom(): ShowroomImpl {
  let ctx: RenderContext | null = null;
  let stage: Stage | null = null;
  let floor: ReflectiveFloor | null = null;
  let visuals: CarVisualsImpl | null = null;
  let active = 0;
  let angle = 0;
  let motion = typeof matchMedia === 'function' ? !matchMedia('(prefers-reduced-motion: reduce)').matches : true;
  let calls = 0;
  const specs: CarVisualSpec[] = TEAMS.map((t, i) => ({ id: i, teamId: t.id, number: t.drivers[0].number, tcam: t.drivers[0].tcam, isGhost: false }));
  const cars: CarRenderState[] = specs.map((s, i) => carState(i, s));
  const frame: RenderFrame = {
    time: 0, frameDt: 0, alpha: 0, cars, playerId: 0,
    conditions: { tod: 'day', rain: 0, wetness: 0, lineWetness: 0, cloud: 0, time: 0 },
    lights: { lit: 0, out: false }, yellowSectors: [false, false, false], paused: false,
    racingLine: { mode: 'off', profile: null, playerS: 0, playerSpeed: 0 }, view: 'orbit', lookBack: false,
  };
  const D = new Vector3(), R = new Vector3(), T = new Vector3();
  const UP = new Vector3(0, 1, 0);

  const pose = (): void => {
    const s = Math.sin(angle), c = Math.cos(angle);
    for (let i = 0; i < cars.length; i++) {
      const cs = cars[i]!;
      cs.visible = i === active;
      cs.isPlayer = i === active;
      cs.fx = s;
      cs.fz = c;
    }
    frame.playerId = active;
    floor?.setAngle(angle);
  };

  const aimCamera = (): void => {
    if (!ctx) return;
    const cam = ctx.camera;
    cam.position.copy(EYE);
    cam.up.copy(UP);
    // Look left of the car so it lands at CAR_X of the width: tan(a) = ndcX · tan(fov/2) · aspect.
    D.subVectors(AIM, EYE);
    const dist = D.length();
    D.divideScalar(dist);
    R.crossVectors(D, UP).normalize();
    const tanA = (2 * CAR_X - 1) * Math.tan(MathUtils.degToRad(FOV / 2)) * cam.aspect;
    T.copy(AIM).addScaledVector(R, -dist * tanA);
    cam.lookAt(T);
    if (cam.fov !== FOV || cam.near !== 0.1) {
      cam.fov = FOV;
      cam.near = 0.1;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  };

  const room: ShowroomImpl = {
    async init(c) {
      ctx = c;
      stage = createStage(true);
      stage.setMode('studio');
      // The reflective floor replaces the stage's floor and turntable meshes.
      stage.floor.visible = false;
      stage.turntable.visible = false;
      c.scene.add(stage.root);
      floor = createReflectiveFloor(c.renderer);
      c.scene.add(floor.mesh);
      c.scene.fog = null;
      graphicsFor(c.renderer)?.system.setLighting({ ...STUDIO_RIG }, stage.envScene);
      visuals = createCarVisuals({ atlasSize: PRESET_DERIVED[c.quality.id].liveryAtlas });
      await visuals.init(c, specs);
      if (!ctx) return; // disposed while loading
      // Warm-up: every livery visible once (all LOD0) so programs compile and atlases upload before the menu shows.
      for (const cs of cars) cs.visible = true;
      visuals.forceLod(0);
      aimCamera();
      visuals.update(frame, c.camera);
      for (const t of visuals.liveryTextures()) c.renderer.initTexture(t);
      const sys = graphicsFor(c.renderer)?.system as { warmup?: (s: typeof c.scene, cam: typeof c.camera) => Promise<void> } | undefined;
      if (sys?.warmup) await sys.warmup(c.scene, c.camera);
      else await c.renderer.compileAsync(c.scene, c.camera);
      if (!visuals) return;
      visuals.forceLod(null);
      pose();
    },
    setTeam(teamId) {
      const i = specs.findIndex((s) => s.teamId === teamId);
      if (i >= 0) active = i;
    },
    render(dtS) {
      if (!ctx || !visuals) return;
      const dt = Math.max(0, Math.min(0.1, dtS));
      if (motion) angle = (angle + TURN_RAD_S * dt) % (Math.PI * 2);
      frame.time += dt;
      frame.frameDt = dt;
      frame.conditions.time = frame.time;
      pose();
      aimCamera();
      visuals.update(frame, ctx.camera);
      const g = graphicsFor(ctx.renderer);
      if (g) {
        g.system.render(frame);
        calls = ctx.renderer.info.render.calls;
      }
    },
    resize() {
      aimCamera();
      if (ctx) floor?.resize(ctx.renderer);
    },
    setMotion(on) {
      motion = on;
      if (!on) angle = 0;
    },
    team: () => specs[active]!.teamId,
    drawCalls: () => calls,
    setAngle(rad) {
      angle = rad;
    },
    dispose() {
      visuals?.dispose();
      visuals = null;
      floor?.dispose();
      floor = null;
      stage?.dispose();
      stage = null;
      ctx = null;
    },
  };
  return room;
}
