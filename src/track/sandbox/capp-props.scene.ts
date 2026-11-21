// ?scene=capp-props (Çevre-2): preview of the Cappadocia prop builders (scenery/cappadociaProps.ts) on the İstanbul
// environment (sky, lighting, golden terrain), east of the circuit. &group=chimneys|dwellings|castle|balloons|village|
// orchards|all picks the camera, &tod=day|sunset|night. A cream wall stands in for a valley face behind the dwellings.

import { Color, Mesh, NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3, type Texture } from 'three';
import type { TimeOfDay } from '../../contracts/common';
import type { ConditionsFrame } from '../../contracts/conditions';
import type { SandboxScene } from '../../contracts/debug';
import type { AssetLoader, RenderFrame } from '../../contracts/render';
import { createGraphicsSystem, QUALITY_PRESETS } from '../../graphics/index';
import { getTrackExtras } from '../build/extras';
import { buildEnvironment, loadTrack } from '../index';
import { createEnvShared, envMaterial } from '../materials/shared';
import { loadEnvTextures } from '../mesh/textures';
import { createBalloons, createCaveDwellings, createFairyChimneys, createOrchards, createStoneVillage, type PropPart } from '../scenery/cappadociaProps';
import { boxInFrame, SBuf } from '../scenery/stands';
import { createGroundHeight } from '../terrain/height';

