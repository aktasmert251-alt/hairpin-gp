// Car rear (2022-regulation show-car look), called from carModel.buildBody via `buildRear(ctx)`: a one-piece rear wing
// (straight cambered aerofoil with a gurney lip whose trailing third is the DRS section behind a fine seam) between thin
// rounded, tapering painted endplates with louvres, a slim central swan-neck pylon, gearbox + crash structure with the
// rain light and exhaust, a detailed floor (scrolled edge, edge-wing cascade, edge strakes, mouse-hole, plank with titanium
// skids, vortex generators, venturi inlet fences) and a large clean diffuser (smooth upswept tunnel roof, sidewalls,
// short strakes flush with the roof, trailing-edge lip).
// Model space as carParts.ts: +Z nose, +Y up, +X left; rear axle z -1.638. Every part is a closed mesh. Materials: wing
// top in the livery (aTag -1 / swatch), carbon wing underside (SW.carbon), woven carbon floor/diffuser with matte and satin
// trim parts, emissive rain light; parts merge into carModel's material groups (no extra draws).
// Three rear styles (wing upsweep, endplate sweep, louvres, strake count) are assigned per car concept.

import { BoxGeometry, BufferAttribute, BufferGeometry, CatmullRomCurve3, CylinderGeometry, Vector3 } from 'three';
import { SW, tagPart } from './atlas';
import { type ConceptId, deg, type Detail, type Part, type PartBuildCtx, REAR_FLAP_PIVOT, REAR_WING, rounded, TRIM, trimUv, V } from './carParts';
import {
  airfoil, constColor, constUv, mergeParts, mirrorX, plateXZ, plateZY, sectionLoft, strip, tube, tubePath,
  type WingStation, wingLoft,
} from './geom';

type RearPart = Part;

export type RearStyleId = 'classic' | 'swept' | 'tall';
interface RearStyle {
  /** Wing upsweep toward the endplates (m at the tips; 0 = dead straight). */
  upsweep: number;
  /** Endplate lower edge: how far it sweeps up toward the leading edge (m). */
  sweep: number;
  /** Louvre cut-outs in each endplate (LOD0, at most 2 on the compact endplates). */
  louvres: number;
  /** Diffuser strakes per side (between the keel and the sidewall). */
  strakes: number;
}
const STYLES: Readonly<Record<RearStyleId, RearStyle>> = {
  classic: { upsweep: 0.025, sweep: 0.06, louvres: 2, strakes: 2 },
  swept: { upsweep: 0.0, sweep: 0.12, louvres: 3, strakes: 3 },
  tall: { upsweep: 0.045, sweep: 0.03, louvres: 2, strakes: 2 },
};
const CONCEPT_REAR: Readonly<Record<ConceptId, RearStyleId>> = { arrow: 'classic', bathtub: 'swept', overbite: 'tall', slim: 'swept' };
export const rearStyleOf = (c: ConceptId): RearStyleId => CONCEPT_REAR[c];

const trim = (g: BufferGeometry, cell: number): RearPart => ({ g: constUv(g, ...trimUv(cell)), mat: 'trim', tag: cell });
const carbon = (g: BufferGeometry): RearPart => ({ g, mat: 'carbon', tag: 0 });
const paint = (g: BufferGeometry): RearPart => ({ g: tagPart(g, -1), mat: 'paint', tag: -2 });
const both = (p: RearPart): RearPart[] => [p, { ...p, g: mirrorX(p.g.clone()) }];

/**
 * Rear wing (the 89a5bcc look, as one piece): a straight cambered aerofoil (chord 0.5 m) between compact rounded endplates.
 * The DRS split runs diagonally through the section (upper surface at REAR_WING.cutUpper, lower at cutLower) behind a
 * 2 mm seam, so closed the wing reads as one surface; the flap (separate mesh) hinges near its trailing edge at
 * REAR_FLAP_PIVOT and opens leading edge up (DRS_FLAP_OPEN), leaving a real slot over the main plane's thin trailing
 * edge. Its ends run flush along the endplates' inner faces; a centre actuator pod on the main plane carries the flap's
 * linkage blade (part of the flap mesh, sliding out of the pod as the flap opens).
 */
