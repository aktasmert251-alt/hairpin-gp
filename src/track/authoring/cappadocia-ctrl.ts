// Cappadocia Valley authored geometry (docs/design/tracks-cappadocia.md): a turtle path (straights and constant-radius
// arcs) in map metres (E east, N north; world x = E, z = −N), closed exactly by two designated straights and one arc,
// the authored elevation profile keyed by segment, the pit lane as main-frame (s, d) control points and the procedural
// valley terrain. Pure data + functions with NO imports (like eifel-ctrl.ts), so scripts can run it directly.

/** Straight of `len` m, or an arc of `deg` (+ left, − right) at radius `r`. `tag` marks a segment for other tables;
 *  an arc tagged '+…' continues the previous numbered corner (double apex, decreasing radius). */
export type Seg = readonly ['S', number, string?] | readonly ['A', number, number, string?];

/** Driving order from the S/F line (0, 0) heading east; clockwise (net −360°). 'fixA' / 'fixB' absorb the closure gap
 *  and 'fixH' the heading error. Every arc of ≥ 10° (not tagged '+…') is a numbered corner. */
const SEGS0: readonly Seg[] = [
  ['S', 280, 'sf'],
  ['A', -165, 21, 'hairpin'],
  ['S', 120, 'h-exit'],
  ['A', 45, 36, 'double'],
  ['S', 20],
  ['A', 45, 30, '+double2'],
  ['S', 120],
  ['A', -40, 100, 'esses'],
  ['S', 28],
  ['A', 45, 95],
  ['S', 28],
  ['A', -45, 95],
  ['S', 28],
  ['A', 30, 110],
  ['S', 177, 'crest'],
  ['A', 65, 40, 'blind'],
  ['S', 70],
  ['A', -50, 95, 'decr'],
  ['A', -60, 32, '+decr2'],
  ['S', 200, 'fixA'],
  ['A', -90, 18.5, 'chicane'],
  ['S', 10],
  ['A', 90, 18.5, 'chicane2'],
  ['S', 90],
  ['A', -70, 52, 'offcamber'],
  ['S', 90],
  ['A', 80, 27, 'village'],
  ['S', 60, 'bumps'],
  ['A', -80, 30, 'v2'],
  ['S', 301, 'back'],
  ['A', -150, 58, 'carousel'],
  ['S', 120],
  ['A', 80, 53, 'k'],
  ['S', 265, 'climb'],
  ['A', -60, 44, 'fin1'],
  ['S', 50],
  ['A', 150, 22, 'hairpin2'],
  ['S', 80],
  ['A', -90, 28, 'fin3'],
  ['S', 180],
  ['A', -70, 34, 'fin4'],
  ['S', 70],
  ['A', 70, 32, 'fin5'],
  ['S', 150, 'fixB'],
  ['A', -90, 30, 'fixH'],
  ['S', 200, 'last'],
];

/** Layout scale (lengths and radii). */
const K = 1.13;
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
export function cappPath(): Built {
  return (built ??= buildPath(1));
}

/** Polygon-basis s of a tagged segment's start plus `off` metres. */
export function tagS(tag: string, off = 0, b: Built = cappPath()): number {
  const k = b.segs.findIndex((g) => (g[0] === 'S' ? g[2] : g[3]) === tag);
  if (k < 0) throw new Error(`[cappadocia] no segment tagged ${tag}`);
  return b.segS[k]! + off;
}

