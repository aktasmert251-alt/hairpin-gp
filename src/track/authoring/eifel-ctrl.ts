// Eifel Forest Ring authored geometry (docs/design/tracks-eifel.md): a turtle path (straights and constant-radius arcs)
// in map metres (E east, N north; world x = E, z = −N), closed exactly by adjusting two designated straights, the
// authored elevation profile keyed by segment, the pit lane as main-frame (s, d) control points and the procedural
// terrain. Pure data + functions with NO imports (like alpine-ctrl.ts), so scripts can run it directly.

/** Straight of `len` m, or an arc of `deg` (+ left, − right) at radius `r`. `tag` marks a segment for other tables. */
export type Seg = readonly ['S', number, string?] | readonly ['A', number, number, string?];

/** Driving order from the S/F line (0, 0) heading east; clockwise (net −360°). The straights tagged 'fixA' / 'fixB'
 *  absorb the closure gap and the arc tagged 'fixH' the heading error. Every arc of ≥ 10° is a numbered corner. */
export const SEGS: readonly Seg[] = [
  // ---- GP loop: pit straight, T1, the infield esses, the left hairpin, the chicane onto the ring ----
  ['S', 640, 'sf'],
  ['A', -95, 36],
  ['S', 150],
  ['A', 50, 65],
  ['S', 200],
  ['A', -40, 150],
  ['S', 230],
  ['A', -80, 55],
  ['S', 170],
  ['A', 160, 27],
  ['S', 380],
  ['A', -85, 75],
  ['S', 220],
  ['A', 45, 40],
  ['S', 25],
  ['A', -45, 40],
  ['S', 220],
  // ---- forest esses ----
  ['A', -50, 110, 'esses'],
  ['S', 90],
  ['A', 40, 85],
  ['S', 70],
  ['A', -48, 80],
  ['S', 80],
  ['A', 42, 90],
  ['S', 70],
  ['A', -38, 100],
  ['S', 90],
  ['A', 30, 120],
  ['S', 80],
  ['A', -22, 130],
  ['S', 160],
  // ---- the downhill rush through the forest ----
  ['A', 22, 450, 'rush'],
  ['S', 200],
  ['A', -32, 380],
  ['S', 140],
  ['A', 30, 320],
  ['S', 220],
  ['A', -28, 260],
  ['S', 160],
  ['A', 30, 220],
  ['S', 280, 'dip'],
  ['A', -30, 300],
  ['S', 180],
  ['A', 62, 85],
  ['S', 120],
  ['A', -64, 75],
  ['S', 140],
  ['A', 46, 90],
  ['S', 110],
  ['A', -50, 80],
  ['S', 220],
  ['A', 20, 500],
  ['S', 240],
  // ---- valley floor heading west: the village, the stream bridges ----
  ['A', -36, 50, 'valley'],
  ['S', 125, 'village'],
  ['A', 55, 42],
  ['S', 52],
  ['A', -55, 48],
  ['S', 182, 'bridge'],
  ['A', -30, 140],
  ['S', 78],
  ['A', 40, 90],
  ['S', 105],
  ['A', 35, 120],
  ['S', 84],
  ['A', -50, 100],
  ['S', 126],
  ['A', -25, 300],
  ['S', 105],
  ['A', 30, 200],
  ['S', 93],
  ['A', -40, 110],
  ['S', 63],
  ['A', 45, 95],
  ['S', 126],
  ['A', -20, 130],
  ['S', 84],
  ['A', 20, 260],
  ['S', 115],
  ['A', -35, 100],
  ['S', 57],
  ['A', 30, 110],
  ['S', 105],
  // ---- the climb north: switchbacks, the banked bowl ----
  ['A', -85, 60],
  ['S', 260, 'fixB'],
  ['A', 35, 120],
  ['S', 170],
  ['A', -45, 110],
  ['S', 150],
  ['A', 40, 90],
  ['S', 180],
  ['A', -50, 80],
  ['S', 170],
  ['A', 30, 100],
  ['S', 120],
  ['A', -35, 90],
  ['S', 220],
  ['A', 170, 30, 'bowl'],
  ['S', 200],
  ['A', -95, 60],
  ['S', 130],
  ['A', -75, 70],
  ['S', 200],
  ['A', 115, 35],
  ['S', 150],
  ['A', -115, 40],
  ['S', 200],
  ['A', 30, 150],
  ['S', 180],
  ['A', -40, 120],
  ['S', 180, 'crest'],
  ['A', 25, 250],
  ['S', 220],
  ['A', -60, 90],
  ['S', 180],
  ['A', 45, 100],
  ['S', 160],
  ['A', -30, 120],
  ['S', 130],
  ['A', 35, 110],
  ['S', 220],
  // ---- the plateau: crests, the hump, the castle ----
  ['A', -50, 160, 'fixH'],
  ['S', 230, 'hump'],
  ['A', 20, 400],
  ['S', 312],
  ['A', -40, 140],
  ['S', 221],
  ['A', 35, 110],
  ['S', 195],
  ['A', -45, 100],
  ['S', 169],
  ['A', 30, 130],
  ['S', 143],
  ['A', -30, 120],
  ['S', 208],
  ['A', 22, 200],
  ['S', 156],
  ['A', -28, 160],
  ['S', 182],
  ['A', 25, 150],
  ['S', 156],
  ['A', -25, 150],
  // ---- the long straight back to the GP loop ----
  ['S', 1800, 'fixA'],
  ['A', -5, 900],
  ['S', 200],
];