const HALF_SPAN = 0.552;
const EP_X = 0.56;
const WING = { chord: REAR_WING.chord, angle: REAR_WING.angle, thick: 0.1, camber: -0.05, gurney: 0.03 } as const;
const WING_LE = REAR_WING.le;
const CUT_U = REAR_WING.cutUpper, CUT_L = REAR_WING.cutLower, SEAM = 0.004;
/** Section thickness / camber (chord units) and the upper / lower surfaces. */
const yt = (x: number): number => 5 * WING.thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
const yc = (x: number): number => WING.camber * 4 * x * (1 - x);
const yUp = (x: number): number => yc(x) + yt(x);
const yLo = (x: number): number => yc(x) - yt(x);
/** Model-space [z, y] of the centre section at chord fraction u, normal offset v (chord units) plus `dv` metres. */
function wingPt(u: number, v: number, dv = 0): [number, number] {
  const cu = u * WING.chord, cv = v * WING.chord + dv, ca = Math.cos(WING.angle), sa = Math.sin(WING.angle);
  return [WING_LE.z - cu * ca + cv * sa, WING_LE.y + cu * sa + cv * ca];
}
/** Same point stored relative to the flap hinge (flap mesh space). */
const flapPt = (u: number, v: number, dv = 0): [number, number] => {
  const [z, y] = wingPt(u, v, dv);
  return [z - REAR_FLAP_PIVOT.z, y - REAR_FLAP_PIVOT.y];
};

/**
 * Compact endplate outline ([z, y], before rounding; top chain = indices 1..8, front to back) and its chord mapping:
 * wing chord + 4 cm long, a rounded top rising from the leading edge to just over the open flap's nose and easing down
 * to the trailing edge, a short swept lower edge ~6 cm under the wing; follows the wing's tip upsweep.
 */
function endplateProfile(s: RearStyle): { prof: [number, number][]; zl: (k: number) => number } {
  const up = s.upsweep, sw = s.sweep * 0.25;
  const z0 = wingPt(0, 0)[0] + 0.022, z1 = wingPt(1, 0)[0] - 0.016;
  const zl = (k: number): number => z0 + (z1 - z0) * k;
  const prof: [number, number][] = [
    [zl(0.03), 0.7 + up + sw], [zl(0), 0.745 + up], [zl(0.02), 0.79 + up], [zl(0.1), 0.835 + up], [zl(0.28), 0.893 + up], [zl(0.5), 0.912 + up],
    [zl(0.8), 0.916 + up], [zl(0.97), 0.91 + up], [zl(1), 0.89 + up], [zl(1), 0.815 + up], [zl(0.75), 0.775 + up], [zl(0.4), 0.725 + up],
    [zl(0.15), 0.7 + up + sw * 0.5],
  ];
  return { prof, zl };
}

/**
 * DRS geometry check (tests): with the flap opened by `theta`, the slot = shortest distance from the main plane's
 * trailing-edge lip to the flap section (m), and the clearance = how far the flap's tip section stays below the
 * endplate's top edge (m, minimum over the flap; negative = the flap would show above the plate).
 */
