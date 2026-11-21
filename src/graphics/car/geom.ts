// Procedural geometry helpers for the car (model space: +Z nose, +Y up, +X left; metres).
// Lofts of super-elliptic sections, airfoil wing lofts, elliptic tubes, extruded plates, projected UVs.

import { BufferAttribute, BufferGeometry, ExtrudeGeometry, Float32BufferAttribute, Path, Shape, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------------------------
// Monotone cubic interpolation of keyed parameter vectors (Fritsch–Carlson): no overshoot between keys.

export type Keys = readonly (readonly number[])[];

/** keys[i] = [t, p0, p1, ...] sorted by t. Returns f(t, out) → out (clamped outside the key range). */
export function monotoneCurve(keys: Keys): (t: number, out: number[]) => number[] {
  const n = keys.length;
  const dims = keys[0]!.length - 1;
  const ts = keys.map((k) => k[0]!);
  const slopes: number[][] = [];
  for (let d = 0; d < dims; d++) {
    const ys = keys.map((k) => k[d + 1]!);
    const delta: number[] = [];
    for (let i = 0; i < n - 1; i++) delta.push((ys[i + 1]! - ys[i]!) / (ts[i + 1]! - ts[i]!));
    const m: number[] = new Array(n).fill(0);
    m[0] = delta[0] ?? 0;
    m[n - 1] = delta[n - 2] ?? 0;
    for (let i = 1; i < n - 1; i++) m[i] = delta[i - 1]! * delta[i]! <= 0 ? 0 : (delta[i - 1]! + delta[i]!) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (delta[i] === 0) {
        m[i] = 0;
        m[i + 1] = 0;
        continue;
      }
      const a = m[i]! / delta[i]!;
      const b = m[i + 1]! / delta[i]!;
      const s = a * a + b * b;
      if (s > 9) {
        const tau = 3 / Math.sqrt(s);
        m[i] = tau * a * delta[i]!;
        m[i + 1] = tau * b * delta[i]!;
      }
    }
    slopes.push(m);
  }
  const asc = ts[n - 1]! >= ts[0]!;
  return (t, out) => {
    let i = 0;
    if (asc) {
      if (t <= ts[0]!) i = 0;
      else if (t >= ts[n - 1]!) i = n - 2;
      else while (i < n - 2 && t > ts[i + 1]!) i++;
    } else {
      if (t >= ts[0]!) i = 0;
      else if (t <= ts[n - 1]!) i = n - 2;
      else while (i < n - 2 && t < ts[i + 1]!) i++;
    }
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    const h = t1 - t0;
    let u = h === 0 ? 0 : (t - t0) / h;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const h00 = 2 * u ** 3 - 3 * u * u + 1;
    const h10 = u ** 3 - 2 * u * u + u;
    const h01 = -2 * u ** 3 + 3 * u * u;
    const h11 = u ** 3 - u * u;
    for (let d = 0; d < dims; d++) {
      const y0 = keys[i]![d + 1]!;
      const y1 = keys[i + 1]![d + 1]!;
      out[d] = h00 * y0 + h10 * h * slopes[d]![i]! + h01 * y1 + h11 * h * slopes[d]![i + 1]!;
    }
    return out;
  };
}

// ---------------------------------------------------------------------------------------------
// Ring lofts

/**
 * Builds a surface through `rings` (each `n` points × 3, same count). Closed rings wrap. Optional fan caps.
 * Winding is fixed automatically so normals point away from each ring's centroid.
 */
