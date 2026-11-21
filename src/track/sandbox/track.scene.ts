// ?scene=track (Çevre): the full track environment through the real GraphicsSystem. &track=istanbul|lombardia (default istanbul).
// Cameras: &cam=<preset> (per track, see PRESETS; aerial everywhere), then orbit (default), free-fly (G: WASD, R/F, arrows, Shift)
// or drive-along (V: follows the centreline at the GUI speed). &quality=low|medium|high|ultra, &tod=day|sunset|night,
// &rain=0..1, &wet=0..1, &cloud=0..1, &weather=dry|light|heavy, &line=0..1 (racing-line wetness), &freeze=1 (time stops), &clean=1 (no GUI/overlay). lil-gui: TOD, rain,
// wetness, cloud, quality, camera mode. window.__trackStats() → renderer.info of a plain main pass and of the frame.

import GUI from 'lil-gui';
import { Frustum, HalfFloatType, Matrix4, NoColorSpace, RepeatWrapping, Sphere, SRGBColorSpace, TextureLoader, Vector3, WebGLRenderTarget, type Mesh, type Texture } from 'three';
import type { QualityId, TimeOfDay, Vec3, WeatherPreset } from '../../contracts/common';
import type { ConditionsFrame } from '../../contracts/conditions';
import type { SessionConfig } from '../../contracts/race';
import { applyConditionsOverride, conditionsFrame, initConditions } from '../../race/index';
import type { SandboxScene } from '../../contracts/debug';
import type { AssetLoader, AssetProgress, RenderFrame } from '../../contracts/render';
import { createGraphicsSystem, QUALITY_PRESETS } from '../../graphics/index';
import type { RaceTrackId } from '../../contracts/track';
import type { BuiltTrackId } from '../authoring/types';
import { getTrackExtras } from '../build/extras';
import { buildEnvironment, loadTrack } from '../index';

function sandboxAssets(): AssetLoader {
  const loader = new TextureLoader();
  const owned = new Set<Texture>();
  const prog: AssetProgress = { loaded: 0, total: 0, progress: 1 };
  return {
    async texture(url, o) {
      const t = await loader.loadAsync(url);
      t.colorSpace = (o?.srgb ?? true) ? SRGBColorSpace : NoColorSpace;
      if (o?.repeat) t.wrapS = t.wrapT = RepeatWrapping;
      t.anisotropy = o?.anisotropy ?? 1;
      owned.add(t);
      return t;
    },
    release(t) {
      owned.delete(t);
      t.dispose();
    },
    refCount: () => 0,
    font: async () => true,
    track: (w) => w,
    progress: () => prog,
    onProgress: () => () => {},
    resetProgress() {},
    async warmup(renderer, scene, camera) {
      await renderer.compileAsync(scene, camera);
    },
    dispose() {
      for (const t of owned) t.dispose();
      owned.clear();
    },
  };
}