export function drsGeometry(style: RearStyleId, theta: number): { slot: number; clearance: number } {
  const s = STYLES[style];
  const sec = foilSection(CUT_U + SEAM, 1, CUT_L + SEAM, 1, 24).map(([u, v]) => wingPt(u, v));
  const c = Math.cos(-theta), sn = Math.sin(-theta);
  const open = sec.map(([z, y]): [number, number] => {
    const dz = z - REAR_FLAP_PIVOT.z, dy = y - REAR_FLAP_PIVOT.y;
    return [REAR_FLAP_PIVOT.z + dy * sn + dz * c, REAR_FLAP_PIVOT.y + dy * c - dz * sn];
  });
  const [tz, ty] = wingPt(CUT_L, yLo(CUT_L));
  let slot = Infinity;
  for (let i = 0; i < open.length; i++) {
    const [az, ay] = open[i]!, [bz, by] = open[(i + 1) % open.length]!;
    const vz = bz - az, vy = by - ay;
    const t = Math.min(1, Math.max(0, ((tz - az) * vz + (ty - ay) * vy) / (vz * vz + vy * vy || 1)));
    slot = Math.min(slot, Math.hypot(tz - az - t * vz, ty - ay - t * vy));
  }
  const top = endplateProfile(s).prof.slice(1, 9);
  const topAt = (z: number): number => {
    for (let i = 0; i < top.length - 1; i++) {
      const [az, ay] = top[i]!, [bz, by] = top[i + 1]!;
      if (z <= az && z >= bz) return ay + ((by - ay) * (z - az)) / (bz - az || 1);
    }
    return -Infinity;
  };
  let clearance = Infinity;
  for (const [z, y] of open) clearance = Math.min(clearance, topAt(z) - (y + s.upsweep));
  return { slot, clearance };
}

/** Diffuser: start/end z, half width, roof height at the start, total upsweep. */
// Modern (2022-style) proportions: the tunnel kicks up from just ahead of the rear axle and exits just behind the rear
// tyres, under the beam wing / rear-wing leading edge, instead of trailing far behind the car.
const DIF = { z0: -1.3, z1: -2.1, half: 0.56, y0: 0.058, rise: 0.27 } as const;
/** Diffuser roof (underside of the floor) height at z; smooth, steepening toward the exit. */
export function diffuserRoof(z: number): number {
  const t = Math.min(1, Math.max(0, (DIF.z0 - z) / (DIF.z0 - DIF.z1)));
  return DIF.y0 + DIF.rise * t * t * (1.55 - 0.55 * t);
}

/**
 * Closed slab over a height field: top surface y = top(x, z) on an nx × nz grid, bottom = top − thick, plus four side
 * walls. Built as separate indexed sheets (crisp edges, smooth inside each sheet) and merged.
 */
function heightSlab(x0: number, x1: number, z0: number, z1: number, nx: number, nz: number, top: (x: number, z: number) => number, thick: number): BufferGeometry {
  const sheet = (pt: (i: number, j: number) => Vector3, ni: number, nj: number, flip: boolean): BufferGeometry => {
    const pos = new Float32Array((ni + 1) * (nj + 1) * 3);
    for (let i = 0; i <= ni; i++) for (let j = 0; j <= nj; j++) {
      const p = pt(i, j);
      pos.set([p.x, p.y, p.z], (i * (nj + 1) + j) * 3);
    }
    const idx: number[] = [];
    for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) {
      const a = i * (nj + 1) + j, b = a + nj + 1, c = b + 1, d = a + 1;
      if (flip) idx.push(a, d, b, b, d, c);
      else idx.push(a, b, d, b, c, d);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  const X = (i: number): number => x0 + ((x1 - x0) * i) / nx;
  const Z = (j: number): number => z0 + ((z1 - z0) * j) / nz;
  const up = (x: number, z: number): Vector3 => V(x, top(x, z), z);
  const dn = (x: number, z: number): Vector3 => V(x, top(x, z) - thick, z);
  const parts = [
    sheet((i, j) => up(X(i), Z(j)), nx, nz, z1 > z0),
    sheet((i, j) => dn(X(i), Z(j)), nx, nz, z1 <= z0),
    // Side walls: i runs along the edge, j = 0 bottom / 1 top.
    sheet((i, j) => (j ? up(X(0), Z(i)) : dn(X(0), Z(i))), nz, 1, z1 > z0),
    sheet((i, j) => (j ? up(X(nx), Z(i)) : dn(X(nx), Z(i))), nz, 1, z1 <= z0),
    sheet((i, j) => (j ? up(X(i), Z(0)) : dn(X(i), Z(0))), nx, 1, z1 <= z0),
    sheet((i, j) => (j ? up(X(i), Z(nz)) : dn(X(i), Z(nz))), nx, 1, z1 > z0),
  ];
  return mergeParts(parts);
}

/**
 * Closed aerofoil section (NACA-style thickness + camber, cosine spacing): upper surface bu -> au, then lower al -> bl
 * (same order as geom.airfoil). Different upper / lower start fractions give the diagonal DRS split face (the ring
 * closes with a straight edge). When bu = 1 the trailing edge carries a small gurney lip (crisp TE).
 */
function foilSection(au: number, bu: number, al: number, bl: number, n: number): [number, number][] {
  const span = (a: number, b: number): number[] => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * (0.5 - 0.5 * Math.cos((Math.PI * i) / n)));
  const up: [number, number][] = span(au, bu).reverse().map((x) => [x, yUp(x)]);
  const lo: [number, number][] = span(al, bl).map((x) => [x, yLo(x)]);
  if (bu === 1) {
    const te = up[0]!;
    up.unshift([1, te[1] + WING.gurney], [0.988, te[1] + WING.gurney]);
    up.splice(2, 1, [0.988, te[1] + 0.002]);
  }
  return au === 0 && al === 0 ? [...up, ...lo.slice(1)] : [...up, ...lo];
}

