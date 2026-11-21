// Cappadocia prop builders (Çevre-2, for scenery/cappadocia.ts): instanced, budget-friendly groups placed from lists.
// Every builder takes a PropsEnv (an EnvContext with its ground) and returns an EnvPart-compatible PropPart.
//   createFairyChimneys  tuff cones 6–40 m with basalt caps, twin / triple clusters, carved openings  2 draws
//   createCaveDwellings  openings, doors and dovecote holes on valley walls + a honeycombed rock castle  2 draws
//   createBalloons       8–15 hot-air balloons drifting and rising (deterministic, render clock)        1 draw
//   createStoneVillage   flat-roof stone houses (lit windows), a mosque with minaret, field walls      2–3 draws
//   createOrchards       vineyard rows and apricot orchards                                            2 draws
// Openings are EnvMode.Lamp quads: black by day (they read as holes), warm light at sunset / night (applyConditions).
// Only the env material families (opaque, inst) are used: no new shader programs.

import {
  Color, Group, IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3,
  type BufferGeometry, type Material, type PerspectiveCamera,
} from 'three';
import type { ConditionsFrame } from '../../contracts/conditions';
import type { QualityPreset, RenderFrame } from '../../contracts/render';
import { envMaterial, EnvMode, envUniforms, type EnvShared } from '../materials/shared';
import { makeRand } from '../mesh/textures';
import type { EnvTextures } from '../mesh/textures';
import { blockGeometry } from './skyline';
import { boxInFrame, SBuf } from './stands';

type V3 = number[];
const TAU = Math.PI * 2;

/** What the builders need from the environment (an EnvContext satisfies it with `ground: c.ground!`). */
export interface PropsEnv {
  sh: EnvShared;
  tex: Pick<EnvTextures, 'concrete' | 'dirt'>;
  quality: Pick<QualityPreset, 'id'>;
  ground: { height(x: number, z: number): number };
}

/** Optional shared buffers: when given, a builder appends its static rock / stone geometry to `rock` and its carved
 *  openings / lamps to `lamps` (the caller draws each buffer once and drives the lamp light) instead of making its own
 *  meshes, so several groups share two draws. */
export interface PropsSink { rock: SBuf; lamps: SBuf }

/** EnvPart-compatible result (root, update, applyConditions, setQuality, dispose) plus its triangle count. */
export interface PropPart {
  root: Group;
  triangles: number;
  update?(cam: PerspectiveCamera, frame: RenderFrame, dt: number): void;
  applyConditions?(c: ConditionsFrame): void;
  setQuality?(q: QualityPreset): void;
  dispose(): void;
}

// ---- placement lists ---------------------------------------------------------------------------------------------
/** A fairy chimney (or a cluster of 2–3 sharing a base): world (x, z), height 6–40 m. */
export interface ChimneySite { x: number; z: number; h: number; cluster?: 1 | 2 | 3; caves?: boolean; seed?: number; wide?: number; tint?: Color }
/** A vertical valley-wall face to carve: bottom-centre (x, z), outward normal (nx, nz), width, height, base y. */
export interface DwellingFace { x: number; z: number; nx: number; nz: number; w: number; h: number; y0?: number; seed?: number }
/** A rock castle hill: base centre, base radius, height above the ground. */
export interface CastleSite { x: number; z: number; r: number; h: number; /** Base height (default: the ground under the centre). */ y0?: number }
export interface BalloonArea { x: number; z: number; r: number; yMin: number; yMax: number; count: number; seed?: number; windX?: number; windZ?: number }
export interface HouseSite { x: number; z: number; w: number; d: number; h: number; yaw: number }
export interface MosqueSite { x: number; z: number; yaw: number; scale?: number }
export interface FieldRect { x: number; z: number; w: number; d: number; yaw: number }

// ---- shared helpers ----------------------------------------------------------------------------------------------
const TUFF = [new Color(0.96, 0.87, 0.74), new Color(0.93, 0.74, 0.64), new Color(0.98, 0.9, 0.8), new Color(0.88, 0.68, 0.58)];
const BASALT = new Color(0.2, 0.17, 0.15);
const LAMP_WARM = new Color(1, 0.72, 0.42);
const HOLE = new Color(0, 0, 0);

