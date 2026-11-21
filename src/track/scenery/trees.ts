// Trees (Ç7, report §7.9/§7.11): OSM forest/wood/scrub polygons (rasterised to a 20 m mask) filled with stone pines,
// cypresses and oak scrub, plus a sparse scatter on the hills; ≥ 25 m outside the barriers, never on the pit/paddock
// or under stands. 3D low-poly within 150 m (one InstancedMesh per species), cross-billboards beyond (one
// InstancedMesh); the near/far split is recomputed on the CPU when the camera moves (allocation-free).

import {
  BufferAttribute, BufferGeometry, Color, Group, IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, Vector3,
  type PerspectiveCamera,
} from 'three';
import type { QualityPreset } from '../../contracts/render';
import { envMaterial, EnvMode } from '../materials/shared';
import { canvasTexture, makeRand } from '../mesh/textures';
import type { EnvContext, EnvPart } from './environment';

const NEAR = 150;
const SPECIES = 5; // 0 stone pine, 1 cypress, 2 oak scrub, 3 broadleaf (deciduous parkland), 4 spruce (mountain forest)

function blob(rand: () => number, detail: number, sx: number, sy: number, sz: number, y: number, ox = 0, oz = 0): { pos: number[]; nor: number[] } {
  const g = new IcosahedronGeometry(1, detail);
  const p = g.getAttribute('position');
  const pos: number[] = [];
  const nor: number[] = [];
  // Index-free icosahedron: displace each vertex by a hash of its direction (consistent across duplicates).
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), yy = p.getY(i), z = p.getZ(i);
    const h = Math.sin(x * 12.9898 + yy * 78.233 + z * 37.719) * 43758.5453;
    // Realism pass 2026-11: lumpier crowns (stronger, two-scale displacement) so the silhouette is not a smooth ball.
    const h2 = Math.sin(x * 4.1 + yy * 3.3 - z * 5.7) * 0.5 + 0.5;
    const k = 0.7 + 0.34 * (h - Math.floor(h)) + 0.22 * h2;
    pos.push(ox + x * sx * k, y + yy * sy * k, oz + z * sz * k);
    const l = Math.hypot(x / sx, yy / sy, z / sz) || 1;
    nor.push(x / sx / l, yy / sy / l, z / sz / l);
  }
  g.dispose();
  void rand;
  return { pos, nor };
}

function trunk(h: number, r0: number, r1: number, seg: number): { pos: number[]; nor: number[] } {
  const pos: number[] = [];
  const nor: number[] = [];
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    const q = [[a0, 0, r0], [a0, h, r1], [a1, 0, r0], [a1, 0, r0], [a0, h, r1], [a1, h, r1]] as const;
    for (const [a, y, r] of q) {
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      nor.push(Math.cos(a), 0, Math.sin(a));
    }
  }
  return { pos, nor };
}

/** Open cone (side only) of base radius r and height h starting at y0, `seg` sides; normals tilted by the slope. */
function cone(r: number, h: number, y0: number, seg: number): { pos: number[]; nor: number[] } {
  const pos: number[] = [];
  const nor: number[] = [];
  const ny = r / Math.hypot(r, h), nr = h / Math.hypot(r, h);
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
    pos.push(Math.cos(a0) * r, y0, Math.sin(a0) * r, 0, y0 + h, 0, Math.cos(a1) * r, y0, Math.sin(a1) * r);
    nor.push(Math.cos(a0) * nr, ny, Math.sin(a0) * nr, Math.cos(am) * nr, ny, Math.sin(am) * nr, Math.cos(a1) * nr, ny, Math.sin(a1) * nr);
  }
  return { pos, nor };
}

