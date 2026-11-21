// buildEnvironment (Çevre, H3): track surfaces, terrain, barriers, scenery, sky dome, sun/hemi lights with shadow
// fitting, env scene for PMREM and the live LightingRig. Presentation layer: the caller adds `root` to its scene.

import { Group, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { ConditionsFrame } from '../../contracts/conditions';
import type { BuildEnvironment, EnvironmentHandle } from '../../contracts/environment';
import type { QualityPreset, RenderContext, RenderFrame } from '../../contracts/render';
import type { TrackBundle } from '../../contracts/track';
import { getTrackExtras, type TrackExtras } from '../build/extras';
import { createEnvShared, type EnvShared } from '../materials/shared';
import { createTrackMaterials } from '../mesh/materials';
import { buildTrackSurface } from '../mesh/surface';
import { loadEnvTextures, type EnvTextures } from '../mesh/textures';
import { createLighting } from '../sky/lighting';
import { applyRigConditions, baseRig, cloneRig } from '../sky/rigs';
import { createSky } from '../sky/sky';
import type { GroundHeight } from '../terrain/height';
import { createTerrain } from '../terrain/terrain';
import { createBarriers } from './barriers';
import { createStands } from './stands';
import { createPitBuilding } from './pitBuilding';
import { createTrackside } from './trackside';
import { createFloodlights } from './floodlights';
import { createTrees } from './trees';
import { createBuildings } from './buildings';
import { createRuins } from './ruins';
import { createWater } from './water';
import { createBridges } from './bridges';
import { createSkyline } from './skyline';
import { createOutskirts } from './outskirts';
import { createAlpine } from './alpine';
import { createEifel } from './eifel';
import { createCliff } from './cliff';
import { createAegean } from './aegean';
import { createCappadocia } from './cappadocia';
import { createVolcano } from './volcano';
import { createBosphorusDetails } from './tracks/bosphorus';
import { createArdennesDetails, reserveArdennesSites } from './tracks/ardennes';
import { createLombardiaDetails, reserveLombardiaSites } from './tracks/lombardia';

/** A presentation sub-system of the environment. */
export interface EnvPart {
  root: Object3D;
  update?(cam: PerspectiveCamera, frame: RenderFrame, dt: number): void;
  setQuality?(q: QualityPreset): void;
  applyConditions?(c: ConditionsFrame): void;
  dispose(): void;
}

export interface EnvContext {
  track: TrackBundle;
  ex: TrackExtras;
  tex: EnvTextures;
  /** Shared env shading: uniforms + neutral textures for every env material (one program per family). */
  sh: EnvShared;
  ctx: RenderContext;
  quality: QualityPreset;
  /** Set by the terrain part (built first); scenery uses it for placement. */
  ground: GroundHeight | null;
  /** Oriented rectangles (centre, unit u, half extents) where trees and props must not go. */
  blockers: { cx: number; cz: number; ux: number; uz: number; hu: number; hv: number }[];
}

export type EnvPartFactory = (c: EnvContext) => EnvPart | Promise<EnvPart>;

/** Parts in build order (terrain first: it provides the ground height). */
const PART_FACTORIES: EnvPartFactory[] = [
  (c) => {
    const t = createTerrain(c);
    c.ground = t.ground;
    return t;
  },
  // Alpine only (lake, tunnel, cable car, chalets; empty group elsewhere): before the trees, it adds blockers.
  (c) => createAlpine(c),
  // Eifel only (castle, village, bridges, km boards, camps, bowl slabs; empty group elsewhere): adds blockers too.
  (c) => createEifel(c),
  // Desert Cliff only (ramp deck, LEDs, towers, rollercoaster, palms; empty group elsewhere).
  (c) => createCliff(c),
  // Aegean only (sea, bridges, pontoon, tunnel, harbour, villages, boats; empty group elsewhere).
  (c) => createAegean(c),
  // Cappadocia only (fairy chimneys, rock faces, castle, village, vineyards, balloons; empty group elsewhere).
  (c) => createCappadocia(c),
  // Volcano Rim only (lava, lava light, particles, tunnel, bridge, basalt; empty group elsewhere).
  (c) => createVolcano(c),
  (c) => createBarriers(c),
  (c) => {
    const st = createStands(c);
    c.blockers.push(...st.boxes.map((b) => ({ cx: b.cx + b.vx * b.depth / 2, cz: b.cz + b.vz * b.depth / 2, ux: b.ux, uz: b.uz, hu: b.length / 2 + 8, hv: b.depth / 2 + 10 })));
    return st;
  },
  (c) => createRuins(c),
  (c) => createPitBuilding(c),
  (c) => createTrackside(c),
  (c) => createFloodlights(c),
  (c) => {
    if (c.track.data.id === 'ardennes') reserveArdennesSites(c);
    if (c.track.data.id === 'lombardia') reserveLombardiaSites(c);
    return createTrees(c, (x, z) => isBlocked(c, x, z));
  },
  (c) => (c.ex.authoring.THEME.backdrop === 'city' ? createSkyline(c, (x, z) => isBlocked(c, x, z)) : createBuildings(c, (x, z) => isBlocked(c, x, z))),
  // Sea tracks only (empty groups elsewhere).
  (c) => createWater(c),
  (c) => createBridges(c),
  // THEME.outskirts only (empty group elsewhere).
  (c) => createOutskirts(c),
];

/** Pit lane + garages + paddock (garage side of the pit lane over the box section) or inside a stand footprint. */
function isBlocked(c: EnvContext, x: number, z: number): boolean {
  for (const b of c.blockers) {
    const dx = x - b.cx, dz = z - b.cz;
    if (Math.abs(dx * b.ux + dz * b.uz) < b.hu && Math.abs(dx * b.uz - dz * b.ux) < b.hv) return true;
  }
  const pit = c.track.data.pit;
  if (pit.count < 2 || pit.boxes.length === 0) return false;
  const a = Math.max(0, Math.floor((pit.boxes[0]!.sp - 90) / c.ex.pitDsp));
  const e = Math.min(pit.count - 1, Math.ceil((pit.boxes[pit.boxes.length - 1]!.sp + 90) / c.ex.pitDsp));
  for (let j = a; j <= e; j += 6) {
    const dx = x - pit.x[j]!, dz = z - pit.z[j]!;
    if (dx * dx + dz * dz > 170 * 170) continue;
    const along = dx * pit.tx[j]! + dz * pit.tz[j]!;
    const lat = c.ex.pitSide * (dx * pit.tz[j]! - dz * pit.tx[j]!);
    if (Math.abs(along) < 4 && lat > -12 && lat < 160) return true;
  }
  return false;
}

export const buildEnvironmentReal: BuildEnvironment = async ({ track, quality, conditions, ctx, assets, onProgress }) => {
  const ex = getTrackExtras(track.data);
  if (!ex) throw new Error('[track] buildEnvironment needs a TrackData built by buildTrackData (no extras found)');
  const root = new Group();
  root.name = 'environment';
  let q = quality;

  const tex = await loadEnvTextures(assets, quality.anisotropy, (p) => onProgress(0.3 * p));
  const sh = createEnvShared();
  const mats = createTrackMaterials(tex, sh, ex.authoring.THEME.ground !== 'golden' && ex.authoring.THEME.ground !== 'island' && ex.authoring.THEME.ground !== 'valley' && ex.authoring.THEME.ground !== 'volcanic', ex.authoring.THEME.ground === 'island');
  const surface = buildTrackSurface(track, ex, mats);
  const surfaceGroup = new Group();
  surfaceGroup.name = 'track.surface';
  for (const m of surface.meshes) surfaceGroup.add(m);
  root.add(surfaceGroup);
  onProgress(0.4);

  // Flat parkland: a low distant tree line instead of İstanbul's hills.
  const backdrop = ex.authoring.THEME.backdrop;
  const sky = createSky(conditions.tod, backdrop === 'parkland' ? 0.3 : backdrop === 'desert' || backdrop === 'valley' || backdrop === 'volcanic' ? 0 : backdrop === 'city' ? 0.6 : 1, backdrop === 'city' ? 1.6 : 1);
  root.add(sky.mesh);
  const lighting = createLighting(quality, sky);
  root.add(lighting.group);

  /** Large maps only: meshes hidden beyond a distance (bounding-sphere centre + radius + limit). */
  const culled: { o: Object3D; x: number; y: number; z: number; r: number }[] = [];
  const ectx: EnvContext = { track, ex, tex, sh, ctx, quality, ground: null, blockers: [] };
  const parts: EnvPart[] = [];
  for (let k = 0; k < PART_FACTORIES.length; k++) {
    const part = await PART_FACTORIES[k]!(ectx);
    parts.push(part);
    root.add(part.root);
    onProgress(0.4 + (0.55 * (k + 1)) / PART_FACTORIES.length);
  }
  // Large maps (layout > 4 km across): the camera rig's TV-spot probe tests the terrain as a heightfield.
  {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const d = track.data;
    for (let i = 0; i < d.count; i += 10) { x0 = Math.min(x0, d.x[i]!); x1 = Math.max(x1, d.x[i]!); z0 = Math.min(z0, d.z[i]!); z1 = Math.max(z1, d.z[i]!); }
    const g = ectx.ground;
    const cull = ex.authoring.THEME.cull;
    const add = (o: Object3D, r: number): void => {
      o.traverse((m) => {
        const g2 = (m as { geometry?: { boundingSphere: { center: Vector3; radius: number } | null; computeBoundingSphere(): void } }).geometry;
        if (!g2 || m === o) return;
        if (!g2.boundingSphere) g2.computeBoundingSphere();
        const bs = g2.boundingSphere!;
        if (bs.radius > 600 || m.name === 'eifel.castle') return;
        culled.push({ o: m, x: bs.center.x, y: bs.center.y, z: bs.center.z, r: bs.radius + r });
      });
    };
    if (cull && !(g && Math.max(x1 - x0, z1 - z0) > 4000)) {
      // Open maps with long sight lines (Volcano Rim: the whole lap in view from the flanks): THEME.cull distances.
      add(surfaceGroup, cull.surface);
      for (const p of parts) if (p.root.name === 'barriers' || p.root.name === 'trackside' || p.root.name === 'stands') add(p.root, cull.statics);
    }
    if (g && Math.max(x1 - x0, z1 - z0) > 4000) {
      root.userData.groundHeight = (x: number, z: number): number => g.height(x, z);
      // Distance culling (the draw-call budget on a 20 km map): track-surface chunks beyond 1.9 km, barrier cells and the
      // track's small statics beyond 1.3 km are hidden (forest and terrain hide them anyway; the frustum alone keeps
      // 3–4 km of road in view from the crests).
      add(surfaceGroup, 1900);
      for (const p of parts) if (p.root.name === 'barriers' || p.root.name === 'eifel') add(p.root, 1300);
    }
  }

  // Optional per-track visual dressing; other tracks keep their existing environment unchanged.
  if (track.data.id === 'bosphorus') {
    const detail = createBosphorusDetails(ectx, root);
    parts.push(detail);
    root.add(detail.root);
  }
  if (track.data.id === 'ardennes') {
    const detail = createArdennesDetails(ectx, root);
    parts.push(detail);
    root.add(detail.root);
  }
  if (track.data.id === 'lombardia') {
    const detail = createLombardiaDetails(ectx, root);
    parts.push(detail);
    root.add(detail.root);
  }

  const rig = cloneRig(baseRig(conditions.tod, track.data.id));
  let cloud = conditions.cloud;
  let rain = conditions.rain;
  const applyConditions = (c: ConditionsFrame): void => {
    const { shadowIntensity } = applyRigConditions(rig, c, track.data.id);
    cloud = c.cloud;
    rain = c.rain;
    lighting.apply(rig, shadowIntensity);
    sky.update(rig, cloud, rain, c.time);
    sh.setWeather(c.rain, c.wetness, c.lineWetness);
    for (const p of parts) p.applyConditions?.(c);
  };
  applyConditions(conditions);
  onProgress(1);

  // Grafik's per-track looks key on this.
  lighting.envScene.userData.trackId = track.data.id;
  // Heat sources for the post chain's shimmer (Volcano Rim lava), if a part lists them.
  for (const p of parts) {
    const hs = (p as EnvPart & { heatSources?: Float32Array }).heatSources;
    if (hs) lighting.envScene.userData.heatSources = hs;
  }
  const focus = new Vector3();
  let cullFrame = 0;
  let disposed = false;
  const handle: EnvironmentHandle = {
    root,
    sun: lighting.sun,
    hemi: lighting.hemi,
    envScene: lighting.envScene,
    rig,
    applyConditions,
    update(cam, frame, dt) {
      sky.update(rig, cloud, rain, frame.time);
      sky.follow(cam, cam.far);
      const player = frame.cars[frame.playerId];
      const driving = player && frame.view !== 'orbit' && frame.view !== 'free' && frame.view !== 'tv' && frame.view !== 'trailer';
      if (driving) focus.set(player.px, player.py, player.pz);
      lighting.fit(cam, driving ? focus : null);
      sh.setTime(frame.time);
      for (const p of parts) p.update?.(cam, frame, dt);
      if (culled.length && (cullFrame++ & 3) === 0) {
        const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
        // Limits are for the High far plane (3.5 km); a longer far plane (Ultra, aerial shots) stretches them.
        const k = Math.max(1, cam.far / 3500);
        for (const c of culled) {
          const dx = c.x - cx, dy = c.y - cy, dz = c.z - cz;
          c.o.visible = dx * dx + dy * dy + dz * dz < c.r * c.r * k * k;
        }
      }
    },
    setQuality(nq) {
      q = nq;
      ectx.quality = nq;
      lighting.setQuality(nq);
      tex.setAnisotropy(nq.anisotropy);
      for (const p of parts) p.setQuality?.(nq);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      for (const p of parts) p.dispose();
      for (const g of surface.geometries) g.dispose();
      mats.dispose();
      sh.dispose();
      tex.dispose();
      sky.dispose();
      lighting.dispose();
      void q;
    },
  };
  return handle;
};