/** Lathe of a [height, radius, colour] profile around y, `sides` faces, outward normals from the profile slope. */
function lathe(b: SBuf, prof: readonly (readonly [number, number, Color])[], sides: number, o: V3 = [0, 0, 0], sx = 1, sy = 1, wobble?: (a: number, h: number) => number): void {
  for (let k = 0; k + 1 < prof.length; k++) {
    const [h0, r0, col] = prof[k]!, [h1, r1] = prof[k + 1]!;
    const dr = r0 - r1, dh = h1 - h0;
    const l = Math.hypot(dr, dh) || 1;
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * TAU, a1 = ((i + 1) / sides) * TAU, am = (a0 + a1) / 2;
      const w0 = wobble ? wobble(a0, h0) : 1, w1 = wobble ? wobble(a1, h0) : 1, w2 = wobble ? wobble(a0, h1) : 1, w3 = wobble ? wobble(a1, h1) : 1;
      const p = (r: number, a: number, h: number, w: number): V3 => [o[0]! + Math.cos(a) * r * sx * w, o[1]! + h * sy, o[2]! + Math.sin(a) * r * sx * w];
      b.quad([p(r0, a0, h0, w0), p(r0, a1, h0, w1), p(r1, a0, h1, w2), p(r1, a1, h1, w3)], [Math.cos(am) * dh / l, dr / l, Math.sin(am) * dh / l], col);
    }
  }
}

/** Opening quad on a surface point (centre c, outward normal n): width w, height h. */
export function opening(b: SBuf, c: V3, nx: number, nz: number, w: number, h: number, col: Color): void {
  const tx = -nz, tz = nx;
  const x = c[0]! + nx * 0.06, z = c[2]! + nz * 0.06, y = c[1]!;
  b.quad([[x - tx * w / 2, y, z - tz * w / 2], [x + tx * w / 2, y, z + tz * w / 2], [x - tx * w / 2, y + h, z - tz * w / 2], [x + tx * w / 2, y + h, z + tz * w / 2]], [nx, 0, nz], col);
}

function lampMaterial(env: PropsEnv, name: string): ReturnType<typeof envMaterial> {
  return envMaterial(env.sh, { name, family: 'opaque', mode: EnvMode.Lamp, vertexColor: true, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6, wet: 0, flood: 0 });
}

/** Night / sunset strength of carved-window light. */
export const lampK = (c: ConditionsFrame): number => (c.tod === 'night' ? 2.2 : c.tod === 'sunset' ? 0.7 : 0);

function part(root: Group, geos: BufferGeometry[], mats: Material[], meshes: InstancedMesh[], extra: Partial<PropPart> = {}): PropPart {
  const triangles = root.children.reduce((n, o) => {
    const m = o as Mesh & { count?: number };
    const g = m.geometry;
    const t = g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
    return n + t * ((m as InstancedMesh).isInstancedMesh ? (m as InstancedMesh).count : 1);
  }, 0);
  return {
    root, triangles, ...extra,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const m of meshes) m.dispose();
      root.removeFromParent();
    },
  };
}

function staticMesh(geo: BufferGeometry, mat: Material, name: string, shadows: boolean): Mesh {
  const m = new Mesh(geo, mat);
  m.name = name;
  m.castShadow = shadows;
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  return m;
}

// ---- (1) fairy chimneys ------------------------------------------------------------------------------------------
/** Chimney profile in a unit frame (height 1): bulging tuff body in strata bands, a neck, a dark basalt cap. */
function chimneyProfile(): [number, number, Color][] {
  const out: [number, number, Color][] = [];
  const body: [number, number][] = [[-0.06, 0.36], [0.06, 0.32], [0.18, 0.285], [0.3, 0.25], [0.42, 0.215], [0.54, 0.18], [0.65, 0.145], [0.75, 0.11], [0.81, 0.088]];
  body.forEach(([h, r], k) => out.push([h, r, TUFF[k % TUFF.length]!]));
  out.push([0.835, 0.08, BASALT], [0.855, 0.16, BASALT], [0.91, 0.15, BASALT], [0.96, 0.08, BASALT], [0.99, 0.0, BASALT]);
  return out;
}
const chimneyRadius = (t: number): number => {
  const p = chimneyProfile();
  for (let k = 0; k + 1 < p.length; k++) if (t <= p[k + 1]![0]) return p[k]![1] + ((p[k + 1]![1] - p[k]![1]) * (t - p[k]![0])) / (p[k + 1]![0] - p[k]![0]);
  return 0;
};