/** Per-vertex paint tags on a lofted foil (rings of `n` points, then two cap centres): upper surface `top`, rest `under`. */
function tagFoil(g: BufferGeometry, n: number, upperCount: number, top: number, under: number = SW.carbon): BufferGeometry {
  const count = g.getAttribute('position').count;
  const t = new Float32Array(count).fill(under);
  for (let i = 0; i < count - 2; i++) if (i % n < upperCount) t[i] = top;
  g.setAttribute('aTag', new BufferAttribute(t, 1));
  return g;
}

function rearWing(d: Detail, s: RearStyle, parts: RearPart[]): void {
  const n = d.lod === 0 ? 14 : d.lod === 1 ? 6 : 3;
  const nr = Math.max(2, Math.round(n / 2));
  const spanN = d.lod === 0 ? 12 : d.lod === 1 ? 4 : 1;
  const stations: WingStation[] = [];
  for (let i = 0; i <= spanN; i++) {
    const x = -HALF_SPAN + (2 * HALF_SPAN * i) / spanN;
    const xn = Math.abs(x) / HALF_SPAN;
    stations.push({ x, y: WING_LE.y + s.upsweep * xn * xn, z: WING_LE.z, chord: WING.chord, angle: WING.angle });
  }
  // Main plane (LOD2: the whole chord, no DRS split): livery on top (plan-view projection: team colour + title sponsor),
  // carbon underside. Its trailing edge is the thin lower lip under the diagonal split.
  const whole = d.lod === 2;
  const front = whole ? foilSection(0, 1, 0, 1, n) : foilSection(0, CUT_U, 0, CUT_L, n);
  parts.push({ g: tagFoil(wingLoft(stations, front), front.length, whole ? n + 3 : n + 1, -1), mat: 'paint', tag: -2 });
  if (!whole) {
    // DRS flap with the gurney lip, 2 mm behind the split. Its mesh is stored about the hinge (the projection cannot be
    // used there), so its top takes the primary swatch, the colour the plan view puts under it; underside in the
    // secondary colour (from behind at eye level a wing shows its underside: a livery band, not a black hoop).
    const rear = foilSection(CUT_U + SEAM, 1, CUT_L + SEAM, 1, nr);
    const flap = tagFoil(wingLoft(stations, rear), rear.length, nr + 3, SW.primary, SW.secondary);
    if (d.lod === 0) {
      flap.translate(0, -REAR_FLAP_PIVOT.y, -REAR_FLAP_PIVOT.z);
      parts.push({ g: flap, mat: 'flap', tag: -2 });
    } else parts.push({ g: flap, mat: 'paint', tag: -2 });
  }
  if (d.lod === 0) {
    // DRS actuator pod on the centre line (fixed, on the main plane just ahead of the flap; its back leans forward so
    // the rising flap nose clears it) and the linkage blade (flap mesh): closed it hides inside the pod / main plane /
    // flap, open it shows between the pod top and the flap nose and still reaches into the pod.
    const pod: [number, number][] = [
      wingPt(CUT_U - 0.2, yUp(CUT_U - 0.2), -0.008), wingPt(CUT_U - 0.17, yUp(CUT_U - 0.17), 0.045), wingPt(CUT_U - 0.12, yUp(CUT_U - 0.12), 0.066),
      wingPt(CUT_U - 0.06, yUp(CUT_U - 0.06), 0.07), wingPt(CUT_U - 0.034, yUp(CUT_U - 0.034), 0.064), wingPt(CUT_U - 0.014, yUp(CUT_U - 0.014), -0.006),
    ];
    parts.push(carbon(plateZY(rounded(pod, 1, [0, 5]), 0, 0.02, 0.004)));
    const sl = (u: number): number => yUp(CUT_U) + ((yLo(CUT_L) - yUp(CUT_U)) * (u - CUT_U)) / (CUT_L - CUT_U);
    const blade: [number, number][] = [
      flapPt(CUT_U + 0.06, yUp(CUT_U + 0.06), -0.006), flapPt(CUT_U + 0.06, sl(CUT_U + 0.06), 0.006),
      flapPt(CUT_U - 0.004, yLo(CUT_U - 0.004), 0.008), flapPt(CUT_U - 0.07, yLo(CUT_U - 0.07), 0.008),
      flapPt(CUT_U - 0.07, yUp(CUT_U - 0.07), -0.004), flapPt(CUT_U - 0.004, yUp(CUT_U - 0.004), -0.003),
    ];
    parts.push({ g: tagPart(plateZY(blade, 0, 0.008), SW.carbon), mat: 'flap', tag: -2 });
  }
  // Compact thin endplates (user: smaller, much shorter than 89a5bcc's): wing chord + 4 cm long, a rounded top that
  // rises from the leading edge to just over the open flap's nose and eases down to the trailing edge, a short swept
  // lower edge ~6 cm under the wing. Follows the wing's tip upsweep; 2 louvres in the upper rear corner.
  const up = s.upsweep;
  const { prof, zl } = endplateProfile(s);
  const holes: [number, number][][] = [];
  if (d.lod === 0) for (let k = 0; k < Math.min(2, s.louvres); k++) {
    const y = 0.884 + up - k * 0.02;
    holes.push([[zl(0.6), y], [zl(0.86), y + 0.008], [zl(0.86), y + 0.017], [zl(0.6), y + 0.009]]);
  }
  const ep = plateZY(d.lod === 2 ? prof : rounded(prof, d.lod === 0 ? 2 : 1, [0]), EP_X, 0.012, d.lod === 0 ? 0.004 : 0, 4, holes);
  parts.push(...both(paint(ep)));
  if (d.lod === 2) return;
  // Slim central swan-neck pylon from the crash structure over the leading edge, hanging the wing from its top surface.
  const neck: [number, number][] = [
    [-1.97, 0.44], [-1.99, 0.6], [-2.02, 0.73], [-2.06, 0.8], [-2.12, 0.832], [-2.2, 0.836], [-2.26, 0.822], [-2.27, 0.8],
    [-2.18, 0.797], [-2.11, 0.79], [-2.075, 0.75], [-2.07, 0.62], [-2.1, 0.44],
  ];
  parts.push(paint(plateZY(d.lod === 0 ? rounded(neck, 1, [0, neck.length - 1]) : neck, 0, 0.02, d.lod === 0 ? 0.005 : 0)));
}

