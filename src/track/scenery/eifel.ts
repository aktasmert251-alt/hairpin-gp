// Eifel Forest Ring extras (docs/design/tracks-eifel.md §9): the castle on its hill above the valley, the village the
// road runs through, bridges over the road (a stone road bridge in the village, a second on the climb, spectator
// footbridges), kilometre boards every km, spectator camps in the forest clearings and the concrete slabs of the banked
// bowl. Empty group on every other track. Every material reuses an existing env program variant (opaque + concrete
// maps like alpine.struct, inst + vertex colour like alpine.chalets); statics are split per site so the frustum and
// far plane cull them. Adds blockers (no trees in the village, camps, castle, under bridges).

import { Color, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3, type BufferGeometry, type Material } from 'three';
import type { TrackFrame } from '../../contracts/track';
import { SITES, tagS } from '../authoring/eifel-ctrl';
import { EIFEL } from '../authoring/eifel';
import { siteXZ } from '../data/eifel-raw';
import { envMaterial } from '../materials/shared';
import { canvasTexture, makeRand } from '../mesh/textures';
import type { EnvContext, EnvPart } from './environment';
import { boxInFrame, SBuf } from './stands';

const STONE = new Color(0.58, 0.55, 0.5);
const STONE_D = new Color(0.44, 0.41, 0.37);
const SLATE = new Color(0.1, 0.105, 0.12);
const STEEL = new Color(0.36, 0.4, 0.44);
const WHITE = new Color(0.92, 0.92, 0.9);

/** Octagonal prism (+ optional cone roof) at o, radius r, from y0 to y1 (roof up to y1 + roofH). */
function tower(b: SBuf, o: { x: number; y: number; z: number }, r: number, y0: number, y1: number, roofH: number, wall: Color, roof: Color): void {
  const n = 8;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    const p = (a: number, y: number, rr = r): number[] => [o.x + Math.cos(a) * rr, o.y + y, o.z + Math.sin(a) * rr];
    b.quad([p(a0, y0), p(a1, y0), p(a0, y1), p(a1, y1)], [Math.cos(am), 0, Math.sin(am)], wall);
    if (roofH > 0) {
      const top = [o.x, o.y + y1 + roofH, o.z];
      b.quad([p(a0, y1, r * 1.12), p(a1, y1, r * 1.12), top, top], [Math.cos(am) * 0.7, 0.7, Math.sin(am) * 0.7], roof);
    } else {
      // Crenellated top: a merlon on every other face.
      if (k % 2 === 0) b.quad([p(a0, y1), p(a1, y1), p(a0, y1 + 1.2), p(a1, y1 + 1.2)], [Math.cos(am), 0, Math.sin(am)], wall);
      b.quad([p(a0, y1, r * 0.75), p(a1, y1, r * 0.75), p(a0, y1), p(a1, y1)], [0, 1, 0], wall);
    }
  }
}

/** Half-timbered house in a unit frame (u, v ∈ ±0.5, y 0..1): plaster, dark timber bands, steep roof. */
function houseGeometry(): SBuf {
  const b = new SBuf();
  const o = { x: 0, y: 0, z: 0 };
  const plaster = new Color(0.86, 0.83, 0.76), timber = new Color(0.16, 0.09, 0.05), roof = new Color(0.32, 0.12, 0.08), win = new Color(0.04, 0.045, 0.05);
  boxInFrame(b, o, [-0.5, 0.5], [-0.5, 0.5], [-0.3, 0.6], 1, 0, 0, 1, plaster);
  for (const y of [0.28, 0.58]) boxInFrame(b, o, [-0.51, 0.51], [-0.51, 0.51], [y, y + 0.03], 1, 0, 0, 1, timber);
  for (const u of [-0.5, -0.17, 0.17, 0.5]) for (const s of [-1, 1]) boxInFrame(b, o, [u - 0.02, u + 0.02], [s * 0.51 - 0.01, s * 0.51 + 0.01], [0, 0.6], 1, 0, 0, 1, timber);
  for (const u of [-0.33, 0, 0.33]) for (const s of [-1, 1]) {
    b.quad([[u - 0.06, 0.1, s * 0.515], [u + 0.06, 0.1, s * 0.515], [u - 0.06, 0.22, s * 0.515], [u + 0.06, 0.22, s * 0.515]], [0, 0, s], win);
    b.quad([[u - 0.06, 0.38, s * 0.515], [u + 0.06, 0.38, s * 0.515], [u - 0.06, 0.5, s * 0.515], [u + 0.06, 0.5, s * 0.515]], [0, 0, s], win);
  }
  for (const s of [-1, 1]) {
    b.quad([[s * 0.5, 0.6, -0.5], [s * 0.5, 0.6, 0.5], [s * 0.5, 1.0, 0], [s * 0.5, 1.0, 0]], [s, 0, 0], plaster);
    const e = s * 0.6;
    b.quad([[-0.56, 0.54, e], [0.56, 0.54, e], [-0.56, 1.02, 0], [0.56, 1.02, 0]], [0, 0.75, s * 0.66], roof);
  }
  return b;
}