export function createFairyChimneys(env: PropsEnv, sites: readonly ChimneySite[], sink?: PropsSink): PropPart {
  const root = new Group();
  root.name = 'capp.chimneys';
  const b = new SBuf();
  lathe(b, chimneyProfile(), 12);
  const geo = b.geometry();
  type Inst = { x: number; y: number; z: number; h: number; wk: number; yaw: number; tint?: Color };
  const inst: Inst[] = [];
  const holes = sink?.lamps ?? new SBuf();
  for (const s of sites) {
    const rand = makeRand(s.seed ?? Math.round(s.x * 7 + s.z * 13));
    const n = s.cluster ?? 1;
    for (let k = 0; k < n; k++) {
      const a = rand() * TAU, off = n > 1 ? s.h * (0.12 + rand() * 0.1) : 0;
      const x = s.x + Math.cos(a) * off, z = s.z + Math.sin(a) * off;
      const h = s.h * (k === 0 ? 1 : 0.55 + rand() * 0.35);
      const wk = (s.wide ?? 1) * (0.85 + rand() * 0.35);
      // Sit on the lowest ground under the base (the bulge buries itself on a slope).
      let y = env.ground.height(x, z);
      for (let j = 0; j < 4; j++) y = Math.min(y, env.ground.height(x + Math.cos(j * 1.57) * h * 0.3, z + Math.sin(j * 1.57) * h * 0.3));
      inst.push({ x, y, z, h, wk, yaw: rand() * TAU, tint: s.tint });
      // Carved openings: a door at the foot and 1–4 windows up the body, on the larger cones.
      if (s.caves && h > 10) {
        const nw = 1 + Math.floor(rand() * 4);
        for (let m = 0; m <= nw; m++) {
          const t = m === 0 ? 0.0 : 0.12 + rand() * 0.42;
          const ang = rand() * TAU;
          const r = chimneyRadius(t + (m === 0 ? 0.03 : 0)) * h * wk;
          const nx = Math.cos(ang), nz = Math.sin(ang);
          const c: V3 = [x + nx * r, y + t * h + (m === 0 ? 0 : 0), z + nz * r];
          if (m === 0) opening(holes, c, nx, nz, 1.3, 2.3, LAMP_WARM);
          else opening(holes, c, nx, nz, 0.9, 1.2, rand() < 0.65 ? LAMP_WARM : HOLE);
        }
      }
    }
  }
  const mat = envMaterial(env.sh, { name: 'capp.chimneys', family: 'inst', vertexColor: true, normalMap: env.tex.concrete.normal, roughness: 0.95, wet: 0.5, flood: 0.7 });
  const mesh = new InstancedMesh(geo, mat, Math.max(1, inst.length));
  mesh.name = 'capp.chimneys';
  const m4 = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), p = new Vector3(), sc = new Vector3(), white = new Color(1, 1, 1);
  inst.forEach((c, k) => {
    m4.compose(p.set(c.x, c.y, c.z), q.setFromAxisAngle(up, c.yaw), sc.set(c.h * c.wk, c.h, c.h * c.wk));
    mesh.setMatrixAt(k, m4);
    mesh.setColorAt(k, c.tint ?? white);
  });
  mesh.count = inst.length;
  mesh.castShadow = env.quality.id !== 'low';
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  root.add(mesh);
  if (sink) return part(root, [geo], [mat], [mesh], { setQuality(qp) { mesh.castShadow = qp.id !== 'low'; } });
  const hGeo = holes.geometry();
  const hMat = lampMaterial(env, 'capp.chimneyWindows');
  root.add(staticMesh(hGeo, hMat, 'capp.chimneyWindows', false));
  return part(root, [geo, hGeo], [mat, hMat], [mesh], {
    applyConditions(c) { hMat.emissiveIntensity = lampK(c); },
    setQuality(qp) { mesh.castShadow = qp.id !== 'low'; },
  });
}