export function loftRings(rings: Float32Array[], opts: { closed?: boolean; capStart?: boolean; capEnd?: boolean; flip?: boolean } = {}): BufferGeometry {
  const closed = opts.closed ?? true;
  const m = rings.length;
  const n = rings[0]!.length / 3;
  const extra = (opts.capStart ? 1 : 0) + (opts.capEnd ? 1 : 0);
  const pos = new Float32Array((m * n + extra) * 3);
  for (let i = 0; i < m; i++) pos.set(rings[i]!, i * n * 3);
  const idx: number[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < m - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % n;
      const a = i * n + j;
      const b = (i + 1) * n + j;
      const c = (i + 1) * n + j1;
      const d = i * n + j1;
      idx.push(a, b, d, b, c, d);
    }
  }
  let vi = m * n;
  const centroid = (r: Float32Array, out: Vector3): Vector3 => {
    out.set(0, 0, 0);
    for (let j = 0; j < n; j++) out.x += r[j * 3]!, out.y += r[j * 3 + 1]!, out.z += r[j * 3 + 2]!;
    return out.multiplyScalar(1 / n);
  };
  const c = new Vector3();
  if (opts.capStart) {
    centroid(rings[0]!, c);
    pos.set([c.x, c.y, c.z], vi * 3);
    for (let j = 0; j < segs; j++) idx.push(vi, (j + 1) % n, j);
    vi++;
  }
  if (opts.capEnd) {
    centroid(rings[m - 1]!, c);
    pos.set([c.x, c.y, c.z], vi * 3);
    const base = (m - 1) * n;
    for (let j = 0; j < segs; j++) idx.push(vi, base + j, base + ((j + 1) % n));
    vi++;
  }
  // Orientation check on a middle quad: normal must point away from the ring centroid.
  const mi = Math.floor((m - 1) / 2);
  const a = new Vector3().fromArray(pos, (mi * n) * 3);
  const b = new Vector3().fromArray(pos, ((mi + 1) * n) * 3);
  const d = new Vector3().fromArray(pos, (mi * n + 1) * 3);
  const nrm = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(d, a));
  centroid(rings[mi]!, c);
  let flip = nrm.dot(a.clone().sub(c)) < 0;
  if (opts.flip) flip = !flip;
  if (flip) for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2]!, idx[k + 1]!];
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Super-elliptic sections

export interface Section {
  cx: number; cy: number;
  /** Half-widths of the upper and lower halves (blended smoothly through the equator). */
  wT: number; wB: number;
  /** Half-heights above and below cy. */
  hT: number; hB: number;
  /** Exponents (2 = ellipse, larger = boxier) for the upper and lower halves. */
  nT: number; nB: number;
  /** Cockpit tub: points of the upper half with |x − cx| < tubW are lowered by tubD. */
  tubW?: number; tubD?: number;
}

const sgnPow = (v: number, e: number): number => Math.sign(v) * Math.abs(v) ** e;
const smooth01 = (t: number): number => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

/** Writes ring `out` (n points) of a section at station z. Points start at the bottom and go through +x first. */
export function sectionRing(s: Section, z: number, n: number, out: Float32Array, mirrorX = false, tubOut?: Float32Array, tubOff = 0): Float32Array {
  for (let j = 0; j < n; j++) {
    const th = -Math.PI / 2 + (j / n) * Math.PI * 2;
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    const top = sn >= 0;
    const e = 2 / (top ? s.nT : s.nB);
    const w = s.wB + (s.wT - s.wB) * smooth01((sn + 1) / 2);
    let x = s.cx + w * sgnPow(cs, e);
    let y = s.cy + (top ? s.hT : s.hB) * sgnPow(sn, e);
    if (top && s.tubW && s.tubD) {
      const ax = Math.abs(x - s.cx);
      const k = 1 - smooth01((ax - s.tubW * 0.82) / (s.tubW * 0.18));
      y -= s.tubD * k;
      if (tubOut) tubOut[tubOff + j] = k > 0.04 ? 1 : 0;
    }
    if (mirrorX) x = -x;
    out[j * 3] = x;
    out[j * 3 + 1] = y;
    out[j * 3 + 2] = z;
  }
  return out;
}

/**
 * Loft along z through keyed sections. keys rows: [z, cx, cy, wT, wB, hT, hB, nT, nB, tubW, tubD].
 * `stations` z values are sampled from z0 to z1 with a cosine spacing bias toward both ends.
 */
