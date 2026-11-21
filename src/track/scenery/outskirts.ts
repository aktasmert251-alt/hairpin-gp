// City outskirts on the horizon (visual pass 2026-10, THEME.outskirts; İstanbul: the high-rise housing estates of the
// city's eastern edge beyond the golden hills). Clusters of residential towers and mid-rise blocks on an arc around the
// compass bearing, inside the DEM area (the far ring has no placement height), plus a few generic mosques (hall, dome,
// one or two minarets; no replica of any building) and one telecom mast on the highest site. Windows come from
// EnvMode.Facade (lit cells at night, like skyline.ts); 3 draws, no new programs (inst family).

import { BufferAttribute, BufferGeometry, Color, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { envMaterial, EnvMode, envUniforms } from '../materials/shared';
import { makeRand } from '../mesh/textures';
import { SBuf } from './stands';
import type { EnvContext, EnvPart } from './environment';

const TOWER_COLS = [0xe2ddd2, 0xd6cbb6, 0xc2c8cc, 0xe8dfcb, 0xb9ae9c, 0xd9d2c6, 0xc8b49a];

/** Unit block x, z ∈ [−0.5, 0.5], y ∈ [0, 1]; uv as skyline.ts (width faces 0..1, depth faces 2..3, roof −1). */
function blockGeometry(): BufferGeometry {
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

/** Vertical prism ring (n sides) from y0 to y1, radius r0 → r1 (r1 0 = cone). */
function prism(b: SBuf, cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, n: number, c: Color): void {
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    const p = (a: number, r: number, y: number): number[] => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    b.quad([p(a0, r0, y0), p(a1, r0, y0), p(a0, Math.max(r1, 0.01), y1), p(a1, Math.max(r1, 0.01), y1)], [Math.cos(am), (r0 - r1) / Math.max(1, y1 - y0), Math.sin(am)], c);
  }
}

/** Generic mosque silhouette (≈ 0.4 k triangles): square hall, drum and stepped dome, two minarets. Origin = ground. */
function mosqueGeometry(): BufferGeometry {
  const b = new SBuf();
  const stone = new Color(0.8, 0.77, 0.7), lead = new Color(0.4, 0.43, 0.46);
  prism(b, 0, 0, 13, 13, 0, 10, 4, stone);
  prism(b, 0, 0, 9, 9, 10, 13, 12, stone);
  for (let k = 0; k < 6; k++) {
    const a0 = (k / 6) * (Math.PI / 2), a1 = ((k + 1) / 6) * (Math.PI / 2);
    prism(b, 0, 0, 9 * Math.cos(a0), 9 * Math.cos(a1), 13 + 9 * Math.sin(a0), 13 + 9 * Math.sin(a1), 12, lead);
  }
  for (const [mx, mz] of [[11, 11], [-11, -11]] as [number, number][]) {
    prism(b, mx, mz, 1.3, 1.1, 0, 34, 8, stone);
    prism(b, mx, mz, 1.8, 1.8, 26, 27, 8, stone);
    prism(b, mx, mz, 1.1, 0, 34, 41, 8, lead);
  }
  return b.geometry();
}

/** Telecom mast (≈ 0.3 k triangles): tapered concrete shaft, equipment pod, steel antenna. */
function mastGeometry(): BufferGeometry {
  const b = new SBuf();
  const concrete = new Color(0.82, 0.82, 0.8), steel = new Color(0.55, 0.12, 0.1), pod = new Color(0.62, 0.66, 0.7);
  prism(b, 0, 0, 6, 3, 0, 120, 10, concrete);
  prism(b, 0, 0, 9, 9, 105, 118, 12, pod);
  prism(b, 0, 0, 1.2, 0.4, 120, 175, 6, steel);
  return b.geometry();
}

export function createOutskirts(c: EnvContext): EnvPart & { triangles: number } {
  const group = new Group();
  group.name = 'outskirts';
  const O = c.ex.authoring.THEME.outskirts;
  const t = c.ex.terrain;
  if (!O || !t || !c.ground) return { root: group, triangles: 0, dispose() {} };
  const ground = c.ground;
  const { data } = c.track;
  const rand = makeRand(4141);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < data.count; i++) {
    minX = Math.min(minX, data.x[i]!); maxX = Math.max(maxX, data.x[i]!);
    minZ = Math.min(minZ, data.z[i]!); maxZ = Math.max(maxZ, data.z[i]!);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  // DEM area in world coordinates (100 m margin): sites outside have no reliable ground height.
  const k = c.ex.reg.k;
  const dx0 = (t.x0 - c.ex.reg.cx) * k + 100, dz0 = (t.z0 - c.ex.reg.cz) * k + 100;
  const dx1 = (t.x0 + (t.nx - 1) * t.step - c.ex.reg.cx) * k - 100, dz1 = (t.z0 + (t.nz - 1) * t.step - c.ex.reg.cz) * k - 100;
  const inDem = (x: number, z: number): boolean => x > dx0 && x < dx1 && z > dz0 && z < dz1;
  const info = { s: 0, d: 0, covered: false, nearTrack: 0 };
  const free = (x: number, z: number): boolean => {
    if (!inDem(x, z)) return false;
    ground.height(x, z, info);
    return !info.covered && info.nearTrack < 0.02;
  };
  // Compass bearing (0 = north = −z, 90 = east = +x).
  const bear = (O.bearingDeg * Math.PI) / 180;
  /** Track extent from the centre along a bearing, and the distance to the DEM edge (minus an estate's half size). */
  const extent = (a: number): number => {
    const ux = Math.sin(a), uz = -Math.cos(a);
    let e = 0;
    for (let i = 0; i < data.count; i += 8) e = Math.max(e, (data.x[i]! - cx) * ux + (data.z[i]! - cz) * uz);
    return e;
  };
  const reach = (a: number): number => {
    let r = 0;
    while (r < 6000 && inDem(cx + Math.sin(a) * (r + 140), cz - Math.cos(a) * (r + 140))) r += 20;
    return r;
  };

  type Inst = { x: number; y: number; z: number; w: number; d: number; h: number; yaw: number; col: number; seed: number };
  const blocks: Inst[] = [];
  const sites: { x: number; y: number; z: number }[] = [];
  for (let n = 0; n < O.clusters; n++) {
    const a = bear + ((n + 0.5) / O.clusters - 0.5) * ((O.arcDeg * Math.PI) / 180) + (rand() - 0.5) * 0.12;
    const dist = Math.min(reach(a), extent(a) + O.distance[0] + rand() * (O.distance[1] - O.distance[0]));
    const ox = cx + Math.sin(a) * dist, oz = cz - Math.cos(a) * dist;
    if (!free(ox, oz)) continue;
    const yaw = rand() * Math.PI;
    const ux = Math.cos(yaw), uz = Math.sin(yaw);
    const towers = 8 + Math.floor(rand() * 14);
    sites.push({ x: ox, y: ground.dem(ox, oz), z: oz });
    for (let m = 0; m < towers * 1.6; m++) {
      // Estate grid (40 m) with jitter; the central part high-rise, the rim mid-rise.
      const gi = (m % 6) - 2.5, gj = Math.floor(m / 6) - 2;
      const u = gi * 42 + (rand() - 0.5) * 10, v = gj * 40 + (rand() - 0.5) * 10;
      const x = ox + ux * u - uz * v, z = oz + uz * u + ux * v;
      if (!free(x, z)) continue;
      const core = Math.hypot(gi, gj) < 2.2;
      const floors = core && rand() < 0.75 ? 11 + Math.floor(rand() * 18) : 4 + Math.floor(rand() * 5);
      const w = core ? 17 + rand() * 8 : 22 + rand() * 14, dp = core ? 15 + rand() * 6 : 11 + rand() * 4;
      blocks.push({ x, y: ground.dem(x, z), z, w, d: dp, h: floors * 3.0 + 1.2, yaw: yaw + (rand() < 0.25 ? Math.PI / 2 : 0), col: TOWER_COLS[Math.floor(rand() * TOWER_COLS.length)]!, seed: rand() });
    }
  }

  const up = new Vector3(0, 1, 0);
  const m4 = new Matrix4();
  const qt = new Quaternion();
  const pv = new Vector3();
  const sv = new Vector3();
  const tint = new Color();

  const blockGeo = blockGeometry();
  const apx = new InstancedBufferAttribute(new Float32Array(Math.max(1, blocks.length) * 4), 4);
  blockGeo.setAttribute('aApx', apx);
  const facadeMat = envMaterial(c.sh, { name: 'outskirts.facades', family: 'inst', mode: EnvMode.Facade, vertexColor: true, roughness: 0.88, wet: 0.5, flood: 0.8 });
  const blockMesh = new InstancedMesh(blockGeo, facadeMat, Math.max(1, blocks.length));
  blockMesh.name = 'outskirts.blocks';
  blocks.forEach((b, i) => {
    qt.setFromAxisAngle(up, b.yaw);
    // Sunk 3 m: the 75–100 m DEM slopes under a footprint.
    m4.compose(pv.set(b.x, b.y - 3, b.z), qt, sv.set(b.w, b.h + 3, b.d));
    blockMesh.setMatrixAt(i, m4);
    blockMesh.setColorAt(i, tint.setHex(b.col).convertSRGBToLinear());
    apx.setXYZW(i, Math.floor(b.seed * 97), b.w, b.d, b.h + 3);
  });
  blockMesh.count = blocks.length;
  blockMesh.computeBoundingSphere();
  blockMesh.receiveShadow = true;
  group.add(blockMesh);

  // Mosques at the edge of every other estate; the mast on the highest free site.
  const lmMat = envMaterial(c.sh, { name: 'outskirts.landmarks', family: 'inst', vertexColor: true, roughness: 0.75, emissive: 0xffc890, emissiveIntensity: 0, wet: 0.4, flood: 0 });
  const mosqueGeo = mosqueGeometry();
  const mosques = sites.filter((_, i) => i % 2 === 0);
  const mosqueMesh = new InstancedMesh(mosqueGeo, lmMat, Math.max(1, mosques.length));
  mosqueMesh.name = 'outskirts.mosques';
  mosques.forEach((s, i) => {
    const x = s.x + 150, z = s.z + 40;
    qt.setFromAxisAngle(up, rand() * Math.PI);
    m4.compose(pv.set(x, ground.dem(x, z) - 1, z), qt, sv.setScalar(1));
    mosqueMesh.setMatrixAt(i, m4);
    mosqueMesh.setColorAt(i, tint.setRGB(1, 1, 1));
  });
  mosqueMesh.count = mosques.length;
  mosqueMesh.computeBoundingSphere();
  group.add(mosqueMesh);
  const mastGeo = mastGeometry();
  const mastMesh = new InstancedMesh(mastGeo, lmMat, 1);
  mastMesh.name = 'outskirts.mast';
  let best: { x: number; z: number; y: number } | null = null;
  for (let n = 0; n < 60; n++) {
    const a = bear + (rand() - 0.5) * ((O.arcDeg * Math.PI) / 180);
    const dist = Math.min(reach(a), extent(a) + O.distance[0] * 0.8 + rand() * (O.distance[1] - O.distance[0]));
    const x = cx + Math.sin(a) * dist, z = cz - Math.cos(a) * dist;
    if (!free(x, z)) continue;
    const y = ground.dem(x, z);
    if (!best || y > best.y) best = { x, z, y };
  }
  if (best) {
    m4.compose(pv.set(best.x, best.y - 1, best.z), qt.identity(), sv.setScalar(1));
    mastMesh.setMatrixAt(0, m4);
    mastMesh.setColorAt(0, tint.setRGB(1, 1, 1));
  }
  mastMesh.count = best ? 1 : 0;
  mastMesh.computeBoundingSphere();
  group.add(mastMesh);

  const triangles = blocks.length * 10 + mosques.length * (mosqueGeo.index!.count / 3) + (best ? mastGeo.index!.count / 3 : 0);
  return {
    root: group,
    triangles,
    applyConditions(cc) {
      envUniforms(facadeMat).uApxP.value.x = cc.tod === 'night' ? 1.6 : cc.tod === 'sunset' ? 0.45 : 0;
      lmMat.emissiveIntensity = cc.tod === 'night' ? 0.32 : cc.tod === 'sunset' ? 0.06 : 0;
    },
    dispose() {
      blockGeo.dispose();
      mosqueGeo.dispose();
      mastGeo.dispose();
      facadeMat.dispose();
      lmMat.dispose();
      blockMesh.dispose();
      mosqueMesh.dispose();
      mastMesh.dispose();
      group.removeFromParent();
    },
  };
}