// ---- (2) carved dwellings on valley walls + the rock castle ------------------------------------------------------
export function createCaveDwellings(env: PropsEnv, faces: readonly DwellingFace[], castle?: CastleSite, sink?: PropsSink): PropPart {
  const root = new Group();
  root.name = 'capp.dwellings';
  const rock = sink?.rock ?? new SBuf();
  const holes = sink?.lamps ?? new SBuf();
  const pale = new Color(0.98, 0.9, 0.78);
  for (const f of faces) {
    const rand = makeRand(f.seed ?? Math.round(f.x * 3 + f.z * 5));
    const tx = -f.nz, tz = f.nx;
    const y0 = f.y0 ?? env.ground.height(f.x, f.z);
    // Doors along the foot, rows of windows above, dovecote holes in a grid near the top.
    const doors = Math.max(1, Math.floor(f.w / 9));
    for (let k = 0; k < doors; k++) {
      const u = (k + 0.5) / doors - 0.5 + (rand() - 0.5) * 0.06;
      const c: V3 = [f.x + tx * u * f.w, y0, f.z + tz * u * f.w];
      // Carved façade panel round some doors (a paler relief standing proud of the wall).
      if (rand() < 0.4) {
        boxInFrame(rock, { x: c[0]! + f.nx * 0.1, y: y0, z: c[2]! + f.nz * 0.1 }, [-1.6, 1.6], [-0.15, 0.15], [0, 3.6], tx, tz, f.nx, f.nz, pale);
        c[0] = c[0]! + f.nx * 0.27; c[2] = c[2]! + f.nz * 0.27;
      }
      opening(holes, c, f.nx, f.nz, 1.3, 2.3, LAMP_WARM);
    }
    const rows = Math.max(1, Math.floor((f.h * 0.6) / 4));
    for (let r = 0; r < rows; r++) {
      const per = Math.max(1, Math.floor(f.w / (6 + rand() * 4)));
      for (let k = 0; k < per; k++) {
        if (rand() < 0.3) continue;
        const u = (k + 0.5) / per - 0.5 + (rand() - 0.5) * 0.08;
        const c: V3 = [f.x + tx * u * f.w, y0 + 4 + r * 4 + rand() * 0.8, f.z + tz * u * f.w];
        opening(holes, c, f.nx, f.nz, 0.9, 1.2, rand() < 0.55 ? LAMP_WARM : HOLE);
      }
    }
    // Dovecote holes: small dark squares in rows, a pale band round them.
    const dTop = y0 + f.h * 0.82;
    for (let r = 0; r < 3; r++) for (let k = 0; k < Math.floor(f.w / 2.2); k++) {
      const u = (k + 0.5) / Math.floor(f.w / 2.2) - 0.5;
      opening(holes, [f.x + tx * u * f.w * 0.5, dTop + r * 0.9, f.z + tz * u * f.w * 0.5], f.nx, f.nz, 0.32, 0.32, HOLE);
    }
  }
  // Rock castle: a jagged pinnacle (displaced lathe in tuff bands) honeycombed with openings, a flag on top.
  if (castle) {
    const rand = makeRand(Math.round(castle.x + castle.z));
    const gy = castle.y0 ?? env.ground.height(castle.x, castle.z);
    const prof: [number, number, Color][] = [];
    const N = 16;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const r = t < 0.85 ? 1 - 0.55 * Math.pow(t / 0.85, 1.4) - 0.12 * Math.sin(t * 9) : 0.33 * (1 - (t - 0.85) / 0.15) + 0.05;
      prof.push([t, Math.max(0.02, r), TUFF[k % TUFF.length]!]);
    }
    const wob = (a: number, h: number): number => 1 + 0.16 * Math.sin(a * 5 + h * 7) + 0.09 * Math.sin(a * 11 - h * 13);
    lathe(rock, prof, 28, [castle.x, gy - 2, castle.z], castle.r, castle.h + 2, wob);
    for (let k = 0; k < Math.round(castle.r * castle.h * 0.06); k++) {
      const t = 0.08 + rand() * 0.75;
      const a = rand() * TAU;
      const pr = prof[Math.min(N, Math.round(t * N))]![1];
      const r = pr * castle.r * wob(a, t) - 0.3;
      const nx = Math.cos(a), nz = Math.sin(a);
      opening(holes, [castle.x + nx * r, gy - 2 + t * (castle.h + 2), castle.z + nz * r], nx, nz, 1.0, 1.4, rand() < 0.5 ? LAMP_WARM : HOLE);
    }
    const top = gy + castle.h;
    boxInFrame(rock, { x: castle.x, y: top - 1, z: castle.z }, [-0.08, 0.08], [-0.08, 0.08], [0, 9], 1, 0, 0, 1, new Color(0.7, 0.7, 0.72));
    rock.quad([[castle.x, top + 7.8, castle.z], [castle.x + 3.4, top + 7.8, castle.z], [castle.x, top + 6, castle.z], [castle.x + 3.4, top + 6, castle.z]], [0, 0, 1], new Color(0.75, 0.08, 0.06));
    rock.quad([[castle.x + 3.4, top + 7.8, castle.z], [castle.x, top + 7.8, castle.z], [castle.x + 3.4, top + 6, castle.z], [castle.x, top + 6, castle.z]], [0, 0, -1], new Color(0.75, 0.08, 0.06));
  }
  if (sink) return part(root, [], [], []);
  const rGeo = rock.geometry();
  const rMat = envMaterial(env.sh, { name: 'capp.dwellingRock', family: 'opaque', vertexColor: true, map: env.tex.concrete.map, normalMap: env.tex.dirt.normal, roughness: 0.95, wet: 0.5 });
  const rMesh = staticMesh(rGeo, rMat, 'capp.dwellingRock', env.quality.id !== 'low');
  root.add(rMesh);
  const hGeo = holes.geometry();
  const hMat = lampMaterial(env, 'capp.dwellingWindows');
  root.add(staticMesh(hGeo, hMat, 'capp.dwellingWindows', false));
  return part(root, [rGeo, hGeo], [rMat, hMat], [], {
    applyConditions(c) { hMat.emissiveIntensity = lampK(c); },
    setQuality(qp) { rMesh.castShadow = qp.id !== 'low'; },
  });
}