function rearStructure(d: Detail, parts: RearPart[]): void {
  const ring = Math.max(8, d.ring / 2);
  parts.push(carbon(sectionLoft([
    [-1.45, 0, 0.27, 0.13, 0.13, 0.13, 0.13, 3, 3, 0, 0],
    [-2.05, 0, 0.3, 0.09, 0.09, 0.1, 0.1, 3, 3, 0, 0],
  ], ring, 2, { capEnd: true })));
  // Crash structure: tapering, slightly drooping box ending in the rain-light face.
  // Compact: it ends under the middle of the rear wing (well inside the endplates' trailing edge).
  parts.push(carbon(sectionLoft([
    [-1.98, 0, 0.41, 0.075, 0.075, 0.07, 0.07, 2.8, 2.8, 0, 0],
    [-2.2, 0, 0.405, 0.058, 0.058, 0.054, 0.05, 2.8, 2.8, 0, 0],
    [-2.37, 0, 0.4, 0.046, 0.046, 0.042, 0.04, 2.8, 2.8, 0, 0],
  ], ring, d.lod === 0 ? 5 : 2, { capEnd: true })));
  // Rain light (emissive red; carVisuals drives its intensity).
  const light = strip(new BoxGeometry(0.074, 0.046, 0.012).translate(0, 0.4, -2.372));
  parts.push({ g: constColor(light, 1, 0.1, 0.1), mat: 'emissive', tag: 0 });
  if (d.lod === 2) return;
  const ex = tube(V(0, 0.552, -2.12), V(0, 0.555, -2.3), 0.044, 0.041, d.tube + 2, 1, true);
  parts.push(trim(ex, TRIM.exhaust));
  const exIn = strip(new CylinderGeometry(0.036, 0.036, 0.004, d.tube + 2).rotateX(Math.PI / 2).translate(0, 0.554, -2.302));
  parts.push(trim(exIn, TRIM.inletBlack));
}

