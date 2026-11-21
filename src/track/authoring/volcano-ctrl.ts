// Volcano Rim authored geometry (docs/design/tracks-volcano.md): a turtle path (straights and constant-radius arcs) in
// map metres (E east, N north; world x = E, z = −N), closed exactly by two designated straights and one arc, the
// authored elevation profile keyed by segment, the pit lane as main-frame (s, d) control points and the procedural
// volcano terrain (cone, crater with its lava lake, the lava river, the spiral's lava cone). Pure data + functions with
// NO imports (like cappadocia-ctrl.ts), so scripts can run it directly.

/** Straight of `len` m, or an arc of `deg` (+ left, − right) at radius `r`. `tag` marks a segment for other tables;
 *  an arc tagged '+…' continues the previous numbered corner (double apex, decreasing radius). */
export type Seg = readonly ['S', number, string?] | readonly ['A', number, number, string?];

/** Driving order from the S/F line (0, 0) heading east; clockwise (net −360°). 'fixA' / 'fixB' absorb the closure gap
 *  and 'fixH' the heading error. Every arc of ≥ 10° (not tagged '+…') is a numbered corner. */
const SEGS0: readonly Seg[] = [
  // ---- S/F on the ash plain (north), T1, the climb up the east flank ----
  ['S', 420, 'sf'],
  ['A', -90, 45, 't1'],
  ['S', 250, 'flank'],
  ['A', 45, 140, 'sw1'],
  ['S', 30],
  ['A', -40, 130, 'sw2'],
  ['S', 30],
  ['A', 40, 150, 'sw3'],
  ['S', 120, 'fixA'],
  // Switchback hairpins.
  ['A', -150, 22, 'hp1'],
  ['S', 150, 'switch'],
  ['A', 150, 22, 'hp2'],
  ['S', 140],
  ['A', -45, 110, 't7'],
  // Blind crest, onto the lava-river bridge, into the tunnel through the crater wall.
  ['S', 120, 'crest'],
  ['A', 20, 300, 't8'],
  ['S', 250, 'bridge'],
  ['A', -100, 26, 't9'],
  ['S', 320, 'tunnel'],
  // The south rim, heading west (crater on the right).
  ['A', -9, 140, 'rim1'],
  ['S', 80],
  ['A', 30, 110, 'rim2'],
  ['S', 100, 'rimA'],
  ['A', -30, 90, 'rim3'],
  ['S', 60],
  ['A', 9, 160, 'rim4'],
  ['S', 480, 'rim'],
  // The spiral hairpin descent of the west flank.
  ['A', -160, 22, 'hp3'],
  ['S', 140, 'spiral'],
  ['A', 160, 24, 'sp1'],
  ['S', 40],
  ['A', -80, 32, 'sp2'],
  ['S', 120, 'vents'],
  ['A', -9, 70, 't18'],
  // Fast sweepers down the slope.
  ['S', 250, 'sweep'],
  ['A', -40, 180, 'sw4'],
  ['S', 40],
  ['A', 40, 170, 'sw5'],
  ['S', 40],
  ['A', -45, 160, 'sw6'],
  ['S', 40],
  ['A', 35, 200, 'sw7'],
  ['S', 100, 'fixB'],
  ['A', -25, 220, 'sw8'],
  ['S', 50],
  ['A', 25, 220, 'sw9'],
  ['S', 60],
  ['A', -90, 35, 'fixH'],
  ['S', 230, 'last'],
];

/** Layout scale (lengths and radii). */
const K = 1.0;
export const SEGS: readonly Seg[] = SEGS0.map((g): Seg => (g[0] === 'S' ? ['S', g[1] * K, g[2]] : ['A', g[1], g[2] * K, g[3]]));

export interface Arc { s0: number; s1: number; turn: number; r: number; seg: number; tag: string }
export interface Built {
  pts: [number, number][];
  arcs: Arc[];
  /** Polygon-basis s at the start of every segment (index = segment), plus the total length at the end. */
  segS: number[];
  /** Segment list after the closure correction. */
  segs: Seg[];
  length: number;
}

const D2R = Math.PI / 180;

function walk(segs: readonly Seg[]): { x: number; y: number; h: number } {
  let x = 0, y = 0, h = 0;
  for (const g of segs) {
    if (g[0] === 'S') {
      x += Math.cos(h) * g[1];
      y += Math.sin(h) * g[1];
    } else {
      const a = g[1] * D2R, r = g[2];
      const sg = Math.sign(a);
      const cx = x - Math.sin(h) * r * sg, cy = y + Math.cos(h) * r * sg;
      const h1 = h + a;
      x = cx + Math.sin(h1) * r * sg;
      y = cy - Math.cos(h1) * r * sg;
      h = h1;
    }
  }
  return { x, y, h };
}

