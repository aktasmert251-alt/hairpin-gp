// City backdrop for THEME.backdrop 'city' (T-B, tracks.md §3.10), replacing buildings.ts there:
//  - skyline: instanced façade blocks on the land of both shores within 3.2 km (procedural; OSM footprints are added
//    as extrusions when the raw file has any), windows from EnvMode.Facade with ≈ 45 % lit cells at night (1–2 draws);
//  - street buildings: 4–6-storey pastel / timber façades 6–10 m behind the walls on the inland streets, shopfronts
//    lit at night (1 draw, shadow casting);
//  - 4 generic domed silhouettes (dome, half-domes, minarets; no replica of any building) on the ridges of both
//    shores, floodlit warm at night (1 draw).
// Deterministic (seeded); no new programs (inst / opaque env families).

import { BufferAttribute, BufferGeometry, Color, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { envMaterial, EnvMode, envUniforms } from '../materials/shared';
import type { TrackFrame } from '../../contracts/track';
import { makeRand } from '../mesh/textures';
import { SBuf } from './stands';
import { worldToLocal } from './water';
import type { EnvContext, EnvPart } from './environment';

const RADIUS = 3200;
const CELL = 34;
const PALETTE = [0xd9c6a5, 0xc98f6b, 0xa9b8a2, 0xe0d7c6, 0x9c6b4e, 0xb7c3cc, 0xd8b4a0, 0xcfd2c4];
const CITY = [0x8e8a84, 0x9a948a, 0x7d8084, 0xb0aa9e, 0x6f6a64, 0xa59d92];

/** Unit block x, z ∈ [−0.5, 0.5], y ∈ [0, 1]; uv: width faces (±z) x 0..1, depth faces (±x) x 2..3, roof −1. */
export function blockGeometry(): BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const face = (p: number[][], n: number[], u0: number, roof: boolean): void => {
    const b = pos.length / 3;
    p.forEach((q, k) => {
      pos.push(q[0]!, q[1]!, q[2]!);
      nor.push(n[0]!, n[1]!, n[2]!);
      col.push(1, 1, 1);
      uv.push(roof ? -1 : u0 + (k & 1), roof ? -1 : k >> 1);
    });
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  };
  face([[-0.5, 0, 0.5], [0.5, 0, 0.5], [-0.5, 1, 0.5], [0.5, 1, 0.5]], [0, 0, 1], 0, false);
  face([[0.5, 0, -0.5], [-0.5, 0, -0.5], [0.5, 1, -0.5], [-0.5, 1, -0.5]], [0, 0, -1], 0, false);
  face([[0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, 0.5], [0.5, 1, -0.5]], [1, 0, 0], 2, false);
  face([[-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, -0.5], [-0.5, 1, 0.5]], [-1, 0, 0], 2, false);
  face([[-0.5, 1, 0.5], [0.5, 1, 0.5], [-0.5, 1, -0.5], [0.5, 1, -0.5]], [0, 1, 0], 0, true);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Generic domed silhouette (~1.8 k triangles): base hall, central dome on a drum, 4 half-domes, 4 slim minarets. */
function domeGeometry(): BufferGeometry {
  const b = new SBuf();
  const stone = new Color(0.78, 0.74, 0.66), lead = new Color(0.42, 0.45, 0.47);
  const ring = (cx: number, cz: number, r: number, y0: number, y1: number, seg: number, c: Color): void => {
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const p = (a: number, y: number): number[] => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
      const am = (a0 + a1) / 2;
      b.quad([p(a0, y0), p(a1, y0), p(a0, y1), p(a1, y1)], [Math.cos(am), 0, Math.sin(am)], c);
    }
  };
  /** Spherical cap (θ from the top 0 … th1) over the azimuth range [p0, p1]. */
  const cap = (cx: number, cy: number, cz: number, r: number, th1: number, p0: number, p1: number, segA: number, segT: number, c: Color, peak = 1): void => {
    for (let i = 0; i < segT; i++) for (let k = 0; k < segA; k++) {
      const t0 = (i / segT) * th1, t1 = ((i + 1) / segT) * th1;
      const a0 = p0 + ((p1 - p0) * k) / segA, a1 = p0 + ((p1 - p0) * (k + 1)) / segA;
      const P = (t: number, a: number): number[] => [cx + Math.sin(t) * Math.cos(a) * r, cy + Math.cos(t) * r * peak, cz + Math.sin(t) * Math.sin(a) * r];
      const tm = (t0 + t1) / 2, am = (a0 + a1) / 2;
      b.quad([P(t1, a0), P(t1, a1), P(t0, a0), P(t0, a1)], [Math.sin(tm) * Math.cos(am), Math.cos(tm), Math.sin(tm) * Math.sin(am)], c);
    }
  };
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: Color): void => {
    const P = (x: number, y: number, z: number): number[] => [x, y, z];
    b.quad([P(x0, y1, z0), P(x1, y1, z0), P(x0, y1, z1), P(x1, y1, z1)], [0, 1, 0], c);
    b.quad([P(x0, y0, z1), P(x1, y0, z1), P(x0, y1, z1), P(x1, y1, z1)], [0, 0, 1], c);
    b.quad([P(x1, y0, z0), P(x0, y0, z0), P(x1, y1, z0), P(x0, y1, z0)], [0, 0, -1], c);
    b.quad([P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z0), P(x0, y1, z1)], [-1, 0, 0], c);
    b.quad([P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z1), P(x1, y1, z0)], [1, 0, 0], c);
  };
  box(-17, 17, -4, 14, -17, 17, stone);
  box(-24, 24, -4, 7, -24, 24, stone); // courtyard arcade ring (low)
  ring(0, 0, 12, 14, 19, 16, stone);
  cap(0, 19, 0, 12.5, Math.PI / 2, 0, Math.PI * 2, 16, 6, lead, 0.85);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    cap(Math.cos(a) * 12, 14, Math.sin(a) * 12, 7.5, Math.PI / 2, a - Math.PI / 2, a + Math.PI / 2, 8, 4, lead, 0.8);
  }
  for (const [x, z, h] of [[-22, -22, 58], [22, -22, 58], [-22, 22, 46], [22, 22, 46]] as const) {
    ring(x, z, 1.6, -2, h, 8, stone);
    ring(x, z, 2.3, h * 0.72, h * 0.72 + 1.2, 8, stone);
    cap(x, h, z, 1.7, Math.PI / 2, 0, Math.PI * 2, 8, 2, lead, 4.5);
  }
  return b.geometry();
}