/** Ridge tent (unit: 1 m along u, 1 m wide, 1 m high). */
function tentGeometry(): SBuf {
  const b = new SBuf();
  const c = new Color(1, 1, 1);
  for (const s of [-1, 1]) b.quad([[-0.5, 0, s * 0.5], [0.5, 0, s * 0.5], [-0.5, 1, 0], [0.5, 1, 0]], [0, 0.5, s * 0.86], c);
  for (const s of [-1, 1]) b.quad([[s * 0.5, 0, -0.5], [s * 0.5, 0, 0.5], [s * 0.5, 1, 0], [s * 0.5, 1, 0]], [s, 0, 0], c);
  return b;
}

/** Camper van / car (unit box with a darker window band; colour from the instance). */
function vanGeometry(): SBuf {
  const b = new SBuf();
  const o = { x: 0, y: 0, z: 0 };
  boxInFrame(b, o, [-0.5, 0.5], [-0.5, 0.5], [0.12, 0.8], 1, 0, 0, 1, new Color(1, 1, 1));
  boxInFrame(b, o, [-0.38, 0.42], [-0.505, 0.505], [0.55, 0.75], 1, 0, 0, 1, new Color(0.08, 0.09, 0.1));
  boxInFrame(b, o, [-0.48, 0.48], [-0.46, 0.46], [0, 0.12], 1, 0, 0, 1, new Color(0.05, 0.05, 0.05));
  return b;
}

/** Spectator (0.5 × 1.75 m figure, shirt colour from the instance, dark legs). */
function personGeometry(): SBuf {
  const b = new SBuf();
  const o = { x: 0, y: 0, z: 0 };
  boxInFrame(b, o, [-0.2, 0.2], [-0.12, 0.12], [0, 0.85], 1, 0, 0, 1, new Color(0.12, 0.13, 0.17));
  boxInFrame(b, o, [-0.24, 0.24], [-0.14, 0.14], [0.85, 1.45], 1, 0, 0, 1, new Color(1, 1, 1));
  boxInFrame(b, o, [-0.11, 0.11], [-0.11, 0.11], [1.45, 1.75], 1, 0, 0, 1, new Color(0.85, 0.66, 0.52));
  return b;
}

/** Atlas of kilometre numbers 1..24: 4 × 6 cells, black on white with a yellow frame (km board look). */
function kmAtlas() {
  return canvasTexture(512, 768, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 512, 768);
    for (let k = 0; k < 24; k++) {
      const x = (k % 4) * 128, y = Math.floor(k / 4) * 128;
      g.fillStyle = '#e9b800';
      g.fillRect(x + 4, y + 4, 120, 120);
      g.fillStyle = '#ffffff';
      g.fillRect(x + 14, y + 14, 100, 100);
      g.fillStyle = '#111111';
      g.font = '800 78px "Barlow Condensed", "Arial Narrow", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(k + 1), x + 64, y + 60);
      g.font = '700 22px "Barlow Condensed", "Arial Narrow", sans-serif';
      g.fillText('KM', x + 64, y + 103);
    }
  });
}