/** Closure: the 'fixH' arc takes the heading error, then 'fixA'/'fixB' the position error (2 × 2 solve). */
export function closeSegs(src: readonly Seg[]): Seg[] {
  const segs: Seg[] = src.map((g) => g.slice() as unknown as Seg);
  const total = segs.reduce((a, g) => a + (g[0] === 'A' ? g[1] : 0), 0);
  const kH = segs.findIndex((g) => g[0] === 'A' && g[3] === 'fixH');
  const gH = segs[kH]!;
  if (gH[0] === 'A') segs[kH] = ['A', gH[1] + (-360 - total), gH[2], gH[3]];
  const kA = segs.findIndex((g) => g[0] === 'S' && g[2] === 'fixA');
  const kB = segs.findIndex((g) => g[0] === 'S' && g[2] === 'fixB');
  const dirOf = (k: number): [number, number] => {
    const w = walk(segs.slice(0, k));
    return [Math.cos(w.h), Math.sin(w.h)];
  };
  const [ax, ay] = dirOf(kA), [bx, by] = dirOf(kB);
  const end = walk(segs);
  const det = ax * by - ay * bx;
  const da = (-end.x * by + end.y * bx) / det;
  const db = (-ax * end.y + ay * end.x) / det;
  const A = segs[kA]!, B = segs[kB]!;
  segs[kA] = ['S', (A[1] as number) + da, 'fixA'];
  segs[kB] = ['S', (B[1] as number) + db, 'fixB'];
  return segs;
}

/** Samples the closed path every `step` m from (0, 0); world (x, z) = (E, −N). */
export function buildPath(step = 1, src: readonly Seg[] = SEGS): Built {
  const segs = closeSegs(src);
  const pts: [number, number][] = [];
  const arcs: Arc[] = [];
  const segS: number[] = [];
  let x = 0, y = 0, h = 0, s = 0, carry = 0;
  segs.forEach((g, k) => {
    segS.push(s);
    if (g[0] === 'S') {
      const len = g[1];
      let u = carry;
      for (; u < len; u += step) pts.push([x + Math.cos(h) * u, -(y + Math.sin(h) * u)]);
      carry = u - len;
      x += Math.cos(h) * len;
      y += Math.sin(h) * len;
      s += len;
    } else {
      const a = g[1] * D2R, r = g[2];
      const sg = Math.sign(a);
      const cx = x - Math.sin(h) * r * sg, cy = y + Math.cos(h) * r * sg;
      const len = Math.abs(a) * r;
      let u = carry;
      for (; u < len; u += step) {
        const hh = h + sg * (u / r);
        pts.push([cx + Math.sin(hh) * r * sg, -(cy - Math.cos(hh) * r * sg)]);
      }
      carry = u - len;
      arcs.push({ s0: s, s1: s + len, turn: g[1], r, seg: k, tag: g[3] ?? '' });
      h += a;
      x = cx + Math.sin(h) * r * sg;
      y = cy - Math.cos(h) * r * sg;
      s += len;
    }
  });
  segS.push(s);
  return { pts: pts.map(([a, b]) => [Math.round(a * 100) / 100, Math.round(b * 100) / 100]), arcs, segS, segs, length: s };
}

let built: Built | null = null;
/** The 1 m path, built once. */
export function volcPath(): Built {
  return (built ??= buildPath(1));
}

/** Polygon-basis s of a tagged segment's start plus `off` metres. */
export function tagS(tag: string, off = 0, b: Built = volcPath()): number {
  const k = b.segs.findIndex((g) => (g[0] === 'S' ? g[2] : g[3]) === tag);
  if (k < 0) throw new Error(`[volcano] no segment tagged ${tag}`);
  return b.segS[k]! + off;
}

/** Numbered corners in driving order: arcs of ≥ 10°, each merged with the '+…' arcs that follow it. */
export interface CornerArc { s0: number; s1: number; turn: number; r: number; apexes: number[]; tag: string }
export function volcCorners(b: Built = volcPath()): CornerArc[] {
  const out: CornerArc[] = [];
  for (const a of b.arcs) {
    if (a.tag.startsWith('+') && out.length) {
      const c = out[out.length - 1]!;
      c.s1 = a.s1;
      c.turn += a.turn;
      c.r = Math.min(c.r, a.r);
      c.apexes.push((a.s0 + a.s1) / 2);
      continue;
    }
    if (Math.abs(a.turn) < 10) continue;
    out.push({ s0: a.s0, s1: a.s1, turn: a.turn, r: a.r, apexes: [(a.s0 + a.s1) / 2], tag: a.tag });
  }
  return out;
}