function floor(d: Detail, parts: RearPart[]): void {
  // Outline with the mouse-hole cut-out ahead of the rear tyre.
  const half: [number, number][] = [
    [0.3, 1.28], [0.46, 1.08], [0.64, 0.72], [0.79, 0.42], [0.83, 0.05], [0.83, -0.7], [0.74, -0.78], [0.7, -0.9], [0.74, -1.0],
    [0.68, -1.1], [0.6, -1.2], [0.56, -1.3],
  ];
  const outline: [number, number][] = [...half, ...[...half].reverse().map(([x, z]) => [-x, z] as [number, number])];
  // Woven carbon floor plate; matte raw-carbon / satin parts on it so the shapes read against each other.
  parts.push(carbon(plateXZ(outline, 0.058, 0.022)));
  parts.push(trim(strip(new BoxGeometry(0.3, 0.02, 2.3).translate(0, 0.037, 0.05)), TRIM.rubber));
  if (d.lod === 2) return;
  // Titanium skid blocks set into the plank.
  if (d.lod === 0) for (const z of [0.95, 0.55, 0.0, -0.45, -0.95]) parts.push(trim(strip(new BoxGeometry(0.1, 0.008, 0.1).translate(0, 0.031, z)), TRIM.titanium));
  // Scrolled floor edge: a curled lip rolling up and inward along the outer edge.
  const edge = new CatmullRomCurve3([V(0.79, 0.08, 0.42), V(0.825, 0.092, 0.0), V(0.828, 0.096, -0.4), V(0.81, 0.09, -0.68)]).getPoints(d.lod === 0 ? 14 : 4);
  parts.push(...both(carbon(tubePath(edge, 0.016, 0.034, d.lod === 0 ? 10 : 6))));
  // Curl inside the lip (thin blade folded over the floor top).
  const curl = edge.map((p) => V(p.x - 0.03, p.y + 0.022, p.z));
  parts.push(...both(trim(tubePath(curl, 0.022, 0.006, 6), TRIM.satinBlack)));
  // Edge-wing cascade ahead of the rear tyre (3 small elements, stepping up and back), and edge strakes on the floor top.
  const ewFoil = airfoil(Math.max(6, d.foil - 10), 0.1, 0.06);
  const elems = d.lod === 0 ? 3 : 1;
  for (let k = 0; k < elems; k++) {
    const ew: WingStation[] = [];
    for (let i = 0; i <= 3; i++) ew.push({ x: 0.64 + 0.18 * (i / 3), y: 0.1 + 0.03 * k + 0.02 * (i / 3), z: -0.74 - 0.09 * k, chord: 0.12 - 0.015 * k, angle: deg(16 + 8 * k) });
    parts.push(...both(trim(wingLoft(ew, ewFoil), TRIM.satinBlack)));
  }
  if (d.lod === 0) {
    for (const [z, h] of [[-0.1, 0.05], [-0.3, 0.06], [-0.5, 0.07]] as const) {
      const fin = plateZY([[z, 0.07], [z - 0.02, 0.07 + h], [z - 0.12, 0.07 + h * 0.6], [z - 0.14, 0.07]], 0.77, 0.006);
      parts.push(...both(trim(fin, TRIM.satinBlack)));
    }
    // Vortex generators on the floor under the sidepod (small swept triangles, toed outward).
    for (const [x, z] of [[0.6, 0.55], [0.66, 0.35], [0.72, 0.15]] as const) {
      const vg = plateZY([[0, 0.068], [-0.11, 0.068], [-0.1, 0.115]], 0, 0.006).rotateY(-0.25).translate(x, 0, z);
      parts.push(...both(trim(vg, TRIM.satinBlack)));
    }
  }
  // Venturi inlet fences under the sidepod leading edge: rounded blades curving outboard, faired into the floor.
  const fx = d.lod === 0 ? [0.18, 0.29, 0.4, 0.52] : [0.29, 0.52];
  for (const x of fx) {
    const k = (x - 0.18) / 0.34;
    const zf = 1.2 - 0.26 * k, zr = 0.5 - 0.1 * k, h = 0.15 - 0.03 * k;
    const prof: [number, number][] = [[zf, 0.05], [zf + 0.01, h - 0.03], [zf - 0.05, h], [zf - 0.3, h - 0.01], [zr + 0.08, 0.075], [zr - 0.1, 0.05]];
    const fence = plateZY(prof, x, 0.008, 0, 4);
    const fp = fence.getAttribute('position');
    for (let i = 0; i < fp.count; i++) {
      const t = Math.min(1, Math.max(0, (zf - fp.getZ(i)) / (zf - zr)));
      fp.setX(i, fp.getX(i) + 0.07 * t * t);
    }
    fence.computeVertexNormals();
    parts.push(...both(trim(fence, TRIM.rawCarbon)));
  }
}

