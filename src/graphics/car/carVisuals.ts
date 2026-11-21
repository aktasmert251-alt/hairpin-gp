// CarVisualsSystem (docs/design/rendering.md §7.3–§7.5, contract render.ts).
// LOD0: 7 body draws per car (paint, carbon, trim, visor, emissive, DRS flap, steering wheel).
// LOD1: 3 draws per car (paint, carbon+trim vertex colours, emissive). LOD2: one InstancedMesh for every far car.
// Wheels: 3 InstancedMeshes per LOD (tyre, rim, brake/upright) shared by all cars. Blob shadows: one InstancedMesh.

import {
  BoxGeometry, MeshStandardMaterial,
  Color, DynamicDrawUsage, Float32BufferAttribute, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, type Object3D, type PerspectiveCamera, PlaneGeometry, Quaternion,
  type Texture, Vector3, type BufferGeometry, type MeshPhysicalMaterial, type ShaderMaterial,
} from 'three';
import type { TeamDef } from '../../contracts/data';
import type { HudModel } from '../../contracts/hud';
import type { CarRenderState, CarVisualSpec, CarVisualsSystem, QualityPreset, RenderContext, RenderFrame } from '../../contracts/render';
import { COMPOUND_COLORS, createCarMaterials, type CarMaterialLib } from '../materials/carMaterials';
import { canvasTexture } from '../materials/textures';
import { PRESET_DERIVED } from '../presets';
import { attachSubsystem, detachSubsystem } from '../renderer/registry';
import { buildBody, conceptOf, type BodyLod, type ConceptId, REAR_FLAP_PIVOT } from './carModel';
import { DRS_FLAP_OPEN } from './carParts';
import { mergeParts } from './geom';
import { drawLivery, LIVERY_FONT, loadLiveryFonts, teamForLivery } from './livery';
import { createMirrors, MIRROR_LAYER, type Mirrors } from './mirrors';
import { createPitCrew, type PitCrew } from './pitCrew';
import type { TrackQuery } from '../../contracts/track';
import { createWheelDisplay, type WheelDisplay } from './wheelDisplay';
import { buildWheels, FRONT_W, REAR_W, TYRE_R, type WheelLod } from './wheels';

const WHEEL_POS: readonly [number, number, number][] = [[0.8, TYRE_R, 1.962], [-0.8, TYRE_R, 1.962], [0.775, TYRE_R, -1.638], [-0.775, TYRE_R, -1.638]];
const FLAP_PIVOT = new Vector3(0, REAR_FLAP_PIVOT.y, REAR_FLAP_PIVOT.z);
/** DRS flap visual travel from the sim's linear 0..1 flap state (0.25 s open / 0.15 s close): the visual reaches full
 * open at 60 % of the sim ramp (~0.15 s) and closes in the last ~0.09 s, eased at both ends (no snap). */
export function drsEase(f: number): number {
  const t = Math.min(1, Math.max(0, f / 0.6));
  return t * t * (3 - 2 * t);
}
const STEER_POS = new Vector3(0, 0.6, 0.62);
const STEER_TILT = -0.28;
const WHEEL_ATTRS: readonly string[] = ['aCompound', 'aTread', 'aTint', 'aBlur', 'aGlow'];
/** Tyre tread pattern id per compound (carMaterials TREAD_GLSL): 0 slick, 1 intermediate, 2 wet. */
const TREAD_KIND: Readonly<Record<string, number>> = { soft: 0, medium: 0, hard: 0, inter: 1, wet: 2 };
/** G4: ghosts live only on this layer (the main camera enables it; mirror and shadow cameras do not). */
export const GHOST_LAYER = 5;