/** Authored elevation keys (segment tag, metres past its start, y relative to the S/F line), linear between keys and
 *  smoothed by the build. ≈ 168 m: the plain, the climb of the east flank with the switchbacks, the blind crest at
 *  T8, the bridge 25 m over the lava river, the 10 % climb through the tunnel onto the south rim, the rim at
 *  +150…+168, the hairpin descent of the west flank and the long downhill sweepers back to the plain. */
export const ELEV_KEYS: readonly (readonly [string, number, number])[] = [
  ['sf', 0, 0], ['t1', 0, 3], ['flank', 0, 6], ['sw1', 0, 12], ['sw3', 0, 28], ['fixA', 0, 36], ['hp1', 0, 46],
  ['switch', 0, 49], ['hp2', 0, 62], ['t7', 0, 70], ['crest', 0, 78], ['crest', 110, 90], ['t8', 40, 92], ['bridge', 0, 89],
  ['t9', 0, 89], ['tunnel', 0, 92], ['rim1', 0, 126], ['rim2', 0, 134], ['rimA', 0, 139], ['rim3', 0, 146], ['rim', 0, 154],
  ['hp3', 0, 162], ['spiral', 0, 158], ['sp1', 0, 152], ['sp2', 0, 142], ['vents', 0, 138], ['sweep', 0, 128], ['sw4', 0, 113],
  ['sw5', 0, 100], ['sw6', 0, 86], ['sw7', 0, 70], ['fixB', 0, 60], ['sw8', 0, 37], ['sw9', 0, 23], ['fixH', 0, 9],
  ['last', 0, 4.5], ['last', 150, 1.5],
]

/** Elevation keys as (s, y), sorted, closing at L with y 0. */
export function elevTable(b: Built = volcPath()): [number, number][] {
  const t = ELEV_KEYS.map(([tag, off, y]) => [tagS(tag, off, b), y] as [number, number]).sort((p, q) => p[0] - q[0]);
  t.push([b.length, 0]);
  return t;
}

/** Linear authored elevation at polygon-basis s. */
export function elevationAt(b: Built, s: number, t: [number, number][] = elevTable(b)): number {
  for (let k = 0; k + 1 < t.length; k++) {
    const a = t[k]!, c = t[k + 1]!;
    if (s <= c[0]) return a[1] + ((c[1] - a[1]) * (s - a[0])) / Math.max(1e-6, c[0] - a[0]);
  }
  return 0;
}

/** Pit lane (main s offsets from the S/F line, d +left; the pit is on the left, the plain north of the straight):
 *  in before T22 and round its outside (dense points so the spline follows the arc), beside the straight, out 195 m
 *  after the line. */
export const PIT_SD_REL: readonly (readonly [number, number])[] = [
  [-330, 6.5], [-305, 10], [-290, 14], [-279, 17.25], [-265, 17.25], [-250, 17.25], [-235, 17.25], [-200, 17.25],
  [80, 17.25], [130, 14], [165, 10.5], [195, 7],
]

/** World (x, z) at main-polyline (1 m samples) s, d (d > 0 = left). */
export function xzFromSD(poly: readonly (readonly [number, number])[], s: number, d: number): [number, number] {
  const L = poly.length;
  const sw = ((s % L) + L) % L;
  const i = Math.floor(sw), t = sw - i;
  const a = poly[i]!, b = poly[(i + 1) % L]!;
  const tx = b[0] - a[0], tz = b[1] - a[1];
  const l = Math.hypot(tx, tz) || 1;
  return [a[0] + tx * t + (tz / l) * d, a[1] + tz * t - (tx / l) * d];
}

/** Pit polyline in world (x, z). */
export function pitPolyline(poly: readonly (readonly [number, number])[]): [number, number][] {
  const P = PIT_SD_REL.map(([s, d]) => xzFromSD(poly, s, d));
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < P.length; k++) {
    const p0 = P[Math.max(0, k - 1)]!, p1 = P[k]!, p2 = P[k + 1]!, p3 = P[Math.min(P.length - 1, k + 2)]!;
    const m = Math.max(1, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])));
    for (let j = 0; j < m; j++) {
      const t = j / m, t2 = t * t, t3 = t2 * t;
      const c = (a: number, b: number, e: number, f: number): number => 0.5 * (2 * b + (-a + e) * t + (2 * a - 5 * b + 4 * e - f) * t2 + (-a + 3 * b - 3 * e + f) * t3);
      out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push([P[P.length - 1]![0], P[P.length - 1]![1]]);
  return out;
}