/** Camera presets per track: [pos, look] as (s on the OSM basis, d, height). */
type Triple = [number, number, number];
const PRESETS: Partial<Record<BuiltTrackId, Record<string, [Triple, Triple]>>> = {
  istanbul: {
    sf: [[5225, 3, 3.2], [40, -6, 3.5]],
    t1: [[172, 6.5, 3.4], [258, -14, 0.8]],
    t3: [[900, -22, 8], [985, 2, 2]],
    t8: [[2392, -62, 16], [2300, 4, 0]],
    t9: [[3180, -20, 10], [3270, 0, 0]],
    t12: [[4552, -16, 5.5], [4672, 6, 0.5]],
    pit: [[5150, 4, 6], [5190, 16, 0]],
  },
  lombardia: {
    sf: [[5730, 1, 3.2], [120, 2, 3.5]],
    t1: [[470, -3, 3.4], [625, 4, 0.8]],
    forest: [[2140, 2, 3.2], [2260, -8, 1.5]],
    ruin: [[3160, 2, 3.2], [3300, 0, 5]],
    t11: [[5180, 30, 9], [5020, 0, 0]],
    pit: [[5600, -4, 6], [5640, -18, 0]],
  },
  bosphorus: {
    sf: [[4560, 2, 3.2], [120, 0, 3.5]],
    straight: [[420, 3, 4.5], [4560, -6, 8]],
    t1: [[760, 3, 3.4], [945, 4, 0.8]],
    t4: [[1400, 2, 3.2], [1520, -2, 2.5]],
    ridge: [[2120, 2, 3.2], [2600, 0, 2]],
    t9: [[3960, -16, 7], [3860, 2, 0]],
    water: [[560, -46, 7], [820, -420, 0]],
    pit: [[4900, 4, 6], [4950, 16, 0]],
  },
  ardennes: {
    sf: [[6880, 2, 3.2], [160, 0, 3.5]],
    t1: [[340, 14, 8], [262, -6, 0]],
    dip: [[700, 2, 3.2], [1040, 0, 0]],
    climb: [[930, 3, 2.6], [1180, 0, 9]],
    forest: [[5480, 2, 3.2], [5760, 0, 2]],
    t8: [[3070, 12, 9], [2945, -4, 0]],
    t18: [[6500, 2, 3.4], [6640, 0, 1]],
    pit: [[60, -6, 6], [100, -20, 0]],
  },
  cappadocia: {
    sf: [[4400, 2, 3.5], [60, 0, 2]],
    t1stand: [[262, -6, 5], [205, 38, 9]],
    chicane: [[1735, 2, 3.2], [1835, 0, 1]],
    chimneys: [[850, 8, 10], [905, -170, 30]],
    castle: [[4300, 30, 18], [4320, 300, 70]],
    village: [[2120, 2, 3.2], [2252, 0, 2]],
  },
  aegean: {
    sf: [[6000, 3, 3.5], [400, 0, 2]],
    causeway: [[300, 2, 3.2], [600, 0, 2]],
    cable: [[1380, -170, 25], [1590, 0, 12]],
    cabledeck: [[1380, 2, 3.2], [1590, 0, 8]],
    esses: [[2040, 2, 3.2], [2300, 0, 1]],
    pontoon: [[2760, 2, 3], [3000, 0, 1]],
    breakwater: [[2880, 70, 10], [2960, 0, -1]],
    tunnel: [[3700, 2, 3], [3800, 0, 3]],
    hairpin: [[3890, 22, 10], [3956, -4, 0]],
    longbridge: [[4100, 2, 3.2], [4600, 0, 2]],
    longside: [[4650, -260, 35], [4700, 0, 0]],
    harbour: [[5520, 40, 18], [5600, 230, -4]],
    pit: [[6000, -10, 6], [6040, -26, 0]],
  },
  cliff: {
    sf: [[7120, -3, 3.5], [500, 0, 8]],
    ramp: [[420, 2, 3.2], [800, 0, 3]],
    ramp2: [[600, 2, 3.2], [960, 0, 3]],
    t1: [[880, 2, 3.2], [1100, 0, 2]],
    t2: [[1060, 12, 4], [1178, -4, 0]],
    plunge: [[1260, 2, 3.2], [1600, 0, 0]],
    side: [[650, -200, 15], [900, 0, -5]],
    under: [[1120, 140, -55], [1170, 0, -6]],
    canyon: [[5900, 3, 3.2], [6100, 0, 0]],
    t11: [[4420, -30, 12], [4526, 4, 0]],
    pit: [[7080, 10, 6], [7120, 26, 0]],
  },
  alpine: {
    sf: [[5520, 3, 3.5], [420, 0, 4]],
    t1: [[640, 16, 9], [553, -6, 0]],
    esses: [[960, 3, 3.2], [1330, 0, 24]],
    portal: [[1945, 2, 3.2], [2060, 0, 4]],
    tunnel: [[2080, 1, 2.6], [2200, 0, 3]],
    summit: [[2560, 2, 3.2], [2900, 0, -8]],
    descent: [[3090, 2, 3.2], [3400, 0, -24]],
    hairpin: [[4040, 24, 12], [4157, -4, 0]],
    cable: [[110, -150, 25], [160, -900, 220]],
    lake: [[5500, 30, 25], [5800, 600, 160]],
    pit: [[5500, -8, 6], [5540, -24, 0]],
  },
  eifel: {
    sf: [[20280, 3, 3.5], [300, 0, 4]],
    t1: [[760, 16, 9], [670, -6, 0]],
    gp: [[1600, 30, 18], [1730, 0, 0]],
    esses: [[2700, 2, 3.2], [3000, 0, 2]],
    rush: [[3950, 2, 3.2], [4300, 0, -15]],
    dip: [[5300, 2, 3.2], [5700, 0, -2]],
    village: [[7300, 3, 3.5], [7520, 0, 2]],
    bridge: [[7700, 3, 3.5], [7900, 0, 1]],
    castle: [[7820, 25, 25], [7900, -420, 130]],
    climb: [[10450, 2, 3.2], [10700, 0, 8]],
    bowl: [[11780, 22, 10], [11890, -6, 0]],
    crest: [[13300, 2, 3.2], [13560, 0, 2]],
    plateau: [[15050, 2, 3.2], [15400, 0, 2]],
    straight: [[18000, 2, 3.2], [19500, 0, 2]],
    hump: [[18760, 2, 3.2], [19000, 0, 3]],
    pit: [[20100, -8, 6], [20140, -26, 0]],
  },
};