function diffuser(d: Detail, s: RearStyle, parts: RearPart[]): void {
  // Tunnel roof: one smooth upswept slab (no steps), a slight arch across each half, and a kicked-up trailing-edge lip.
  const nz = d.lod === 0 ? 10 : d.lod === 1 ? 4 : 2;
  const nx = d.lod === 0 ? 8 : 1;
  const arch = (x: number): number => (d.lod === 0 ? 0.018 * Math.sin((Math.abs(x) / DIF.half) * Math.PI) : 0);
  const roofTop = (x: number, z: number): number => diffuserRoof(z) + 0.02 + arch(x) * Math.min(1, (DIF.z0 - z) / 0.6);
  parts.push(carbon(heightSlab(-DIF.half, DIF.half, DIF.z0, DIF.z1, nx, nz, roofTop, 0.02)));
  if (d.lod === 2) return;
  const lipY = (x: number, z: number): number => roofTop(x, DIF.z1) + 0.04 * ((DIF.z1 - z) / 0.035);
  parts.push(carbon(heightSlab(-DIF.half, DIF.half, DIF.z1, DIF.z1 - 0.035, nx, 1, lipY, 0.012)));
  // Full-height sidewalls: floor level up to just above the roof, rounded top-rear corner.
  const wallTop: [number, number][] = [];
  const steps = d.lod === 0 ? 8 : 4;
  for (let k = 0; k <= steps; k++) {
    const z = DIF.z0 - 0.1 - ((DIF.z1 - 0.03 - DIF.z0 + 0.1) * k) / steps;
    wallTop.push([z, diffuserRoof(z) + 0.035]);
  }
  const wall: [number, number][] = [[DIF.z0 - 0.1, 0.045], [DIF.z1 - 0.03, 0.045], ...wallTop.reverse()];
  parts.push(...both(carbon(plateZY(wall, DIF.half + 0.006, 0.012))));
  // Strakes: vertical dividers from a straight bottom edge up into the roof (clean tunnel exits, no stair blocks).
  const n = d.lod === 0 ? s.strakes : 1;
  for (let i = 1; i <= n; i++) {
    const x = (DIF.half * i) / (n + 1);
    const zs0 = DIF.z0 - 0.3 - 0.04 * i;
    // Blade depth below the roof grows smoothly toward the exit (a curved lower edge, not a full-height block).
    const top: [number, number][] = [], bot: [number, number][] = [];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const z = zs0 + (DIF.z1 - zs0) * t;
      top.push([z, diffuserRoof(z) + 0.012]);
      bot.push([z, diffuserRoof(z) - 0.004 - 0.035 * t]);
    }
    const prof: [number, number][] = [...bot, ...top.reverse()];
    parts.push(...both(carbon(plateZY(prof, x, 0.008))));
  }
  // Central keel under the crash structure.
  const keelTop: [number, number][] = [];
  for (let k = 0; k <= steps; k++) {
    const z = DIF.z0 - 0.2 + ((DIF.z1 + 0.2 - DIF.z0) * k) / steps;
    keelTop.push([z, diffuserRoof(z) + 0.012]);
  }
  parts.push(carbon(plateZY([[DIF.z0 - 0.2, diffuserRoof(DIF.z0 - 0.2) - 0.004], [DIF.z1, diffuserRoof(DIF.z1) - 0.04], ...keelTop.reverse()], 0, 0.014)));
  // Beam wing over the diffuser exit (2022 style): a slim cambered blade through the crash structure, its tips carried
  // by small carbon fins standing on the diffuser sidewalls.
  const bw: WingStation[] = [];
  const bn = d.lod === 0 ? 4 : 1;
  for (let i = 0; i <= bn; i++) {
    const x = -0.55 + (1.1 * i) / bn;
    bw.push({ x, y: 0.455 + 0.012 * (Math.abs(x) / 0.55), z: -2.05, chord: 0.16, angle: deg(14) });
  }
  parts.push(carbon(wingLoft(bw, airfoil(d.lod === 0 ? 12 : 6, 0.1, 0.05))));
  const fin: [number, number][] = [[DIF.z1 + 0.06, diffuserRoof(DIF.z1 + 0.06) + 0.02], [DIF.z1 - 0.025, diffuserRoof(DIF.z1) + 0.06], [-2.21, 0.5], [-2.02, 0.48]];
  parts.push(...both(carbon(plateZY(fin, 0.556, 0.01))));
}

/** Builds all rear parts for ctx.lod / ctx.concept into the shared parts list (closed meshes; carModel merges them). */
export function buildRear(ctx: PartBuildCtx): void {
  for (const p of rearParts(ctx.detail, ctx.concept)) ctx.add(p.g, p.mat, p.tag);
}

/** The rear parts on their own (tests / budgets). */
export function rearParts(d: Detail, concept: ConceptId): RearPart[] {
  const s = STYLES[rearStyleOf(concept)];
  const parts: RearPart[] = [];
  rearWing(d, s, parts);
  rearStructure(d, parts);
  floor(d, parts);
  diffuser(d, s, parts);
  return parts;
}

/** Triangle count of a part list (tests / budgets). */
export function rearTriangles(parts: readonly RearPart[]): number {
  let t = 0;
  for (const p of parts) t += (p.g.index ? p.g.index.count : p.g.getAttribute('position').count) / 3;
  return t;
}
