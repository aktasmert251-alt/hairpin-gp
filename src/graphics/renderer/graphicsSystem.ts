// GraphicsSystem (docs/design/rendering.md §1, §2, §4): WebGLRenderer, PMREM environment, post chain.
// Tone mapping happens in the post chain (AgX); renderer.toneMapping stays NoToneMapping.

import {
  type Camera, Color, FogExp2, type Object3D, NoToneMapping, PCFShadowMap, PMREMGenerator, PerspectiveCamera, SRGBColorSpace, Scene, type WebGLRenderTarget, WebGLRenderer,
} from 'three';
import type { LightingRig } from '../../contracts/environment';
import type { GraphicsSystem, QualityPreset, RenderContext, RenderFrame, RendererPerf } from '../../contracts/render';
import { createHeatHaze, type HeatHaze } from '../post/heatHaze';
import { rendererPixelRatio } from '../presets';
import { createLensDroplets, type LensDroplets } from '../post/lensDroplets';
import { createPostChain, type PostChain } from '../post/postChain';
import { registerGraphics, unregisterGraphics } from './registry';

/** Implementation extras beyond the contract (CR-09 setPostEnabled, sandbox helpers). */
export interface GraphicsSystemImpl extends GraphicsSystem {
  /** CR-09: `?nopost=1` / post scene A/B. */
  setPostEnabled(on: boolean): void;
  /** The live post chain (null before init). */
  post(): PostChain | null;
  /** Current lighting rig (null until setLighting). */
  rig(): LightingRig | null;
  /** Clears the per-frame renderer.info counters (called once per frame by render()). */
  resetInfo(): void;
  /**
   * Compiles `scene` for the post chain's linear render target. renderer.compileAsync() alone compiles the
   * 'srgb' output variant (no render target bound), and every program then recompiles on the first frame.
   */
  warmup(scene: Object3D, camera: Camera): Promise<void>;
  /** D-021: collision CA kick (impulse > 8,000 N·s adds 0.0008 UV, decaying linearly over 150 ms). */
  onCollision(impulse: number): void;
  /** QC2-06: frames rendered / skipped because MAX_FRAMES_IN_FLIGHT frames were still queued on the GPU. */
  frameQueueStats(): { rendered: number; skipped: number };
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** D-021 / sprint-2 G1: the collision CA kick lasts at most 150 ms. */
const CA_KICK_S = 0.15;

/** G6: lens droplets only in the on-board views. */
const INCAR_VIEWS = new Set(['cockpit', 'tcam', 'nose']);

/** rendering.md §4.4: spray = wetness · max over cars ahead (0 < Δs < 40 m, |Δd| < 3 m) of (1 − Δs/40). */
function sprayAhead(frame: RenderFrame): number {
  const p = frame.cars[frame.playerId];
  if (!p || frame.conditions.wetness <= 0) return 0;
  const fl = Math.hypot(p.fx, p.fz) || 1;
  const fx = p.fx / fl, fz = p.fz / fl;
  let best = 0;
  for (let i = 0; i < frame.cars.length; i++) {
    const c = frame.cars[i]!;
    if (c === p || !c.visible || c.isGhost) continue;
    const dx = c.px - p.px, dz = c.pz - p.pz;
    const along = dx * fx + dz * fz;
    if (along <= 0 || along >= 40) continue;
    const lat = -dx * fz + dz * fx;
    if (Math.abs(lat) >= 3) continue;
    best = Math.max(best, 1 - along / 40);
  }
  return frame.conditions.wetness * best;
}

const DRIVING_VIEWS = new Set(['cockpit', 'tcam', 'nose', 'chaseNear', 'chaseFar']);

/**
 * QC2-06: at most this many frames may be queued on the GPU. When the GPU is the bottleneck (Ultra, uncapped), Chrome
 * otherwise lets the queue grow and then blocks a WebGL call (bufferSubData / draw) for 50-200 ms about every 0.2 s.
 * A frame is skipped (no GL work, the canvas keeps the last image) while the queue is full.
 */
const MAX_FRAMES_IN_FLIGHT = 3;

export function createGraphicsSystem(opts: { motionEffects?: () => boolean } = {}): GraphicsSystemImpl {
  let ctx: RenderContext | null = null;
  let canvasEl: HTMLCanvasElement | null = null;
  let post: PostChain | null = null;
  let envTarget: WebGLRenderTarget | null = null;
  let envScene: Scene | null = null;
  let rig: LightingRig | null = null;
  let fog: FogExp2 | null = null;
  let lastTime = -1;
  let collisionKick = 0;
  let droplets: LensDroplets | null = null;
  let lensHold = 0;
  let haze: HeatHaze | null = null;
  const fences: WebGLSync[] = [];
  let skippedDt = 0;
  let nRendered = 0;
  let nSkipped = 0;
  const motionEffects = opts.motionEffects ?? ((): boolean => true);

  const sizeOf = (canvas: HTMLCanvasElement): { w: number; h: number } => {
    const w = canvas.clientWidth || canvas.parentElement?.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || canvas.parentElement?.clientHeight || window.innerHeight;
    return { w: Math.max(1, w), h: Math.max(1, h) };
  };

  const regenEnv = (): void => {
    if (!ctx || !envScene) return;
    const old = envTarget;
    envTarget = ctx.pmrem.fromScene(envScene, 0, 0.5, 3000, { size: ctx.quality.envSize });
    ctx.scene.environment = envTarget.texture;
    old?.dispose();
  };

  const system: GraphicsSystemImpl = {
    async init(canvas, q) {
      canvasEl = canvas;
      const renderer = new WebGLRenderer({
        canvas, antialias: false, alpha: false, stencil: false, depth: true, powerPreference: 'high-performance',
        preserveDrawingBuffer: false, logarithmicDepthBuffer: false,
      });
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = NoToneMapping;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = PCFShadowMap;
      renderer.info.autoReset = false;
      const scene = new Scene();
      scene.background = null;
      const { w, h } = sizeOf(canvas);
      const camera = new PerspectiveCamera(65, w / h, 0.1, q.far);
      const pmrem = new PMREMGenerator(renderer);
      pmrem.compileCubemapShader();
      pmrem.compileEquirectangularShader();
      ctx = { renderer, scene, camera, pmrem, quality: q, width: w, height: h, pixelRatio: 1 };
      post = createPostChain(renderer, scene, camera, q);
      droplets = createLensDroplets();
      droplets.compile(renderer);
      haze = createHeatHaze();
      haze.compile(renderer, camera);
      registerGraphics(renderer, { post, system });
      system.resize();
      return ctx;
    },
    setQuality(q: QualityPreset) {
      if (!ctx) return;
      const prev = ctx.quality;
      ctx.quality = q;
      if (prev.far !== q.far) {
        ctx.camera.far = q.far;
        ctx.camera.updateProjectionMatrix();
      }
      post?.setQuality(q);
      if (prev.renderScale !== q.renderScale || prev.id !== q.id) system.resize();
      if (prev.envSize !== q.envSize) regenEnv();
    },
    setLighting(r, scene) {
      if (!ctx) return;
      rig = r;
      envScene = scene;
      // Per-track look: the environment tags its env scene with the track id (tracks-visual pass).
      const tid = (scene.userData as { trackId?: unknown }).trackId;
      if (typeof tid === 'string' && post) post.setLook(tid);
      regenEnv();
      ctx.scene.environmentIntensity = r.envIntensity;
      // Fog: managed here only when nobody else installed one (the environment may own its own fog object).
      if (ctx.scene.fog === null || ctx.scene.fog === fog) {
        if (!fog) fog = new FogExp2(new Color(r.fogColor).getHex(), r.fogDensity);
        ctx.scene.fog = fog;
      }
    },
    render(frame: RenderFrame) {
      if (!ctx || !post) return;
      const gl = ctx.renderer.getContext() as WebGL2RenderingContext;
      while (fences.length > 0 && gl.getSyncParameter(fences[0]!, gl.SYNC_STATUS) === gl.SIGNALED) gl.deleteSync(fences.shift()!);
      if (fences.length >= MAX_FRAMES_IN_FLIGHT) {
        skippedDt += frame.frameDt;
        nSkipped++;
        return;
      }
      system.resetInfo();
      const dt = lastTime < 0 ? 0 : Math.max(0, Math.min(0.1, frame.frameDt + skippedDt));
      skippedDt = 0;
      lastTime = frame.time;
      if (rig) {
        ctx.scene.environmentIntensity = rig.envIntensity;
        if (fog && ctx.scene.fog === fog) {
          fog.color.setHex(rig.fogColor);
          fog.density = rig.fogDensity;
        }
      }
      // Chromatic aberration (§4.2): speed-driven, plus a decaying kick after hard collisions.
      const view = frame.view ?? 'chaseNear';
      const player = frame.cars[frame.playerId];
      let a = 0;
      if (player && motionEffects() && DRIVING_VIEWS.has(view)) {
        a = 0.0011 * smooth(160, 330, player.speed * 3.6) + collisionKick;
      }
      collisionKick = Math.max(0, collisionKick - (0.0008 / CA_KICK_S) * dt);
      post.setAberration(a);
      post.setVignetteScale(view === 'cockpit' && !frame.lookBack ? 0.75 : 1);
      post.suppressAo(ctx.camera.fov < 20);
      // Lens droplets (G6): on-board views only; drops keep their analytic life for 3.5 s after the rain stops.
      let lensOn = false;
      if (droplets && player && INCAR_VIEWS.has(view) && !frame.lookBack) {
        const rain = frame.conditions?.rain ?? 0;
        const rate = rain * (12 + 20 * sprayAhead(frame));
        lensHold = rate > 0.05 ? 3.5 : Math.max(0, lensHold - dt);
        if (lensHold > 0) {
          const kmh = Math.abs(player.speed) * 3.6;
          const radial = view !== 'tcam' && kmh >= 80 ? 0.15 + 0.6 * smooth(80, 250, kmh) : 0;
          droplets.render(ctx.renderer, frame.time, rate, radial, ctx.quality.id === 'low' ? 24 : 48);
          lensOn = true;
        }
      } else lensHold = 0;
      post.setLens(lensOn ? 1 : 0, lensOn && droplets ? droplets.texture : null);
      // Heat haze (G10, §4.4): Ultra only, dry, day/sunset; exhausts of visible, moving rival cars within 60 m. The
      // player car is skipped (its haze warped the rear wing in chase views) and so are stationary cars (showroom).
      let hazeOn = false;
      const cond = frame.conditions;
      if (haze && ctx.quality.lens === 'all' && cond && cond.wetness < 0.1 && cond.tod !== 'night') {
        const cp = ctx.camera.position;
        let n = 0;
        for (let i = 0; i < frame.cars.length; i++) {
          const c = frame.cars[i]!;
          if (!c.visible || c.isGhost || i === frame.playerId || c.speed < 5) continue;
          const x = c.px + c.ux * 0.55 - c.fx * 2.45, y = c.py + c.uy * 0.55 - c.fy * 2.45, z = c.pz + c.uz * 0.55 - c.fz * 2.45;
          const d = Math.hypot(x - cp.x, y - cp.y, z - cp.z);
          if (d >= 60) continue;
          haze.set(n++, x, y, z, 1 - smooth(45, 60, d));
        }
        if (n > 0) {
          haze.render(ctx.renderer, ctx.camera, frame.time, n);
          hazeOn = true;
        }
      }
      // Lava shimmer (Volcano Rim only: the environment lists its heat sources on the env scene): High and Ultra, any
      // time of day; up to 12 large sprites over the lava nearest the camera, within 180 m.
      const heat = (envScene?.userData as { heatSources?: Float32Array } | undefined)?.heatSources;
      if (haze && heat && (ctx.quality.id === 'high' || ctx.quality.id === 'ultra') && !hazeOn) {
        const cp = ctx.camera.position;
        let n = 0;
        for (let k = 0; k + 2 < heat.length && n < 12; k += 3) {
          const d = Math.hypot(heat[k]! - cp.x, heat[k + 1]! - cp.y, heat[k + 2]! - cp.z);
          if (d >= 180) continue;
          haze.set(n++, heat[k]!, heat[k + 1]!, heat[k + 2]!, 1 - smooth(120, 180, d), 34, 12, 2.2);
        }
        if (n > 0) {
          haze.render(ctx.renderer, ctx.camera, frame.time, n);
          hazeOn = true;
        }
      }
      post.setHaze(hazeOn && haze ? haze.texture : null);
      post.update(rig, frame.conditions?.cloud ?? 0, dt);
      post.render(dt);
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (sync) fences.push(sync);
      nRendered++;
    },
    resize() {
      if (!ctx || !canvasEl) return;
      const { w, h } = sizeOf(canvasEl);
      const pr = rendererPixelRatio(ctx.quality, window.devicePixelRatio);
      ctx.renderer.setPixelRatio(pr);
      ctx.renderer.setSize(w, h, false);
      post?.setSize(w, h);
      droplets?.setSize(Math.round(w * pr), Math.round(h * pr));
      haze?.setSize(Math.round(w * pr), Math.round(h * pr));
      ctx.camera.aspect = w / h;
      ctx.camera.updateProjectionMatrix();
      ctx.width = w;
      ctx.height = h;
      ctx.pixelRatio = pr;
    },
    getPerf(): RendererPerf {
      if (!ctx) return { calls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0 };
      const info = ctx.renderer.info;
      return {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
      };
    },
    setPostEnabled(on) {
      post?.setPostEnabled(on);
    },
    post: () => post,
    async warmup(scene, camera) {
      if (!ctx) return;
      const r = ctx.renderer;
      const prev = r.getRenderTarget();
      r.setRenderTarget(post ? post.composer.inputBuffer : null);
      try {
        await r.compileAsync(scene, camera);
      } finally {
        r.setRenderTarget(prev);
      }
    },
    onCollision(impulse) {
      if (impulse > 8000 && motionEffects()) collisionKick = 0.0008;
    },
    rig: () => rig,
    frameQueueStats: () => ({ rendered: nRendered, skipped: nSkipped }),
    resetInfo() {
      ctx?.renderer.info.reset();
    },
    dispose() {
      if (!ctx) return;
      ctx.renderer.setAnimationLoop(null);
      const gl = ctx.renderer.getContext() as WebGL2RenderingContext;
      for (const f of fences) gl.deleteSync(f);
      fences.length = 0;
      unregisterGraphics(ctx.renderer);
      if (ctx.scene.fog === fog) ctx.scene.fog = null;
      fog = null;
      ctx.scene.environment = null;
      envTarget?.dispose();
      envTarget = null;
      envScene = null;
      post?.dispose();
      post = null;
      droplets?.dispose();
      droplets = null;
      haze?.dispose();
      haze = null;
      ctx.pmrem.dispose();
      ctx.renderer.dispose();
      ctx = null;
      canvasEl = null;
      rig = null;
    },
  };
  return system;
}