/** Numbered corners in driving order: arcs of ≥ 10°, each merged with the '+…' arcs that follow it. */
export interface CornerArc { s0: number; s1: number; turn: number; r: number; apexes: number[]; tag: string }
export function cappCorners(b: Built = cappPath()): CornerArc[] {
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
 *  smoothed by the build (crest R ≥ 700 m / sag R ≥ 400 m). ≈ 58 m: the S/F straight falls from the T21 crest into the
 *  T1 hairpin (downhill braking), the esses run along the valley floor, a short steep climb to the blind crest at T7,
 *  down through the rock chicane and the off-camber T11 to the village and the carousel at the bottom, then the long
 *  climb of the final sector back up to the T21 crest. */
export const ELEV_KEYS: readonly (readonly [string, number, number])[] = [
  ['sf', 0, 0], ['hairpin', 0, -14], ['h-exit', 0, -17], ['double', 0, -20], ['esses', 0, -27], ['esses', 300, -33],
  ['crest', 0, -33], ['crest', 150, -16], ['blind', 12, -13], ['blind', 60, -15], ['decr', 0, -17], ['fixA', 0, -19],
  ['chicane', 0, -25], ['offcamber', 0, -28], ['offcamber', 70, -37], ['village', 0, -44], ['v2', 0, -49], ['back', 0, -50],
  ['carousel', 0, -55], ['carousel', 150, -56], ['k', 0, -53], ['climb', 0, -50], ['fin1', 0, -40], ['hairpin2', 0, -35],
  ['fin3', 0, -27], ['fin4', 0, -17], ['fin5', 0, -11], ['fixB', 0, -6], ['fixH', 0, 0], ['fixH', 40, 2], ['last', 0, 2],
  ['last', 150, 0.5],
];

/** Elevation keys as (s, y), sorted, closing at L with y 0. */
export function elevTable(b: Built = cappPath()): [number, number][] {
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

/** Pit lane (main s offsets from the S/F line, d +left; the pit is on the left, north of the S/F straight), Catmull–Rom
 *  at 1 m: the lane leaves the climb (fixB) 480 m before the line, swings round the outside of T21 (dense points so the
 *  spline follows the arc), runs beside the straight and rejoins 175 m after the line, before the T1 braking zone. */
export const PIT_SD_REL: readonly (readonly [number, number])[] = [
  [-480, 6.5], [-440, 10], [-395, 14], [-345, 17.25], [-315, 17.25], [-290, 17.25], [-272, 17.25], [-256, 17.25],
  [-240, 17.25], [-222, 17.25], [-190, 17.25], [60, 17.25], [110, 14], [145, 10.5], [175, 6.75],
];

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

const sst = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Valley relief (m) added to the road-following surface `dist` m from the nearest road sample: the floor stays near
 *  road level, then terraced tuff walls rise 85–130 m (stepped ledges, eroded gullies) to the plateau. */
export function valleyRelief(x: number, z: number, dist: number): number {
  const top = 85 + 45 * vnoise(x / 700 + 4.2, z / 700 - 1.3);
  const edge = 150 + 130 * vnoise(x / 420 - 2.7, z / 420 + 6.1);
  const h = top * sst(edge, edge + 150, dist);
  const step = 16;
  const terr = Math.floor(h / step) * step + step * sst(0.6, 1, (h / step) % 1);
  const gully = 22 * (vnoise(x / 80, z / 80) - 0.5) * sst(edge, edge + 100, dist);
  const floor = 6 * (vnoise(x / 160 + 9, z / 160) - 0.5) * sst(40, 120, dist);
  return 0.85 * terr + 0.15 * h + gully + floor;
}

/** Scenery sites (basis s via tag + offset, d > 0 = left of the driving direction). */
export const SITES = {
  /** The rock castle: a tuff pinnacle honeycombed with dwellings, north-west of the S/F straight. */
  castle: { tag: 'last', off: 40, d: 300, hill: 95 },
  /** The stone village round T12–T13 and its mosque on the outside of T13. */
  village: { tag: 'village', off: 20, r: 170 },
  mosque: { tag: 'v2', off: 20, d: 60 },
  /** Fairy-chimney clusters: centre (tag, off, d), radius, count. */
  chimneys: [
    { tag: 'esses', off: 150, d: -150, r: 90, n: 34 },
    { tag: 'crest', off: 60, d: 70, r: 60, n: 18 },
    { tag: 'chicane', off: 10, d: 60, r: 50, n: 18 },
    { tag: 'chicane', off: 20, d: -55, r: 45, n: 14 },
    { tag: 'back', off: 150, d: 110, r: 80, n: 26 },
    { tag: 'carousel', off: 120, d: -170, r: 70, n: 22 },
    { tag: 'climb', off: 100, d: -110, r: 70, n: 22 },
    { tag: 'fin4', off: 40, d: 120, r: 70, n: 20 },
    { tag: 'h-exit', off: 60, d: -90, r: 50, n: 14 },
    { tag: 'hairpin2', off: 20, d: 60, r: 45, n: 14 },
  ],
  /** Vineyards (rows) and apricot orchards on the valley floor: centre, half sizes, row heading (deg). */
  vineyards: [
    { tag: 'esses', off: 200, d: 170, a: 110, b: 70, rot: 20 },
    { tag: 'back', off: 250, d: 170, a: 120, b: 60, rot: 90 },
    { tag: 'fin3', off: 120, d: -180, a: 90, b: 70, rot: 0 },
  ],
  orchards: [
    { tag: 'double', off: 40, d: 120, a: 80, b: 60 },
    { tag: 'k', off: 60, d: 150, a: 80, b: 60 },
    { tag: 'decr', off: 60, d: 140, a: 70, b: 50 },
  ],
} as const;

/** Narrow walled sections (tag + offset): rock faces or house fronts close on both sides (authoring close walls, the
 *  scenery dresses them). */
export const GORGES: readonly { from: readonly [string, number]; to: readonly [string, number]; kind: 'rock' | 'village' }[] = [
  { from: ['chicane', -60], to: ['chicane2', 50], kind: 'rock' },
  { from: ['village', -30], to: ['v2', 45], kind: 'village' },
  { from: ['hairpin2', -25], to: ['fin3', 5], kind: 'rock' },
];

/** TrackData.attribution. */
export const ATTRIBUTION: readonly string[] = [
  'Cappadocia Valley Circuit: original fictional layout, terrain and scenery by the HAIRPIN GP team (procedural, no map data).',
];