function speciesGeometry(sp: number): BufferGeometry {
  const rand = makeRand(sp * 31 + 7);
  const parts: { pos: number[]; nor: number[]; col: [number, number, number] }[] = [];
  const bark: [number, number, number] = [0.07, 0.045, 0.028];
  if (sp === 0) {
    parts.push({ ...trunk(7.2, 0.28, 0.16, 6), col: bark });
    parts.push({ ...blob(rand, 1, 4.6, 1.8, 4.6, 8.0), col: [0.045, 0.075, 0.025] });
    parts.push({ ...blob(rand, 0, 2.6, 1.2, 2.6, 8.9, 1.4, -0.8), col: [0.055, 0.09, 0.03] });
  } else if (sp === 1) {
    parts.push({ ...trunk(1.6, 0.2, 0.15, 5), col: bark });
    parts.push({ ...blob(rand, 1, 1.25, 5.8, 1.25, 6.4), col: [0.03, 0.055, 0.02] });
  } else if (sp === 2) {
    parts.push({ ...trunk(2.2, 0.2, 0.14, 5), col: bark });
    parts.push({ ...blob(rand, 1, 2.9, 2.3, 2.9, 3.6), col: [0.07, 0.095, 0.03] });
  } else if (sp === 4) {
    // Spruce: narrow dark cone on a short bare trunk, ≈ 20–30 m with the instance scale (four stacked tiers).
    parts.push({ ...trunk(3, 0.3, 0.2, 5), col: bark });
    for (let k = 0; k < 4; k++) parts.push({ ...cone(3.4 - 0.7 * k, 9 - 1.2 * k, 2.2 + 4.9 * k, 7), col: [0.034 + 0.004 * k, 0.062 + 0.006 * k, 0.04] });
  } else {
    // Broadleaf: tall visible trunk, broad layered crown, ≈ 18–25 m with the instance scale.
    parts.push({ ...trunk(8.5, 0.42, 0.24, 6), col: bark });
    parts.push({ ...blob(rand, 1, 5.6, 4.6, 5.6, 12.6), col: [0.05, 0.085, 0.03] });
    parts.push({ ...blob(rand, 0, 3.6, 3.0, 3.6, 16.4, -1.2, 1.0), col: [0.062, 0.1, 0.036] });
    parts.push({ ...blob(rand, 0, 3.2, 2.6, 3.2, 10.6, 2.6, -1.4), col: [0.045, 0.075, 0.028] });
  }
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  for (const p of parts) {
    pos.push(...p.pos);
    nor.push(...p.nor);
    for (let i = 0; i < p.pos.length / 3; i++) {
      // Darker toward the bottom of the crown (cheap AO).
      const y = p.pos[i * 3 + 1]!;
      // Crown undersides and interiors are much darker than the sunlit tops (downward normals = self-shadowed).
      const ny = p.nor[i * 3 + 1]!;
      const ao = p.col === bark ? 1 : (0.62 + 0.38 * Math.min(1, Math.max(0, (y - 3) / 8))) * (0.5 + 0.5 * Math.min(1, Math.max(0, ny * 0.75 + 0.6)));
      col.push(p.col[0] * ao, p.col[1] * ao, p.col[2] * ao);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.computeBoundingSphere();
  return g;
}

/** Cross-billboard (two vertical quads, 4 triangles) of unit size, uv across one atlas cell. */
function crossGeometry(): BufferGeometry {
  const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let k = 0; k < 2; k++) {
    const a = (k * Math.PI) / 2;
    const cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5;
    const b = pos.length / 3;
    for (const [sx, y, u, v] of [[-1, 0, 0, 0], [1, 0, 1, 0], [-1, 1, 0, 1], [1, 1, 1, 1]] as const) {
      pos.push(cx * sx, y, cz * sx);
      uv.push(u, v);
      nor.push(0, 1, 0);
    }
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(idx);
  return g;
}

function treeAtlas() {
  // 5 cells of 256 × 256 (pine, cypress, oak, broadleaf, spruce): leaf clumps with top-light shading.
  return canvasTexture(1280, 256, (g) => {
    g.clearRect(0, 0, 1280, 256);
    const rand = makeRand(99);
    const clump = (cx: number, cy: number, r: number, base: [number, number, number]): void => {
      for (let k = 0; k < 160; k++) {
        const a = rand() * Math.PI * 2;
        const rr = Math.sqrt(rand()) * r;
        const x = cx + Math.cos(a) * rr * 1.1;
        const y = cy + Math.sin(a) * rr * 0.6;
        const light = 0.75 + 0.5 * (1 - (y - (cy - r * 0.6)) / (r * 1.2));
        // Painter's order = depth: early clumps are the dark interior, later ones the sunlit outer leaves.
        const depth = 0.5 + 0.75 * (k / 160);
        const c = base.map((v, j) => Math.round(Math.min(255, v * light * depth * (0.8 + rand() * 0.4) * (j === 2 ? 0.85 : 1))));
        g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        g.beginPath();
        g.arc(x, y, 4 + rand() * 8 * (1.3 - 0.5 * (k / 160)), 0, Math.PI * 2);
        g.fill();
      }
    };
    // Pine: trunk + umbrella crown.
    g.fillStyle = '#4a3624';
    g.fillRect(124, 120, 8, 136);
    clump(128, 90, 110, [62, 84, 40]);
    // Cypress: narrow flame.
    for (let k = 0; k < 220; k++) {
      const y = 30 + rand() * 210;
      const w = 30 * Math.sin(((y - 30) / 210) * Math.PI) + 4;
      const x = 384 + (rand() - 0.5) * 2 * w;
      g.fillStyle = `rgb(${Math.round(28 + rand() * 14)},${Math.round(46 + rand() * 16)},${Math.round(22 + rand() * 8)})`;
      g.beginPath();
      g.arc(x, y, 4 + rand() * 6, 0, Math.PI * 2);
      g.fill();
    }
    // Oak scrub: round crown, short trunk.
    g.fillStyle = '#4a3624';
    g.fillRect(636, 170, 8, 86);
    clump(640, 140, 95, [80, 96, 44]);
    // Broadleaf: tall trunk, broad tall crown.
    g.fillStyle = '#4a3624';
    g.fillRect(891, 130, 10, 126);
    clump(896, 92, 118, [56, 88, 38]);
    clump(880, 60, 70, [66, 100, 44]);
    // Spruce: dark narrow cone with drooping tiers.
    g.fillStyle = '#3a2a1c';
    g.fillRect(1148, 200, 8, 56);
    for (let k = 0; k < 700; k++) {
      const y = 8 + rand() * 210;
      const w = 6 + 96 * ((y - 8) / 210) * (0.8 + 0.2 * Math.sin(y * 0.18));
      const x = 1152 + (rand() - 0.5) * 2 * w;
      g.fillStyle = `rgb(${Math.round(34 + rand() * 16)},${Math.round(60 + rand() * 22)},${Math.round(40 + rand() * 14)})`;
      g.beginPath();
      g.arc(x, y, 3 + rand() * 5, 0, Math.PI * 2);
      g.fill();
    }
  });
}

interface FeaturePoly { xz: [number, number][] }

/** Even-odd scanline rasterisation of polygons into a cell mask. */
function rasterise(polys: FeaturePoly[], x0: number, z0: number, cell: number, nx: number, nz: number): Uint8Array {
  const mask = new Uint8Array(nx * nz);
  for (const p of polys) {
    const xs: number[] = [];
    for (let j = 0; j < nz; j++) {
      const z = z0 + (j + 0.5) * cell;
      xs.length = 0;
      const n = p.xz.length;
      for (let k = 0; k < n; k++) {
        const a = p.xz[k]!, b = p.xz[(k + 1) % n]!;
        if ((a[1] <= z && b[1] > z) || (b[1] <= z && a[1] > z)) xs.push(a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k]! - x0) / cell - 0.5));
        const i1 = Math.min(nx - 1, Math.floor((xs[k + 1]! - x0) / cell - 0.5));
        for (let i = i0; i <= i1; i++) mask[j * nx + i] = 1;
      }
    }
  }
  return mask;
}