export function sectionLoft(keys: Keys, n: number, stations: number, opts: { capStart?: boolean; capEnd?: boolean; mirrorX?: boolean; zs?: number[]; markTub?: boolean } = {}): BufferGeometry {
  const curve = monotoneCurve(keys);
  const z0 = keys[0]![0]!;
  const z1 = keys[keys.length - 1]![0]!;
  const zs = opts.zs ?? Array.from({ length: stations }, (_, i) => z0 + (z1 - z0) * (0.5 - 0.5 * Math.cos((Math.PI * i) / (stations - 1))));
  const p: number[] = new Array(10).fill(0);
  const tub = opts.markTub ? new Float32Array(zs.length * n + 2) : undefined;
  const rings = zs.map((z, i) => {
    curve(z, p);
    const s: Section = { cx: p[0]!, cy: p[1]!, wT: Math.max(1e-4, p[2]!), wB: Math.max(1e-4, p[3]!), hT: Math.max(1e-4, p[4]!), hB: Math.max(1e-4, p[5]!), nT: p[6]!, nB: p[7]!, tubW: p[8]!, tubD: p[9]! };
    return sectionRing(s, z, n, new Float32Array(n * 3), opts.mirrorX, tub, i * n);
  });
  const g = loftRings(rings, { closed: true, capStart: opts.capStart, capEnd: opts.capEnd, flip: opts.mirrorX });
  if (tub) g.setAttribute('aTub', new BufferAttribute(tub.subarray(0, g.getAttribute('position').count), 1));
  return g;
}

// ---------------------------------------------------------------------------------------------
// Airfoils and wings

/** Closed cambered airfoil loop in chord units: (u along chord 0..1, v normal), `n` points (even). */
export function airfoil(n: number, thick: number, camber: number): [number, number][] {
  const pts: [number, number][] = [];
  const half = n / 2;
  const yt = (x: number): number => 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const yc = (x: number): number => (x < 0.4 ? (camber / 0.16) * (0.8 * x - x * x) : (camber / 0.36) * (0.2 + 0.8 * x - x * x));
  for (let i = 0; i < half; i++) {
    // upper surface TE → LE
    const x = 0.5 + 0.5 * Math.cos((Math.PI * i) / half);
    pts.push([x, yc(x) + yt(x)]);
  }
  for (let i = 0; i < half; i++) {
    // lower surface LE → TE
    const x = 0.5 - 0.5 * Math.cos((Math.PI * i) / half);
    pts.push([x, yc(x) - yt(x)]);
  }
  return pts;
}

export interface WingStation {
  /** Span coordinate (model x). */
  x: number;
  /** Leading edge (y, z). */
  y: number; z: number;
  chord: number;
  /** Incidence (rad): positive = trailing edge higher than the leading edge (chord runs toward −z). */
  angle: number;
}

/** Lofts an airfoil along span stations; chord runs from LE toward −z, rotated up by `angle`. */
export function wingLoft(stations: WingStation[], foil: [number, number][], caps = true): BufferGeometry {
  const n = foil.length;
  const rings = stations.map((s) => {
    const r = new Float32Array(n * 3);
    const ca = Math.cos(s.angle);
    const sa = Math.sin(s.angle);
    for (let j = 0; j < n; j++) {
      const [u, v] = foil[j]!;
      const cu = u * s.chord;
      const cv = v * s.chord;
      // chord direction d = (0, sin a, −cos a); "up" normal of the chord = (0, cos a, sin a)
      r[j * 3] = s.x;
      r[j * 3 + 1] = s.y + cu * sa + cv * ca;
      r[j * 3 + 2] = s.z - cu * ca + cv * sa;
    }
    return r;
  });
  return loftRings(rings, { closed: true, capStart: caps, capEnd: caps });
}

export interface SweepStation { p: Vector3; chord: number; angle: number }

/**
 * Airfoil swept along a curve in the x/y plane (leading edge at `p`, chord towards −z rotated by `angle`): the section
 * plane follows the curve, so a wing can roll down at its tips into a vertical endplate without degenerate sections.
 */
