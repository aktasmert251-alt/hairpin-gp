// Sea, seawall, night light streaks, ferries and moored yachts (T-B, tracks.md §3.10). Only for THEME.sea tracks.
// Water: one 8 km plane at sea.y in the shared env program (EnvMode.Water: procedural swell + scrolling noise normals,
// PBR env reflection), clipped visually by the terrain (land is above it). Streaks: the floodlight glow shader stretched
// into vertical bands hanging below lamps on the shore, the bridges and the ferries (1 draw, additive, night/sunset).
// Ferries move on deterministic shuttles from the render clock (never sim state).

import {
  AdditiveBlending, BufferAttribute, Color, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh, Matrix4,
  Mesh, PlaneGeometry, Quaternion, RawShaderMaterial, Sphere, Vector2, Vector3, type FogExp2,
} from 'three';
import { envMaterial, EnvMode } from '../materials/shared';
import { makeRand } from '../mesh/textures';
import type { TrackExtras } from '../build/extras';
import { GLOW_FRAG, GLOW_VERT } from './floodlights';
import { boxInFrame, SBuf } from './stands';
import type { EnvContext, EnvPart } from './environment';

/** World (x, z) of local shore-frame (u, v) (tracks.md §3.2), through the raw → world registration. */
export function localToWorld(ex: TrackExtras, u: number, v: number): [number, number] {
  const L = ex.local!;
  const b = (L.beta * Math.PI) / 180;
  const sb = Math.sin(b), cb = Math.cos(b);
  const rx = L.anchor[0] + u * sb - v * cb;
  const rz = L.anchor[1] - (u * cb + v * sb);
  return [(rx - ex.reg.cx) * ex.reg.k, (rz - ex.reg.cz) * ex.reg.k];
}

/** Inverse of localToWorld: local (u, v) of a world point. */
export function worldToLocal(ex: TrackExtras, x: number, z: number): [number, number] {
  const L = ex.local!;
  const b = (L.beta * Math.PI) / 180;
  const sb = Math.sin(b), cb = Math.cos(b);
  const dE = x / ex.reg.k + ex.reg.cx - L.anchor[0], dN = -(z / ex.reg.k + ex.reg.cz - L.anchor[1]);
  return [dE * sb + dN * cb, -dE * cb + dN * sb];
}

const FERRIES = 3;
const YACHTS = 10;
const STREAK_COLOR = 0xffb070;

export function ferryGeometry(): { body: SBuf; windows: SBuf } {
  const body = new SBuf();
  const windows = new SBuf();
  const o = { x: 0, y: 0, z: 0 };
  const hull = new Color(0.08, 0.09, 0.11), white = new Color(0.78, 0.78, 0.76), red = new Color(0.45, 0.06, 0.05);
  // Local frame: u = length (x), v = beam (z), y up; 48 × 11 m, waterline at y 0.
  boxInFrame(body, o, [-24, 24], [-5.5, 5.5], [-1.5, 2.2], 1, 0, 0, 1, hull);
  boxInFrame(body, o, [-26, -24], [-4, 4], [-1.0, 2.0], 1, 0, 0, 1, hull);
  boxInFrame(body, o, [24, 26], [-4, 4], [-1.0, 2.0], 1, 0, 0, 1, hull);
  boxInFrame(body, o, [-19, 19], [-5.0, 5.0], [2.2, 5.0], 1, 0, 0, 1, white);
  boxInFrame(body, o, [-13, 13], [-4.2, 4.2], [5.0, 7.4], 1, 0, 0, 1, white);
  boxInFrame(body, o, [-2.2, 2.2], [-1.2, 1.2], [7.4, 10.5], 1, 0, 0, 1, red);
  // Window bands on both sides of both decks (emissive at night).
  for (const [y0, y1, l, w] of [[3.1, 4.3, 18.5, 5.04], [5.7, 6.8, 12.5, 4.24]] as const) {
    for (const s of [-1, 1]) {
      windows.quad([[-l, y0, s * w], [l, y0, s * w], [-l, y1, s * w], [l, y1, s * w]], [0, 0, s], new Color(1, 1, 1));
    }
  }
  return { body, windows };
}