// ---- (3) hot-air balloons ----------------------------------------------------------------------------------------
const BALLOON_COLS = [0xd8242a, 0xf2b705, 0x1f6fd1, 0x22a35a, 0xe8642a, 0x7b3fb5, 0xf2f2f2, 0xe23f8c, 0x13a3b5, 0xf59a1b];

/** Envelope (radius 8.5 m, 22 m tall, 14 gores in two tones that the instance colour tints), throat, cables, basket. */
function balloonGeometry(): BufferGeometry {
  const b = new SBuf();
  const prof: [number, number][] = [[0, 0.17], [0.12, 0.42], [0.3, 0.78], [0.48, 0.98], [0.64, 1.0], [0.78, 0.92], [0.9, 0.7], [0.97, 0.4], [1.0, 0.0]];
  const SIDES = 14, R = 8.5, H = 22, Y0 = 6;
  for (let k = 0; k + 1 < prof.length; k++) {
    const [h0, r0] = prof[k]!, [h1, r1] = prof[k + 1]!;
    const dr = (r0 - r1) * R, dh = (h1 - h0) * H, l = Math.hypot(dr, dh) || 1;
    for (let i = 0; i < SIDES; i++) {
      const a0 = (i / SIDES) * TAU, a1 = ((i + 1) / SIDES) * TAU, am = (a0 + a1) / 2;
      const p = (r: number, a: number, h: number): V3 => [Math.cos(a) * r * R, Y0 + h * H, Math.sin(a) * r * R];
      const tone = i % 2 === 0 ? 1 : k === 4 ? 1 : 0.55;
      b.quad([p(r0, a0, h0), p(r0, a1, h0), p(r1, a0, h1), p(r1, a1, h1)], [Math.cos(am) * dh / l, dr / l, Math.sin(am) * dh / l], new Color(tone, tone, tone));
    }
  }
  const basket = new Color(0.3, 0.2, 0.12), cable = new Color(0.2, 0.2, 0.2);
  boxInFrame(b, { x: 0, y: 0, z: 0 }, [-0.75, 0.75], [-0.75, 0.75], [0, 1.15], 1, 0, 0, 1, basket, true);
  for (const [ux, uz] of [[0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
    const top = [ux * 2.0, Y0 + 0.2, uz * 2.0];
    b.quad([[ux - 0.03, 1.15, uz], [ux + 0.03, 1.15, uz], [top[0]! - 0.03, top[1]!, top[2]!], [top[0]! + 0.03, top[1]!, top[2]!]], [0, 0, 1], cable);
  }
  boxInFrame(b, { x: 0, y: 1.4, z: 0 }, [-0.3, 0.3], [-0.3, 0.3], [0, 0.6], 1, 0, 0, 1, new Color(0.55, 0.55, 0.58));
  return b.geometry();
}

/** Extra controls of the balloon group. */
export interface BalloonControls {
  /** Advance the drift clock by dt seconds (same as update without camera / frame). */
  step(dt: number): void;
  /** World position of balloon k (tests, cameras). */
  positionOf(k: number, o: Vector3): Vector3;
}

export function createBalloons(env: PropsEnv, area: BalloonArea): PropPart & BalloonControls {
  const root = new Group();
  root.name = 'capp.balloons';
  const rand = makeRand(area.seed ?? 1923);
  const n = Math.max(1, Math.min(15, area.count));
  const geo = balloonGeometry();
  const mat = envMaterial(env.sh, { name: 'capp.balloons', family: 'inst', vertexColor: true, roughness: 0.75, wet: 0.2, flood: 0.3 });
  const mesh = new InstancedMesh(geo, mat, n);
  mesh.name = 'capp.balloons';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  const wx = area.windX ?? 1.6, wz = area.windZ ?? 0.6;
  const bs = Array.from({ length: n }, (_, k) => ({
    x0: (rand() - 0.5) * 2 * area.r, z0: (rand() - 0.5) * 2 * area.r, v: 0.6 + rand() * 0.8, ph: rand() * TAU,
    w: 0.02 + rand() * 0.03, yaw: rand() * TAU, col: new Color(BALLOON_COLS[k % BALLOON_COLS.length]!).convertSRGBToLinear(),
  }));
  bs.forEach((b, k) => mesh.setColorAt(k, b.col));
  root.add(mesh);
  const m4 = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), p = new Vector3(), one = new Vector3(1, 1, 1);
  const span = 2 * area.r;
  const wrap = (v: number): number => ((((v + area.r) % span) + span) % span) - area.r;
  let clock = 0;
  /** Positions at render-clock time t (deterministic: drift with the wind, wrapped in the area; slow rise and fall). */
  const place = (t: number): void => {
    for (let k = 0; k < n; k++) {
      const b = bs[k]!;
      const x = area.x + wrap(b.x0 + wx * b.v * t), z = area.z + wrap(b.z0 + wz * b.v * t);
      const y = area.yMin + (area.yMax - area.yMin) * (0.5 + 0.5 * Math.sin(t * b.w + b.ph));
      m4.compose(p.set(x, y, z), q.setFromAxisAngle(up, b.yaw + t * 0.01), one);
      mesh.setMatrixAt(k, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  place(0);
  const out = part(root, [geo], [mat], [mesh], {
    update(_cam, _frame, dt) {
      clock += dt;
      place(clock);
    },
    // Balloons fly at dawn / by day and sunset; none at night.
    applyConditions(c) { mesh.visible = c.tod !== 'night'; },
  });
  const controls: BalloonControls = {
    step(dt) { clock += dt; place(clock); },
    positionOf(k, o) { mesh.getMatrixAt(k, m4); return o.setFromMatrixPosition(m4); },
  };
  return Object.assign(out, controls);
}

// ---- (4) stone village -------------------------------------------------------------------------------------------
export function createStoneVillage(env: PropsEnv, houses: readonly HouseSite[], mosque?: MosqueSite, walls: readonly (readonly [number, number])[][] = [], sink?: PropsSink): PropPart {
  const root = new Group();
  root.name = 'capp.village';
  const rand = makeRand(Math.round((houses[0]?.x ?? 0) * 3 + 17));
  // Houses: the façade program (lit windows at night) on warm stone tints; flat roofs.
  const hGeo = blockGeometry();
  const apx = new InstancedBufferAttribute(new Float32Array(Math.max(1, houses.length) * 4), 4);
  hGeo.setAttribute('aApx', apx);
  const hMat = envMaterial(env.sh, { name: 'capp.houses', family: 'inst', mode: EnvMode.Facade, vertexColor: true, roughness: 0.9, wet: 0.5, flood: 0.8 });
  const hMesh = new InstancedMesh(hGeo, hMat, Math.max(1, houses.length));
  hMesh.name = 'capp.houses';
  const STONE = [0xd9c3a0, 0xcbb08a, 0xe2d2b6, 0xc29f7e, 0xd6b896];
  const m4 = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), p = new Vector3(), sc = new Vector3(), tint = new Color();
  houses.forEach((h, k) => {
    let y = env.ground.height(h.x, h.z);
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) y = Math.min(y, env.ground.height(h.x + ox * h.w * 0.5, h.z + oz * h.d * 0.5));
    m4.compose(p.set(h.x, y - 1, h.z), q.setFromAxisAngle(up, h.yaw), sc.set(h.w, h.h + 1, h.d));
    hMesh.setMatrixAt(k, m4);
    hMesh.setColorAt(k, tint.setHex(STONE[Math.floor(rand() * STONE.length)]!).convertSRGBToLinear());
    apx.setXYZW(k, Math.floor(rand() * 97), h.w, h.d, h.h + 1);
  });
  hMesh.count = houses.length;
  hMesh.castShadow = env.quality.id !== 'low';
  hMesh.receiveShadow = true;
  hMesh.computeBoundingSphere();
  root.add(hMesh);
  // Mosque (prayer hall, dome, minaret with a balcony) and field walls in one static mesh; the balcony lamps glow.
  const st = sink?.rock ?? new SBuf();
  const lamps = sink?.lamps ?? new SBuf();
  const stone = new Color(0.9, 0.82, 0.68), lead = new Color(0.45, 0.47, 0.5), wallC = new Color(0.8, 0.7, 0.55);
  if (mosque) {
    const s = mosque.scale ?? 1, ux = Math.cos(mosque.yaw), uz = -Math.sin(mosque.yaw);
    const gy = env.ground.height(mosque.x, mosque.z);
    const o = { x: mosque.x, y: gy - 0.5, z: mosque.z };
    boxInFrame(st, o, [-7 * s, 7 * s], [-7 * s, 7 * s], [0, 7.5 * s], ux, uz, -uz, ux, stone);
    const domeP: [number, number, Color][] = [];
    for (let k = 0; k <= 6; k++) { const a = (k / 6) * (Math.PI / 2); domeP.push([Math.sin(a), Math.cos(a), lead]); }
    lathe(st, domeP, 16, [mosque.x, gy + 7 * s, mosque.z], 6 * s, 5.5 * s);
    const mx = mosque.x + ux * 8.5 * s - uz * 6 * s, mz = mosque.z + uz * 8.5 * s + ux * 6 * s, mg = env.ground.height(mx, mz);
    lathe(st, [[0, 1.3, stone], [1, 1.1, stone]], 8, [mx, mg - 0.5, mz], s, 22 * s);
    lathe(st, [[0, 1.8, stone], [0.06, 1.8, stone], [0.12, 1.1, stone]], 8, [mx, mg + 17 * s, mz], s, 10 * s);
    lathe(st, [[0, 1.1, lead], [1, 0, lead]], 8, [mx, mg + 21.5 * s, mz], s, 5 * s);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      boxInFrame(lamps, { x: mx + Math.cos(a) * 1.85 * s, y: mg + 18 * s, z: mz + Math.sin(a) * 1.85 * s }, [-0.12, 0.12], [-0.12, 0.12], [0, 0.25], 1, 0, 0, 1, LAMP_WARM);
    }
  }
  for (const line of walls) {
    for (let k = 0; k + 1 < line.length; k++) {
      const [ax, az] = line[k]!, [bx, bz] = line[k + 1]!;
      const l = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(l / 4));
      for (let m = 0; m < n; m++) {
        const x0 = ax + ((bx - ax) * m) / n, z0 = az + ((bz - az) * m) / n, x1 = ax + ((bx - ax) * (m + 1)) / n, z1 = az + ((bz - az) * (m + 1)) / n;
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sl = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / sl, uz = (z1 - z0) / sl;
        boxInFrame(st, { x: cx, y: env.ground.height(cx, cz) - 0.4, z: cz }, [-sl / 2 - 0.05, sl / 2 + 0.05], [-0.3, 0.3], [0, 1.9], ux, uz, -uz, ux, wallC);
      }
    }
  }
  const houseLight = (c: ConditionsFrame): void => { envUniforms(hMat).uApxP.value.x = c.tod === 'night' ? 1.4 : c.tod === 'sunset' ? 0.4 : 0; };
  if (sink) return part(root, [hGeo], [hMat], [hMesh], { applyConditions: houseLight, setQuality(qp) { hMesh.castShadow = qp.id !== 'low'; } });
  const sGeo = st.geometry(), lGeo = lamps.geometry();
  const sMat = envMaterial(env.sh, { name: 'capp.villageStatics', family: 'opaque', vertexColor: true, map: env.tex.concrete.map, roughness: 0.9, wet: 0.5 });
  const lMat = lampMaterial(env, 'capp.villageLamps');
  const sMesh = staticMesh(sGeo, sMat, 'capp.villageStatics', env.quality.id !== 'low');
  root.add(sMesh);
  if (lamps.pos.length) root.add(staticMesh(lGeo, lMat, 'capp.villageLamps', false));
  return part(root, [hGeo, sGeo, lGeo], [hMat, sMat, lMat], [hMesh], {
    applyConditions(c) {
      houseLight(c);
      lMat.emissiveIntensity = lampK(c);
    },
    setQuality(qp) { hMesh.castShadow = qp.id !== 'low'; sMesh.castShadow = qp.id !== 'low'; },
  });
}