export function sweepFoil(stations: SweepStation[], foil: [number, number][], caps = true): BufferGeometry {
  const n = foil.length;
  const t = new Vector3(), nn = new Vector3(), d = new Vector3(), up = new Vector3();
  const rings = stations.map((s, i) => {
    const a = stations[Math.max(0, i - 1)]!.p, b = stations[Math.min(stations.length - 1, i + 1)]!.p;
    t.subVectors(b, a).normalize();
    nn.set(-t.y, t.x, 0).normalize();
    const ca = Math.cos(s.angle), sa = Math.sin(s.angle);
    d.set(nn.x * sa, nn.y * sa, -ca);
    up.set(nn.x * ca, nn.y * ca, sa);
    const r = new Float32Array(n * 3);
    for (let j = 0; j < n; j++) {
      const [u, v] = foil[j]!;
      r[j * 3] = s.p.x + (d.x * u + up.x * v) * s.chord;
      r[j * 3 + 1] = s.p.y + (d.y * u + up.y * v) * s.chord;
      r[j * 3 + 2] = s.p.z + (d.z * u + up.z * v) * s.chord;
    }
    return r;
  });
  return loftRings(rings, { closed: true, capStart: caps, capEnd: caps });
}

// ---------------------------------------------------------------------------------------------
// Tubes and plates

/** Elliptic tube from a to b; `rx` lies in the horizontal plane (aero profile), `ry` vertical. */
export function tube(a: Vector3, b: Vector3, rx: number, ry: number, sides = 8, segs = 1, caps = true): BufferGeometry {
  const dir = new Vector3().subVectors(b, a);
  const len = dir.length();
  dir.normalize();
  const up = Math.abs(dir.y) > 0.95 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  const side = new Vector3().crossVectors(up, dir).normalize();
  const nup = new Vector3().crossVectors(dir, side).normalize();
  const rings: Float32Array[] = [];
  for (let i = 0; i <= segs; i++) {
    const c = new Vector3().copy(a).addScaledVector(dir, (len * i) / segs);
    const r = new Float32Array(sides * 3);
    for (let j = 0; j < sides; j++) {
      const th = (j / sides) * Math.PI * 2;
      const p = new Vector3().copy(c).addScaledVector(side, Math.cos(th) * rx).addScaledVector(nup, Math.sin(th) * ry);
      r.set([p.x, p.y, p.z], j * 3);
    }
    rings.push(r);
  }
  return loftRings(rings, { closed: true, capStart: caps, capEnd: caps });
}

/** Tube through a polyline of points (smooth curve given by the caller). */
export function tubePath(pts: Vector3[], rx: number, ry: number, sides = 10, caps = true, upHint = new Vector3(0, 1, 0)): BufferGeometry {
  const rings: Float32Array[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const t = new Vector3().subVectors(pts[Math.min(pts.length - 1, i + 1)]!, pts[Math.max(0, i - 1)]!).normalize();
    const side = new Vector3().crossVectors(upHint, t);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const nup = new Vector3().crossVectors(t, side).normalize();
    const r = new Float32Array(sides * 3);
    for (let j = 0; j < sides; j++) {
      const th = (j / sides) * Math.PI * 2;
      const q = new Vector3().copy(p).addScaledVector(side, Math.cos(th) * rx).addScaledVector(nup, Math.sin(th) * ry);
      r.set([q.x, q.y, q.z], j * 3);
    }
    rings.push(r);
  }
  return loftRings(rings, { closed: true, capStart: caps, capEnd: caps });
}

/**
 * Plate in the z/y plane (side profile given as [z, y] points, CCW seen from +x), centred at model `x`, `thick` wide.
 * Optional bevel rounds the edges; `holes` ([z, y] outlines inside the profile) cut slots / louvres through the plate.
 */
export function plateZY(profile: [number, number][], x: number, thick: number, bevel = 0, curveSegs = 4, holes: readonly [number, number][][] = []): BufferGeometry {
  const shape = new Shape();
  // shape (sx, sy) = (−z, y) so that after rotateY(+90°) model z = −sx... see below
  profile.forEach(([z, y], i) => (i === 0 ? shape.moveTo(-z, y) : shape.lineTo(-z, y)));
  shape.closePath();
  for (const h of holes) {
    const path = new Path();
    h.forEach(([z, y], i) => (i === 0 ? path.moveTo(-z, y) : path.lineTo(-z, y)));
    path.closePath();
    shape.holes.push(path);
  }
  const g = new ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, thick - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: curveSegs, steps: 1,
  });
  // Extrusion along +Z(shape); rotateY(+90°): (sx, sy, sz) → (sz, sy, −sx) = (depth, y, z)
  g.rotateY(Math.PI / 2);
  g.translate(x - (thick - 2 * bevel) / 2, 0, 0);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/** Plate in the x/z plane (plan view, [x, z] points), at height y, `thick` tall. */