/** Smooth deterministic value noise (no Math.random). */
export function vnoise(x: number, y: number): number {
  const h = (i: number, j: number): number => {
    const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
}

export const sst = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Signature features in world (x, z) (computed from the path). */
export interface VolcanoSites {
  /** Crater centre, lava-lake radius and level, rim crest radius and height. */
  crater: { x: number; z: number; lake: number; lakeY: number; rimR: number; rimY: number };
  /** Lava river: polyline from the crater breach under the bridge and on down the east flank, lava level per point. */
  river: { x: number; z: number; y: number }[];
  /** The lava cone inside the spiral descent. */
  cone: { x: number; z: number; r: number; h: number; y: number };
}

let sites: VolcanoSites | null = null;
/** The crater sits 185 m inside the south rim (right of the rim straight); the river leaves it through a breach to
 *  the east and runs under the bridge; the cone stands inside the hairpin descent. */
export function volcanoSites(b: Built = volcPath()): VolcanoSites {
  if (sites) return sites;
  const P = b.pts;
  const at = (tag: string, off: number, d: number): [number, number] => xzFromSD(P, tagS(tag, off, b), d);
  const et = elevTable(b);
  const [cx, cz] = at('rimA', 50, -185);
  const rimY = elevationAt(b, tagS('rimA', 50, b), et) + 14;
  const bridgeMid = tagS('bridge', 125, b);
  const [bx, bz] = xzFromSD(P, bridgeMid, 0);
  const bridgeY = elevationAt(b, bridgeMid, et);
  // River: crater breach (lake edge toward the bridge) → under the bridge → 700 m on, falling away.
  const dx = bx - cx, dz = bz - cz, dl = Math.hypot(dx, dz);
  const ux = dx / dl, uz = dz / dl;
  const river: { x: number; z: number; y: number }[] = [];
  const lakeY = 70;
  for (let t = 150; t <= dl + 700; t += 20) {
    // A gentle meander; the level falls from the lake to 25 m under the deck at the bridge, then on down the flank.
    const m = 25 * Math.sin(t / 130) * sst(170, 260, t) * (1 - sst(dl - 80, dl - 20, t)) + 25 * Math.sin(t / 130) * sst(dl + 30, dl + 120, t);
    const y = t <= dl ? lakeY + (bridgeY - 25 - lakeY) * sst(150, dl, t) : bridgeY - 25 - (t - dl) * 0.09;
    river.push({ x: cx + ux * t - uz * m, z: cz + uz * t + ux * m, y });
  }
  const [ox, oz] = at('hp3', 30, 75);
  const coneY = elevationAt(b, tagS('hp3', 30, b), et);
  sites = {
    crater: { x: cx, z: cz, lake: 115, lakeY, rimR: 168, rimY },
    river,
    cone: { x: ox, z: oz, r: 38, h: 34, y: coneY - 6 },
  };
  return sites;
}

/** Distance from (x, z) to the river polyline and the lava level there. */
export function riverNear(x: number, z: number, b: Built = volcPath()): { d: number; y: number } {
  const R = volcanoSites(b).river;
  let best = Infinity, by = 0;
  for (let k = 0; k + 1 < R.length; k++) {
    const a = R[k]!, c = R[k + 1]!;
    const vx = c.x - a.x, vz = c.z - a.z, l2 = vx * vx + vz * vz;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
    const d = Math.hypot(x - a.x - vx * t, z - a.z - vz * t);
    if (d < best) { best = d; by = a.y + (c.y - a.y) * t; }
  }
  return { d: best, y: by };
}

/** Basis-s ranges (tag + offsets) of the signature structures. */
export const BRIDGE: readonly [string, number, string, number] = ['bridge', -10, 't9', -10];
export const TUNNEL_TAGS: readonly [string, number, string, number] = ['tunnel', 20, 'tunnel', 360];
/** Fall zones on the crater rim: no barrier on the outside of T11 (crater side, right) and T12 (outer cliff, left). */
export const FALL_TAGS: readonly { from: readonly [string, number]; to: readonly [string, number]; side: 1 | -1 }[] = [
  { from: ['rim2', -15], to: ['rim2', 65], side: -1 },
  { from: ['rim3', -15], to: ['rim3', 60], side: 1 },
];
/** Ash drifts across the racing surface (tag, offset, length). */
export const ASH_TAGS: readonly (readonly [string, number, number])[] = [
  ['rim1', 10, 70], ['rimA', 20, 60], ['rim', 120, 80], ['rim', 330, 70], ['spiral', 20, 60], ['vents', 30, 60], ['sweep', 80, 60],
];

/** TrackData.attribution. */
export const ATTRIBUTION: readonly string[] = [
  'Volcano Rim: original fictional layout, terrain and scenery by the HAIRPIN GP team (procedural, no map data).',
];

