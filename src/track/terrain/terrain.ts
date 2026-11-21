// Terrain (Ç5, report §7.10): inner ring at 10 m (track plane inside the barriers, DEM blended beyond), outer ring at
// 50 m over the 3 × 3 km EU-DEM grid and a far ring to ±4.5 km with procedural hills (the distant hill silhouette is
// drawn by the sky shader since S2-Ç1). Seams: inner border heights are the outer edge interpolation.

import { BufferAttribute, BufferGeometry, Group, Mesh } from 'three';
import type { QualityPreset } from '../../contracts/render';
import { envMaterial, EnvMode } from '../materials/shared';
import type { EnvContext, EnvPart } from '../scenery/environment';
import { createGroundHeight, type GroundHeight, type GroundInfo } from './height';

const INNER = 10;
const OUTER = 50;
const FAR = 150;
const SINK = 0.35; // under the track meshes

function gridGeometry(x0: number, z0: number, nx: number, nz: number, step: number, h: (x: number, z: number, out: number[]) => number,
  skip: ((cx: number, cz: number) => boolean) | null): BufferGeometry {
  const pos = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  // aApx = (near, far, valley) for the terrain splat (EnvMode.Terrain).
  const apx = new Float32Array(nx * nz * 3);
  const tmp = [0, 0];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = x0 + i * step;
      const z = z0 + j * step;
      pos[k * 3] = x;
      pos[k * 3 + 1] = h(x, z, tmp);
      pos[k * 3 + 2] = z;
      uv[k * 2] = x / 6;
      uv[k * 2 + 1] = z / 6;
      apx[k * 3] = tmp[0]!;
      apx[k * 3 + 1] = tmp[1]!;
    }
  }
  // Valley-ness: separable box blur of the heights (≈ 80 m) minus the height (positive in hollows).
  const r = Math.max(2, Math.round(80 / step));
  const tmpH = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    let a = 0, n = 0;
    for (let k = -r; k <= r; k++) { const ii = i + k; if (ii >= 0 && ii < nx) { a += pos[(j * nx + ii) * 3 + 1]!; n++; } }
    tmpH[j * nx + i] = a / n;
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    let a = 0, n = 0;
    for (let k = -r; k <= r; k++) { const jj = j + k; if (jj >= 0 && jj < nz) { a += tmpH[jj * nx + i]!; n++; } }
    apx[(j * nx + i) * 3 + 2] = Math.max(-1, Math.min(1, (a / n - pos[(j * nx + i) * 3 + 1]!) / 4));
  }
  const idx: number[] = [];
  for (let j = 0; j + 1 < nz; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      if (skip && skip(x0 + (i + 0.5) * step, z0 + (j + 0.5) * step)) continue;
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      // Alternate the diagonal for a less directional look.
      if ((i + j) & 1) idx.push(a, c, b, b, c, d);
      else idx.push(a, c, d, a, d, b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setAttribute('aApx', new BufferAttribute(apx, 3));
  g.setIndex(nx * nz > 65535 ? new BufferAttribute(new Uint32Array(idx), 1) : new BufferAttribute(new Uint16Array(idx), 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function hillNoise(x: number, z: number): number {
  // Deterministic smooth noise for the far ring (no Math.random).
  const s = (a: number, b: number): number => Math.sin(a * 0.00091 + b * 0.00037) * Math.cos(b * 0.00083 - a * 0.00029);
  return 45 * s(x, z) + 22 * s(x * 2.3 + 900, z * 2.1 - 400) + 9 * s(x * 5.1, z * 4.7);
}

/** Alpine backdrop (tracks-alpine.md §9): ridged crests 450–1,550 m above the DEM edge, sharp summits. */
function alpinePeaks(x: number, z: number): number {
  const r = (a: number): number => (1 - Math.abs(Math.sin(a))) ** 2;
  const p = 0.55 * r(x * 0.0016 + z * 0.0007) + 0.3 * r(z * 0.0023 - x * 0.0011 + 1.7) + 0.15 * r(x * 0.0071 + z * 0.0049);
  return 450 + 1100 * p + 0.6 * hillNoise(x, z);
}

export function createTerrain(c: EnvContext): EnvPart & { ground: GroundHeight } {
  const { track, ex, tex } = c;
  const ground = createGroundHeight(track, ex);
  const data = track.data;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < data.count; i++) {
    minX = Math.min(minX, data.x[i]!); maxX = Math.max(maxX, data.x[i]!);
    minZ = Math.min(minZ, data.z[i]!); maxZ = Math.max(maxZ, data.z[i]!);
  }
  const ix0 = Math.floor((minX - 160) / OUTER) * OUTER;
  const ix1 = Math.ceil((maxX + 160) / OUTER) * OUTER;
  const iz0 = Math.floor((minZ - 160) / OUTER) * OUTER;
  const iz1 = Math.ceil((maxZ + 160) / OUTER) * OUTER;
  const info: GroundInfo = { s: 0, d: 0, covered: false, nearTrack: 0 };
  const t = ex.terrain;
  const demX0 = t ? Math.ceil(((t.x0 - ex.reg.cx) * ex.reg.k) / OUTER) * OUTER : -1500;
  const demZ0 = t ? Math.ceil(((t.z0 - ex.reg.cz) * ex.reg.k) / OUTER) * OUTER : -1500;
  const demN = t ? Math.floor(((t.nx - 1) * t.step) / OUTER) : 60;
  const demX1 = demX0 + demN * OUTER;
  const demZ1 = demZ0 + demN * OUTER;

  // Outer height: DEM (with the full blend near the track for the vertices that touch the inner ring).
  const outerH = (x: number, z: number): number => {
    const inside = x >= ix0 && x <= ix1 && z >= iz0 && z <= iz1;
    return inside ? ground.height(x, z) : ground.dem(x, z);
  };
  // Large maps (the ≈ 20 km Eifel ring, inner area > 12 km²): the 10 m grid only within NEAR_M of the road, in 500 m
  // tiles; tiles farther away are drawn at the outer 50 m resolution. Meshes are 1 km blocks (frustum / far-plane
  // culled). Small maps keep the single inner mesh over the whole box (unchanged).
  const large = (ix1 - ix0) * (iz1 - iz0) > 12e6;
  const TILE = 500, BLOCK = 1000, NEAR_M = 260;
  const ntx = large ? Math.ceil((ix1 - ix0) / TILE) : 1, ntz = large ? Math.ceil((iz1 - iz0) / TILE) : 1;
  const nearTile = new Uint8Array(ntx * ntz).fill(1);
  if (large) {
    nearTile.fill(0);
    for (let i = 0; i < data.count; i += 10) {
      const x = data.x[i]!, z = data.z[i]!;
      const a0 = Math.max(0, Math.floor((x - NEAR_M - ix0) / TILE)), a1 = Math.min(ntx - 1, Math.floor((x + NEAR_M - ix0) / TILE));
      const b0 = Math.max(0, Math.floor((z - NEAR_M - iz0) / TILE)), b1 = Math.min(ntz - 1, Math.floor((z + NEAR_M - iz0) / TILE));
      for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) nearTile[b * ntx + a] = 1;
    }
  }
  const tileNear = (a: number, b: number): boolean => a >= 0 && b >= 0 && a < ntx && b < ntz && nearTile[b * ntx + a] === 1;
  /** A vertex on a tile line is a seam vertex when any tile touching it is far (or outside the inner box). */
  const seam = (x: number, z: number): boolean => {
    const fa = (x - ix0) / TILE, fb = (z - iz0) / TILE;
    const a = Math.floor(fa + 1e-6), b = Math.floor(fb + 1e-6);
    const onX = Math.abs(fa - Math.round(fa)) < 1e-6, onZ = Math.abs(fb - Math.round(fb)) < 1e-6;
    for (const da of onX ? [-1, 0] : [0]) for (const db of onZ ? [-1, 0] : [0]) if (!tileNear(a + da, b + db)) return true;
    return false;
  };
  const onBorder = large
    ? (x: number, z: number): boolean => seam(x, z)
    : (x: number, z: number): boolean => x <= ix0 + 0.01 || x >= ix1 - 0.01 || z <= iz0 + 0.01 || z >= iz1 - 0.01;
  const onXLine = (x: number): boolean => (large ? Math.abs((x - ix0) / TILE - Math.round((x - ix0) / TILE)) < 1e-6 : x <= ix0 + 0.01 || x >= ix1 - 0.01);
  const innerH = (x: number, z: number, out: number[]): number => {
    out[1] = 0;
    // Vertices inside a far tile are never referenced by a triangle (skipped cells): no height lookup.
    if (large && !tileNear(Math.floor((x - ix0) / TILE), Math.floor((z - iz0) / TILE)) && !seam(x, z)) {
      out[0] = 0;
      return 0;
    }
    if (onBorder(x, z)) {
      out[0] = 0;
      // Exact linear interpolation of the outer grid along the border (crack-free T-junctions).
      if (onXLine(x)) {
        const za = Math.floor(z / OUTER) * OUTER;
        const f = (z - za) / OUTER;
        return f < 1e-6 ? outerH(x, za) : outerH(x, za) * (1 - f) + outerH(x, za + OUTER) * f;
      }
      const xa = Math.floor(x / OUTER) * OUTER;
      const f = (x - xa) / OUTER;
      return f < 1e-6 ? outerH(xa, z) : outerH(xa, z) * (1 - f) + outerH(xa + OUTER, z) * f;
    }
    const y = ground.height(x, z, info);
    out[0] = info.nearTrack;
    if (info.covered && Number.isFinite(info.below)) return info.below! - SINK;
    return info.covered ? y - SINK : y;
  };
  const geos: BufferGeometry[] = [];
  const names: string[] = [];
  if (!large) {
    geos.push(gridGeometry(ix0, iz0, Math.round((ix1 - ix0) / INNER) + 1, Math.round((iz1 - iz0) / INNER) + 1, INNER, innerH, null));
    names.push('terrain.inner');
  } else {
    const farCell = (x: number, z: number): boolean => !tileNear(Math.floor((x - ix0) / TILE), Math.floor((z - iz0) / TILE));
    for (let bz = iz0; bz < iz1; bz += BLOCK) {
      for (let bx = ix0; bx < ix1; bx += BLOCK) {
        const ex1 = Math.min(ix1, bx + BLOCK), ez1 = Math.min(iz1, bz + BLOCK);
        let any = false;
        for (let b = Math.floor((bz - iz0) / TILE); b * TILE + iz0 < ez1; b++) for (let a = Math.floor((bx - ix0) / TILE); a * TILE + ix0 < ex1; a++) any ||= tileNear(a, b);
        if (!any) continue;
        geos.push(gridGeometry(bx, bz, Math.round((ex1 - bx) / INNER) + 1, Math.round((ez1 - bz) / INNER) + 1, INNER, innerH, farCell));
        names.push(`terrain.inner.${bx}.${bz}`);
      }
    }
    // Far tiles of the inner box at 50 m (one mesh).
    geos.push(gridGeometry(ix0, iz0, Math.round((ix1 - ix0) / OUTER) + 1, Math.round((iz1 - iz0) / OUTER) + 1, OUTER, (x, z, out) => {
      out[0] = 0;
      out[1] = 0.5;
      return farCell(Math.min(x, ix1 - 1), Math.min(z, iz1 - 1)) || seam(x, z) ? outerH(x, z) : 0;
    }, (x, z) => !farCell(x, z)));
    names.push('terrain.innerFar');
  }
  geos.push(gridGeometry(demX0, demZ0, demN + 1, demN + 1, OUTER, (x, z, out) => {
    out[0] = 0;
    out[1] = 0.5;
    return outerH(x, z);
  }, (x, z) => x > ix0 && x < ix1 && z > iz0 && z < iz1));
  names.push('terrain.outer');
  // Far ring: ±4.5 km, procedural hills rising away from the DEM edge (higher to the north). A DEM that reaches past
  // ±4 km (large maps) gets a ring centred on it, 4.5 km wider on every side.
  const demBig = demX0 < -4000 || demX1 > 4000 || demZ0 < -4400 || demZ1 > 3600;
  const R = demBig ? Math.max(demX1 - demX0, demZ1 - demZ0) / 2 + 4500 : 4500;
  const rcx = demBig ? Math.round((demX0 + demX1) / 2 / FAR) * FAR : 0;
  const rcz = demBig ? Math.round((demZ0 + demZ1) / 2 / FAR) * FAR : -400;
  // Flat parkland (Lombardia): the far ring stays a gentle plain.
  const hillK = { parkland: 0.12, city: 0.6, residential: 1, alpine: 1, desert: 0.7, islands: 0, valley: 1.2, volcanic: 1.4 }[c.ex.authoring.THEME.backdrop];
  const alpine = c.ex.authoring.THEME.backdrop === 'alpine';
  const farH = (x: number, z: number, out: number[]): number => {
    out[0] = 0;
    out[1] = 1;
    const cx = Math.min(demX1, Math.max(demX0, x));
    const cz = Math.min(demZ1, Math.max(demZ0, z));
    const edge = ground.dem(cx, cz);
    const dist = Math.hypot(x - cx, z - cz);
    if (dist < 1e-6) return edge - 4; // under the outer ring (overlap strip hides the seam)
    const w = Math.min(1, dist / 900);
    const north = Math.max(0, (-z - 1200) / 2500);
    if (alpine) return edge + w * alpinePeaks(x, z);
    return edge + w * hillK * (hillNoise(x, z) + 35 + 70 * north);
  };
  geos.push(gridGeometry(rcx - R, rcz - R, Math.round((2 * R) / FAR) + 1, Math.round((2 * R) / FAR) + 1, FAR, farH,
    (x, z) => x - FAR / 2 > demX0 && x + FAR / 2 < demX1 && z - FAR / 2 > demZ0 && z + FAR / 2 < demZ1));
  names.push('terrain.far');

  // ---- splat material (dry golden grass / green grass / dirt by slope and noise; farmland far away) ------------
  const mat = envMaterial(c.sh, {
    name: 'terrain', family: 'opaque', mode: EnvMode.Terrain, wet: 0.55, param: { golden: 0, green: 1, urban: 2, alpine: 3, desert: 4, island: 5, valley: 6, volcanic: 7 }[c.ex.authoring.THEME.ground],
    map: tex.grassDry.map, normalMap: tex.grassDry.normal, roughness: 0.97, normalScale: 0.8, texA: tex.grassGreen.map, texB: tex.dirt.map,
  });

  const group = new Group();
  group.name = 'terrain';
  const meshes = geos.map((g, k) => {
    const m = new Mesh(g, mat);
    m.name = names[k]!;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
    return m;
  });
  void meshes;

  return {
    root: group,
    ground,
    setQuality(_q: QualityPreset) {
      void _q;
    },
    dispose() {
      for (const g of geos) g.dispose();
      mat.dispose();
      group.removeFromParent();
    },
  };
}