export function plateXZ(profile: [number, number][], y: number, thick: number, bevel = 0): BufferGeometry {
  const shape = new Shape();
  profile.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z)));
  shape.closePath();
  const g = new ExtrudeGeometry(shape, { depth: Math.max(1e-4, thick - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1 });
  // shape (x, −z) extruded along +Z → rotateX(−90°): (sx, sy, sz) → (sx, sz, −sy) = (x, depth, z)
  g.rotateX(-Math.PI / 2);
  g.translate(0, y - (thick - 2 * bevel) / 2 + bevel, 0);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Merge, mirror, attributes

/** Keeps only position + normal (indexed or not), so parts merge cleanly. */
export function strip(g: BufferGeometry): BufferGeometry {
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  return g;
}

/** Mirror copy across x = 0 (winding fixed). */
export function mirrorX(g: BufferGeometry): BufferGeometry {
  const m = g.clone();
  m.scale(-1, 1, 1);
  const idx = m.getIndex();
  if (idx) {
    const a = idx.array;
    for (let k = 0; k < a.length; k += 3) {
      const t = a[k + 1]!;
      a[k + 1] = a[k + 2]!;
      a[k + 2] = t;
    }
    idx.needsUpdate = true;
  } else {
    const p = m.getAttribute('position');
    const nn = m.getAttribute('normal');
    for (let k = 0; k < p.count; k += 3) {
      for (const attr of [p, nn]) {
        if (!attr) continue;
        const x = attr.getX(k + 1), y = attr.getY(k + 1), z = attr.getZ(k + 1);
        attr.setXYZ(k + 1, attr.getX(k + 2), attr.getY(k + 2), attr.getZ(k + 2));
        attr.setXYZ(k + 2, x, y, z);
      }
    }
  }
  m.computeVertexNormals();
  return m;
}

export function withMirror(g: BufferGeometry): BufferGeometry[] {
  return [g, mirrorX(g)];
}

/** Merge non-indexed copies of every part (position, normal + optional extra float attributes). */
export function mergeParts(parts: BufferGeometry[]): BufferGeometry {
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const names = new Set<string>();
  for (const f of flat) for (const n of Object.keys(f.attributes)) names.add(n);
  for (const f of flat) {
    for (const n of names) {
      if (f.getAttribute(n)) continue;
      const size = flat.find((o) => o.getAttribute(n))!.getAttribute(n).itemSize;
      f.setAttribute(n, new Float32BufferAttribute(new Float32Array(f.getAttribute('position').count * size), size));
    }
  }
  const merged = mergeGeometries(flat, false);
  if (!merged) throw new Error('[car] mergeGeometries failed');
  return merged;
}

/** Adds a constant vec2 `uv` (swatch cell) to a part. */
export function constUv(g: BufferGeometry, u: number, v: number): BufferGeometry {
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    a[i * 2] = u;
    a[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new BufferAttribute(a, 2));
  return g;
}

/** Adds a constant vec3 `color` (vertex colour, linear) to a part. */
export function constColor(g: BufferGeometry, r: number, gg: number, b: number): BufferGeometry {
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([r, gg, b], i * 3);
  g.setAttribute('color', new BufferAttribute(a, 3));
  return g;
}

export function triCount(g: BufferGeometry): number {
  return g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
}

/** Box-projected UVs in metres / `scale` per triangle (non-indexed input) for tiling detail maps. */
export function boxUv(g: BufferGeometry, scale: number): BufferGeometry {
  const p = g.getAttribute('position');
  const uv = new Float32Array(p.count * 2);
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    n.subVectors(b, a).cross(c.clone().sub(a));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c;
      let u = 0, w = 0;
      if (ax >= ay && ax >= az) { u = v.z; w = v.y; } else if (ay >= az) { u = v.x; w = v.z; } else { u = v.x; w = v.y; }
      uv[(i + k) * 2] = u / scale;
      uv[(i + k) * 2 + 1] = w / scale;
    }
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  return g;
}