export interface Arc { s0: number; s1: number; turn: number; r: number; seg: number }
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

/** Heading, end point and per-segment geometry of a segment list (no sampling). */
function walk(segs: readonly Seg[]): { x: number; y: number; h: number } {
  let x = 0, y = 0, h = 0;
  for (const g of segs) {
    if (g[0] === 'S') {
      x += Math.cos(h) * g[1];
      y += Math.sin(h) * g[1];
    } else {
      const a = g[1] * D2R, r = g[2];
      const sg = Math.sign(a);
      // Centre to the left (sg > 0) or right of the heading.
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
  const kH = segs.findIndex((g) => g[3] === 'fixH' || g[2] === 'fixH');
  const gH = segs[kH]!;
  if (gH[0] === 'A') segs[kH] = ['A', gH[1] + (-360 - total), gH[2], gH[3]];
  const kA = segs.findIndex((g) => g[0] === 'S' && g[2] === 'fixA');
  const kB = segs.findIndex((g) => g[0] === 'S' && g[2] === 'fixB');
  // Directions of the two straights.
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

/** Samples the closed path every `step` m from (0, 0); returns world (x, z) = (E, −N) like filletPolygon(). */
export function buildPath(step = 1): Built {
  const segs = closeSegs(SEGS);
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
      arcs.push({ s0: s, s1: s + len, turn: g[1], r, seg: k });
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
export function eifelPath(): Built {
  return (built ??= buildPath(1));
}

/** Polygon-basis s of a tagged segment's start plus `off` metres. */
export function tagS(tag: string, off = 0, b: Built = eifelPath()): number {
  const k = b.segs.findIndex((g) => (g[0] === 'S' ? g[2] : g[3]) === tag);
  if (k < 0) throw new Error(`[eifel] no segment tagged ${tag}`);
  return b.segS[k]! + off;
}

/** Numbered corners (arcs of ≥ 10°) in driving order. */
export function eifelCorners(b: Built = eifelPath()): Arc[] {
  return b.arcs.filter((a) => Math.abs(a.turn) >= 10);
}

/** Authored elevation keys (segment tag, metres past its start, y relative to S/F), linear between keys (smoothed by
 *  the build). ≈ 300 m from the valley floor to the plateau: GP loop → forest esses → the long rush down into the valley
 *  (a compression at the foot of the steepest part) → village and bridges at the bottom → the climb with the bowl →
 *  blind crests → the plateau with the hump → the long straight gently down to the GP loop. */
export const ELEV_KEYS: readonly (readonly [string, number, number])[] = [
  ['sf', 0, 0], ['sf', 640, -3], ['esses', 0, -16], ['rush', 0, -40], ['rush', 900, -100], ['dip', 0, -160],
  ['dip', 250, -188], ['dip', 520, -184], ['valley', 0, -244], ['village', 0, -246], ['bridge', 0, -262], ['bridge', 500, -264],
  ['bridge', 900, -255], ['bridge', 1300, -264], ['fixB', 0, -262], ['fixB', 500, -215], ['bowl', 0, -150], ['bowl', 200, -140],
  ['bowl', 700, -80], ['crest', 0, -62], ['crest', 140, -54], ['crest', 420, -50], ['fixH', 0, 12], ['hump', 0, 18],
  ['hump', 160, 24], ['hump', 360, 15], ['fixA', 0, 22], ['fixA', 900, 8], ['fixA', 1040, 14], ['fixA', 1180, 4], ['fixA', 1700, 3],
];

/** Elevation keys as (s, y), sorted, closing at L with y 0. */
export function elevTable(b: Built = eifelPath()): [number, number][] {
  const t = ELEV_KEYS.map(([tag, off, y]) => [tagS(tag, off, b), y] as [number, number]).sort((p, q) => p[0] - q[0]);
  t.push([b.length, 0]);
  return t;
}

/** Linear authored elevation at polygon-basis s. */
export function elevationAt(b: Built, s: number): number {
  const t = elevTable(b);
  for (let k = 0; k + 1 < t.length; k++) {
    const a = t[k]!, c = t[k + 1]!;
    if (s <= c[0]) return a[1] + ((c[1] - a[1]) * (s - a[0])) / Math.max(1e-6, c[0] - a[0]);
  }
  return 0;
}

/** Pit lane (main s offsets from the S/F, d +left; the pit is on the right), Catmull–Rom at 1 m. Entry on the long
 *  straight 500 m before the line, exit 345 m after it (Alpine values). */
export const PIT_SD_REL: readonly (readonly [number, number])[] = [
  [-499, -8.5], [-444, -12], [-379, -16.5], [-309, -18.25], [-49, -18.25], [150, -18.25], [245, -15.5], [300, -11.5], [345, -8.5],
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

/** Rolling-hills relief (m) added on top of the track-following surface, growing with the distance from the road. */
export function hillRelief(x: number, z: number): number {
  return 70 * (vnoise(x / 1400 + 3.1, z / 1400 - 1.7) - 0.5) + 30 * (vnoise(x / 520 - 5.3, z / 520 + 2.2) - 0.5) + 9 * (vnoise(x / 160, z / 160) - 0.5);
}

/** Scenery sites as (basis s, d) beside the road (d > 0 = left): the village straddles the road, the castle sits on its
 *  hill inside the valley bend, spectator camps in forest clearings, bridges over the road. */
export const SITES = {
  village: { tag: 'village', off: 90, d: 0, r: 230 },
  castle: { tag: 'bridge', off: 260, d: -330, r: 150, hill: 110 },
  camps: [
    { tag: 'rush', off: 520, d: 45, r: 70 },
    { tag: 'dip', off: 380, d: -50, r: 80 },
    { tag: 'bowl', off: 40, d: 55, r: 75 },
    { tag: 'crest', off: 60, d: -48, r: 70 },
    { tag: 'hump', off: 120, d: 50, r: 80 },
    { tag: 'fixA', off: 600, d: -55, r: 90 },
  ],
  /** Bridges over the road: 'stone' road bridge (village), 'foot' spectator bridges. */
  bridges: [
    { tag: 'village', off: 140, kind: 'stone' },
    { tag: 'esses', off: 40, kind: 'foot' },
    { tag: 'rush', off: 1200, kind: 'foot' },
    { tag: 'crest', off: 330, kind: 'foot' },
    { tag: 'fixA', off: 400, kind: 'foot' },
    { tag: 'fixB', off: 320, kind: 'stone' },
  ],
} as const;

/** TrackData.attribution. */
export const ATTRIBUTION: readonly string[] = [
  'Eifel Forest Ring: original fictional layout, terrain and scenery by the HAIRPIN GP team (procedural, no map data).',
];