export function createEifel(c: EnvContext): EnvPart & { triangles: number } {
  const group = new Group();
  group.name = 'eifel';
  if (c.ex.authoring.id !== 'eifel') return { root: group, triangles: 0, dispose: () => group.removeFromParent() };
  const { data, query: q } = c.track;
  const ex = c.ex;
  const ground = c.ground!;
  const rand = makeRand(1927);
  const reg = ex.reg;
  const W = (p: [number, number]): [number, number] => [(p[0] - reg.cx) * reg.k, (p[1] - reg.cz) * reg.k];
  const S = (tag: string, off: number): number => q.wrapS(tagS(tag, off) * ex.sScale);
  const f: TrackFrame = { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 };
  const P = { x: 0, y: 0, z: 0 };
  const info = { s: 0, d: 0, covered: false, nearTrack: 0 };
  const geos: BufferGeometry[] = [];
  const mats: Material[] = [];
  const disposers: (() => void)[] = [];
  let tris = 0;
  const block = (cx: number, cz: number, ux: number, uz: number, hu: number, hv: number): void => { c.blockers.push({ cx, cz, ux, uz, hu, hv }); };
  const wallAt = (s: number, side: 1 | -1): number => (side === 1 ? data.wallL : data.wallR)[Math.round(s) % data.count]!;

  // Statics are single-instance InstancedMeshes on the instanced vertex-colour material (the same program as the houses).
  const instMat = envMaterial(c.sh, { name: 'eifel.inst', family: 'inst', vertexColor: true, roughness: 0.85, wet: 0.5 });
  mats.push(instMat);
  const ident = new Matrix4(), white = new Color(1, 1, 1);
  const addStatic = (b: SBuf, name: string, shadow = true, at?: Matrix4): void => {
    if (b.idx.length === 0) return;
    const g = b.geometry();
    geos.push(g);
    const m = new InstancedMesh(g, instMat, 1);
    m.setMatrixAt(0, at ?? ident);
    m.setColorAt(0, white);
    m.computeBoundingSphere();
    m.name = name;
    m.castShadow = shadow && c.quality.id !== 'low';
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
    tris += g.index!.count / 3;
  };

  // ---- the castle on its hill (1 draw) ----
  {
    const [cx, cz] = W(siteXZ(SITES.castle.tag, SITES.castle.off, SITES.castle.d));
    let base = Infinity;
    for (let a = 0; a < 8; a++) base = Math.min(base, ground.height(cx + Math.cos(a) * 52, cz + Math.sin(a) * 52));
    // Built around the origin and placed 1.6× scale on the hill top: it has to read from the valley road 300 m away.
    const SC = 1.6;
    const o = { x: 0, y: 0, z: 0 };
    const b = new SBuf();
    // Face the valley road: the long side toward the track.
    q.project(cx, cz, { s: S(SITES.castle.tag, SITES.castle.off), ribbon: 'main', sp: NaN }, info);
    q.frameAt(info.s, f);
    const ux = f.tx, uz = f.tz, vx = f.lx, vz = f.lz;
    const H = 13;
    // Curtain walls (60 × 42 m) with a wall walk, crenellations every 3 m.
    for (const [u0, u1, v0, v1] of [[-30, 30, -21, -18.5], [-30, 30, 18.5, 21], [-30, -27.5, -21, 21], [27.5, 30, -21, 21]] as const) {
      boxInFrame(b, o, [u0, u1], [v0, v1], [0, H], ux, uz, vx, vz, STONE);
    }
    for (let u = -29; u <= 29; u += 3) for (const v of [-21, 18.5]) boxInFrame(b, o, [u, u + 1.4], [v, v + 2.5], [H, H + 1.3], ux, uz, vx, vz, STONE);
    for (let v = -18; v <= 18; v += 3) for (const u of [-30, 27.5]) boxInFrame(b, o, [u, u + 2.5], [v, v + 1.4], [H, H + 1.3], ux, uz, vx, vz, STONE);
    // Gate house, keep, palas and four corner towers.
    boxInFrame(b, o, [-6, 6], [-23, -16], [0, H + 5], ux, uz, vx, vz, STONE_D);
    boxInFrame(b, o, [-12, 2], [-4, 10], [0, 30], ux, uz, vx, vz, STONE);
    const keepTop = { x: o.x + ux * -5 + vx * 3, y: o.y + 30, z: o.z + uz * -5 + vz * 3 };
    tower(b, keepTop, 6, 0, 0.1, 9, STONE, SLATE);
    boxInFrame(b, o, [6, 26], [2, 17], [0, 19], ux, uz, vx, vz, new Color(0.74, 0.71, 0.64));
    // Palas roof (gable along u).
    for (const s of [-1, 1]) {
      const P0 = (u: number, v: number, y: number): number[] => [o.x + ux * u + vx * v, o.y + y, o.z + uz * u + vz * v];
      b.quad([P0(5, 9.5 + s * 8.5, 19), P0(27, 9.5 + s * 8.5, 19), P0(5, 9.5, 27), P0(27, 9.5, 27)], [vx * s * 0.7, 0.7, vz * s * 0.7], SLATE);
      b.quad([P0(s > 0 ? 26 : 6, 2, 19), P0(s > 0 ? 26 : 6, 17, 19), P0(s > 0 ? 26 : 6, 9.5, 27), P0(s > 0 ? 26 : 6, 9.5, 27)], [s * ux, 0, s * uz], new Color(0.74, 0.71, 0.64));
    }
    for (const [u, v] of [[-30, -21], [30, -21], [-30, 21], [30, 21]] as const) {
      tower(b, { x: o.x + ux * u + vx * v, y: o.y, z: o.z + uz * u + vz * v }, 4.5, 0, H + 7, (u + v) % 2 === 0 ? 7 : 0, STONE, SLATE);
    }
    addStatic(b, 'eifel.castle', true, new Matrix4().compose(new Vector3(cx, base - 3, cz), new Quaternion(), new Vector3(SC, SC, SC)));
    block(cx, cz, ux, uz, 42 * SC, 34 * SC);
  }

  // ---- far-view road ribbon (1 draw per 2 km): a light-grey band 0.12 m under the road, 1.5 m wider each side. Near the
  // camera the road and its verge bands cover it; beyond the surface's 1.9 km cull distance it keeps the ring legible
  // through the forest and from the crests / aerial views ----
  {
    const grey = new Color(0.52, 0.52, 0.5);
    const wpt = (s: number, d: number): number[] => { q.worldFromSD(s, d, P); return [P.x, P.y - 0.12, P.z]; };
    for (let c0 = 0; c0 < data.length; c0 += 2000) {
      const b = new SBuf();
      const c1 = Math.min(data.length, c0 + 2000);
      for (let s = c0; s < c1; s += 10) {
        const e = Math.min(c1, s + 10);
        const i = Math.round(s) % data.count, j = Math.round(e) % data.count;
        b.quad([wpt(s, -data.halfWidthR[i]! - 1.5), wpt(e, -data.halfWidthR[j]! - 1.5), wpt(s, data.halfWidthL[i]! + 1.5), wpt(e, data.halfWidthL[j]! + 1.5)], [0, 1, 0], grey);
      }
      addStatic(b, `eifel.roadFar.${c0}`, false);
    }
  }

  // ---- bridges over the road (1 draw each) and their spectators ----
  const people: { x: number; y: number; z: number; rot: number }[] = [];
  for (const br of SITES.bridges) {
    const s = S(br.tag, br.off);
    q.frameAt(s, f);
    const stone = br.kind === 'stone';
    const reach = Math.max(wallAt(s, 1), wallAt(s, -1)) + (stone ? 7 : 5);
    const deckW = stone ? 7 : 3;
    const clearance = stone ? 6.2 : 5.6;
    const deckY = f.py + clearance + Math.abs(f.crossSlope) * reach;
    const o = { x: f.px, y: 0, z: f.pz };
    const b = new SBuf();
    // Deck spans along the road's left normal (v = across the road), u along the road.
    const ux = f.tx, uz = f.tz, vx = f.lx, vz = f.lz;
    const col = stone ? STONE : STEEL;
    boxInFrame(b, o, [-deckW / 2, deckW / 2], [-reach, reach], [deckY, deckY + (stone ? 1.4 : 0.5)], ux, uz, vx, vz, col, true);
    // Parapets / railings.
    for (const su of [-1, 1]) boxInFrame(b, o, [su * deckW / 2 - (su > 0 ? 0.35 : 0), su * deckW / 2 + (su < 0 ? 0.35 : 0)], [-reach, reach], [deckY + (stone ? 1.4 : 0.5), deckY + (stone ? 2.4 : 1.6)], ux, uz, vx, vz, stone ? STONE_D : STEEL);
    // Abutments / stair towers down to the ground beyond the barriers.
    for (const sv of [-1, 1]) {
      const v0 = sv > 0 ? reach - (stone ? 6 : 3.5) : -reach, v1 = sv > 0 ? reach : -reach + (stone ? 6 : 3.5);
      q.worldFromSD(s, sv * (reach - 2), P);
      const gy = Math.min(ground.height(P.x, P.z), f.py) - 2;
      boxInFrame(b, { x: o.x, y: gy, z: o.z }, [-deckW / 2 - 0.5, deckW / 2 + 0.5], [v0, v1], [0, deckY - gy], ux, uz, vx, vz, stone ? STONE_D : STEEL);
      block(P.x, P.z, ux, uz, deckW + 6, 8);
    }
    // Banner on the footbridges (white with a dark stripe both faces).
    if (!stone) for (const su of [-1, 1]) boxInFrame(b, o, [su * (deckW / 2 + 0.02) - 0.01, su * (deckW / 2 + 0.02) + 0.01], [-reach * 0.6, reach * 0.6], [deckY - 1.4, deckY], ux, uz, vx, vz, WHITE);
    addStatic(b, `eifel.bridge.${br.tag}.${br.off}`);
    if (!stone) for (let k = 0; k < 14; k++) {
      const v = (rand() * 2 - 1) * (reach - 5);
      people.push({ x: o.x + vx * v + ux * (rand() - 0.5) * (deckW - 1), y: deckY + 0.5, z: o.z + vz * v + uz * (rand() - 0.5) * (deckW - 1), rot: Math.atan2(-ux, uz) + (rand() > 0.5 ? 0 : Math.PI) });
    }
  }

  // ---- kilometre boards every 1,000 m (1 draw): post + panel facing the oncoming cars, right side ----
  {
    const atlas = kmAtlas();
    const kmMat = envMaterial(c.sh, { name: 'eifel.kmBoards', family: 'opaque', vertexColor: true, map: atlas, normalMap: c.tex.concrete.normal, roughness: 0.6, wet: 0.4 });
    mats.push(kmMat);
    const pos: number[] = [], nor: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
    const quad = (p: number[][], n: number[], uvs: number[][], cc: Color): void => {
      const b0 = pos.length / 3;
      p.forEach((v, k) => { pos.push(...v); nor.push(...n); col.push(cc.r, cc.g, cc.b); uv.push(...uvs[k]!); });
      idx.push(b0, b0 + 1, b0 + 2, b0 + 1, b0 + 3, b0 + 2);
    };
    const nKm = Math.floor(data.length / 1000);
    for (let k = 1; k <= Math.min(24, nKm); k++) {
      const s = q.wrapS(k * 1000);
      q.frameAt(s, f);
      const side: 1 | -1 = -1;
      q.worldFromSD(s, side * (wallAt(s, side) + 1.2), P);
      const gy = ground.height(P.x, P.z);
      // Panel faces backward along the road (toward the approaching cars); u across the road.
      const nx = -f.tx, nz = -f.tz, ax = f.lx, az = f.lz;
      const cu = ((k - 1) % 4) * 0.25, cv = 1 - Math.floor((k - 1) / 4) / 6;
      const y0 = gy + 1.6, y1 = gy + 3.0, hw = 0.7;
      const pt = (a: number, y: number): number[] => [P.x + ax * a + nx * 0.05, y, P.z + az * a + nz * 0.05];
      quad([pt(hw, y0), pt(-hw, y0), pt(hw, y1), pt(-hw, y1)], [nx, 0, nz], [[cu, cv - 1 / 6], [cu + 0.25, cv - 1 / 6], [cu, cv], [cu + 0.25, cv]], WHITE);
      // Back face and two posts (white atlas corner).
      const ptb = (a: number, y: number): number[] => [P.x + ax * a - nx * 0.05, y, P.z + az * a - nz * 0.05];
      quad([ptb(-hw, y0), ptb(hw, y0), ptb(-hw, y1), ptb(hw, y1)], [-nx, 0, -nz], [[0.01, 0.99], [0.02, 0.99], [0.01, 0.995], [0.02, 0.995]], new Color(0.6, 0.6, 0.6));
      for (const a of [-hw + 0.1, hw - 0.1]) {
        for (const [fx, fz] of [[nx, nz], [ax, az]] as const) {
          const r = 0.05;
          quad([[P.x + ax * a - fz * r + fx * 0.06, gy, P.z + az * a + fx * r + fz * 0.06], [P.x + ax * a + fz * r + fx * 0.06, gy, P.z + az * a - fx * r + fz * 0.06],
            [P.x + ax * a - fz * r + fx * 0.06, y0, P.z + az * a + fx * r + fz * 0.06], [P.x + ax * a + fz * r + fx * 0.06, y0, P.z + az * a - fx * r + fz * 0.06]],
          [fx, 0, fz], [[0.01, 0.99], [0.02, 0.99], [0.01, 0.995], [0.02, 0.995]], new Color(0.35, 0.36, 0.38));
        }
      }
    }
    const b = new SBuf();
    b.pos = pos; b.nor = nor; b.col = col; b.uv = uv; b.idx = idx;
    const g = b.geometry();
    geos.push(g);
    const m = new Mesh(g, kmMat);
    m.name = 'eifel.kmBoards';
    m.matrixAutoUpdate = false;
    group.add(m);
    tris += idx.length / 3;
    disposers.push(() => atlas.dispose());
  }

  // ---- the bowl: concrete slabs over the banked asphalt (1 draw, polygon offset) ----
  {
    const bowl = EIFEL.CORNERS.find((x) => x.bankDeg > 10)!;
    const s0 = q.wrapS((bowl.entry - 25) * ex.sScale), len = q.wrapS((bowl.exit - bowl.entry + 50) * ex.sScale);
    const b = new SBuf();
    const slab = new Color(0.86, 0.85, 0.82), joint = new Color(0.55, 0.54, 0.52);
    for (let u = 0; u < len; u += 2) {
      // 4 m slabs: 3.75 m of concrete, then a 0.25 m dark expansion joint.
      const joint4 = Math.floor(u / 2) % 2 === 1;
      const s = q.wrapS(s0 + u), e = q.wrapS(s0 + Math.min(len, u + (joint4 ? 1.75 : 2)));
      q.frameAt(s, f);
      const hl = f.halfWidthL, hr = f.halfWidthR;
      const nn = 4;
      for (let k = 0; k < nn; k++) {
        const da = -hr + ((hl + hr) * k) / nn, db = -hr + ((hl + hr) * (k + 1)) / nn;
        const w = (sx: number, d: number): number[] => { q.worldFromSD(sx, d, P); return [P.x, P.y + 0.025, P.z]; };
        b.quad([w(s, da), w(e, da), w(s, db), w(e, db)], [0, 1, 0], slab);
        if (joint4) {
          const e2 = q.wrapS(s0 + Math.min(len, u + 2));
          b.quad([w(e, da), w(e2, da), w(e, db), w(e2, db)], [0, 1, 0], joint);
        }
      }
    }
    const g = b.geometry();
    geos.push(g);
    const bm = envMaterial(c.sh, { name: 'eifel.bowl', family: 'opaque', vertexColor: true, map: c.tex.concrete.map, normalMap: c.tex.concrete.normal, roughness: 0.85, wet: 0.7 });
    bm.polygonOffset = true;
    bm.polygonOffsetFactor = -2;
    bm.polygonOffsetUnits = -2;
    mats.push(bm);
    const m = new Mesh(g, bm);
    m.name = 'eifel.bowl';
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
    tris += g.index!.count / 3;
  }

  // ---- instanced: village houses, camp tents, camper vans, spectators (1 draw each) ----
  const m4 = new Matrix4(), qt = new Quaternion(), up = new Vector3(0, 1, 0), pv = new Vector3(), sv = new Vector3(), tint = new Color();
  const inst = (geo: SBuf, name: string, list: { x: number; y: number; z: number; rot: number; sx: number; sy: number; sz: number; col: Color }[]): void => {
    if (list.length === 0) return;
    const g = geo.geometry();
    geos.push(g);
    const im = new InstancedMesh(g, instMat, list.length);
    im.name = name;
    list.forEach((p, k) => {
      qt.setFromAxisAngle(up, p.rot);
      im.setMatrixAt(k, m4.compose(pv.set(p.x, p.y, p.z), qt, sv.set(p.sx, p.sy, p.sz)));
      im.setColorAt(k, p.col);
    });
    im.castShadow = c.quality.id !== 'low';
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
    tris += (list.length * g.index!.count) / 3;
  };
  const free = (x: number, z: number, pad: number): boolean => !c.blockers.some((b) => {
    const dx = x - b.cx, dz = z - b.cz;
    return Math.abs(dx * b.ux + dz * b.uz) < b.hu + pad && Math.abs(dx * b.uz - dz * b.ux) < b.hv + pad;
  });

  // Village: houses on both sides of the road through it, facing the street, plus a church tower.
  const houses: Parameters<typeof inst>[2] = [];
  {
    const sv0 = S(SITES.village.tag, SITES.village.off - 260), span = 520;
    for (let u = 0; u < span; u += 16 + rand() * 8) {
      const s = q.wrapS(sv0 + u);
      q.frameAt(s, f);
      for (const side of [1, -1] as const) {
        if (rand() < 0.15) continue;
        for (let row = 0; row < 3; row++) {
          const d = side * (wallAt(s, side) + 8 + row * 22 + rand() * 6);
          q.worldFromSD(s, d, P);
          const y = ground.height(P.x, P.z, info);
          if (info.covered) continue;
          const w = 9 + rand() * 4, dd = 8 + rand() * 3;
          if (!free(P.x, P.z, 4) || houses.some((h) => Math.hypot(h.x - P.x, h.z - P.z) < 13)) continue;
          const rot = Math.atan2(-f.tz, f.tx) + (rand() - 0.5) * 0.15;
          houses.push({ x: P.x, y: y - 0.3, z: P.z, rot, sx: w, sy: 10 + rand() * 3, sz: dd, col: tint.setRGB(0.92 + rand() * 0.1, 0.9 + rand() * 0.1, 0.86 + rand() * 0.1).clone() });
          block(P.x, P.z, Math.cos(rot), -Math.sin(rot), w / 2 + 3, dd / 2 + 3);
        }
      }
    }
    // Church: nave + tower beside the main street (statics).
    const s = S(SITES.village.tag, SITES.village.off + 40);
    q.frameAt(s, f);
    q.worldFromSD(s, wallAt(s, 1) + 30, P);
    const gy = ground.height(P.x, P.z);
    const b = new SBuf();
    const o = { x: P.x, y: gy - 1, z: P.z };
    boxInFrame(b, o, [-14, 10], [-6, 6], [0, 12], f.tx, f.tz, f.lx, f.lz, new Color(0.84, 0.82, 0.76));
    boxInFrame(b, o, [10, 16], [-3, 3], [0, 30], f.tx, f.tz, f.lx, f.lz, new Color(0.84, 0.82, 0.76));
    tower(b, { x: o.x + f.tx * 13, y: o.y + 30, z: o.z + f.tz * 13 }, 3.6, 0, 0.1, 11, WHITE, SLATE);
    for (const sgn of [-1, 1]) {
      const p0 = (u: number, v: number, y: number): number[] => [o.x + f.tx * u + f.lx * v, o.y + y, o.z + f.tz * u + f.lz * v];
      b.quad([p0(-15, sgn * 7, 11.5), p0(10, sgn * 7, 11.5), p0(-15, 0, 19), p0(10, 0, 19)], [f.lx * sgn * 0.7, 0.7, f.lz * sgn * 0.7], SLATE);
    }
    addStatic(b, 'eifel.church');
    block(P.x, P.z, f.tx, f.tz, 20, 10);
  }
  inst(houseGeometry(), 'eifel.houses', houses);

  // Camps: tents, vans and spectators in the clearings; spectators along the fences nearby.
  const tents: Parameters<typeof inst>[2] = [], vans: Parameters<typeof inst>[2] = [];
  const tentCols = [new Color(0.75, 0.12, 0.1), new Color(0.12, 0.35, 0.7), new Color(0.95, 0.75, 0.12), new Color(0.2, 0.5, 0.25), new Color(0.9, 0.9, 0.88), new Color(0.95, 0.45, 0.1)];
  for (const cp of SITES.camps) {
    const [cx, cz] = W(siteXZ(cp.tag, cp.off, cp.d));
    for (let k = 0; k < 26; k++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * cp.r * 0.8;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const y = ground.height(x, z, info);
      if (info.covered || info.nearTrack > 0.4 || !free(x, z, 1.5)) continue;
      const rot = rand() * Math.PI;
      if (k % 3 === 2) vans.push({ x, y, z, rot, sx: 5.5 + rand() * 1.5, sy: 2.6, sz: 2.2, col: tint.setHSL(rand(), 0.25, 0.35 + rand() * 0.45).clone() });
      else tents.push({ x, y, z, rot, sx: 2.5 + rand() * 2, sy: 1.4 + rand() * 0.6, sz: 2 + rand(), col: tentCols[Math.floor(rand() * tentCols.length)]!.clone() });
      for (let p = 0; p < 2; p++) people.push({ x: x + (rand() - 0.5) * 6, y: ground.height(x, z), z: z + (rand() - 0.5) * 6, rot: rand() * 6.28 });
      block(x, z, Math.cos(rot), -Math.sin(rot), 3.5, 3);
    }
    // A line of fans behind the barrier opposite the camp.
    const s = S(cp.tag, cp.off);
    const side: 1 | -1 = cp.d > 0 ? 1 : -1;
    for (let u = -40; u <= 40; u += 1.6) {
      const ss = q.wrapS(s + u);
      q.frameAt(ss, f);
      q.worldFromSD(ss, side * (wallAt(ss, side) + 2.2 + rand() * 1.5), P);
      if (rand() < 0.3) continue;
      people.push({ x: P.x, y: ground.height(P.x, P.z), z: P.z, rot: Math.atan2(side * f.lx, side * f.lz) + (rand() - 0.5) * 0.6 });
    }
  }
  inst(tentGeometry(), 'eifel.tents', tents);
  inst(vanGeometry(), 'eifel.vans', vans);
  inst(personGeometry(), 'eifel.spectators', people.map((p) => ({ ...p, sx: 1, sy: 0.9 + rand() * 0.2, sz: 1, col: tint.setHSL(rand(), 0.6, 0.35 + rand() * 0.3).clone() })));

  return {
    root: group,
    triangles: tris,
    setQuality(qp) {
      group.traverse((o) => { if ((o as InstancedMesh).isInstancedMesh || o.name === 'eifel.castle') o.castShadow = qp.id !== 'low'; });
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const d of disposers) d();
      group.removeFromParent();
    },
  };
}