const scene: SandboxScene = {
  id: 'capp-props',
  title: 'Cappadocia props',
  async create({ canvas, params }) {
    const track = loadTrack('istanbul');
    const ex = getTrackExtras(track.data)!;
    const quality = QUALITY_PRESETS.high;
    const graphics = createGraphicsSystem();
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block';
    const ctx = await graphics.init(canvas, quality);
    const loader = new TextureLoader();
    const owned: Texture[] = [];
    const assets = {
      async texture(url: string, o?: { srgb?: boolean; repeat?: boolean; anisotropy?: number }) {
        const t = await loader.loadAsync(url);
        t.colorSpace = (o?.srgb ?? true) ? SRGBColorSpace : NoColorSpace;
        if (o?.repeat) t.wrapS = t.wrapT = RepeatWrapping;
        owned.push(t);
        return t;
      },
      release() {}, refCount: () => 0, font: async () => true, track: <T>(w: T) => w, progress: () => ({ loaded: 0, total: 0, progress: 1 }),
      onProgress: () => () => {}, resetProgress() {}, async warmup() {}, dispose() { for (const t of owned) t.dispose(); },
    } as unknown as AssetLoader;
    const tod = (params.get('tod') ?? 'day') as TimeOfDay;
    const conditions: ConditionsFrame = { tod, rain: 0, wetness: 0, lineWetness: 0, cloud: 0, time: 12 };
    const env = await buildEnvironment({ track, quality, conditions, ctx, assets, onProgress: () => {} });
    ctx.scene.add(env.root);
    graphics.setLighting(env.rig, env.envScene);

    // Props on their own shared env uniforms and textures, placed east of the circuit.
    const sh = createEnvShared();
    const tex = await loadEnvTextures(assets, quality.anisotropy, () => {});
    const gh = createGroundHeight(track, ex);
    let maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < track.data.count; i++) { maxX = Math.max(maxX, track.data.x[i]!); minZ = Math.min(minZ, track.data.z[i]!); maxZ = Math.max(maxZ, track.data.z[i]!); }
    const O = new Vector3(maxX + 700, 0, (minZ + maxZ) / 2);
    O.y = gh.height(O.x, O.z);
    const penv = { sh, tex, quality, ground: { height: (x: number, z: number) => gh.height(x, z) } };
    const parts: PropPart[] = [];
    const sites = Array.from({ length: 18 }, (_, k) => {
      const a = k * 2.4, r = 30 + (k * 37) % 140;
      return { x: O.x + Math.cos(a) * r, z: O.z + Math.sin(a) * r, h: 6 + ((k * 13) % 35), cluster: ((k % 4) === 0 ? 3 : (k % 3) === 0 ? 2 : 1) as 1 | 2 | 3, caves: k % 2 === 0 };
    });
    parts.push(createFairyChimneys(penv, sites));
    // A cream stand-in valley wall 260 m west of O, facing east, carved by the dwellings builder; the castle north-west.
    const wall = new SBuf();
    const wx = O.x - 260, wz = O.z, wy = gh.height(wx, wz);
    boxInFrame(wall, { x: wx - 15, y: wy - 2, z: wz }, [-15, 15], [-60, 60], [0, 40], 1, 0, 0, 1, new Color(0.93, 0.8, 0.68));
    const wallMat = envMaterial(sh, { name: 'capp.previewWall', family: 'opaque', vertexColor: true, map: tex.concrete.map, roughness: 0.95, wet: 0.5 });
    ctx.scene.add(new Mesh(wall.geometry(), wallMat));
    parts.push(createCaveDwellings(penv, [{ x: wx, z: wz, nx: 1, nz: 0, w: 110, h: 36, y0: wy }], { x: O.x - 380, z: O.z - 260, r: 48, h: 70 }));
    parts.push(createBalloons(penv, { x: O.x, z: O.z, r: 600, yMin: O.y + 110, yMax: O.y + 280, count: 12 }));
    const houses = Array.from({ length: 36 }, (_, k) => ({ x: O.x + 220 + (k % 6) * 17 + ((k * 7) % 5), z: O.z - 180 + Math.floor(k / 6) * 16, w: 8 + (k % 3) * 2, d: 7 + (k % 2) * 2, h: 4 + (k % 3) * 2.5, yaw: (k % 4) * 0.08 }));
    parts.push(createStoneVillage(penv, houses, { x: O.x + 200, z: O.z - 60, yaw: 0.2 }, [[[O.x + 180, O.z - 200], [O.x + 340, O.z - 200], [O.x + 340, O.z - 70]]]));
    parts.push(createOrchards(penv, [{ x: O.x + 60, z: O.z + 260, w: 140, d: 60, yaw: 0.1 }, { x: O.x - 110, z: O.z + 280, w: 90, d: 50, yaw: -0.2 }], [{ x: O.x + 230, z: O.z + 230, w: 96, d: 72, yaw: 0.3 }]));
    for (const p of parts) { ctx.scene.add(p.root); p.applyConditions?.(conditions); }

    const cam = ctx.camera;
    cam.fov = 50;
    cam.near = 0.5;
    cam.far = quality.far;
    cam.updateProjectionMatrix();
    const shots: Record<string, [number, number, number, number, number, number]> = {
      chimneys: [O.x + 210, O.y + 18, O.z + 140, O.x, O.y + 16, O.z],
      dwellings: [O.x - 140, O.y + 14, O.z + 40, O.x - 260, O.y + 16, O.z],
      castle: [O.x - 200, O.y + 25, O.z - 120, O.x - 380, O.y + 40, O.z - 260],
      balloons: [O.x + 300, O.y + 20, O.z + 500, O.x, O.y + 180, O.z],
      village: [O.x + 130, O.y + 20, O.z + 10, O.x + 270, O.y + 6, O.z - 120],
      orchards: [O.x + 120, O.y + 14, O.z + 360, O.x + 120, O.y, O.z + 240],
      all: [O.x + 600, O.y + 220, O.z + 600, O.x, O.y + 30, O.z],
    };
    const s = shots[params.get('group') ?? 'all'] ?? shots.all!;
    cam.position.set(s[0], s[1], s[2]);
    cam.lookAt(s[3], s[4], s[5]);
    cam.updateMatrixWorld();
    const frame: RenderFrame = {
      time: 12, frameDt: 1 / 60, alpha: 0, cars: [], playerId: 0, conditions,
      lights: { lit: 0, out: false }, yellowSectors: [false, false, false], paused: false,
      racingLine: { mode: 'off', profile: null, playerS: 0, playerSpeed: 0 }, view: 'free', lookBack: false,
    };
    (window as unknown as { __capp: unknown }).__capp = { tris: parts.map((p) => [p.root.name, Math.round(p.triangles)]) };
    return {
      update(dt) {
        frame.time += dt;
        frame.frameDt = dt;
        sh.setTime(frame.time);
        for (const p of parts) p.update?.(cam, frame, dt);
        env.update(cam, frame, dt);
        graphics.render(frame);
      },
      dispose() {
        for (const p of parts) p.dispose();
        wallMat.dispose();
        tex.dispose();
        sh.dispose();
        env.dispose();
        graphics.dispose();
        assets.dispose();
      },
    };
  },
};

export default scene;