/** One merged LOD1 ghost mesh: livery body (aPaint 1) + trim and four static wheels (aPaint 0). */
function ghostGeometry(body: BodyLod, w: WheelLod): BufferGeometry {
  const prep = (g: BufferGeometry, paint: number, m: Matrix4 | null): BufferGeometry => {
    const c = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(c.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') c.deleteAttribute(k);
    const n = c.getAttribute('position').count;
    if (!c.getAttribute('uv')) c.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n * 2), 2));
    c.setAttribute('aPaint', new Float32BufferAttribute(new Float32Array(n).fill(paint), 1));
    if (m) c.applyMatrix4(m);
    return c;
  };
  const parts: BufferGeometry[] = [];
  if (body.geo.paint) parts.push(prep(body.geo.paint, 1, null));
  if (body.geo.trim) parts.push(prep(body.geo.trim, 0, null));
  const m = new Matrix4(), q = new Quaternion(), p = new Vector3(), sc = new Vector3();
  for (let i = 0; i < 4; i++) {
    const [x, y, z] = WHEEL_POS[i]!;
    p.set(x, y, z);
    q.setFromAxisAngle(new Vector3(0, 1, 0), x < 0 ? Math.PI : 0);
    sc.set(i < 2 ? 1 : REAR_W / FRONT_W, 1, 1);
    m.compose(p, q, sc);
    parts.push(prep(w.tyre, 0, m), prep(w.rim, 0, m));
  }
  const merged = mergeParts(parts);
  for (const g of parts) g.dispose();
  return merged;
}

export interface CarVisualStats {
  triangles: [number, number, number];
  bodyDraws: [number, number, number];
  wheelTriangles: [number, number, number];
  lodCounts: [number, number, number, number];
}

export interface CarVisualsImpl extends CarVisualsSystem {
  /** Force every car to one LOD (car scene LOD browser); null = automatic. */
  forceLod(lod: 0 | 1 | 2 | null): void;
  setQuality(q: QualityPreset): void;
  stats(): CarVisualStats;
  /** Main-pass draw calls issued by car visuals in the last update (bodies + wheels + LOD2 + blobs). */
  drawCalls(): number;
  materials(): CarMaterialLib | null;
  root(): Object3D | null;
  /** Livery atlases (warm-up uploads). */
  liveryTextures(): readonly Texture[];
  /** G12: builds the pit crew for this track's boxes (forwarded from CameraRig.setTrack via the registry). */
  setTrack(q: TrackQuery | null): void;
  /** CR-16: steering-wheel display model (glue: 30 Hz in `cockpit`, null otherwise). */
  setWheelDisplay(m: HudModel | null): void;
  /** Wheel display (perf checks); null before init. */
  wheelDisplay(): WheelDisplay | null;
}

interface Slot {
  spec: CarVisualSpec;
  team: TeamDef;
  atlas: Texture;
  paint: MeshPhysicalMaterial;
  root: Group;
  lod0: Group;
  lod1: Group;
  flap: Mesh;
  steer: Mesh;
  visor: Mesh;
  ghost: Group | null;
  lod: number;
  rain: number;
  head: { value: number };
  tint: Color;
  lightBar: Mesh<BoxGeometry, MeshStandardMaterial> | null;
}