// ---- (5) vineyards and apricot orchards ---------------------------------------------------------------------------
/** One vine-row segment in a unit frame (length 1 along x, ≈ 0.9 m tall): leafy hedge on a trellis post line. */
function vineGeometry(): BufferGeometry {
  const b = new SBuf();
  boxInFrame(b, { x: 0, y: 0, z: 0 }, [-0.5, 0.5], [-0.35, 0.35], [0.25, 1.0], 1, 0, 0, 1, new Color(0.16, 0.26, 0.07));
  boxInFrame(b, { x: 0, y: 0, z: 0 }, [-0.5, 0.5], [-0.08, 0.08], [0, 0.25], 1, 0, 0, 1, new Color(0.2, 0.14, 0.08));
  return b.geometry();
}

/** Apricot tree (≈ 4.5 m): short trunk, round canopy with a few orange fruit clusters. */
function apricotGeometry(): BufferGeometry {
  const b = new SBuf();
  boxInFrame(b, { x: 0, y: 0, z: 0 }, [-0.15, 0.15], [-0.15, 0.15], [0, 1.6], 1, 0, 0, 1, new Color(0.22, 0.15, 0.09));
  const ico = new IcosahedronGeometry(1, 1);
  const pos = ico.getAttribute('position');
  const leaf = new Color(0.12, 0.24, 0.06), fruit = new Color(0.95, 0.5, 0.1);
  for (let i = 0; i < pos.count; i += 3) {
    const tri: V3[] = [];
    for (let j = 0; j < 3; j++) tri.push([pos.getX(i + j) * 2.1, 3.0 + pos.getY(i + j) * 1.6, pos.getZ(i + j) * 2.1]);
    const nx = tri.reduce((s, v) => s + v[0]!, 0), ny = tri.reduce((s, v) => s + v[1]! - 3, 0), nz = tri.reduce((s, v) => s + v[2]!, 0);
    b.quad([tri[0]!, tri[1]!, tri[2]!, tri[2]!], [nx, ny, nz], (i / 3) % 9 === 4 ? fruit : leaf);
  }
  ico.dispose();
  return b.geometry();
}