export function createTrees(c: EnvContext, blocked: (x: number, z: number) => boolean): EnvPart & { triangles: () => number } {
  const { track, ex } = c;
  const ground = c.ground!;
  const data = track.data;
  const reg = ex.reg;
  const rand = makeRand(20261005);
  const toWorld = (f: { xz: [number, number][] }): FeaturePoly => ({ xz: f.xz.map(([x, z]) => [(x - reg.cx) * reg.k, (z - reg.cz) * reg.k]) });
  const theme = ex.authoring.THEME;
  const forests = ex.features.filter((f) => f.kind === 'forest').map(toWorld);
  const scrubs = ex.features.filter((f) => f.kind === 'scrub').map(toWorld);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < data.count; i++) {
    minX = Math.min(minX, data.x[i]!); maxX = Math.max(maxX, data.x[i]!);
    minZ = Math.min(minZ, data.z[i]!); maxZ = Math.max(maxZ, data.z[i]!);
  }
  const cxm = (minX + maxX) / 2, czm = (minZ + maxZ) / 2;
  // Large maps (the Eifel ring): the forest grid covers the whole layout plus a margin (others keep ±1.45 km).
  const HALF = Math.max(1450, Math.ceil(Math.max(maxX - minX, maxZ - minZ) / 2 + 900));
  const large = HALF > 1450;
  // THEME.treeFar: beyond `near` m from the road the forest is filled at `spacing` (ground straight from the DEM).
  const farFill = theme.treeFar;
  const nearRoadAt = farFill ? (() => {
    const n = Math.ceil((2 * HALF) / 50), r = Math.ceil(farFill.near / 50);
    const m = new Uint8Array(n * n);
    for (let i = 0; i < data.count; i += 25) {
      const a = Math.floor((data.x[i]! - (cxm - HALF)) / 50), b = Math.floor((data.z[i]! - (czm - HALF)) / 50);
      for (let jb = Math.max(0, b - r); jb <= Math.min(n - 1, b + r); jb++) for (let ja = Math.max(0, a - r); ja <= Math.min(n - 1, a + r); ja++) m[jb * n + ja] = 1;
    }
    return (x: number, z: number): boolean => {
      const a = Math.floor((x - (cxm - HALF)) / 50), b = Math.floor((z - (czm - HALF)) / 50);
      return a < 0 || b < 0 || a >= n || b >= n || m[b * n + a] === 1;
    };
  })() : null;
  const CELL = 20;
  const gx0 = cxm - HALF, gz0 = czm - HALF;
  const GN = Math.ceil((2 * HALF) / CELL);
  const forestMask = rasterise(forests, gx0, gz0, CELL, GN, GN);
  const scrubMask = rasterise(scrubs, gx0, gz0, CELL, GN, GN);

  // Candidate trees: jittered grid (forest 11 m, scrub 14 m, open hills sparse).
  type Tree = { x: number; y: number; z: number; sp: number; s: number; rot: number; tint: number };
  const trees: Tree[] = [];
  const info = { s: 0, d: 0, covered: false, nearTrack: 0 };
  const tryAdd = (x: number, z: number, sp: number, farTree = false): void => {
    if (blocked(x, z)) return;
    if (farTree) {
      trees.push({ x, y: ground.dem(x, z), z, sp, s: 1.0 + rand() * 0.5, rot: rand() * Math.PI * 2, tint: rand() });
      return;
    }
    const y = ground.height(x, z, info);
    if (info.covered) return;
    // Sea tracks: no trees in the water or on the beach.
    if (theme.sea && y < theme.sea.y + 1.5) return;
    const k = Math.round(info.s) % data.count;
    const wall = info.d >= 0 ? data.wallL[k]! : data.wallR[k]!;
    if (Math.abs(info.d) < wall + theme.treeSetback) return;
    trees.push({ x, y, z, sp, s: 0.75 + rand() * 0.5, rot: rand() * Math.PI * 2, tint: rand() });
  };
  /** Species from weights (pine, cypress, oak, broadleaf); one rand() for the first weight, a second for the rest. */
  const pick = (m: readonly [number, number, number, number, number?]): number => {
    if (rand() < m[0]) return 0;
    const m4 = m[4] ?? 0;
    const r = rand() * (m[1] + m[2] + m[3] + m4);
    return r < m[1] ? 1 : r < m[1] + m[2] ? 2 : r < m[1] + m[2] + m[3] ? 3 : 4;
  };
  for (const [spacing, kind] of [[theme.forestSpacing, 'forest'], [12, 'scrub'], [theme.openTreeSpacing, 'open'], [farFill?.spacing ?? 0, 'far']] as const) {
    if (spacing <= 0) continue;
    for (let z = gz0; z < gz0 + 2 * HALF; z += spacing) {
      for (let x = gx0; x < gx0 + 2 * HALF; x += spacing) {
        const jx = x + (rand() - 0.5) * spacing * 0.9;
        const jz = z + (rand() - 0.5) * spacing * 0.9;
        const i = Math.floor((jx - gx0) / CELL), j = Math.floor((jz - gz0) / CELL);
        if (i < 0 || j < 0 || i >= GN || j >= GN) continue;
        const fm = forestMask[j * GN + i]!, sm = scrubMask[j * GN + i]!;
        const nearRoad = !nearRoadAt || nearRoadAt(jx, jz);
        if (kind === 'far') {
          if (fm && !nearRoad) tryAdd(jx, jz, pick(theme.forestMix), true);
          continue;
        }
        if (!nearRoad && kind !== 'scrub') continue;
        if (kind === 'forest' && fm) tryAdd(jx, jz, pick(theme.forestMix));
        else if (kind === 'scrub' && sm && !fm && rand() < 0.7) tryAdd(jx, jz, rand() < 0.75 ? 2 : 0);
        else if (kind === 'open' && !fm && !sm) {
          // Hills: clumps by low-frequency noise, more on the slopes away from the track.
          const n = Math.sin(jx * 0.011 + 1.3) * Math.cos(jz * 0.009 - 0.7) + Math.sin(jx * 0.027 - jz * 0.019);
          if (n > 0.55 && rand() < 0.55) tryAdd(jx, jz, pick(theme.openMix));
        }
      }
    }
  }
  // Street trees (city theme): rows behind the walls.
  const pw = { x: 0, y: 0, z: 0 };
  for (const row of theme.streetTrees ?? []) {
    const len = track.query.wrapS((row.to - row.from) * ex.sScale);
    for (let u = 0; u <= len; u += row.spacing) {
      const s = track.query.wrapS(row.from * ex.sScale + u);
      const i = Math.round(s) % data.count;
      track.query.worldFromSD(s, row.side * ((row.side === 1 ? data.wallL[i]! : data.wallR[i]!) + row.d), pw);
      tryAdd(pw.x + (rand() - 0.5) * 1.5, pw.z + (rand() - 0.5) * 1.5, 3);
    }
  }
  // Deterministic shuffle + cap; density cuts take a prefix (even thinning).
  for (let k = trees.length - 1; k > 0; k--) {
    const j = Math.floor(rand() * (k + 1));
    [trees[k], trees[j]] = [trees[j]!, trees[k]!];
  }
  if (trees.length > theme.maxTrees) trees.length = theme.maxTrees;
  const TOTAL = trees.length;

  // Precomputed instance matrices (3D and billboard sizes differ per species).
  const BB_SIZE: [number, number][] = [[11, 11], [3.4, 13], [7, 7.2], [13, 20], [9, 25]];
  const mat3 = new Float32Array(TOTAL * 16);
  const matB = new Float32Array(TOTAL * 16);
  const m4 = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const v = new Vector3();
  const sc = new Vector3();
  const colors = new Float32Array(TOTAL * 3);
  const col = new Color();
  trees.forEach((t, k) => {
    q.setFromAxisAngle(up, t.rot);
    v.set(t.x, t.y - 0.15, t.z);
    sc.setScalar(t.s);
    m4.compose(v, q, sc).toArray(mat3, k * 16);
    const [w, h] = BB_SIZE[t.sp]!;
    sc.set(w * t.s, h * t.s, w * t.s);
    m4.compose(v, q, sc).toArray(matB, k * 16);
    col.setRGB(0.85 + 0.3 * t.tint, 0.88 + 0.24 * t.tint, 0.8 + 0.3 * (1 - t.tint));
    colors.set([col.r, col.g, col.b], k * 3);
  });

  // ---- meshes -----------------------------------------------------------------------------------------
  const group = new Group();
  group.name = 'trees';
  const treeMat = envMaterial(c.sh, { name: 'trees.3d', family: 'inst', mode: EnvMode.Foliage, vertexColor: true, roughness: 0.92, wet: 0.3, flood: 0.8 });
  const geos3 = [0, 1, 2, 3, 4].map(speciesGeometry);
  // Large maps: the near (3D) and streamed billboard sets never hold the whole forest (capacity caps, not every tree).
  const CAP3 = large ? Math.min(TOTAL, 6000) : TOTAL;
  const CAPB = large ? Math.min(TOTAL, 90_000) : TOTAL;
  const near: InstancedMesh[] = geos3.map((g, sp) => {
    const m = new InstancedMesh(g, treeMat, Math.max(1, CAP3));
    m.name = `trees.3d.${sp}`;
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = c.quality.id !== 'low';
    m.receiveShadow = true;
    m.instanceColor = new InstancedBufferAttribute(new Float32Array(Math.max(1, CAP3) * 3), 3);
    group.add(m);
    return m;
  });
  const atlas = treeAtlas();
  const bbMat = envMaterial(c.sh, {
    name: 'trees.billboard', family: 'instCutout', mode: EnvMode.Billboard, vertexColor: true, map: atlas, alphaTest: 0.45, roughness: 0.95,
    param: NEAR - 3, wet: 0, flood: 0.8,
  });
  const bbGeo = crossGeometry();
  const speciesAttr = new InstancedBufferAttribute(new Float32Array(Math.max(1, CAPB)), 1);
  bbGeo.setAttribute('aApx', speciesAttr);
  const far = new InstancedMesh(bbGeo, bbMat, Math.max(1, CAPB));
  far.name = 'trees.billboards';
  far.frustumCulled = false;
  far.receiveShadow = false;
  far.instanceColor = new InstancedBufferAttribute(new Float32Array(Math.max(1, CAPB) * 3), 3);
  if (!large) {
    (far.instanceMatrix.array as Float32Array).set(matB);
    (far.instanceColor.array as Float32Array).set(colors);
    trees.forEach((t, k) => ((speciesAttr.array as Float32Array)[k] = t.sp));
  }
  group.add(far);

  // 100 m grid of tree indices for the near (3D) set.
  const GC = 100;
  const gcx0 = gx0, gcz0 = gz0;
  const GCN = Math.ceil((2 * HALF) / GC) + 1;
  const gridCells: number[][] = Array.from({ length: GCN * GCN }, () => []);
  trees.forEach((t, k) => {
    const i = Math.min(GCN - 1, Math.max(0, Math.floor((t.x - gcx0) / GC)));
    const j = Math.min(GCN - 1, Math.max(0, Math.floor((t.z - gcz0) / GC)));
    gridCells[j * GCN + i]!.push(k);
  });

  let active = Math.round(TOTAL * Math.min(1, c.quality.treeDensity / 1.3));
  far.count = active;
  let lastX = Infinity, lastZ = Infinity;
  // Large maps: the billboard mesh holds only the trees within BB_R of the camera (compacted from 250 m cells when the
  // camera has moved 60 m), so the drawn set stays a few ten thousand instead of the whole forest.
  const BB_CELL = 250;
  let bbR = 0.62 * c.quality.far;
  const bbN = Math.ceil((2 * HALF) / BB_CELL) + 1;
  const bbCells: number[][] = large ? Array.from({ length: bbN * bbN }, () => []) : [];
  if (large) {
    trees.forEach((t, k) => {
      const i = Math.min(bbN - 1, Math.max(0, Math.floor((t.x - gx0) / BB_CELL)));
      const j = Math.min(bbN - 1, Math.max(0, Math.floor((t.z - gz0) / BB_CELL)));
      bbCells[j * bbN + i]!.push(k);
    });
    far.count = 0;
  }
  const species = speciesAttr.array as Float32Array;
  const farM = far.instanceMatrix.array as Float32Array;
  const farC = far.instanceColor.array as Float32Array;
  let bbX = Infinity, bbZ = Infinity;
  const relayoutFar = (cx: number, cz: number): void => {
    let n = 0;
    const r2 = bbR * bbR;
    const i0 = Math.max(0, Math.floor((cx - bbR - gx0) / BB_CELL)), i1 = Math.min(bbN - 1, Math.floor((cx + bbR - gx0) / BB_CELL));
    const j0 = Math.max(0, Math.floor((cz - bbR - gz0) / BB_CELL)), j1 = Math.min(bbN - 1, Math.floor((cz + bbR - gz0) / BB_CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cell = bbCells[j * bbN + i]!;
        for (let m = 0; m < cell.length; m++) {
          const k = cell[m]!;
          if (k >= active) continue;
          const t = trees[k]!;
          const dx = t.x - cx, dz = t.z - cz;
          if (dx * dx + dz * dz >= r2 || n >= CAPB) continue;
          farM.set(matB.subarray(k * 16, k * 16 + 16), n * 16);
          farC.set(colors.subarray(k * 3, k * 3 + 3), n * 3);
          species[n] = t.sp;
          n++;
        }
      }
    }
    far.count = n;
    far.instanceMatrix.needsUpdate = true;
    far.instanceColor!.needsUpdate = true;
    speciesAttr.needsUpdate = true;
  };
  const counts = [0, 0, 0, 0, 0];
  const relayout = (cx: number, cz: number): void => {
    counts.fill(0);
    const r2 = NEAR * NEAR;
    const i0 = Math.max(0, Math.floor((cx - NEAR - gcx0) / GC)), i1 = Math.min(GCN - 1, Math.floor((cx + NEAR - gcx0) / GC));
    const j0 = Math.max(0, Math.floor((cz - NEAR - gcz0) / GC)), j1 = Math.min(GCN - 1, Math.floor((cz + NEAR - gcz0) / GC));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cell = gridCells[j * GCN + i]!;
        for (let m = 0; m < cell.length; m++) {
          const k = cell[m]!;
          if (k >= active) continue;
          const t = trees[k]!;
          const dx = t.x - cx, dz = t.z - cz;
          if (dx * dx + dz * dz >= r2) continue;
          const mesh = near[t.sp]!;
          const n = counts[t.sp]!;
          if (n >= CAP3) continue;
          (mesh.instanceMatrix.array as Float32Array).set(mat3.subarray(k * 16, k * 16 + 16), n * 16);
          (mesh.instanceColor!.array as Float32Array).set(colors.subarray(k * 3, k * 3 + 3), n * 3);
          counts[t.sp] = n + 1;
        }
      }
    }
    for (let sp = 0; sp < SPECIES; sp++) {
      const mesh = near[sp]!;
      mesh.count = counts[sp]!;
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    }
  };

  const triPer3 = geos3.map((g) => g.getAttribute('position').count / 3);
  return {
    root: group,
    triangles: () => near.reduce((a, m, sp) => a + m.count * triPer3[sp]!, 0) + far.count * 4,
    update(cam: PerspectiveCamera) {
      const dx = cam.position.x - lastX, dz = cam.position.z - lastZ;
      if (dx * dx + dz * dz > 16) {
        lastX = cam.position.x;
        lastZ = cam.position.z;
        relayout(lastX, lastZ);
      }
      if (large) {
        const ex = cam.position.x - bbX, ez = cam.position.z - bbZ;
        // Streaming radius follows the camera's far plane (the quality preset's in game; longer for aerial shots).
        const want = 0.62 * Math.max(c.quality.far, cam.far);
        if (want !== bbR) { bbR = want; bbX = Infinity; }
        if (ex * ex + ez * ez > 3600 || bbX === Infinity) {
          bbX = cam.position.x;
          bbZ = cam.position.z;
          relayoutFar(bbX, bbZ);
        }
      }
    },
    setQuality(qp: QualityPreset) {
      active = Math.round(TOTAL * Math.min(1, qp.treeDensity / 1.3));
      far.count = large ? 0 : active;
      bbR = 0.62 * qp.far;
      bbX = Infinity;
      for (const m of near) m.castShadow = qp.id !== 'low';
      lastX = Infinity;
    },
    dispose() {
      for (const g of geos3) g.dispose();
      bbGeo.dispose();
      treeMat.dispose();
      bbMat.dispose();
      atlas.dispose();
      for (const m of near) m.dispose();
      far.dispose();
      group.removeFromParent();
    },
  };
}