const scene: SandboxScene = {
  id: 'track',
  title: 'Track environment',
  async create({ canvas, uiRoot, params }) {
    const trackId = (params.get('track') ?? 'istanbul') as RaceTrackId;
    const track = loadTrack(trackId);
    const { data, query: q } = track;
    const L = data.length;
    const S = (s: number): number => q.wrapS(s * getTrackExtras(data)!.sScale);
    const qid = (params.get('quality') ?? 'high') as QualityId;
    let quality = QUALITY_PRESETS[qid] ?? QUALITY_PRESETS.high;
    const graphics = createGraphicsSystem();
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block';
    const ctx = await graphics.init(canvas, quality);
    const assets = sandboxAssets();
    const freeze = params.get('freeze') === '1';
    const clean = params.get('clean') === '1';
    const num = (k: string, d: number): number => {
      const v = Number(params.get(k));
      return params.has(k) && Number.isFinite(v) ? v : d;
    };
    const conditions: ConditionsFrame = {
      tod: (params.get('tod') ?? 'day') as TimeOfDay, rain: num('rain', 0), wetness: num('wet', 0), lineWetness: num('wet', 0) * 0.5,
      cloud: num('cloud', num('rain', 0) > 0 ? 1 : 0), time: num('t', 12),
    };
    // &weather=dry|light|heavy: the race ConditionsSystem's values for that preset (H-COND), &line= overrides lineWetness.
    const weather = params.get('weather') as WeatherPreset | null;
    if (weather) {
      const cs = initConditions({ tod: conditions.tod, weather, seed: 1 } as SessionConfig);
      applyConditionsOverride(cs, { weather });
      conditionsFrame(cs, conditions.time, conditions);
    }
    if (params.has('line')) conditions.lineWetness = num('line', conditions.lineWetness);
    const env = await buildEnvironment({ track, quality, conditions, ctx, assets, onProgress: () => {} });
    ctx.scene.add(env.root);
    graphics.setLighting(env.rig, env.envScene);
    if (params.get('nopost') === '1') graphics.setPostEnabled(false);
    const noFog = params.get('fog') === '0';
    if (noFog) ctx.scene.fog = null;

    const cam = ctx.camera;
    cam.fov = 50;
    cam.near = 0.1;
    cam.far = num('far', quality.far);
    cam.updateProjectionMatrix();
    const P: Vec3 = { x: 0, y: 0, z: 0 };
    const at = (s: number, d: number, h: number): Vector3 => {
      q.worldFromSD(S(s), d, P);
      return new Vector3(P.x, P.y + h, P.z);
    };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < data.count; i++) {
      minX = Math.min(minX, data.x[i]!); maxX = Math.max(maxX, data.x[i]!);
      minZ = Math.min(minZ, data.z[i]!); maxZ = Math.max(maxZ, data.z[i]!);
    }
    const presets: Record<string, () => [Vector3, Vector3]> = {
      ...Object.fromEntries(Object.entries(PRESETS[data.id as BuiltTrackId] ?? {}).map(([k, [a, b]]) => [k, (): [Vector3, Vector3] => [at(...a), at(...b)]])),
      aerial: () => [new Vector3((minX + maxX) / 2 - 520, 560, maxZ + 420), new Vector3((minX + maxX) / 2 + 40, 0, (minZ + maxZ) / 2 + 60)],
    };
    const camId = params.get('cam') ?? 'sf';
    let [p0, t0] = (presets[camId] ?? presets.sf ?? presets.aerial!)();
    // &pos=s,d,h&look=s,d,h (OSM-basis s, metres) overrides the preset.
    const triple = (k: string): number[] | null => {
      const v = params.get(k)?.split(',').map(Number);
      return v && v.length === 3 && v.every(Number.isFinite) ? v : null;
    };
    const pp = triple('pos');
    const lp = triple('look');
    if (pp) p0 = at(pp[0]!, pp[1]!, pp[2]!);
    if (lp) t0 = at(lp[0]!, lp[1]!, lp[2]!);
    cam.position.copy(p0);
    const target = t0.clone();
    cam.lookAt(target);

    // ---- camera modes -------------------------------------------------------------------------------------
    type Mode = 'orbit' | 'free' | 'drive';
    const st = { mode: 'orbit' as Mode, kmh: 180, driveS: S(5250), tod: conditions.tod, rain: conditions.rain, wet: conditions.wetness, cloud: conditions.cloud, quality: quality.id };
    const keys = new Set<string>();
    let yaw = 0;
    let pitch = 0;
    const syncAngles = (): void => {
      const dir = new Vector3();
      cam.getWorldDirection(dir);
      yaw = Math.atan2(dir.x, -dir.z);
      pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    };
    syncAngles();
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code === 'KeyG') { st.mode = st.mode === 'free' ? 'orbit' : 'free'; syncAngles(); }
      else if (e.code === 'KeyV') st.mode = st.mode === 'drive' ? 'orbit' : 'drive';
      keys.add(e.code);
      if (e.code.startsWith('Arrow') || ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF'].includes(e.code)) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      keys.delete(e.code);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    const onResize = (): void => graphics.resize();
    window.addEventListener('resize', onResize);

    // ---- GUI + overlay ------------------------------------------------------------------------------------
    let gui: GUI | null = null;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;left:12px;bottom:10px;font:12px/1.35 Consolas,monospace;color:#e8e8e8;background:rgba(9,11,14,.7);padding:6px 8px;pointer-events:none;white-space:pre';
    const pushConditions = (): void => {
      conditions.tod = st.tod;
      conditions.rain = st.rain;
      conditions.wetness = st.wet;
      conditions.lineWetness = st.wet * 0.5;
      conditions.cloud = st.cloud;
      env.applyConditions(conditions);
      graphics.setLighting(env.rig, env.envScene);
      if (noFog) ctx.scene.fog = null;
    };
    if (!clean) {
      uiRoot.appendChild(overlay);
      gui = new GUI({ title: 'track', container: uiRoot });
      gui.domElement.style.cssText += ';position:fixed;top:8px;right:8px;pointer-events:auto';
      gui.add(st, 'tod', ['day', 'sunset', 'night']).onChange(pushConditions);
      gui.add(st, 'cloud', 0, 1, 0.05).onChange(pushConditions);
      gui.add(st, 'rain', 0, 1, 0.05).onChange(pushConditions);
      gui.add(st, 'wet', 0, 1, 0.05).name('wetness').onChange(pushConditions);
      gui.add(st, 'quality', ['low', 'medium', 'high', 'ultra']).onChange((id: QualityId) => {
        quality = QUALITY_PRESETS[id];
        graphics.setQuality(quality);
        env.setQuality(quality);
        cam.far = quality.far;
        cam.updateProjectionMatrix();
      });
      gui.add(st, 'mode', ['orbit', 'free', 'drive']).listen().onChange(syncAngles);
      gui.add(st, 'kmh', 40, 340, 10).name('drive km/h');
      if (freeze) gui.close();
    }

    const frame: RenderFrame = {
      time: conditions.time, frameDt: 1 / 60, alpha: 0, cars: [], playerId: 0, conditions,
      lights: { lit: 0, out: false }, yellowSectors: [false, false, false], paused: false,
      racingLine: { mode: 'off', profile: null, playerS: 0, playerSpeed: 0 }, view: 'free', lookBack: false,
    };
    const stats = { mainCalls: 0, mainTris: 0 };
    const measureMain = (): { calls: number; triangles: number } => {
      const r = ctx.renderer;
      const shadow = r.shadowMap.enabled;
      r.shadowMap.enabled = false;
      r.info.reset();
      r.render(ctx.scene, cam);
      const res = { calls: r.info.render.calls, triangles: r.info.render.triangles };
      r.shadowMap.enabled = shadow;
      r.info.reset();
      return res;
    };
    (window as unknown as { __trackStats: () => unknown }).__trackStats = () => {
      const main = measureMain();
      graphics.render(frame);
      return { quality: quality.id, cam: camId, conditions: { ...conditions }, main, frame: graphics.getPerf() };
    };
    // Program census: name (material name) and usage count of every live WebGLProgram; `env` counts the environment's
    // share (env material names, sky, shadow-depth programs: every shadow caster in this scene is environment).
    // warm=true first compiles every visible material into an offscreen linear target, like the post chain renders
    // (a screen-target compile would create sRGB/tone-mapped variants that a post-processed frame never uses).
    const warmup = (): void => {
      const rt = new WebGLRenderTarget(4, 4, { type: HalfFloatType });
      const prev = ctx.renderer.getRenderTarget();
      ctx.renderer.setRenderTarget(rt);
      ctx.renderer.compile(ctx.scene, cam);
      ctx.renderer.setRenderTarget(prev);
      rt.dispose();
    };
    // Session-like warm-up before the first frame (also primes the scene's light state, so the first shadow pass
    // does not compile light-less depth variants).
    warmup();
    (window as unknown as { __trackPrograms: (warm?: boolean) => unknown }).__trackPrograms = (warm) => {
      if (warm) warmup();
      const progs = (ctx.renderer.info.programs ?? []) as unknown as { name: string; usedTimes: number; cacheKey: string }[];
      const envNames = new Set<string>(['sky', 'sky.env']);
      env.root.traverse((o) => {
        const m = (o as { material?: { name: string } | { name: string }[] }).material;
        for (const x of Array.isArray(m) ? m : m ? [m] : []) if (x.name) envNames.add(x.name);
      });
      const isEnv = (p: { name: string; cacheKey: string }): boolean => envNames.has(p.name) || p.cacheKey.startsWith('depth') || p.cacheKey.startsWith('distance');
      const list = progs.map((p) => `${isEnv(p) ? 'ENV ' : ''}${p.name || '?'}[${p.cacheKey.slice(0, 18).replace(/[\n,]/g, ' ')}] x${p.usedTimes}`).sort();
      const depthKeys = progs.filter((p) => p.cacheKey.startsWith('depth')).map((p) => p.cacheKey);
      return { count: progs.length, env: progs.filter(isEnv).length, list, depthKeys };
    };
    (window as unknown as { __trackShadow: () => unknown }).__trackShadow = () => ({
      enabled: ctx.renderer.shadowMap.enabled, type: ctx.renderer.shadowMap.type, cast: env.sun.castShadow, map: !!env.sun.shadow.map,
      size: env.sun.shadow.mapSize.x, pos: env.sun.position.toArray().map((v) => Math.round(v)), target: env.sun.target.position.toArray().map((v) => Math.round(v)),
      intensity: env.sun.intensity, shadowIntensity: env.sun.shadow.intensity, cam: cam.position.toArray().map((v) => Math.round(v)),
      fog: ctx.scene.fog ? { type: ctx.scene.fog.constructor.name, density: (ctx.scene.fog as { density?: number }).density, color: (ctx.scene.fog as { color: { getHexString(): string } }).color.getHexString() } : null,
      rigFog: env.rig.fogDensity, exposure: env.rig.exposure,
      casters: (() => { let n = 0; ctx.scene.traverse((o) => { if ((o as { castShadow?: boolean }).castShadow) n++; }); return n; })(),
    });
    // __trackLook(px,py,pz, tx,ty,tz): world-space camera for shots of scenery away from the centreline presets.
    (window as unknown as { __trackLook: (...v: number[]) => void }).__trackLook = (px, py, pz, tx, ty, tz) => {
      cam.position.set(px!, py!, pz!);
      target.set(tx!, ty!, tz!);
      cam.lookAt(target);
      syncAngles();
    };

    // __trackMeshes(): visible mesh count per top-level environment group (draw-call census for budgets).
    // inView=true counts only meshes whose bounding sphere intersects the camera frustum (≈ main-pass draws per group).
    (window as unknown as { __trackMeshes: (inView?: boolean) => Record<string, number> }).__trackMeshes = (inView = false) => {
      const out: Record<string, number> = {};
      cam.updateMatrixWorld();
      const fr = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      const sph = new Sphere();
      for (const g of env.root.children) {
        let n = 0;
        g.traverseVisible((o) => {
          const m = o as Mesh & { count?: number; isInstancedMesh?: boolean };
          if (!m.isMesh || (m.count ?? 1) <= 0) return;
          if (inView && m.frustumCulled) {
            const bs = m.isInstancedMesh ? (m as unknown as { boundingSphere: Sphere | null }).boundingSphere : m.geometry.boundingSphere;
            if (bs) { sph.copy(bs).applyMatrix4(m.matrixWorld); if (!fr.intersectsSphere(sph)) return; }
          }
          n++;
        });
        out[g.name || g.type] = n;
      }
      return out;
    };
    // __trackSD(s,d,h, s2,d2,h2): camera from (OSM-basis s, d, height above the road) presets, for scripted sweeps.
    (window as unknown as { __trackSD: (...v: number[]) => void }).__trackSD = (s0, d0, h0, s1, d1, h1) => {
      const a = at(s0!, d0!, h0!), b = at(s1!, d1!, h1!);
      cam.position.copy(a);
      target.copy(b);
      cam.lookAt(target);
      syncAngles();
    };

    const fwd = new Vector3();
    const right = new Vector3();
    let fpsAcc = 0;
    let fpsN = 0;
    let fpsShown = 0;
    let statTimer = 0;
    return {
      update(dt) {
        const d = Math.min(0.1, dt);
        if (!freeze) frame.time += d;
        frame.frameDt = d;
        const fast = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1;
        if (st.mode === 'free') {
          if (keys.has('ArrowLeft')) yaw -= 1.2 * d;
          if (keys.has('ArrowRight')) yaw += 1.2 * d;
          if (keys.has('ArrowUp')) pitch = Math.min(1.5, pitch + 1.0 * d);
          if (keys.has('ArrowDown')) pitch = Math.max(-1.5, pitch - 1.0 * d);
          fwd.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
          right.set(Math.cos(yaw), 0, Math.sin(yaw));
          const v = 20 * fast * d;
          if (keys.has('KeyW')) cam.position.addScaledVector(fwd, v);
          if (keys.has('KeyS')) cam.position.addScaledVector(fwd, -v);
          if (keys.has('KeyD')) cam.position.addScaledVector(right, v);
          if (keys.has('KeyA')) cam.position.addScaledVector(right, -v);
          if (keys.has('KeyR')) cam.position.y += v;
          if (keys.has('KeyF')) cam.position.y -= v;
          target.copy(cam.position).add(fwd);
          cam.lookAt(target);
        } else if (st.mode === 'drive') {
          st.driveS = q.wrapS(st.driveS + (st.kmh / 3.6) * d);
          q.worldFromSD(st.driveS, 0, P);
          cam.position.set(P.x, P.y + 1.15, P.z);
          q.worldFromSD(st.driveS + 35, 0, P);
          target.set(P.x, P.y + 0.6, P.z);
          cam.lookAt(target);
        } else {
          const off = new Vector3().subVectors(cam.position, target);
          const r = off.length();
          let az = Math.atan2(off.x, off.z);
          let el = Math.asin(off.y / r);
          if (keys.has('ArrowLeft')) az -= 0.9 * d;
          if (keys.has('ArrowRight')) az += 0.9 * d;
          if (keys.has('ArrowUp')) el = Math.min(1.45, el + 0.6 * d);
          if (keys.has('ArrowDown')) el = Math.max(0.02, el - 0.6 * d);
          let rr = r;
          if (keys.has('KeyW')) rr = Math.max(4, r * (1 - 0.8 * d));
          if (keys.has('KeyS')) rr = r * (1 + 0.8 * d);
          cam.position.set(target.x + rr * Math.cos(el) * Math.sin(az), target.y + rr * Math.sin(el), target.z + rr * Math.cos(el) * Math.cos(az));
          cam.lookAt(target);
        }
        cam.updateMatrixWorld();
        env.update(cam, frame, d);
        graphics.render(frame);
        if (!clean) {
          fpsAcc += dt;
          fpsN++;
          statTimer += dt;
          if (fpsAcc > 0.5) {
            fpsShown = fpsN / fpsAcc;
            fpsAcc = 0;
            fpsN = 0;
          }
          if (statTimer > 0.25) {
            statTimer = 0;
            const pf = graphics.getPerf();
            stats.mainCalls = pf.calls;
            stats.mainTris = pf.triangles;
            overlay.textContent = `${quality.id} · ${st.mode} · ${fpsShown.toFixed(0)} fps\ncalls ${pf.calls} · tris ${(pf.triangles / 1e6).toFixed(2)} M · geo ${pf.geometries} · tex ${pf.textures} · prog ${pf.programs}`;
          }
        }
      },
      dispose() {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('resize', onResize);
        gui?.destroy();
        overlay.remove();
        env.dispose();
        assets.dispose();
        graphics.dispose();
      },
    };
  },
};

export default scene;
