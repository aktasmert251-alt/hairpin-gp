// Cappadocia Valley extras (docs/design/tracks-cappadocia.md §7–§8): fairy chimneys (tall tuff cones with dark basalt
// caps) in clusters, rose tuff faces close behind the walls in the rock chicane and the gorge hairpin, a rock castle
// honeycombed with dwellings on its pinnacle, carved cave windows and doors on the valley walls and chimneys (lit at
// night), the stone village round T12–T13 with its mosque and minaret, vineyards, apricot orchards, poplar-lined dusty
// tracks, a grandstand carved into the slope at T1 and hot-air balloons drifting over the valley (day / sunset).
// The props come from the cappadociaProps builders; their static stone / rock geometry and every carved opening share
// the `rock` and `lamps` buffers here. Empty group on every other track. Draws: rock 1, lamps (all openings) 1,
// chimneys 1, houses 1, vines 1, apricots 1, poplars 1, balloons 1. Env families only (opaque, inst).

import { Color, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3, type PerspectiveCamera } from 'three';
import type { RenderFrame } from '../../contracts/render';
import type { TrackFrame } from '../../contracts/track';
import { GORGES, SITES, tagS } from '../authoring/cappadocia-ctrl';
import { envMaterial, EnvMode } from '../materials/shared';
import { makeRand } from '../mesh/textures';
import type { EnvContext, EnvPart } from './environment';
import {
  createBalloons, createCaveDwellings, createFairyChimneys, createOrchards, createStoneVillage, lampK, opening,
  type ChimneySite, type FieldRect, type HouseSite, type PropPart, type PropsSink,
} from './cappadociaProps';
import { boxInFrame, SBuf } from './stands';

type V3 = number[];
const TAU = Math.PI * 2;





/** Lombardy-style poplar (≈ 18 m): a slim spindle of stacked octagonal rings. */
function poplarGeometry(): SBuf {
  const b = new SBuf();
  const leaf = new Color(0.17, 0.26, 0.08), bark = new Color(0.3, 0.27, 0.22);
  boxInFrame(b, { x: 0, y: 0, z: 0 }, [-0.18, 0.18], [-0.18, 0.18], [-0.3, 2.5], 1, 0, 0, 1, bark);
  const prof: [number, number][] = [[1.8, 0.4], [3.5, 1.3], [7, 1.75], [11, 1.6], [14.5, 1.1], [17, 0.5], [18.5, 0]];
  for (let k = 0; k + 1 < prof.length; k++) {
    const [h0, r0] = prof[k]!, [h1, r1] = prof[k + 1]!;
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * TAU, a1 = ((i + 1) / 8) * TAU, am = (a0 + a1) / 2;
      const w = (r: number, a: number, h: number): V3 => [Math.cos(a) * r, h, Math.sin(a) * r];
      b.quad([w(r0, a0, h0), w(r0, a1, h0), w(r1, a0, h1), w(r1, a1, h1)], [Math.cos(am), 0.2, Math.sin(am)], leaf);
    }
  }
  return b;
}


interface Inst { x: number; y: number; z: number; sx: number; sy: number; sz: number; yaw: number; col: Color }