/** `keep(x, z)` (optional) drops vines / trees where it returns false (clear of the circuit, the paddock, roads). */
export function createOrchards(env: PropsEnv, vineyards: readonly FieldRect[], orchards: readonly FieldRect[], keep: (x: number, z: number) => boolean = () => true): PropPart {
  const root = new Group();
  root.name = 'capp.orchards';
  const rand = makeRand(77);
  const m4 = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), p = new Vector3(), sc = new Vector3(), tint = new Color();
  // Vine rows: 2.6 m apart, split into ≤ 12 m segments so they follow the ground.
  type Seg = { x: number; y: number; z: number; l: number; yaw: number };
  const segs: Seg[] = [];
  for (const v of vineyards) {
    const ux = Math.cos(v.yaw), uz = -Math.sin(v.yaw), vx = -uz, vz = ux;
    for (let r = -v.d / 2; r <= v.d / 2; r += 2.6) {
      const n = Math.max(1, Math.ceil(v.w / 12)), l = v.w / n;
      for (let k = 0; k < n; k++) {
        const u = -v.w / 2 + (k + 0.5) * l;
        const x = v.x + ux * u + vx * r, z = v.z + uz * u + vz * r;
        if (!keep(x, z)) continue;
        segs.push({ x, y: env.ground.height(x, z), z, l: l - 0.6, yaw: v.yaw });
      }
    }
  }
  const vGeo = vineGeometry();
  const vMat = envMaterial(env.sh, { name: 'capp.vines', family: 'inst', vertexColor: true, roughness: 0.9, wet: 0.4 });
  const vMesh = new InstancedMesh(vGeo, vMat, Math.max(1, segs.length));
  vMesh.name = 'capp.vines';
  segs.forEach((s, k) => {
    m4.compose(p.set(s.x, s.y - 0.1, s.z), q.setFromAxisAngle(up, s.yaw), sc.set(s.l, 0.85 + rand() * 0.3, 1));
    vMesh.setMatrixAt(k, m4);
    vMesh.setColorAt(k, tint.setRGB(0.85 + rand() * 0.3, 0.85 + rand() * 0.3, 0.8 + rand() * 0.2));
  });
  vMesh.count = segs.length;
  vMesh.receiveShadow = true;
  vMesh.computeBoundingSphere();
  root.add(vMesh);
  // Apricot trees on a 6 m grid with a little jitter.
  type Tree = { x: number; y: number; z: number; s: number; yaw: number };
  const trees: Tree[] = [];
  for (const o of orchards) {
    const ux = Math.cos(o.yaw), uz = -Math.sin(o.yaw), vx = -uz, vz = ux;
    for (let a = -o.w / 2 + 3; a <= o.w / 2 - 3; a += 6) for (let c = -o.d / 2 + 3; c <= o.d / 2 - 3; c += 6) {
      const x = o.x + ux * (a + (rand() - 0.5)) + vx * (c + (rand() - 0.5)), z = o.z + uz * (a + (rand() - 0.5)) + vz * (c + (rand() - 0.5));
      if (keep(x, z)) trees.push({ x, y: env.ground.height(x, z), z, s: 0.8 + rand() * 0.4, yaw: rand() * TAU });
    }
  }
  const tGeo = apricotGeometry();
  const tMat = envMaterial(env.sh, { name: 'capp.apricots', family: 'inst', vertexColor: true, roughness: 0.9, wet: 0.3, flood: 0.8 });
  const tMesh = new InstancedMesh(tGeo, tMat, Math.max(1, trees.length));
  tMesh.name = 'capp.apricots';
  trees.forEach((t, k) => {
    m4.compose(p.set(t.x, t.y - 0.1, t.z), q.setFromAxisAngle(up, t.yaw), sc.setScalar(t.s));
    tMesh.setMatrixAt(k, m4);
    tMesh.setColorAt(k, tint.setRGB(0.85 + rand() * 0.3, 0.9 + rand() * 0.2, 0.85 + rand() * 0.2));
  });
  tMesh.count = trees.length;
  tMesh.castShadow = env.quality.id !== 'low';
  tMesh.receiveShadow = true;
  tMesh.computeBoundingSphere();
  root.add(tMesh);
  return part(root, [vGeo, tGeo], [vMat, tMat], [vMesh, tMesh], {
    setQuality(qp) { tMesh.castShadow = qp.id !== 'low'; },
  });
}