function teamOf(id: string): TeamDef {
  return teamForLivery(id);
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface CarVisualsOptions {
  /** Livery atlas size for every car (showroom); default: player atlas for car 0, preset atlas for the rest. */
  atlasSize?: number;
}

export function createCarVisuals(opts: CarVisualsOptions = {}): CarVisualsImpl {
  let ctx: RenderContext | null = null;
  let mats: CarMaterialLib | null = null;
  let quality: QualityPreset | null = null;
  const bodies: BodyLod[] = [];
  /** LOD0/LOD1 bodies per car concept (built once, on first use; `bodies` holds the default concept for LOD2 and stats). */
  const conceptBodies = new Map<string, BodyLod>();
  const bodyOf = (l: 0 | 1, concept: ConceptId): BodyLod => {
    if (concept === 'arrow') return bodies[l]!;
    const key = `${l}:${concept}`;
    let b = conceptBodies.get(key);
    if (!b) {
      b = buildBody(l, concept);
      conceptBodies.set(key, b);
      for (const g of Object.values(b.geo)) if (g) geos.push(g);
    }
    return b;
  };
  const wheels: WheelLod[] = [];
  let slots: Slot[] = [];
  const byId: (Slot | undefined)[] = [];
  let group: Group | null = null;
  let cockpitId: number | null = null;
  let forced: 0 | 1 | 2 | null = null;
  let lastDraws = 0;
  let display: WheelDisplay | null = null;
  let displayModel: HudModel | null = null;
  let mirrors: Mirrors | null = null;
  let crew: PitCrew | null = null;
  const mMirror = new Matrix4();
  /** G9 mirror pass: LOD0 cars show their LOD1 body (layer 1) while the mirror target renders. */
  const mirrorSwap = (on: boolean): void => {
    for (const s of slots) {
      if (s.lod !== 0 || s.ghost) continue;
      s.lod0.visible = !on;
      s.lod1.visible = on;
    }
  };
  const geos: BufferGeometry[] = [];
  const textures: Texture[] = [];

  // Instanced meshes: wheels per LOD (tyre, rim, hub), LOD2 bodies, blobs.
  const wheelMeshes: [InstancedMesh, InstancedMesh, InstancedMesh][] = [];
  let lod2Mesh: InstancedMesh | null = null;
  let blobMesh: InstancedMesh | null = null;

  // Scratch (no per-frame allocation).
  const mCar = new Matrix4();
  const mLocal = new Matrix4();
  const mOut = new Matrix4();
  const vL = new Vector3(), vU = new Vector3(), vF = new Vector3(), vP = new Vector3(), vS = new Vector3();
  const qSteer = new Quaternion(), qSide = new Quaternion(), qSpin = new Quaternion(), qAll = new Quaternion();
  const AX = new Vector3(1, 0, 0), AY = new Vector3(0, 1, 0);
  const qFlip = new Quaternion().setFromAxisAngle(AY, Math.PI);
  const qId = new Quaternion();
  const mBlob = new Matrix4().makeRotationX(-Math.PI / 2).premultiply(new Matrix4().makeTranslation(0, 0.012, 0));
  const zero = new Matrix4().makeScale(0, 0, 0);
  const camPos = new Vector3();
  const tmpColor = new Color();
  const order: number[] = [];
  const dist: number[] = [];
  const wcount: [number, number, number] = [0, 0, 0];

  const carMatrix = (cs: CarRenderState, out: Matrix4): Matrix4 => {
    vF.set(cs.fx, cs.fy, cs.fz);
    vU.set(cs.ux, cs.uy, cs.uz);
    vL.crossVectors(vU, vF);
    return out.makeBasis(vL, vU, vF).setPosition(cs.px, cs.py, cs.pz);
  };

  const meshOf = (g: BufferGeometry | undefined, m: THREE_Material, cast = true): Mesh | null => {
    if (!g) return null;
    const mesh = new Mesh(g, m);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    return mesh;
  };

  const makeInstanced = (g: BufferGeometry, m: THREE_Material, cap: number, attrs: [string, number][]): InstancedMesh => {
    for (const [name, size] of attrs) {
      const a = new InstancedBufferAttribute(new Float32Array(cap * size), size);
      a.setUsage(DynamicDrawUsage);
      g.setAttribute(name, a);
    }
    const im = new InstancedMesh(g, m, cap);
    im.instanceMatrix.setUsage(DynamicDrawUsage);
    im.count = 0;
    im.frustumCulled = false;
    im.castShadow = true;
    im.receiveShadow = true;
    return im;
  };

  const sys: CarVisualsImpl = {
    async init(c, cars) {
      ctx = c;
      quality = c.quality;
      await loadLiveryFonts();
      mats = createCarMaterials(c.quality, LIVERY_FONT);
      group = new Group();
      group.name = 'carVisuals';
      for (const l of [0, 1, 2] as const) {
        bodies[l] = buildBody(l);
        wheels[l] = buildWheels(l);
        for (const g of Object.values(bodies[l]!.geo)) if (g) geos.push(g);
      }
      const n = cars.length + 1;
      c.camera.layers.enable(GHOST_LAYER);
      let ghostGeo: BufferGeometry | null = null;
      // Wheels per LOD.
      for (const l of [0, 1, 2] as const) {
        const w = wheels[l]!;
        const tyre = makeInstanced(w.tyre, mats.tyre, n * 4, [['aCompound', 3], ['aTread', 3]]);
        const rim = makeInstanced(w.rim, mats.rim, n * 4, [['aTint', 3], ['aBlur', 2]]);
        const hub = makeInstanced(w.hub, mats.hub, n * 4, [['aGlow', 1]]);
        hub.castShadow = false;
        rim.castShadow = l === 0;
        wheelMeshes[l] = [tyre, rim, hub];
        group.add(tyre, rim, hub);
        geos.push(w.tyre, w.rim, w.hub);
      }
      // LOD2 instanced bodies (paint + trim + emissive merged, zone colours per instance).
      {
        const b = bodies[2]!.geo;
        const parts = [b.paint!, b.trim, b.emissive].filter((g): g is BufferGeometry => !!g);
        const merged = mergeParts(parts.map((g) => {
          const cg = g.clone();
          for (const k of Object.keys(cg.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'aZone') cg.deleteAttribute(k);
          return cg;
        }));
        geos.push(merged);
        lod2Mesh = makeInstanced(merged, mats.lod2, n, [['aPrim', 3], ['aSec', 3]]);
        group.add(lod2Mesh);
      }
      // Blobs.
      const blobGeo = new PlaneGeometry(2.4, 5.8);
      geos.push(blobGeo);
      blobMesh = new InstancedMesh(blobGeo, mats.blob, n);
      blobMesh.instanceMatrix.setUsage(DynamicDrawUsage);
      blobMesh.frustumCulled = false;
      blobMesh.count = 0;
      blobMesh.renderOrder = 1;
      group.add(blobMesh);

      // Per-car slots.
      const derived = PRESET_DERIVED[c.quality.id];
      slots = cars.map((spec, i) => {
        const team = teamOf(spec.teamId);
        const isPlayer = i === 0;
        const size = opts.atlasSize ?? (isPlayer ? derived.liveryAtlasPlayer : derived.liveryAtlas);
        const canvas = drawLivery({ team, number: spec.number, tcam: spec.tcam, driverIdx: team.drivers[1].number === spec.number ? 1 : 0 }, size);
        const atlas = canvasTexture(canvas, c.quality.anisotropy);
        textures.push(atlas);
        const paint = mats!.paint(team, atlas);
        const head = { value: 0 };
        paint.onBeforeCompile = (s) => {
          mats!.wetShader(s);
          s.uniforms['uHideHead'] = head;
          s.vertexShader = s.vertexShader
            .replace('#include <common>', '#include <common>\nattribute float aHead;\nuniform float uHideHead;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed *= 1.0 - aHead * uHideHead;');
        };
        paint.customProgramCacheKey = () => 'car.paint.head.wet';
        const root = new Group();
        root.name = `car-${spec.id}`;
        root.matrixAutoUpdate = false;
        const lod0 = new Group();
        const concept = conceptOf(spec.teamId);
        const g0 = bodyOf(0, concept).geo;
        for (const m of [meshOf(g0.paint, paint), meshOf(g0.carbon, mats!.carbon), meshOf(g0.trim, mats!.trim)]) if (m) lod0.add(m);
        const visor = meshOf(g0.visor, mats!.visor, false)!;
        lod0.add(visor);
        const em0 = meshOf(g0.emissive, mats!.emissive, false)!;
        lod0.add(em0);
        const flap = new Mesh(g0.flap!, paint);
        flap.castShadow = true;
        flap.receiveShadow = true;
        flap.position.copy(FLAP_PIVOT);
        lod0.add(flap);
        const steer = new Mesh(g0.steer!, mats!.trim);
        steer.position.copy(STEER_POS);
        steer.rotation.set(STEER_TILT, 0, 0);
        lod0.add(steer);
        const lod1 = new Group();
        const g1 = bodyOf(1, concept).geo;
        for (const m of [meshOf(g1.paint, paint), meshOf(g1.trim, mats!.lodTrim)]) if (m) lod1.add(m);
        const em1 = meshOf(g1.emissive, mats!.emissive, false)!;
        lod1.add(em1);
        for (const m of lod1.children) m.layers.enable(MIRROR_LAYER);
        root.add(lod0, lod1);
        let lightBar: Mesh<BoxGeometry, MeshStandardMaterial> | null = null;
        if (spec.teamId === 'safetyCar') {
          const geo = new BoxGeometry(0.9, 0.11, 0.22);
          geos.push(geo);
          lightBar = new Mesh(geo, new MeshStandardMaterial({ color: '#FFB21A', emissive: '#FF9500', emissiveIntensity: 2, roughness: 0.28 }));
          lightBar.name = 'safety-car-light-bar';
          lightBar.position.set(0, 1.12, -0.3);
          lightBar.layers.enable(MIRROR_LAYER);
          root.add(lightBar);
        }
        let ghost: Group | null = null;
        if (spec.isGhost) {
          if (!ghostGeo) {
            ghostGeo = ghostGeometry(bodies[1]!, wheels[1]!);
            geos.push(ghostGeo);
          }
          const gm = mats!.ghost(team, atlas);
          ghost = new Group();
          const gmesh = new Mesh(ghostGeo, gm);
          gmesh.layers.set(GHOST_LAYER);
          gmesh.castShadow = false;
          gmesh.receiveShadow = false;
          gmesh.name = 'ghost';
          ghost.add(gmesh);
          root.add(ghost);
          lod0.visible = false;
          lod1.visible = false;
        }
        const slot: Slot = { spec, team, atlas, paint, root, lod0, lod1, flap, steer, visor, ghost, lightBar, lod: -1, rain: 0.05, head, tint: new Color(team.colors.secondary) };
        const setRain = (): void => {
          mats!.emissive.uniforms['uIntensity']!.value = slot.rain;
          mats!.emissive.uniformsNeedUpdate = true;
        };
        em0.onBeforeRender = setRain;
        em1.onBeforeRender = setRain;
        byId[spec.id] = slot;
        group!.add(root);
        return slot;
      });
      display = createWheelDisplay();
      for (const w of wheelMeshes) for (const m of w) m.layers.enable(MIRROR_LAYER);
      lod2Mesh.layers.enable(MIRROR_LAYER);
      mirrors = createMirrors(c.quality);
      c.scene.add(group);
      attachSubsystem(c.renderer, 'cars', sys);
    },

    update(frame: RenderFrame, cam: PerspectiveCamera) {
      if (!group || !mats || !quality || !lod2Mesh || !blobMesh) return;
      cam.getWorldPosition(camPos);
      mats.setWetness(frame.conditions.wetness);
      const fovK = Math.min(1.5, Math.max(0.25, cam.fov / 65));
      const [l0Max, l1Max, visMax] = quality.carLod;
      const cap = PRESET_DERIVED[quality.id].lod0Cap;
      // Pass 1: desired LOD per car from effective distance with hysteresis.
      order.length = 0;
      const cars = frame.cars;
      for (let i = 0; i < cars.length; i++) {
        const cs = cars[i]!;
        const s = byId[cs.id];
        if (!s) continue;
        const dx = cs.px - camPos.x, dy = cs.py - camPos.y, dz = cs.pz - camPos.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * fovK;
        dist[i] = d;
        let lod: number;
        if (!cs.visible) lod = -1;
        else if (s.spec.isGhost || cs.isGhost) lod = 1;
        else if (forced !== null) lod = forced;
        else {
          const prev = s.lod;
          const t0 = prev > 0 || prev < 0 ? l0Max * 0.9 : l0Max;
          const t1 = prev > 1 || prev < 0 ? l1Max * 0.9 : l1Max;
          const t2 = prev < 0 ? visMax * 0.9 : visMax;
          lod = d < t0 ? 0 : d < t1 ? 1 : d < t2 ? 2 : -1;
          if (cs.isPlayer || cs.id === frame.playerId) lod = 0;
        }
        s.lod = lod;
        if (lod === 0 && !cs.isPlayer && forced === null) order.push(i);
      }
      // LOD0 cap: keep the nearest `cap` (player excluded from the count only if it is not LOD0 already).
      if (forced === null && order.length > cap - 1) {
        order.sort((a, b) => dist[a]! - dist[b]!);
        for (let k = cap - 1; k < order.length; k++) byId[cars[order[k]!]!.id]!.lod = 1;
      }
      // Pass 2: transforms, sub-part animation, instances.
      let b2 = 0, nb = 0;
      let draws = 0;
      wcount[0] = wcount[1] = wcount[2] = 0;
      for (let i = 0; i < cars.length; i++) {
        const cs = cars[i]!;
        const s = byId[cs.id];
        if (!s) continue;
        const lod = s.lod;
        const hide = lod < 0;
        s.root.visible = !hide && lod !== 2;
        if (hide) continue;
        carMatrix(cs, mCar);
        if (lod !== 2) {
          s.root.matrix.copy(mCar);
          s.root.matrixWorldNeedsUpdate = true;
        }
        const ghost = s.ghost !== null;
        s.lod0.visible = lod === 0 && !ghost;
        s.lod1.visible = lod === 1 && !ghost;
        if (ghost) {
          const gm = s.ghost!.children[0] as Mesh;
          (gm.material as ShaderMaterial).uniforms['uAlpha']!.value = cs.ghostAlpha;
          s.ghost!.visible = cs.ghostAlpha > 0.01;
          if (s.ghost!.visible) draws += 1;
        }
        if (lod === 0) {
          s.flap.rotation.x = -DRS_FLAP_OPEN * drsEase(cs.drsFlap);
          s.steer.rotation.z = -cs.steerAngle * 8;
          const cockpit = cockpitId === cs.id;
          s.head.value = cockpit ? 1 : 0;
          s.visor.visible = !cockpit;
          draws += cockpit ? 6 : 7;
          if (cockpit && display) {
            if (display.mesh.parent !== s.steer) s.steer.add(display.mesh);
            display.mesh.visible = displayModel !== null;
            if (displayModel) {
              display.update(frame.time);
              draws++;
            }
          }
        } else if (lod === 1 && !ghost) draws += 3;
        // Rain light: off 0.05, on 4.0, flash 4 Hz square wave with a per-car phase.
        const rl = cs.rainLight;
        if (s.lightBar) {
          s.lightBar.material.emissiveIntensity = rl === 2 ? (frame.time * 2 % 1 < 0.5 ? 3 : 0.15) : 2;
          if (lod < 2) draws++;
        }
        s.rain = rl === 0 ? 0.05 : rl === 1 ? 4 : ((frame.time + 0.07 * cs.id) * 4) % 1 < 0.5 ? 4 : 0.05;
        if (lod === 2) {
          lod2Mesh.setMatrixAt(b2, mCar);
          tmpColor.set(s.team.colors.primary);
          (lod2Mesh.geometry.getAttribute('aPrim') as InstancedBufferAttribute).setXYZ(b2, tmpColor.r, tmpColor.g, tmpColor.b);
          tmpColor.set(s.team.colors.secondary);
          (lod2Mesh.geometry.getAttribute('aSec') as InstancedBufferAttribute).setXYZ(b2, tmpColor.r, tmpColor.g, tmpColor.b);
          b2++;
        }
        if (!ghost) {
          // Wheels.
          const wl = lod as 0 | 1 | 2;
          const [tyre, rim, hub] = wheelMeshes[wl]!;
          const comp = COMPOUND_COLORS[cs.compound];
          tmpColor.setHex(comp);
          // Spoke blur swap around 120 km/h (31–36 m/s); below it the rim shader cuts the spoke gaps open.
          const blur = smooth(31, 36, Math.abs(cs.speed));
          // Tread on LOD0/LOD1 only (LOD2 stays plain); the pattern averages out between 8 and 25 m/s of wheel speed.
          const tread = wl < 2 ? TREAD_KIND[cs.compound] ?? 0 : 0;
          const treadBlur = smooth(8, 25, Math.abs(cs.speed));
          for (let w = 0; w < 4; w++) {
            const idx = wcount[wl]!++;
            const [wx, wy, wz] = WHEEL_POS[w]!;
            const right = wx < 0;
            const front = w < 2;
            let steer = 0;
            if (front) {
              const inner = (cs.steerAngle > 0) === !right;
              steer = cs.steerAngle * (inner ? 1.15 : 0.85);
            }
            qSteer.setFromAxisAngle(AY, steer);
            qSide.copy(right ? qFlip : qId);
            const spin = cs.wheelSpin[w] * (right ? -1 : 1);
            qSpin.setFromAxisAngle(AX, spin);
            vP.set(wx, wy + cs.susp[w], wz);
            vS.set(front ? 1 : REAR_W / FRONT_W, 1, 1);
            qAll.copy(qSteer).multiply(qSide);
            // Hub (no spin).
            mLocal.compose(vP, qAll, vS);
            mOut.multiplyMatrices(mCar, mLocal);
            hub.setMatrixAt(idx, mOut);
            (hub.geometry.getAttribute('aGlow') as InstancedBufferAttribute).setX(idx, cs.brakeGlow[w]);
            qAll.multiply(qSpin);
            mLocal.compose(vP, qAll, vS);
            mOut.multiplyMatrices(mCar, mLocal);
            tyre.setMatrixAt(idx, mOut);
            rim.setMatrixAt(idx, mOut);
            (tyre.geometry.getAttribute('aCompound') as InstancedBufferAttribute).setXYZ(idx, tmpColor.r, tmpColor.g, tmpColor.b);
            (tyre.geometry.getAttribute('aTread') as InstancedBufferAttribute).setXYZ(idx, tread, treadBlur, right ? -1 : 1);
            const ra = rim.geometry.getAttribute('aTint') as InstancedBufferAttribute;
            ra.setXYZ(idx, s.tint.r, s.tint.g, s.tint.b);
            (rim.geometry.getAttribute('aBlur') as InstancedBufferAttribute).setXY(idx, blur, cs.brakeGlow[w]); // (spoke blur, disc glow)
          }
          // Blob shadow.
          mOut.multiplyMatrices(mCar, mBlob);
          blobMesh.setMatrixAt(nb++, mOut);
        }
      }
      for (let l = 0; l < 3; l++) {
        const n = wcount[l]!;
        const wm = wheelMeshes[l]!;
        for (let mi = 0; mi < 3; mi++) {
          const m = wm[mi]!;
          m.count = n;
          if (n > 0) {
            m.instanceMatrix.needsUpdate = true;
            m.instanceMatrix.clearUpdateRanges();
            m.instanceMatrix.addUpdateRange(0, n * 16);
            for (let ai = 0; ai < WHEEL_ATTRS.length; ai++) {
              const a = m.geometry.getAttribute(WHEEL_ATTRS[ai]!) as InstancedBufferAttribute | undefined;
              if (a) a.needsUpdate = true;
            }
            draws++;
          }
        }
      }
      lod2Mesh.count = b2;
      if (b2 > 0) {
        lod2Mesh.instanceMatrix.needsUpdate = true;
        (lod2Mesh.geometry.getAttribute('aPrim') as InstancedBufferAttribute).needsUpdate = true;
        (lod2Mesh.geometry.getAttribute('aSec') as InstancedBufferAttribute).needsUpdate = true;
        draws++;
      }
      blobMesh.count = nb;
      if (nb > 0) {
        blobMesh.instanceMatrix.needsUpdate = true;
        draws++;
      }
      if (crew) crew.update(frame);
      lastDraws = draws;
      // G9: rear-view mirrors, cockpit and T-cam views (D-051 #5; not counted in the main-pass draws above).
      const mirrorId = frame.lookBack ? null : frame.view === 'cockpit' ? cockpitId : frame.view === 'tcam' ? frame.playerId : null;
      const ms = mirrorId !== null ? byId[mirrorId] : undefined;
      let mirrorOn = false;
      if (mirrors && ctx && ms && ms.lod === 0 && !ms.ghost) {
        if (mirrors.glass[0].parent !== ms.lod0) ms.lod0.add(mirrors.glass[0], mirrors.glass[1]);
        mirrorOn = mirrors.render(ctx.renderer, ctx.scene, ms.root.matrix, frame.frameDt, mirrorSwap);
      }
      if (mirrors) mirrors.glass[0].visible = mirrors.glass[1].visible = mirrorOn;
    },

    setTrack(q) {
      crew?.dispose();
      crew = q && group ? createPitCrew(q) : null;
      if (crew) group!.add(crew.mesh);
    },
    setCockpitCar(id) {
      cockpitId = id;
      if (display && id === null) {
        display.mesh.removeFromParent();
        display.mesh.visible = false;
      }
    },
    setWheelDisplay(m) {
      displayModel = m;
      display?.set(m);
      if (display && !m) display.mesh.visible = false;
    },
    wheelDisplay: () => display,
    forceLod(l) {
      forced = l;
    },
    setQuality(q) {
      // D-019: LOD distances, LOD0 cap, material features and anisotropy follow the preset; geometry is shared.
      quality = q;
      mats?.setQuality(q);
      mirrors?.setQuality(q);
      for (const t of textures) {
        if (t.anisotropy === q.anisotropy) continue;
        t.anisotropy = q.anisotropy;
        t.needsUpdate = true;
      }
      for (const s of slots) s.lod = -1;
    },
    stats() {
      const tri = (l: 0 | 1 | 2): number => bodies[l]?.triangles ?? 0;
      const wt = (l: 0 | 1 | 2): number => {
        const w = wheels[l];
        if (!w) return 0;
        const t = (g: BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
        return 4 * (t(w.tyre) + t(w.rim) + t(w.hub));
      };
      const lc: [number, number, number, number] = [0, 0, 0, 0];
      for (const s of slots) lc[s.lod < 0 ? 3 : s.lod]!++;
      return { triangles: [tri(0), tri(1), tri(2)], bodyDraws: [7, 3, 1], wheelTriangles: [wt(0), wt(1), wt(2)], lodCounts: lc };
    },
    drawCalls: () => lastDraws,
    materials: () => mats,
    root: () => group,
    liveryTextures: () => textures,
    dispose() {
      if (ctx) detachSubsystem(ctx.renderer, 'cars', sys);
      display?.dispose();
      display = null;
      displayModel = null;
      mirrors?.dispose();
      mirrors = null;
      crew?.dispose();
      crew = null;
      group?.removeFromParent();
      for (const s of slots) s.lightBar?.material.dispose();
      for (const w of wheelMeshes) for (const m of w) m.dispose();
      wheelMeshes.length = 0;
      lod2Mesh?.dispose();
      blobMesh?.dispose();
      lod2Mesh = null;
      blobMesh = null;
      for (const g of geos) g.dispose();
      geos.length = 0;
      conceptBodies.clear();
      for (const t of textures) t.dispose();
      textures.length = 0;
      mats?.dispose();
      mats = null;
      slots = [];
      byId.length = 0;
      bodies.length = 0;
      wheels.length = 0;
      group = null;
      ctx = null;
      void ctx;
    },
  };
  return sys;
}

type THREE_Material = import('three').Material;