export function createCappadocia(c: EnvContext): EnvPart & { triangles: number } {
  const group = new Group();
  group.name = 'cappadocia';
  if (c.ex.authoring.id !== 'cappadocia') return { root: group, triangles: 0, dispose: () => group.removeFromParent() };
  const { data, query: q } = c.track;
  const ex = c.ex;
  const ground = c.ground!;
  const rand = makeRand(4711);
  const f: TrackFrame = { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 };
  const P = { x: 0, y: 0, z: 0 };
  const info = { s: 0, d: 0, covered: false, nearTrack: 0 };
  const S = (tag: string, off = 0): number => q.wrapS(tagS(tag, off) * ex.sScale);
  const wallAt = (s: number, side: 1 | -1): number => (side === 1 ? data.wallL : data.wallR)[Math.round(q.wrapS(s)) % data.count]!;
  const xzAt = (s: number, d: number): [number, number] => {
    q.worldFromSD(q.wrapS(s), d, P);
    return [P.x, P.z];
  };
  const pit = data.pit;
  /** Clear of the circuit (barrier + `m` m) and of the pit lane / paddock (≈ 160 m behind the garages). */
  const clear = (x: number, z: number, m: number): boolean => {
    ground.height(x, z, info);
    if (info.covered || info.nearTrack > 0.02) return false;
    const k = Math.round(info.s) % data.count;
    const wall = info.d >= 0 ? data.wallL[k]! : data.wallR[k]!;
    if (Math.abs(info.d) < wall + m) return false;
    for (let j = 0; j < pit.count; j += 8) {
      const dx = x - pit.x[j]!, dz = z - pit.z[j]!;
      if (dx * dx + dz * dz < 170 * 170) return false;
    }
    return true;
  };
  // Height of the drawn terrain: the 10 m inner grid near the circuit, the 50 m outer grid beyond (props on the steep
  // valley walls must sit on the mesh, not on the finer DEM).
  let ix0 = Infinity, ix1 = -Infinity, iz0 = Infinity, iz1 = -Infinity;
  for (let i = 0; i < data.count; i += 5) { ix0 = Math.min(ix0, data.x[i]!); ix1 = Math.max(ix1, data.x[i]!); iz0 = Math.min(iz0, data.z[i]!); iz1 = Math.max(iz1, data.z[i]!); }
  ix0 = Math.floor((ix0 - 160) / 50) * 50; ix1 = Math.ceil((ix1 + 160) / 50) * 50; iz0 = Math.floor((iz0 - 160) / 50) * 50; iz1 = Math.ceil((iz1 + 160) / 50) * 50;
  const surfY = (x: number, z: number): number => {
    const inner = x > ix0 && x < ix1 && z > iz0 && z < iz1;
    const G = inner ? 10 : 50;
    const h = (a: number, b: number): number => (inner ? ground.height(a, b) : ground.dem(a, b));
    const x0 = Math.floor(x / G) * G, z0 = Math.floor(z / G) * G, fx = (x - x0) / G, fz = (z - z0) / G;
    return (h(x0, z0) * (1 - fx) + h(x0 + G, z0) * fx) * (1 - fz) + (h(x0, z0 + G) * (1 - fx) + h(x0 + G, z0 + G) * fx) * fz;
  };
  const rock = new SBuf();
  const lamps = new SBuf();
  const sink: PropsSink = { rock, lamps };
  const penv = { sh: c.sh, tex: c.tex, quality: c.quality, ground: { height: surfY } };
  const parts: PropPart[] = [];
  let tris = 0;
  const chimneySites: ChimneySite[] = [];
  const warm = new Color(1.0, 0.62, 0.28), dark = new Color(0, 0, 0);
  const TINTS = [new Color(1, 0.96, 0.9), new Color(1, 0.86, 0.8), new Color(0.98, 0.9, 0.76), new Color(0.92, 0.84, 0.8)];
  /** Window instance on a surface at (x, y, z) facing horizontal direction (nx, nz); lit at night with probability p. */
  const addWindow = (x: number, y: number, z: number, nx: number, nz: number, w: number, h: number, p: number): void => {
    opening(lamps, [x + nx * 0.02, y - h / 2, z + nz * 0.02], nx, nz, w, h, rand() < p ? warm.clone().multiplyScalar(0.6 + 0.6 * rand()) : dark);
  };
  /** Fairy chimney of height h at (x, z) (twins / triples, caves and strata tints come from the builder). */
  const addChimney = (x: number, z: number, h: number, wide: number, dwell: boolean, cluster: 1 | 2 | 3 = 1): void => {
    chimneySites.push({ x, z, h, wide, caves: dwell, cluster, tint: TINTS[Math.floor(rand() * TINTS.length)]!, seed: Math.floor(rand() * 1e6) });
  };

  // ---- fairy-chimney clusters (SITES), plus a scatter on the lower valley slopes ----
  for (const cl of SITES.chimneys) {
    const [cx, cz] = xzAt(S(cl.tag, cl.off), cl.d);
    for (let k = 0, tries = 0; k < cl.n && tries < cl.n * 12; tries++) {
      const a = rand() * TAU, r = Math.sqrt(rand()) * cl.r;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!clear(x, z, 6)) continue;
      if (chimneySites.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < 64)) continue;
      // Tall ones in the middle of a cluster, twins and triples close together.
      const u = rand();
      addChimney(x, z, 9 + 30 * rand() * (1 - (0.6 * r) / cl.r), 0.8 + 0.5 * rand(), rand() < 0.45, u < 0.12 ? 3 : u < 0.3 ? 2 : 1);
      k++;
    }
  }
  for (let k = 0, tries = 0; k < 160 && tries < 3000; tries++) {
    const s = rand() * data.length, side = rand() < 0.5 ? 1 : -1;
    const [x, z] = xzAt(s, side * (wallAt(s, side as 1 | -1) + 60 + rand() * 380));
    if (!clear(x, z, 25)) continue;
    addChimney(x, z, 8 + 22 * rand(), 0.85 + 0.4 * rand(), rand() < 0.3);
    k++;
  }

  // ---- the rock castle: a honeycombed tuff crown on the pinnacle (builder), a ring of chimneys and windows below ----
  {
    const [cx, cz] = xzAt(S(SITES.castle.tag, SITES.castle.off), SITES.castle.d);
    const top = surfY(cx, cz);
    // The crown rises out of the pinnacle: its base 30 m down the hill so it never floats on the summit.
    parts.push(createCaveDwellings(penv, [], { x: cx, z: cz, r: 42, h: 78, y0: top - 30 }, sink));
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU + rand() * 0.3, r = 58 + rand() * 18;
      addChimney(cx + Math.cos(a) * r, cz + Math.sin(a) * r, 14 + 16 * rand(), 1.1, rand() < 0.5);
    }
    for (let ring = 0; ring < 6; ring++) {
      const rr = 62 + ring * 14;
      for (let k = 0; k < 16 + ring * 3; k++) {
        const a = (k / (16 + ring * 3)) * TAU + ring * 0.37 + 0.2 * rand();
        const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
        const y = surfY(x, z);
        if (top - y < 12 || rand() < 0.45) continue;
        addWindow(x - Math.cos(a) * 1.5, y + 1.2, z - Math.sin(a) * 1.5, Math.cos(a), Math.sin(a), 1 + rand(), 1.4 + rand() * 0.8, 0.55);
      }
    }
  }

  // ---- carved dwellings on the valley walls: window / door clusters on steep ground 120–700 m from the circuit ----
  for (let k = 0, tries = 0; k < 45 && tries < 6000; tries++) {
    const s = rand() * data.length, side = rand() < 0.5 ? 1 : -1;
    const [x, z] = xzAt(s, side * (wallAt(s, side as 1 | -1) + 120 + rand() * 580));
    const y = surfY(x, z);
    const gx = (surfY(x + 6, z) - surfY(x - 6, z)) / 12, gz = (surfY(x, z + 6) - surfY(x, z - 6)) / 12;
    const gl = Math.hypot(gx, gz);
    if (gl < 0.45 || !clear(x, z, 40)) continue;
    const nx = -gx / gl, nz = -gz / gl;
    const ux = -nz, uz = nx;
    const n = 8 + Math.floor(rand() * 10);
    for (let m = 0; m < n; m++) {
      const u = (rand() - 0.5) * 22, v = rand() * 10;
      // On the face: step back uphill until the window sits 0.3 m proud of the drawn surface.
      let bx = x + ux * u, bz = z + uz * u;
      const wy = surfY(bx, bz) + v + 1.2;
      for (let it = 0; it < 30 && surfY(bx - nx, bz - nz) < wy; it++) { bx -= nx; bz -= nz; }
      addWindow(bx, wy, bz, nx, nz, m === 0 ? 1.3 : 0.9, m === 0 ? 2.2 : 1.2, 0.5);
    }
    k++;
  }

  // ---- rock faces close behind the walls in the narrow sections (rock chicane, gorge hairpin) ----
  const STEP = 3;
  const strata = (y: number, base: Color): Color => {
    const t = Math.floor(y / 3.2) % 3;
    return base.clone().multiplyScalar(t === 0 ? 1 : t === 1 ? 0.9 : 1.08);
  };
  const rose = new Color(0.82, 0.58, 0.48), cream = new Color(0.88, 0.76, 0.6);
  for (const g of GORGES) {
    if (g.kind !== 'rock') continue;
    const s0 = S(g.from[0], g.from[1]) - 30, s1 = S(g.to[0], g.to[1]) + 30;
    for (const side of [1, -1] as const) {
      const hgt = (s: number): number => 9 + 9 * Math.sin(s * 0.11 + side) * Math.sin(s * 0.037) + 6 * Math.sin(s * 0.53 + side * 2) ** 2;
      for (let s = s0; s < s1; s += STEP) {
        const e = s + STEP;
        const da = side * (wallAt(s, side) + 1.2 + 0.8 * Math.sin(s * 0.7)), de = side * (wallAt(e, side) + 1.2 + 0.8 * Math.sin(e * 0.7));
        q.frameAt(q.wrapS(s), f);
        const n = [-side * f.lx, 0, -side * f.lz];
        q.worldFromSD(q.wrapS(s), da, P);
        const ax = P.x, ay = P.y - 1, az = P.z;
        q.worldFromSD(q.wrapS(e), de, P);
        const bx = P.x, by = P.y - 1, bz = P.z;
        const ha = hgt(s), he = hgt(e);
        const base = Math.floor(s / 21) % 2 ? rose : cream;
        // The face in three bands (strata colours), then the ledge on top running back 7 m.
        // Weathered profile: a bulge low down, the face leaning back towards the top (metres away from the road).
        const lean = (t: number, h: number, s2: number): number => h * (0.05 * Math.sin(t * 3.1 + s2 * 0.2) + 0.22 * t * t);
        const ox = side * f.lx, oz = side * f.lz;
        for (let k = 0; k < 4; k++) {
          const t0 = k / 4, t1 = (k + 1) / 4;
          const la0 = lean(t0, ha, s), la1 = lean(t1, ha, s), le0 = lean(t0, he, e), le1 = lean(t1, he, e);
          const quad = [[ax + ox * la0, ay + ha * t0, az + oz * la0], [bx + ox * le0, by + he * t0, bz + oz * le0],
            [ax + ox * la1, ay + ha * t1, az + oz * la1], [bx + ox * le1, by + he * t1, bz + oz * le1]];
          const nn = [n[0]! * 0.95, 0.3 * (0.22 * (t0 + t1)), n[2]! * 0.95];
          rock.quad(side === 1 ? [quad[1]!, quad[0]!, quad[3]!, quad[2]!] : quad, nn, strata(ay + ha * t0, base));
        }
        const ta = lean(1, ha, s), te = lean(1, he, e);
        const tax = ax + ox * ta, taz = az + oz * ta, tbx = bx + ox * te, tbz = bz + oz * te;
        const bkx = ox * 7, bkz = oz * 7;
        rock.quad([[tax, ay + ha, taz], [tbx, by + he, tbz], [tax + bkx, ay + ha + 2, taz + bkz], [tbx + bkx, by + he + 2, tbz + bkz]], [0, 1, 0], base.clone().multiplyScalar(0.92));
        rock.quad([[tax + bkx, ay - 2, taz + bkz], [tbx + bkx, by - 2, tbz + bkz], [tax + bkx, ay + ha + 2, taz + bkz], [tbx + bkx, by + he + 2, tbz + bkz]], [side * f.lx, 0, side * f.lz], base);
        // Cave windows in the face now and then (lit at night).
        if (rand() < 0.12) addWindow((ax + bx) / 2, ay + 2.5 + rand() * (ha - 5), (az + bz) / 2, n[0]!, n[2]!, 0.9, 1.4, 0.5);
      }
    }
  }

  // ---- braking marker boards (3 / 2 / 1 stripes at 150 / 100 / 50 m) before the slow corners after a fast run, and
  // yellow-black sausage kerbs behind the exit kerbs where the authoring marks sausages (the rock chicane) ----
  {
    const cs = [...ex.authoring.CORNERS].sort((p0, p1) => p0.entry - p1.entry);
    const boardW = new Color(0.95, 0.95, 0.93), stripe = new Color(0.05, 0.05, 0.06), postC = new Color(0.55, 0.55, 0.57);
    const yellow = new Color(0.95, 0.75, 0.05), black = new Color(0.06, 0.06, 0.06);
    cs.forEach((cn, k) => {
      const prev = cs[(k - 1 + cs.length) % cs.length]!;
      const gap = ((cn.entry - prev.exit) % ex.authoring.OSM_LENGTH + ex.authoring.OSM_LENGTH) % ex.authoring.OSM_LENGTH;
      const side = (cn.dir === 'L' ? -1 : 1) as 1 | -1; // outside of the corner
      if (cn.vApex <= 90 && gap > 180) {
        for (const [dist, n] of [[150, 3], [100, 2], [50, 1]] as const) {
          const sb = cn.entry * ex.sScale - dist;
          const d = side * (wallAt(sb, side) + 1.6);
          q.frameAt(q.wrapS(sb), f);
          q.worldFromSD(q.wrapS(sb), d, P);
          const gy = surfY(P.x, P.z);
          const tx = f.tx, tz = f.tz;
          boxInFrame(rock, { x: P.x, y: gy - 0.3, z: P.z }, [-0.06, 0.06], [-0.06, 0.06], [0, 1.4], tx, tz, f.lx, f.lz, postC);
          // Board faces the oncoming cars (−tangent); n diagonal stripes.
          const bx = P.x - tx * 0.08, bz = P.z - tz * 0.08, y0 = gy + 1.1, wx2 = side * f.lx * 0.7, wz2 = side * f.lz * 0.7;
          rock.quad([[bx - wx2, y0, bz - wz2], [bx + wx2, y0, bz + wz2], [bx - wx2, y0 + 1.6, bz - wz2], [bx + wx2, y0 + 1.6, bz + wz2]], [-tx, 0, -tz], boardW);
          for (let m = 0; m < n; m++) {
            const yy = y0 + 0.25 + m * 0.45;
            rock.quad([[bx - wx2 * 0.8 - tx * 0.01, yy, bz - wz2 * 0.8 - tz * 0.01], [bx + wx2 * 0.8 - tx * 0.01, yy + 0.18, bz + wz2 * 0.8 - tz * 0.01],
              [bx - wx2 * 0.8 - tx * 0.01, yy + 0.2, bz - wz2 * 0.8 - tz * 0.01], [bx + wx2 * 0.8 - tx * 0.01, yy + 0.38, bz + wz2 * 0.8 - tz * 0.01]], [-tx, 0, -tz], stripe);
          }
        }
      }
      if (cn.sausage) {
        const ap = cn.apexes[cn.apexes.length - 1]! * ex.sScale, ex1 = cn.exit * ex.sScale;
        for (let sb = ap; sb < ex1 + 10; sb += 2.2) {
          q.frameAt(q.wrapS(sb), f);
          const hw = side === 1 ? data.halfWidthL[Math.round(q.wrapS(sb)) % data.count]! : data.halfWidthR[Math.round(q.wrapS(sb)) % data.count]!;
          q.worldFromSD(q.wrapS(sb), side * (hw + 2.4), P);
          boxInFrame(rock, { x: P.x, y: P.y - 0.05, z: P.z }, [-0.8, 0.8], [-0.22, 0.22], [0, 0.28], f.tx, f.tz, f.lx, f.lz, Math.floor(sb / 2.2) % 2 ? yellow : black);
        }
      }
    });
  }

  // ---- grandstand carved into the slope outside T1: rock mass behind and round the stand ----
  for (const st of ex.authoring.STANDS ?? []) {
    if (st.kind !== 'grandstand' || st.side !== 1) continue;
    const a = st.from * ex.sScale, b = st.to * ex.sScale;
    for (let s = a - 24; s < b + 24; s += 4) {
      const e = s + 4;
      const inside = s >= a && e <= b;
      const d0 = wallAt(s, 1) + st.setback + (inside ? st.depth : 0), d1 = wallAt(s, 1) + st.setback + st.depth + 26;
      q.frameAt(q.wrapS(s), f);
      const pa = xzAt(s, d0), pb = xzAt(e, d0), pc = xzAt(s, d1), pd = xzAt(e, d1);
      const y0 = q.worldFromSD(q.wrapS(s), 0, P).y - 1;
      const H = inside ? 20 : 14 + 6 * Math.min(1, Math.min(s - (a - 24), b + 24 - s) / 24);
      const col = Math.floor(s / 12) % 2 ? rose : cream;
      rock.quad([[pa[0], y0, pa[1]], [pb[0], y0, pb[1]], [pa[0], y0 + H, pa[1]], [pb[0], y0 + H, pb[1]]], [-f.lx, 0, -f.lz], strata(y0 + H * 0.5, col));
      rock.quad([[pa[0], y0 + H, pa[1]], [pb[0], y0 + H, pb[1]], [pc[0], y0 + H + 6, pc[1]], [pd[0], y0 + H + 6, pd[1]]], [0, 1, 0], col);
    }
  }

  // ---- the village: stone houses along the street and round it (façade program: lit windows at night) ----
  const houses: HouseSite[] = [];
  const tryHouse = (x: number, z: number, yaw: number, w: number, d: number, h: number): void => {
    if (!clear(x, z, 1 + Math.max(w, d) / 2)) return;
    if (houses.some((o) => Math.hypot(o.x - x, o.z - z) < (Math.max(o.w, o.d) + Math.max(w, d)) / 2 + 1.5)) return;
    houses.push({ x, z, w, d, h, yaw });
  };
  {
    const vs0 = S('village', -60), vs1 = S('back', 120);
    for (let s = vs0; s < vs1; s += 11) {
      q.frameAt(q.wrapS(s), f);
      for (const side of [1, -1] as const) {
        const w = 8 + rand() * 5, dd = 7 + rand() * 4;
        const [x, z] = xzAt(s, side * (wallAt(s, side) + 1.5 + dd / 2));
        tryHouse(x, z, Math.atan2(-f.tz, f.tx), w, dd, 4 + rand() * 4.5);
      }
    }
    const [vx, vz] = xzAt(S(SITES.village.tag, SITES.village.off), 0);
    for (let k = 0; k < 400 && houses.length < 110; k++) {
      const a = rand() * TAU, r = 25 + Math.sqrt(rand()) * SITES.village.r;
      const w = 7 + rand() * 6, d = 6 + rand() * 5;
      tryHouse(vx + Math.cos(a) * r, vz + Math.sin(a) * r, Math.round(rand() * 4) * (Math.PI / 2) + 0.3, w, d, 3.5 + rand() * 4);
    }
  }
  // The mosque (prayer hall, dome, minaret with its lamp ring) and the village field walls come with the houses.
  {
    const [mx, mz] = xzAt(S(SITES.mosque.tag, SITES.mosque.off), SITES.mosque.d);
    const [vx, vz] = xzAt(S(SITES.village.tag, SITES.village.off), 0);
    const walls: [number, number][][] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + 0.4, r0 = SITES.village.r + 30;
      const p0: [number, number] = [vx + Math.cos(a) * r0, vz + Math.sin(a) * r0], p1: [number, number] = [vx + Math.cos(a + 0.5) * r0, vz + Math.sin(a + 0.5) * r0];
      if (clear(p0[0], p0[1], 8) && clear(p1[0], p1[1], 8) && clear((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, 8)) walls.push([p0, p1]);
    }
    parts.push(createStoneVillage(penv, houses, { x: mx, z: mz, yaw: 0.3 }, walls, sink));
    c.blockers.push({ cx: mx, cz: mz, ux: 1, uz: 0, hu: 18, hv: 18 });
  }

  // ---- vineyards, apricot orchards, poplar-lined dusty tracks ----
  const poplars: Inst[] = [];
  const vineFields: FieldRect[] = [], orchardFields: FieldRect[] = [];
  const white = new Color(1, 1, 1);
  const dust = new Color(0.62, 0.52, 0.4);
  const roadQuad = (x0: number, z0: number, x1: number, z1: number, hw: number): void => {
    const l = Math.hypot(x1 - x0, z1 - z0) || 1, nx = -(z1 - z0) / l * hw, nz = (x1 - x0) / l * hw;
    const y = (x: number, z: number): number => ground.dem(x, z) + 0.12;
    rock.quad([[x0 - nx, y(x0 - nx, z0 - nz), z0 - nz], [x1 - nx, y(x1 - nx, z1 - nz), z1 - nz], [x0 + nx, y(x0 + nx, z0 + nz), z0 + nz], [x1 + nx, y(x1 + nx, z1 + nz), z1 + nz]], [0, 1, 0], dust);
  };
  for (const v of SITES.vineyards) {
    const [cx, cz] = xzAt(S(v.tag, v.off), v.d);
    const ra = (v.rot * Math.PI) / 180, ux = Math.cos(ra), uz = Math.sin(ra);
    vineFields.push({ x: cx, z: cz, w: 2 * v.a, d: 2 * v.b, yaw: -ra });
    // A dusty track along one edge, lined with poplars.
    const e0x = cx - ux * v.a - uz * (v.b + 6), e0z = cz - uz * v.a + ux * (v.b + 6), e1x = cx + ux * v.a - uz * (v.b + 6), e1z = cz + uz * v.a + ux * (v.b + 6);
    for (let k = 0; k < 10; k++) {
      const t0 = k / 10, t1 = (k + 1) / 10;
      const ax = e0x + (e1x - e0x) * t0, az = e0z + (e1z - e0z) * t0, bx = e0x + (e1x - e0x) * t1, bz = e0z + (e1z - e0z) * t1;
      if (clear(ax, az, 2) && clear(bx, bz, 2)) roadQuad(ax, az, bx, bz, 2.2);
    }
    for (let t = 0; t <= 1; t += 0.09) {
      const x = e0x + (e1x - e0x) * t - uz * 4, z = e0z + (e1z - e0z) * t + ux * 4;
      if (clear(x, z, 6) && rand() < 0.8) poplars.push({ x, y: surfY(x, z), z, sx: 0.8 + 0.3 * rand(), sy: 0.8 + 0.35 * rand(), sz: 0.8 + 0.3 * rand(), yaw: rand() * TAU, col: white });
    }
  }
  for (const o of SITES.orchards) {
    const [cx, cz] = xzAt(S(o.tag, o.off), o.d);
    orchardFields.push({ x: cx, z: cz, w: 2 * o.a, d: 2 * o.b, yaw: 0 });
  }
  // Sparse poplars by the village and along the infield.
  for (let k = 0, tries = 0; k < 70 && tries < 1500; tries++) {
    const s = rand() * data.length, side = rand() < 0.5 ? 1 : -1;
    const [x, z] = xzAt(s, side * (wallAt(s, side as 1 | -1) + 18 + rand() * 120));
    if (!clear(x, z, 12)) continue;
    poplars.push({ x, y: surfY(x, z), z, sx: 0.85, sy: 0.75 + 0.4 * rand(), sz: 0.85, yaw: rand() * TAU, col: white });
    k++;
  }

  // ---- meshes ----
  const m4 = new Matrix4(), qt = new Quaternion(), up = new Vector3(0, 1, 0), pv = new Vector3(), sv = new Vector3();
  const geos: { dispose(): void }[] = [];
  const mats: { dispose(): void }[] = [];
  // Builders first (they append to the shared rock / lamp buffers).
  parts.push(createFairyChimneys(penv, chimneySites, sink));
  parts.push(createOrchards(penv, vineFields, orchardFields, (x, z) => clear(x, z, 4)));
  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  for (let i = 0; i < data.count; i += 20) { bx0 = Math.min(bx0, data.x[i]!); bx1 = Math.max(bx1, data.x[i]!); bz0 = Math.min(bz0, data.z[i]!); bz1 = Math.max(bz1, data.z[i]!); }
  const bcx = (bx0 + bx1) / 2, bcz = (bz0 + bz1) / 2, by = ground.dem(bcx, bcz);
  const balloons = createBalloons(penv, { x: bcx, z: bcz, r: Math.max(bx1 - bx0, bz1 - bz0) / 2 + 600, yMin: by + 90, yMax: by + 330, count: 13, windX: 1.6, windZ: -0.9 });
  parts.push(balloons);
  for (const pt of parts) { group.add(pt.root); tris += pt.triangles; }

  const rockMat = envMaterial(c.sh, { name: 'capp.rock', family: 'opaque', vertexColor: true, map: c.tex.dirt.map, normalMap: c.tex.concrete.normal, roughness: 0.95, wet: 0.4 });
  const rockGeo = rock.geometry();
  const rockMesh = new Mesh(rockGeo, rockMat);
  rockMesh.name = 'capp.rock';
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  rockMesh.matrixAutoUpdate = false;
  group.add(rockMesh);
  // Every carved opening (chimneys, castle, valley walls, rock faces) and the minaret ring: one lamp draw.
  const lampMat = envMaterial(c.sh, { name: 'capp.windows', family: 'opaque', mode: EnvMode.Lamp, vertexColor: true, emissive: 0xffffff, emissiveIntensity: 0, roughness: 1, wet: 0, flood: 0 });
  const lampGeo = lamps.geometry();
  const lampMesh = new Mesh(lampGeo, lampMat);
  lampMesh.name = 'capp.windows';
  lampMesh.matrixAutoUpdate = false;
  group.add(lampMesh);
  geos.push(rockGeo, lampGeo);
  mats.push(rockMat, lampMat);
  tris += (rockGeo.index!.count + lampGeo.index!.count) / 3;
  const popGeo = poplarGeometry().geometry();
  const popMat = envMaterial(c.sh, { name: 'capp.poplars', family: 'inst', vertexColor: true, roughness: 0.9, wet: 0.3, flood: 0.6 });
  const popMesh = new InstancedMesh(popGeo, popMat, Math.max(1, poplars.length));
  popMesh.name = 'capp.poplars';
  poplars.forEach((o, k) => {
    qt.setFromAxisAngle(up, o.yaw);
    m4.compose(pv.set(o.x, o.y, o.z), qt, sv.set(o.sx, o.sy, o.sz));
    popMesh.setMatrixAt(k, m4);
    popMesh.setColorAt(k, o.col);
  });
  popMesh.count = poplars.length;
  popMesh.castShadow = c.quality.id !== 'low';
  popMesh.receiveShadow = true;
  popMesh.computeBoundingSphere();
  group.add(popMesh);
  geos.push(popGeo);
  mats.push(popMat);
  tris += (poplars.length * popGeo.index!.count) / 3;
  // Shadow casters of the props (by day only: at night only the floodlit circuit matters and the shadow pass is lean).
  const casters: Mesh[] = [];
  group.traverse((o) => { if ((o as Mesh).isMesh && (o as Mesh).castShadow) casters.push(o as Mesh); });
  let quality = c.quality;

  return {
    root: group,
    triangles: tris,
    update(cam: PerspectiveCamera, frame: RenderFrame, dt: number) {
      balloons.update!(cam, frame, dt);
    },
    applyConditions(cc) {
      // Carved openings: black by day, warm lamplight at sunset and night; houses' windows and the balloons follow.
      lampMat.emissiveIntensity = lampK(cc);
      for (const pt of parts) pt.applyConditions?.(cc);
      for (const m of casters) m.castShadow = cc.tod !== 'night' && quality.id !== 'low';
    },
    setQuality(qp) {
      quality = qp;
      for (const pt of parts) pt.setQuality?.(qp);
      popMesh.castShadow = qp.id !== 'low';
    },
    dispose() {
      for (const pt of parts) pt.dispose();
      popMesh.dispose();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      group.removeFromParent();
    },
  };
}
