// Wheel geometry (rendering.md §7.1, §7.4): tyre, rim and the non-spinning brake/upright assembly, per LOD.
// Local wheel frame: +x = axle pointing to the car's outside, origin = wheel centre. Built for the front width
// (0.305 m); rear wheels use a per-instance x scale of 0.405 / 0.305. 18" rim (bead radius 0.2286 m).
// Rim (spins): barrel, machined lip, team-tinted centre-lock nut and a closed aero WHEEL COVER (2022 show-car look): a
// smooth, slightly dished disc over the whole rim face with a small hub opening the nut shows through. No spokes.
// Every rim vertex carries `aPart` (RIM_PART); wheelAppearance.ts shades by part. Hub (no spin): drum, bell, caliper,
// upright, duct; aDisc marks the part for the hub shader: 1 disc (LOD2 only, glows), 2 caliper, 0 the rest.

import { BufferAttribute, BufferGeometry, CylinderGeometry, Vector3 } from 'three';
import { constUv, mergeParts, strip, tube } from './geom';

export const TYRE_R = 0.36;
export const RIM_R = 0.2286;
export const FRONT_W = 0.305;
export const REAR_W = 0.405;
/** Tyre shoulder radius; the flat tread face spans |x| ≤ FRONT_W / 2 − SHOULDER_R. */
export const SHOULDER_R = 0.035;
/** Aero wheel cover: outer radius (just over the bead), hub opening radius, outboard face x (wheel local). */
export const COVER_R = RIM_R + 0.012;
export const COVER_HOLE_R = 0.045;
export const COVER_X = FRONT_W / 2 - 0.002;
/** Brake disc: inner/outer radius and the outboard face x (wheel local). */
export const DISC_R0 = 0.1;
export const DISC_R1 = 0.168;
export const DISC_X = 0.057;
/** Rim `aPart` ids. */
export const RIM_PART = { barrel: 0, cover: 1, disc: 4, nut: 5, metal: 6 } as const;

export interface WheelLod { tyre: BufferGeometry; rim: BufferGeometry; hub: BufferGeometry }

type Profile = [number, number, number, boolean?][];

/**
 * Revolves a profile [x, r, v] around the x axis. UV: u = angle (0..1), v = profile v.
 * `reverseU` flips u for the inner sidewall so its lettering is not mirrored. `flip` reverses the winding (normals).
 */