export function createSkyline(c: EnvContext, blocked: (x: number, z: number) => boolean): EnvPart & { triangles: number } {
  const { ex, track } = c;
  const { data, query: q } = track;
  const ground = c.ground!;
  const rand = makeRand(1453);
  const seaY = ex.authoring.THEME.sea?.y ?? -1e9;
  const group = new Group();
  group.name = 'skyline';
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < data.count; i++) {
    minX = Math.min(minX, data.x[i]!); maxX = Math.max(maxX, data.x[i]!);
    minZ = Math.min(minZ, data.z[i]!); maxZ = Math.max(maxZ, data.z[i]!);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const nearBox = (x: number, z: number): boolean => x > minX - 500 && x < maxX + 500 && z > minZ - 500 && z < maxZ + 500;
  const info = { s: 0, d: 0, covered: false, nearTrack: 0 };
  /** Ground height for a footprint centre, or null where nothing may stand (water, track, pit, stands). */
  const site = (x: number, z: number, clearTrack: number): number | null => {
    if (blocked(x, z)) return null;
    let y: number;
    if (nearBox(x, z)) {
      y = ground.height(x, z, info);
      if (info.covered || info.nearTrack > clearTrack) return null;
    } else y = ground.dem(x, z);
    return y < seaY + 0.6 ? null : y;
  };
  const yawOf = ex.local ? -((ex.local.beta - 90) * Math.PI) / 180 : 0;
  const up = new Vector3(0, 1, 0);
  const m4 = new Matrix4();
  const qt = new Quaternion();
  const pv = new Vector3();
  const sv = new Vector3();
  const tint = new Color();

  // ---- domed silhouettes on the ridges (picked first: the blocks keep clear of them) ----
  const domes: { x: number; y: number; z: number }[] = [];
  if (ex.local) {
    const cands: { x: number; z: number; y: number; shore: number }[] = [];
    for (let z = cz - RADIUS; z <= cz + RADIUS; z += 60) for (let x = cx - RADIUS; x <= cx + RADIUS; x += 60) {
      const [u, v] = worldToLocal(ex, x, z);
      const shore = v > 600 && v < 1800 ? 0 : v < -900 && v > -2600 ? 1 : -1;
      if (shore < 0 || Math.abs(u) > 2200 || blocked(x, z)) continue;
      const y = ground.dem(x, z);
      if (y > seaY + 15) cands.push({ x, z, y, shore });
    }
    cands.sort((a, b) => b.y - a.y);
    for (const shore of [0, 1]) {
      let n = 0;
      for (const p of cands) {
        if (p.shore !== shore || n >= 2) continue;
        if (domes.some((d) => Math.hypot(d.x - p.x, d.z - p.z) < 1100)) continue;
        domes.push({ x: p.x, y: p.y, z: p.z });
        n++;
      }
    }
  }
  const domeGeo = domeGeometry();
  const domeMat = envMaterial(c.sh, { name: 'skyline.domes', family: 'inst', vertexColor: true, roughness: 0.75, emissive: 0xffc890, emissiveIntensity: 0, wet: 0.4, flood: 0 });
  const domeMesh = new InstancedMesh(domeGeo, domeMat, Math.max(1, domes.length));
  domeMesh.name = 'skyline.domes';
  domes.forEach((d, k) => {
    qt.setFromAxisAngle(up, yawOf + rand() * 0.3);
    m4.compose(pv.set(d.x, d.y, d.z), qt, sv.setScalar(1));
    domeMesh.setMatrixAt(k, m4);
    domeMesh.setColorAt(k, tint.setRGB(1, 1, 1));
  });
  domeMesh.count = domes.length;
  domeMesh.computeBoundingSphere();
  group.add(domeMesh);
  const nearDome = (x: number, z: number, r: number): boolean => domes.some((d) => (d.x - x) ** 2 + (d.z - z) ** 2 < r * r);

  // ---- street buildings along the inland streets ----
  type Inst = { x: number; y: number; z: number; w: number; d: number; h: number; yaw: number; col: number; seed: number };
  const street: Inst[] = [];
  const P = { x: 0, y: 0, z: 0 };
  const f: TrackFrame = { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 };
  for (let s = 0; s < data.length; s += 0) {
    const w = 14 + rand() * 10;
    const sm = s + w / 2;
    s += w + 1.5;
    if (sm >= data.length) break;
    q.frameAt(sm, f);
    if (Math.abs(f.curvature) > 1 / 60) continue;
    for (const side of [1, -1] as const) {
      const i = Math.round(sm) % data.count;
      const dep = 12 + rand() * 6;
      const back = (side === 1 ? data.wallL[i]! : data.wallR[i]!) + 6 + rand() * 4;
      q.worldFromSD(sm, side * (back + dep / 2), P);
      if (ex.local && worldToLocal(ex, P.x, P.z)[1] < 30) continue; // sea side of the waterfront roads
      const yS = site(P.x, P.z, 0.95);
      if (yS === null || nearDome(P.x, P.z, 60)) continue;
      // Stay clear of every other part of the track (inner blocks between two streets).
      ground.height(P.x, P.z, info);
      const k2 = Math.round(info.s) % data.count;
      if (Math.abs(info.d) < (info.d >= 0 ? data.wallL[k2]! : data.wallR[k2]!) + 5 + dep / 2) continue;
      street.push({ x: P.x, y: yS, z: P.z, w, d: dep, h: (4 + Math.floor(rand() * 3)) * 3.2 + 0.6, yaw: Math.atan2(-f.tz, f.tx), col: PALETTE[Math.floor(rand() * PALETTE.length)]!, seed: rand() });
    }
  }

  // ---- skyline blocks on both shores ----
  // Islets: the 100 m DEM inflates small islands into blobs a few hundred metres wide; keep them free of blocks
  // (sea on ≥ 15 of 16 directions 200 m out; shoreline and headland sites see far more land).
  const islet = (x: number, z: number): boolean => {
    let sea = 0;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      if (ground.dem(x + Math.cos(a) * 200, z + Math.sin(a) * 200) < seaY + 0.6) sea++;
    }
    return sea >= 15;
  };
  const city: Inst[] = [];
  const tall = (x: number, z: number): number => Math.sin(x * 0.0021 + 1.1) * Math.cos(z * 0.0017 - 0.4) + 0.6 * Math.sin((x + z) * 0.0043);
  for (let z = cz - RADIUS; z <= cz + RADIUS; z += CELL) for (let x = cx - RADIUS; x <= cx + RADIUS; x += CELL) {
    if ((x - cx) ** 2 + (z - cz) ** 2 > RADIUS * RADIUS || rand() > 0.78) continue;
    const jx = x + (rand() - 0.5) * 10, jz = z + (rand() - 0.5) * 10;
    const y = site(jx, jz, 0.05);
    if (y === null || nearDome(jx, jz, 70) || islet(jx, jz)) continue;
    const t = tall(jx, jz);
    const floors = t > 1.1 && rand() < 0.5 ? 12 + Math.floor(rand() * 16) : 3 + Math.floor(rand() * 6);
    const w = 12 + rand() * 14, d = 10 + rand() * 12;
    city.push({ x: jx, y, z: jz, w, d, h: floors * 3.2 + 0.6, yaw: yawOf + (rand() < 0.5 ? 0 : Math.PI / 2) + (rand() - 0.5) * 0.25, col: CITY[Math.floor(rand() * CITY.length)]!, seed: rand() });
  }

  const blockGeo = blockGeometry();
  const facadeMat = envMaterial(c.sh, { name: 'skyline.facades', family: 'inst', mode: EnvMode.Facade, vertexColor: true, roughness: 0.88, wet: 0.5, flood: 0.8 });
  const makeBlocks = (list: Inst[], name: string): { mesh: InstancedMesh; geo: BufferGeometry } => {
    const geo = blockGeo.clone();
    const apx = new InstancedBufferAttribute(new Float32Array(Math.max(1, list.length) * 4), 4);
    geo.setAttribute('aApx', apx);
    const mesh = new InstancedMesh(geo, facadeMat, Math.max(1, list.length));
    mesh.name = name;
    list.forEach((b, k) => {
      qt.setFromAxisAngle(up, b.yaw);
      // Sink 1.5 m so sloping sites never show a gap under the façade.
      m4.compose(pv.set(b.x, b.y - 1.5, b.z), qt, sv.set(b.w, b.h + 1.5, b.d));
      mesh.setMatrixAt(k, m4);
      mesh.setColorAt(k, tint.setHex(b.col).convertSRGBToLinear());
      apx.setXYZW(k, Math.floor(b.seed * 97), b.w, b.d, b.h + 1.5);
    });
    mesh.count = list.length;
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    group.add(mesh);
    return { mesh, geo };
  };
  const cityM = makeBlocks(city, 'skyline.blocks');
  const streetM = makeBlocks(street, 'skyline.street');
  streetM.mesh.castShadow = c.quality.id !== 'low';

  // ---- OSM footprints (if the raw file carries any): extruded, same façade program, aApx per vertex ----
  const osm = new SBuf();
  const osmApx: number[] = [];
  for (const fe of ex.features) {
    if (fe.kind !== 'building' || fe.xz.length < 4) continue;
    const pts = fe.xz.map(([x, z]) => [(x - ex.reg.cx) * ex.reg.k, (z - ex.reg.cz) * ex.reg.k] as [number, number]);
    let mx = 0, mz = 0;
    for (const [x, z] of pts) { mx += x / pts.length; mz += z / pts.length; }
    const y0 = site(mx, mz, 0.05);
    if (y0 === null) continue;
    const h = (fe.levels ?? 3 + Math.floor(rand() * 6)) * 3.2 + 0.6;
    const seed = Math.floor(rand() * 97);
    const colr = tint.setHex(CITY[Math.floor(rand() * CITY.length)]!).convertSRGBToLinear().clone();
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k]!, e = pts[k + 1]!;
      const l = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (l < 0.5) continue;
      const base = osm.pos.length / 3;
      osm.quad([[a[0], y0 - 1.5, a[1]], [e[0], y0 - 1.5, e[1]], [a[0], y0 + h, a[1]], [e[0], y0 + h, e[1]]], [(e[1] - a[1]) / l, 0, -(e[0] - a[0]) / l], colr);
      osm.uv.splice(base * 2, 8, 0, 0, 1, 0, 0, 1, 1, 1);
      for (let m = 0; m < 4; m++) osmApx.push(seed + k, l, l, h + 1.5);
    }
    for (let k = 1; k + 2 < pts.length; k++) {
      const base = osm.pos.length / 3;
      const a = pts[0]!, e = pts[k]!, g = pts[k + 1]!;
      osm.quad([[a[0], y0 + h, a[1]], [e[0], y0 + h, e[1]], [g[0], y0 + h, g[1]], [g[0], y0 + h, g[1]]], [0, 1, 0], colr);
      osm.uv.splice(base * 2, 8, -1, -1, -1, -1, -1, -1, -1, -1);
      for (let m = 0; m < 4; m++) osmApx.push(0, 1, 1, 1);
    }
  }
  let osmGeo: BufferGeometry | null = null;
  const osmMat = envMaterial(c.sh, { name: 'skyline.osm', family: 'opaque', mode: EnvMode.Facade, vertexColor: true, roughness: 0.88, wet: 0.5, flood: 0.8 });
  if (osmApx.length) {
    osmGeo = osm.geometry();
    osmGeo.setAttribute('aApx', new BufferAttribute(new Float32Array(osmApx), 4));
    const m = new Mesh(osmGeo, osmMat);
    m.name = 'skyline.osm';
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  }

  const triangles = (city.length + street.length) * 10 + domes.length * (domeGeo.index!.count / 3) + (osmGeo ? osmGeo.index!.count / 3 : 0);
  return {
    root: group,
    triangles,
    applyConditions(cc) {
      const night = cc.tod === 'night' ? 1.6 : cc.tod === 'sunset' ? 0.45 : 0;
      envUniforms(facadeMat).uApxP.value.x = night;
      envUniforms(osmMat).uApxP.value.x = night;
      domeMat.emissiveIntensity = cc.tod === 'night' ? 0.32 : cc.tod === 'sunset' ? 0.06 : 0;
    },
    setQuality(qp) {
      streetM.mesh.castShadow = qp.id !== 'low';
    },
    dispose() {
      blockGeo.dispose();
      cityM.geo.dispose();
      streetM.geo.dispose();
      domeGeo.dispose();
      osmGeo?.dispose();
      facadeMat.dispose();
      osmMat.dispose();
      domeMat.dispose();
      cityM.mesh.dispose();
      streetM.mesh.dispose();
      domeMesh.dispose();
      group.removeFromParent();
    },
  };
}