export function yachtGeometry(): SBuf {
  const b = new SBuf();
  const o = { x: 0, y: 0, z: 0 };
  const hull = new Color(0.85, 0.86, 0.86), cabin = new Color(0.12, 0.14, 0.17), mast = new Color(0.7, 0.7, 0.7);
  boxInFrame(b, o, [-7, 6], [-2.1, 2.1], [-0.6, 1.2], 1, 0, 0, 1, hull);
  boxInFrame(b, o, [6, 8], [-1.2, 1.2], [-0.2, 1.2], 1, 0, 0, 1, hull);
  boxInFrame(b, o, [-4, 2], [-1.5, 1.5], [1.2, 2.5], 1, 0, 0, 1, cabin);
  boxInFrame(b, o, [-0.6, -0.4], [-0.1, 0.1], [2.5, 13], 1, 0, 0, 1, mast);
  return b;
}

export function createWater(c: EnvContext): EnvPart & { triangles: number } {
  const ex = c.ex;
  const sea = ex.authoring.THEME.sea;
  const group = new Group();
  group.name = 'water';
  if (!sea || !ex.local) return { root: group, triangles: 0, dispose: () => group.removeFromParent() };
  const { data } = c.track;
  const ground = c.ground!;
  const rand = makeRand(1915);
  const L = ex.local;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < data.count; i++) {
    minX = Math.min(minX, data.x[i]!); maxX = Math.max(maxX, data.x[i]!);
    minZ = Math.min(minZ, data.z[i]!); maxZ = Math.max(maxZ, data.z[i]!);
  }

  // ---- sea plane (1 draw, shared opaque program) ----
  const planeGeo = new PlaneGeometry(9000, 9000, 24, 24);
  planeGeo.rotateX(-Math.PI / 2);
  planeGeo.translate((minX + maxX) / 2, sea.y, (minZ + maxZ) / 2);
  const waterMat = envMaterial(c.sh, { name: 'water', family: 'opaque', mode: EnvMode.Water, roughness: 0.05, wet: 0, flood: 0.6 });
  const plane = new Mesh(planeGeo, waterMat);
  plane.name = 'water.sea';
  plane.receiveShadow = true;
  plane.matrixAutoUpdate = false;
  group.add(plane);

  // ---- seawall: vertical concrete face along v = seawallV, a cap and bollards every 10 m (1 draw) ----
  const wall = new SBuf();
  const conc = new Color(0.62, 0.6, 0.56), cap = new Color(0.78, 0.77, 0.74), dark = new Color(0.1, 0.1, 0.11);
  const STEP = 20;
  for (let u = -L.seawallU; u < L.seawallU; u += STEP) {
    const [x0, z0] = localToWorld(ex, u, L.seawallV);
    const [x1, z1] = localToWorld(ex, u + STEP, L.seawallV);
    const [ix, iz] = localToWorld(ex, u, L.seawallV + 1);
    const nx = x0 - ix, nz = z0 - iz; // seaward normal
    wall.quad([[x0, sea.y - 4, z0], [x1, sea.y - 4, z1], [x0, 0.25, z0], [x1, 0.25, z1]], [nx, 0, nz], conc);
    wall.quad([[x0, 0.25, z0], [x1, 0.25, z1], [x0 - nx * 0.6, 0.25, z0 - nz * 0.6], [x1 - nx * 0.6, 0.25, z1 - nz * 0.6]], [0, 1, 0], cap);
    for (let k = 0; k < STEP; k += 10) {
      const [bx, bz] = localToWorld(ex, u + k, L.seawallV + 0.4);
      boxInFrame(wall, { x: bx, y: 0.2, z: bz }, [-0.2, 0.2], [-0.2, 0.2], [0, 0.6], 1, 0, 0, 1, dark);
    }
  }
  const wallGeo = wall.geometry();
  const wallMat = envMaterial(c.sh, { name: 'water.seawall', family: 'opaque', vertexColor: true, map: c.tex.concrete.map, normalMap: c.tex.concrete.normal, roughness: 0.9, wet: 0.7 });
  const wallMesh = new Mesh(wallGeo, wallMat);
  wallMesh.name = 'water.seawall';
  wallMesh.receiveShadow = true;
  wallMesh.matrixAutoUpdate = false;
  group.add(wallMesh);

  // ---- ferries: shuttles from a European pier to the opposite shore (2 draws) ----
  const isWater = (x: number, z: number): boolean => ground.dem(x, z) < sea.y - 1;
  type Route = { ax: number; az: number; bx: number; bz: number; period: number; phase: number };
  const routes: Route[] = [];
  for (const u0 of [-600, 350, 1450]) {
    const [ax, az] = localToWorld(ex, u0, L.seawallV - 70);
    let v = L.seawallV - 70;
    // March across the strait until land, stop 120 m short of it.
    for (; v > -3000; v -= 20) {
      const [x, z] = localToWorld(ex, u0 + (v - L.seawallV) * 0.35, v);
      if (!isWater(x, z)) break;
    }
    const vb = Math.min(L.seawallV - 300, v + 120);
    const [bx, bz] = localToWorld(ex, u0 + (vb - L.seawallV) * 0.35, vb);
    routes.push({ ax, az, bx, bz, period: 300 + rand() * 120, phase: rand() });
  }
  const fg = ferryGeometry();
  const ferryGeo = fg.body.geometry();
  const winGeo = fg.windows.geometry();
  const ferryMat = envMaterial(c.sh, { name: 'water.ferry', family: 'inst', vertexColor: true, roughness: 0.6, wet: 0.4 });
  const winMat = envMaterial(c.sh, { name: 'water.ferryWindows', family: 'inst', mode: EnvMode.Lamp, vertexColor: true, emissive: 0xffd9a8, emissiveIntensity: 0, wet: 0, flood: 0 });
  const ferries = new InstancedMesh(ferryGeo, ferryMat, FERRIES);
  const ferryWin = new InstancedMesh(winGeo, winMat, FERRIES);
  ferries.name = 'water.ferries';
  ferryWin.name = 'water.ferryWindows';
  ferries.instanceMatrix.setUsage(DynamicDrawUsage);
  ferryWin.instanceMatrix.setUsage(DynamicDrawUsage);
  ferries.frustumCulled = ferryWin.frustumCulled = false;
  ferries.castShadow = c.quality.id !== 'low';
  const white = new Color(1, 1, 1);
  for (let k = 0; k < FERRIES; k++) { ferries.setColorAt(k, white); ferryWin.setColorAt(k, white); }
  group.add(ferries, ferryWin);

  // ---- moored yachts at the pier (sea side of the main straight) (1 draw) ----
  const yGeo = yachtGeometry().geometry();
  const yachts = new InstancedMesh(yGeo, ferryMat, YACHTS);
  yachts.name = 'water.yachts';
  const m4 = new Matrix4();
  const qt = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const one = new Vector3(1, 1, 1);
  const tint = new Color();
  const [px0, pz0] = localToWorld(ex, 0, 0);
  const [pvx, pvz] = localToWorld(ex, 0, -1);
  const seaYaw = Math.atan2(-(pvz - pz0), pvx - px0); // box u axis pointing out to sea
  for (let k = 0; k < YACHTS; k++) {
    const [x, z] = localToWorld(ex, 260 + k * 26 + rand() * 6, L.seawallV - 9 - rand() * 2);
    qt.setFromAxisAngle(up, seaYaw + (rand() - 0.5) * 0.1);
    m4.compose(pos.set(x, sea.y, z), qt, one.setScalar(0.85 + rand() * 0.35));
    yachts.setMatrixAt(k, m4);
    tint.setRGB(0.9 + rand() * 0.1, 0.9 + rand() * 0.1, 0.9 + rand() * 0.1);
    yachts.setColorAt(k, tint);
  }
  one.setScalar(1);
  yachts.computeBoundingSphere();
  yachts.castShadow = c.quality.id !== 'low';
  group.add(yachts);

  // ---- light streaks on the water (1 draw): shore lamps, bridge deck lights, ferries ----
  const anchors: number[] = [];
  for (let u = -L.seawallU; u <= L.seawallU; u += 32) {
    const [x, z] = localToWorld(ex, u + rand() * 8, L.seawallV - 6);
    anchors.push(x, sea.y + 0.05, z);
  }
  for (const f of ex.features) {
    if (f.kind !== 'bridge' || f.xz.length < 2) continue;
    const [ax, az] = [(f.xz[0]![0] - ex.reg.cx) * ex.reg.k, (f.xz[0]![1] - ex.reg.cz) * ex.reg.k];
    const [bx, bz] = [(f.xz[1]![0] - ex.reg.cx) * ex.reg.k, (f.xz[1]![1] - ex.reg.cz) * ex.reg.k];
    for (let t = 0.04; t < 0.97; t += 0.06) {
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      if (isWater(x, z)) anchors.push(x, sea.y + 0.05, z);
    }
  }
  const fixed = anchors.length / 3;
  const nStreak = fixed + FERRIES;
  const sPos = new Float32Array(nStreak * 3);
  sPos.set(anchors);
  const sDir = new Float32Array(nStreak * 3);
  for (let k = 0; k < nStreak; k++) sDir[k * 3 + 1] = 1;
  const quad = new InstancedBufferGeometry();
  quad.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0]), 3));
  quad.setIndex([0, 1, 2, 1, 3, 2]);
  const posAttr = new InstancedBufferAttribute(sPos, 3);
  posAttr.setUsage(DynamicDrawUsage);
  quad.setAttribute('aPos', posAttr);
  quad.setAttribute('aDir', new InstancedBufferAttribute(sDir, 3));
  quad.instanceCount = nStreak;
  quad.boundingSphere = new Sphere(new Vector3((minX + maxX) / 2, sea.y, (minZ + maxZ) / 2), 6000);
  const streakMat = new RawShaderMaterial({
    name: 'water.streaks', vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
    uniforms: { uSize: { value: 5 }, uStretch: { value: new Vector2(0.55, 6) }, uDrop: { value: 1 }, uOmni: { value: 1 }, uColor: { value: new Color() }, uFogDensity: { value: 0 } },
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
  const streaks = new Mesh(quad, streakMat);
  streaks.name = 'water.streaks';
  streaks.renderOrder = 9;
  group.add(streaks);

  const fq = new Quaternion();
  const ferryAt = (k: number, t: number): void => {
    const r = routes[k]!;
    const ph = ((t / r.period + r.phase) % 1 + 1) % 1;
    // Out and back with a 15 % dwell at each pier: position follows a smooth ramp.
    const leg = ph < 0.5 ? ph * 2 : (1 - ph) * 2;
    const w = Math.min(1, Math.max(0, (leg - 0.15) / 0.7));
    const e = w * w * (3 - 2 * w);
    const x = r.ax + (r.bx - r.ax) * e, z = r.az + (r.bz - r.az) * e;
    const dir = ph < 0.5 ? 1 : -1;
    fq.setFromAxisAngle(up, Math.atan2(-(r.bz - r.az) * dir, (r.bx - r.ax) * dir));
    m4.compose(pos.set(x, sea.y, z), fq, one);
    ferries.setMatrixAt(k, m4);
    ferryWin.setMatrixAt(k, m4);
    sPos[(fixed + k) * 3] = x;
    sPos[(fixed + k) * 3 + 1] = sea.y + 0.05;
    sPos[(fixed + k) * 3 + 2] = z;
  };
  for (let k = 0; k < FERRIES; k++) ferryAt(k, 0);

  const tris = 24 * 24 * 2 + wallGeo.index!.count / 3 + FERRIES * (ferryGeo.index!.count + winGeo.index!.count) / 3 + YACHTS * yGeo.index!.count / 3 + nStreak * 2;
  return {
    root: group,
    triangles: tris,
    applyConditions(cc) {
      const k = cc.tod === 'night' ? 1 : cc.tod === 'sunset' ? 0.35 : 0;
      streaks.visible = k > 0;
      streakMat.uniforms.uColor!.value.setHex(STREAK_COLOR).multiplyScalar(0.9 * k);
      winMat.emissiveIntensity = cc.tod === 'night' ? 3 : cc.tod === 'sunset' ? 0.8 : 0;
    },
    update(_cam, frame) {
      for (let k = 0; k < FERRIES; k++) ferryAt(k, frame.time);
      ferries.instanceMatrix.needsUpdate = true;
      ferryWin.instanceMatrix.needsUpdate = true;
      posAttr.needsUpdate = true;
      const fog = c.ctx.scene.fog as FogExp2 | null;
      streakMat.uniforms.uFogDensity!.value = fog && 'density' in fog ? fog.density : 0;
    },
    setQuality(qp) {
      ferries.castShadow = yachts.castShadow = qp.id !== 'low';
    },
    dispose() {
      planeGeo.dispose();
      wallGeo.dispose();
      ferryGeo.dispose();
      winGeo.dispose();
      yGeo.dispose();
      quad.dispose();
      waterMat.dispose();
      wallMat.dispose();
      ferryMat.dispose();
      winMat.dispose();
      streakMat.dispose();
      ferries.dispose();
      ferryWin.dispose();
      yachts.dispose();
      group.removeFromParent();
    },
  };
}