function revolve(profile: Profile, seg: number, flip = false): BufferGeometry {
  const n = profile.length;
  const pos = new Float32Array((seg + 1) * n * 3);
  const uv = new Float32Array((seg + 1) * n * 2);
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    for (let j = 0; j < n; j++) {
      const [x, r, v, rev] = profile[j]!;
      const k = i * n + j;
      pos[k * 3] = x;
      pos[k * 3 + 1] = r * c;
      pos[k * 3 + 2] = r * s;
      uv[k * 2] = rev ? 1 - i / seg : i / seg;
      uv[k * 2 + 1] = v;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j, b = (i + 1) * n + j, c = (i + 1) * n + j + 1, d = i * n + j + 1;
      if (flip) idx.push(a, b, d, b, c, d);
      else idx.push(a, d, b, b, d, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // The u seam duplicates the first column: average its normals so the seam does not show as a lighting crease.
  const nrm = g.getAttribute('normal');
  for (let j = 0; j < n; j++) {
    const k = seg * n + j;
    const x = nrm.getX(j) + nrm.getX(k), y = nrm.getY(j) + nrm.getY(k), z = nrm.getZ(j) + nrm.getZ(k);
    const l = Math.hypot(x, y, z) || 1;
    nrm.setXYZ(j, x / l, y / l, z / l);
    nrm.setXYZ(k, x / l, y / l, z / l);
  }
  return g;
}

/** Point at (x, radius, angle) in the wheel frame (same angle convention as `revolve`: y = r·cos a, z = r·sin a). */
const polar = (x: number, r: number, a: number): Vector3 => new Vector3(x, r * Math.cos(a), r * Math.sin(a));

/**
 * Lofts closed cross-section loops (rows[station][point]) into flat-shaded strips, one per loop segment, each wound
 * to face away from the row centre. `caps` closes both ends with fans.
 */
function loftStrips(rows: Vector3[][], caps: boolean): BufferGeometry {
  const pos: number[] = [];
  const centre = rows.map((row) => row.reduce((s, p) => s.add(p), new Vector3()).multiplyScalar(1 / row.length));
  const tri = (a: Vector3, b: Vector3, c: Vector3, out: Vector3): void => {
    const nrm = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    if (nrm.dot(out) < 0) pos.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
    else pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  const parts: BufferGeometry[] = [];
  const m = rows[0]!.length;
  for (let j = 0; j < m; j++) {
    pos.length = 0;
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i]![j]!, b = rows[i]![(j + 1) % m]!, c = rows[i + 1]![(j + 1) % m]!, d = rows[i + 1]![j]!;
      const out = a.clone().add(b).multiplyScalar(0.5).sub(centre[i]!);
      tri(a, b, c, out);
      tri(a, c, d, out);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    parts.push(g);
  }
  if (caps) {
    for (const [i, k] of [[0, 1], [rows.length - 1, rows.length - 2]] as const) {
      pos.length = 0;
      const out = centre[i]!.clone().sub(centre[k]!);
      const row = rows[i]!;
      for (let j = 0; j < m; j++) tri(centre[i]!, row[j]!, row[(j + 1) % m]!, out);
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      parts.push(g);
    }
  }
  const merged = mergeParts(parts);
  merged.computeVertexNormals(); // non-indexed → flat facets (machined look)
  return merged;
}

/** Tyre profile from the outer bead over the tread to the inner bead. v: 0..0.45 outer sidewall, 0.5 tread, 0.55..1 inner. */
function tyreProfile(lod: 0 | 1 | 2): Profile {
  const h = FRONT_W / 2;
  const R = TYRE_R;
  const S = SHOULDER_R;
  const rb = RIM_R + 0.004;
  if (lod === 2) return [[h - 0.02, rb, 0, true], [h, R - 0.05, 0.3, true], [h - 0.03, R, 0.5], [-h + 0.03, R, 0.5], [-h, R - 0.05, 0.3], [-h + 0.02, rb, 0]];
  // Sidewall: rim protector at the bead, the widest bulge at ~60 % height, then it rolls into the shoulder arc.
  const wall = (t: number): number => -0.014 + 0.02 * Math.sin(Math.pow(t, 0.8) * Math.PI * 0.92);
  const pts: Profile = [];
  const outerSide = lod === 0 ? 7 : 3;
  const innerSide = lod === 0 ? 4 : 2;
  const sh = lod === 0 ? 4 : 2;
  for (let i = 0; i <= outerSide; i++) {
    const t = i / outerSide;
    pts.push([h + wall(t), rb + (R - S - rb) * t, 0.02 + 0.42 * t, true]);
  }
  const x0 = h + wall(1);
  // Shoulder arc from the sidewall top to the tread, then a slight crown across the tread face.
  for (let i = 1; i <= sh; i++) {
    const a = (i / sh) * (Math.PI / 2);
    pts.push([h - S + (x0 - h + S) * Math.cos(a), R - S + S * Math.sin(a), 0.44 + 0.06 * (i / sh), true]);
  }
  if (lod === 0) for (const f of [0.5, 0, -0.5]) pts.push([f * (h - S), R + 0.0015 * (1 - f * f), 0.5]);
  for (let i = 0; i < sh; i++) {
    const a = Math.PI / 2 + (i / sh) * (Math.PI / 2);
    pts.push([-h + S + (x0 - h + S) * Math.cos(a), R - S + S * Math.sin(a), 0.5 - 0.06 * (i / sh)]);
  }
  for (let i = innerSide; i >= 0; i--) {
    const t = i / innerSide;
    pts.push([-h - wall(t), rb + (R - S - rb) * t, 0.02 + 0.42 * t]);
  }
  return pts;
}

/** Sets a constant `aPart` (rim) attribute. */
function part(g: BufferGeometry, id: number): BufferGeometry {
  g.setAttribute('aPart', new BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(id), 1));
  if (!g.getAttribute('uv')) constUv(g, 0.5, 0.5);
  return g;
}

/** Cylinder along +x (radiusTop at the outboard end), flat-shaded when `facets`. */
function xCyl(rOut: number, rIn: number, len: number, x: number, sides: number, facets: boolean): BufferGeometry {
  let g: BufferGeometry = new CylinderGeometry(rOut, rIn, len, sides, 1, false).rotateZ(-Math.PI / 2).translate(x, 0, 0);
  if (facets) {
    g = g.toNonIndexed();
    g.deleteAttribute('normal');
  }
  return strip(g);
}

/**
 * Closed aero cover: a revolved, closed profile (outer face → rolled rim edge → back face → hub lip), slightly dished
 * towards the hub. Indexed and watertight; normals point out of the shell.
 */
function coverGeometry(lod: 0 | 1 | 2, seg: number): BufferGeometry {
  const X = COVER_X, R = COVER_R, H = COVER_HOLE_R;
  const prof: [number, number][] = lod === 2
    ? [[X, H], [X, R], [X - 0.008, R], [X - 0.008, H]]
    : lod === 1
      ? [[X - 0.003, H], [X, 0.12], [X - 0.002, R - 0.006], [X - 0.007, R], [X - 0.01, 0.12], [X - 0.008, H]]
      : [[X - 0.004, H + 0.001], [X - 0.0005, H + 0.012], [X, 0.12], [X - 0.0015, R - 0.016], [X - 0.004, R - 0.004], [X - 0.008, R],
        [X - 0.011, R - 0.006], [X - 0.009, 0.12], [X - 0.01, H + 0.01], [X - 0.008, H - 0.001]];
  const n = prof.length;
  const pos = new Float32Array(seg * n * 3);
  const uv = new Float32Array(seg * n * 2).fill(0.5);
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    for (let j = 0; j < n; j++) {
      const [x, r] = prof[j]!;
      pos.set([x, r * Math.cos(a), r * Math.sin(a)], (i * n + j) * 3);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < seg; i++) {
    const i1 = (i + 1) % seg;
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      const a = i * n + j, b = i1 * n + j, c = i1 * n + j1, d = i * n + j1;
      idx.push(a, b, d, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(idx);
  // Orientation: the outer face (profile point at r 0.12) must face +x.
  const k = prof.findIndex(([, r]) => r === 0.12);
  const v = (q: number): Vector3 => new Vector3().fromBufferAttribute(g.getAttribute('position') as BufferAttribute, q);
  const e1 = v(n + k).sub(v(k)), e2 = v(k + 1).sub(v(k));
  if (e1.cross(e2).x < 0) {
    for (let q = 0; q < idx.length; q += 3) [idx[q + 1], idx[q + 2]] = [idx[q + 2]!, idx[q + 1]!];
    g.setIndex(idx);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Rim. LOD0: barrel, machined lip, nut, cover. LOD1: barrel, nut, cover. LOD2: barrel + cover. The cover hides the
 * rim face and the disc, so neither is modelled behind it.
 */
function rimGeometry(lod: 0 | 1 | 2, seg: number): BufferGeometry {
  const h = FRONT_W / 2;
  const R = RIM_R;
  const P = RIM_PART;
  const parts: BufferGeometry[] = [];
  parts.push(part(revolve([[-h + 0.03, R, 1], [h - 0.02, R, 1]], seg), P.barrel));
  parts.push(part(coverGeometry(lod, seg), P.cover));
  if (lod === 2) return mergeParts(parts);
  // Centre-lock nut (seen through the hub opening): hex body, chamfered hex front, safety pin; washer behind.
  parts.push(part(xCyl(0.03, 0.03, 0.024, h - 0.022, 6, true), P.nut));
  parts.push(part(xCyl(0.021, 0.03, 0.006, h - 0.007, 6, true), P.nut));
  if (lod === 0) parts.push(part(xCyl(0.009, 0.009, 0.012, h - 0.002, 8, false), P.metal));
  parts.push(part(xCyl(0.046, 0.046, 0.01, h - 0.012, lod === 0 ? 16 : 8, false), P.metal));
  if (lod === 0) {
    // Machined lip just behind the cover edge (a thin bright line around the cover).
    parts.push(part(revolve([[h - 0.014, R + 0.006, 1], [h - 0.005, R + 0.002, 1], [h - 0.003, R - 0.005, 0.99]], seg, true), P.metal));
  }
  return mergeParts(parts);
}

/** Caliper: a chamfered box section swept along the disc edge (top-rear quadrant), straddling the disc. */
function caliper(n: number): BufferGeometry {
  const x0 = DISC_X - 0.048, x1 = DISC_X + 0.02, r0 = DISC_R0 + 0.014, r1 = DISC_R1 + 0.024, c = 0.009;
  const sec: [number, number][] = [[x0 + c, r0], [x1 - c, r0], [x1, r0 + c], [x1, r1 - c], [x1 - c, r1], [x0 + c, r1], [x0, r1 - c], [x0, r0 + c]];
  const mid = -0.55, half = 0.48;
  const loops: Vector3[][] = [];
  for (let i = 0; i <= n; i++) {
    const a = mid - half + (2 * half * i) / n;
    loops.push(sec.map(([x, r]) => polar(x, r, a)));
  }
  return loftStrips(loops, true);
}

/** Brake drum/duct + caliper + upright (non-spinning); LOD2 also carries the disc here. aDisc = 1 marks glowing disc vertices. */
function hubGeometry(lod: 0 | 1 | 2, seg: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const mark = (g: BufferGeometry, disc: number): BufferGeometry => {
    const n = g.getAttribute('position').count;
    g.setAttribute('aDisc', new BufferAttribute(new Float32Array(n).fill(disc), 1));
    return g;
  };
  const cyl = (r: number, w: number, x: number, s = seg): BufferGeometry => strip(new CylinderGeometry(r, r, w, s, 1, false).rotateZ(Math.PI / 2).translate(x, 0, 0));
  if (lod === 2) {
    parts.push(mark(cyl(DISC_R1, 0.034, 0.04), 1));
  } else {
    // Carbon drum behind the disc and the disc bell.
    parts.push(mark(cyl(0.192, 0.11, -0.05), 0));
    parts.push(mark(cyl(0.085, 0.03, 0.065, Math.max(8, seg / 2)), 0));
    parts.push(mark(caliper(lod === 0 ? 6 : 3), 2));
    // Upright arms toward the wishbone pick-ups (inboard).
    parts.push(mark(tube(new Vector3(-0.08, 0.0, 0), new Vector3(-0.14, 0.15, 0), 0.025, 0.025, 5, 1, true), 0));
    parts.push(mark(tube(new Vector3(-0.08, 0.0, 0), new Vector3(-0.14, -0.15, 0), 0.025, 0.025, 5, 1, true), 0));
    // Brake duct scoop (front of the drum).
    parts.push(mark(strip(new CylinderGeometry(0.05, 0.065, 0.12, 8, 1, true).rotateX(Math.PI / 2).scale(1.4, 0.8, 1).translate(-0.09, -0.02, 0.17)), 0));
  }
  return mergeParts(parts.map((p) => constUv(p, 0.5, 0.5)));
}

const SEG: Record<0 | 1 | 2, number> = { 0: 56, 1: 18, 2: 8 };

export function buildWheels(lod: 0 | 1 | 2): WheelLod {
  const seg = SEG[lod];
  const tyre = revolve(tyreProfile(lod), seg);
  const rim = rimGeometry(lod, seg);
  const hub = hubGeometry(lod, Math.max(8, seg / 2));
  for (const g of [tyre, rim, hub]) g.computeBoundingSphere();
  return { tyre, rim, hub };
}

export function wheelTriangles(w: WheelLod): number {
  const t = (g: BufferGeometry): number => (g.index ? g.index.count / 3 : g.getAttribute('position').count / 3);
  return t(w.tyre) + t(w.rim) + t(w.hub);
}
