// Procedural 2025-style open-wheel car (docs/design/rendering.md §7.1–§7.2). Model space: +Z nose, +Y up, +X left.
// One geometry set per LOD and car concept is built once and shared by every car of that concept; liveries differ only by
// material maps. Four concepts (nose, sidepod / inlet, airbox, fin, endplates) make the teams recognisable at a glance.
// Key dimensions: nose tip z +3.05, rear-wing TE z −2.55 (5.60 m), width 2.00 m, axles z +1.962 / −1.638.

import { BoxGeometry, BufferAttribute, type BufferGeometry, CatmullRomCurve3, CylinderGeometry, SphereGeometry, Vector3 } from 'three';
import { AT, SW, projectPaintUv, tagPart } from './atlas';
import { buildFront, frontNoseRows } from './carFront';
import {
  type CarMat, type ConceptId, deg, DETAIL, type Detail, GEARBOX_KEYS, type Part, partCtx, REAR_FLAP_PIVOT, rounded, TRIM, TRIM_SWATCHES, trimUv, V,
} from './carParts';
import { buildRear } from './carRear';
import {
  boxUv, constColor, constUv, loftRings, mergeParts, mirrorX, monotoneCurve, plateZY, sectionLoft, sectionRing, strip, tube, tubePath, type Keys,
} from './geom';
import { FRONT_W, REAR_W, TYRE_R } from './wheels';

export { type CarMat, CONCEPT_IDS, type ConceptId, DETAIL, type Detail, REAR_FLAP_PIVOT, TRIM, TRIM_CELLS, TRIM_SWATCHES } from './carParts';

/** Section keys from readable rows: [z, top, bottom, wT, wB, nT, nB, tubW?, tubD?] (symmetric about x = 0). */
function symKeys(rows: readonly number[][], belly = 0.45): Keys {
  return rows.map(([z, top, bot, wT, wB, nT, nB, tubW = 0, tubD = 0]) => {
    const cy = bot! + (top! - bot!) * belly;
    return [z!, 0, cy, wT!, wB!, top! - cy, cy - bot!, nT!, nB!, tubW, tubD];
  });
}

/** Sidepod keys from [z, xInner, xOuter, top, bottom, undercut(wB/wT)]. */
function podKeys(rows: readonly number[][], n: readonly [number, number] = [2.7, 2.2]): Keys {
  // Optional row[6], row[7] = section exponents for that row (the inlet rows use a clean rounded rectangle).
  return rows.map(([z, xi, xo, top, bot, uc, nT, nB]) => {
    const cy = bot! + (top! - bot!) * 0.55;
    const w = (xo! - xi!) / 2;
    return [z!, (xi! + xo!) / 2, cy, w, w * uc!, top! - cy, cy - bot!, nT ?? n[0], nB ?? n[1], 0, 0];
  });
}

// ---------------------------------------------------------------------------------------------
// Car concepts

/** Concept per base team id (custom teams race on their base team's car; the safety car has its own entry). */
const TEAM_CONCEPT: Readonly<Record<string, ConceptId>> = {
  anka: 'arrow', kestrel: 'arrow', ironclad: 'arrow',
  aurora: 'bathtub', titan: 'bathtub', nova: 'bathtub', safetyCar: 'bathtub',
  vortex: 'overbite', zephyr: 'overbite',
  solaris: 'slim', meridian: 'slim',
};
export const conceptOf = (teamId: string): ConceptId => TEAM_CONCEPT[teamId] ?? 'arrow';

interface Concept {
  /** Sidepod rows ([z, xInner, xOuter, top, bottom, undercut]); the first row is the inlet face. */
  pod: number[][];
  /** Superellipse exponents of the pod section (top, bottom): ~2 = round / bulbous, higher = boxier. */
  podN: [number, number];
  airbox: 'round' | 'tri';
  fin: 'full' | 'cut' | 'none';
  /** Exposed cooling "cannon" outlet at the rear of the engine cover. */
  cannon: boolean;
  /** Cooling gills on the sidepod shoulder. */
  gills: boolean;
}

const CONCEPTS: Readonly<Record<ConceptId, Concept>> = {
  // Base (2022-regulation show car): long slim low nose resting on the wing, bulbous pods with a tall oval inlet over a
  // deep undercut and a long downwash ramp, big round airbox, slim cover without a fin, rolled rear-wing tips.
  arrow: {
    pod: [
      [0.68, 0.27, 0.6, 0.605, 0.405, 1.0, 3.2, 3.2], [0.62, 0.23, 0.645, 0.612, 0.365, 0.95, 3.0, 3.0], [0.46, 0.16, 0.71, 0.605, 0.28, 0.6],
      [0.3, 0.14, 0.73, 0.595, 0.22, 0.45], [0.04, 0.12, 0.74, 0.575, 0.18, 0.4],
      [-0.3, 0.12, 0.715, 0.53, 0.118, 0.5], [-0.66, 0.12, 0.635, 0.45, 0.082, 0.7], [-1.0, 0.12, 0.51, 0.372, 0.072, 0.86],
      [-1.25, 0.12, 0.405, 0.34, 0.072, 0.93], [-1.47, 0.12, 0.325, 0.33, 0.072, 0.96], [-1.72, 0.11, 0.22, 0.3, 0.08, 1.0],
    ],
    podN: [2.15, 2.0], airbox: 'round', fin: 'none', cannon: false,
    gills: true,
  },
  // Wide blunt nose tip, boxier "bathtub" pods with a wide low inlet and a gentle downwash, split triangular airbox,
  // short fin, cooling cannon.
  bathtub: {
    pod: [
      [0.72, 0.21, 0.725, 0.52, 0.37, 1.0, 3.4, 3.4], [0.66, 0.18, 0.745, 0.535, 0.33, 0.95, 3.0, 3.0], [0.46, 0.14, 0.76, 0.55, 0.24, 0.7],
      [0.3, 0.13, 0.76, 0.555, 0.2, 0.62], [0.0, 0.12, 0.75, 0.56, 0.14, 0.6],
      [-0.4, 0.12, 0.72, 0.55, 0.1, 0.65], [-0.8, 0.12, 0.64, 0.5, 0.08, 0.78], [-1.15, 0.12, 0.5, 0.43, 0.072, 0.9],
      [-1.45, 0.12, 0.36, 0.36, 0.072, 0.95], [-1.72, 0.11, 0.22, 0.3, 0.08, 1.0],
    ],
    podN: [2.7, 2.3], airbox: 'tri', fin: 'cut', cannon: true,
    gills: false,
  },
  // Drooped long nose tip, "P-shaped" inlet (wide top, narrower bottom) over a pronounced downwash ramp, slim fin.
  overbite: {
    pod: [
      [0.74, 0.22, 0.66, 0.6, 0.39, 0.74, 3.0, 2.6], [0.68, 0.19, 0.69, 0.605, 0.35, 0.7, 2.9, 2.5], [0.5, 0.15, 0.73, 0.59, 0.26, 0.5],
      [0.3, 0.13, 0.74, 0.575, 0.2, 0.44], [0.1, 0.12, 0.74, 0.55, 0.16, 0.42],
      [-0.25, 0.12, 0.71, 0.46, 0.11, 0.5], [-0.6, 0.12, 0.64, 0.385, 0.08, 0.7], [-0.95, 0.12, 0.52, 0.335, 0.072, 0.86],
      [-1.25, 0.12, 0.4, 0.315, 0.072, 0.93], [-1.47, 0.12, 0.325, 0.31, 0.072, 0.96], [-1.72, 0.11, 0.22, 0.3, 0.08, 1.0],
    ],
    podN: [2.3, 2.0], airbox: 'round', fin: 'full', cannon: false,
    gills: true,
  },
  // Short nose tip, slim "zero-pod" sides with a vertical slot inlet, triangular airbox, no fin, cooling cannon.
  slim: {
    pod: [
      [0.62, 0.31, 0.43, 0.6, 0.3, 1.0, 3.4, 3.4], [0.56, 0.27, 0.47, 0.605, 0.28, 0.95, 3.0, 3.0], [0.4, 0.18, 0.53, 0.59, 0.2, 0.6],
      [0.2, 0.13, 0.56, 0.58, 0.17, 0.6], [0.0, 0.12, 0.57, 0.55, 0.14, 0.6],
      [-0.4, 0.12, 0.55, 0.5, 0.1, 0.7], [-0.8, 0.12, 0.5, 0.43, 0.08, 0.85], [-1.15, 0.12, 0.42, 0.38, 0.072, 0.92],
      [-1.45, 0.12, 0.33, 0.34, 0.072, 0.96], [-1.72, 0.11, 0.22, 0.3, 0.08, 1.0],
    ],
    podN: [2.4, 2.2], airbox: 'tri', fin: 'none', cannon: true,
    gills: false,
  },
};

/** Linear value of pod row column `k` at station z. */
function podAt(rows: readonly number[][], z: number, k: number): number {
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i]!, b = rows[i + 1]!;
    if (z <= a[0]! && z >= b[0]!) return a[k]! + (b[k]! - a[k]!) * ((a[0]! - z) / (a[0]! - b[0]!));
  }
  return z > rows[0]![0]! ? rows[0]![k]! : rows[rows.length - 1]![k]!;
}

const CHASSIS_ROWS = [
  [2.0, 0.495, 0.112, 0.172, 0.13, 2.6, 3.2],
  [1.6, 0.578, 0.116, 0.212, 0.158, 2.7, 3.4],
  [1.2, 0.63, 0.112, 0.248, 0.186, 2.8, 3.6],
  [0.86, 0.655, 0.108, 0.278, 0.21, 2.9, 3.8, 0.0, 0.0],
  [0.76, 0.662, 0.104, 0.296, 0.225, 2.9, 3.8, 0.12, 0.2],
  [0.62, 0.668, 0.1, 0.318, 0.245, 3.0, 3.8, 0.205, 0.32],
  [0.3, 0.676, 0.1, 0.342, 0.27, 3.0, 4.0, 0.232, 0.34],
  [0.02, 0.686, 0.1, 0.35, 0.28, 3.0, 4.0, 0.222, 0.34],
  [-0.1, 0.692, 0.1, 0.35, 0.28, 3.0, 4.0, 0.15, 0.22],
  [-0.2, 0.696, 0.1, 0.345, 0.28, 3.0, 4.0, 0.0, 0.0],
  [-0.42, 0.69, 0.1, 0.33, 0.27, 3.0, 4.0],
  // Taper into the engine cover / sidepods so the monocoque's rear bulkhead is buried (no open end to see into).
  [-0.62, 0.66, 0.1, 0.19, 0.2, 3.0, 4.0],
];
const chassisRows = (concept: ConceptId): number[][] => {
  const rows = [...frontNoseRows(concept), ...CHASSIS_ROWS].map((r) => r.slice());
  // Softer shoulders from the nose back to the cockpit (superellipse exponent ≤ 2.6: curved, not slab-sided).
  for (const row of rows) row[5] = Math.min(row[5]!, 2.6);
  return rows;
};

const COVER_ROWS = [
  [0.12, 0.84, 0.42, 0.085, 0.12, 2.2, 2.6],
  [0.02, 0.952, 0.4, 0.122, 0.16, 2.3, 2.8],
  [-0.2, 0.966, 0.36, 0.16, 0.21, 2.3, 3.0],
  [-0.45, 0.93, 0.32, 0.2, 0.26, 2.3, 3.0],
  [-0.8, 0.842, 0.28, 0.226, 0.27, 2.3, 3.0],
  [-1.2, 0.722, 0.25, 0.198, 0.232, 2.3, 3.0],
  [-1.55, 0.604, 0.25, 0.148, 0.17, 2.3, 3.0],
  [-1.85, 0.522, 0.27, 0.105, 0.12, 2.3, 2.8],
  [-2.06, 0.48, 0.3, 0.074, 0.08, 2.2, 2.6],
];
const coverKeys = (): Keys => symKeys(COVER_ROWS, 0.35);
/** x of a loft's +x surface at station z and height y (pickup points sit on the bodywork, not in the air). */
function surfX(keys: Keys, z: number, y: number): number {
  const p: number[] = new Array(10).fill(0);
  monotoneCurve(keys)(z, p);
  const n = 128;
  const r = sectionRing({ cx: p[0]!, cy: p[1]!, wT: p[2]!, wB: p[3]!, hT: p[4]!, hB: p[5]!, nT: p[6]!, nB: p[7]! }, z, n, new Float32Array(n * 3));
  for (let j = 0; j < n / 2; j++) {
    const y0 = r[j * 3 + 1]!, y1 = r[(j + 1) * 3 + 1]!;
    if (y0 !== y1 && (y - y0) * (y - y1) <= 0) return r[j * 3]! + (r[(j + 1) * 3]! - r[j * 3]!) * ((y - y0) / (y1 - y0));
  }
  return p[0]! + Math.max(p[2]!, p[3]!);
}

function chassis(d: Detail, parts: Part[], concept: ConceptId): void {
  const rows = chassisRows(concept);
  const st = d.lod === 0 ? 60 : d.st;
  // QC2-17: on LOD0 extra stations around the cockpit opening (3 cm at the headrest end, 5 cm along the tub), so the
  // tub edge and the opening's back wall are smooth up close (T-cam) instead of faceted.
  let zs: number[] | undefined;
  if (d.lod === 0) {
    const z0 = rows[0]![0]!, z1 = rows[rows.length - 1]![0]!;
    const all = Array.from({ length: st }, (_, i) => z0 + (z1 - z0) * (0.5 - 0.5 * Math.cos((Math.PI * i) / (st - 1))));
    for (let z = -0.25; z <= 0.1; z += 0.03) all.push(z);
    for (let z = 0.15; z <= 0.9; z += 0.05) all.push(z);
    all.sort((a, b) => b - a);
    zs = all.filter((z, i) => i === 0 || all[i - 1]! - z > 0.008);
  } else if (d.lod === 1) {
    // LOD1: four extra stations over the first 25 cm so the rounded nose tip is not faceted.
    const z0 = rows[0]![0]!, z1 = rows[rows.length - 1]![0]!;
    const all = Array.from({ length: st }, (_, i) => z0 + (z1 - z0) * (0.5 - 0.5 * Math.cos((Math.PI * i) / (st - 1))));
    for (const dz of [0.012, 0.035, 0.08, 0.16, 0.25]) all.push(z0 - dz);
    all.sort((a, b) => b - a);
    zs = all.filter((z, i) => i === 0 || all[i - 1]! - z > 0.006);
  }
  const g = sectionLoft(symKeys(rows), d.ring, st, { capStart: true, capEnd: true, markTub: true, zs });
  // Cockpit tub interior → inlet black (vertices lowered by the tub; projection uses the first vertex of a triangle).
  tagPart(g, -1);
  const tub = g.getAttribute('aTub');
  const t = g.getAttribute('aTag');
  for (let i = 0; i < t.count; i++) if (tub.getX(i) > 0.5) t.setX(i, SW.inlet);
  g.deleteAttribute('aTub');
  parts.push({ g, mat: 'paint', tag: -2 });
}

function engineCover(d: Detail, parts: Part[], c: Concept): void {
  // Rounded spine (top exponent ≤ 2.3): the cover reads as a moulded shell tapering into the coke-bottle rear.
  parts.push({ g: tagPart(sectionLoft(coverKeys(), d.ring, d.lod === 0 ? 48 : d.st, { capStart: true, capEnd: true }), -1), mat: 'paint', tag: -2 });
  if (d.lod === 2) return;
  // Airbox over the driver's head: a painted intake shell running back into the cover (capped) and a recessed dark mouth
  // (QC2-17). 'round' = oval roll-hoop inlet; 'tri' = triangular inlet split by a central blade.
  const ir = d.lod === 0 ? d.ring : Math.max(8, d.ring / 2);
  const sec = c.airbox === 'round'
    ? { cy: 0.884, wT: 0.082, wB: 0.09, hT: 0.064, hB: 0.06, nT: 2.1, nB: 2.1 }
    : { cy: 0.878, wT: 0.022, wB: 0.09, hT: 0.068, hB: 0.04, nT: 1.35, nB: 3.0 };
  const key = (z: number, k: number): number[] => [z, 0, sec.cy, sec.wT * k, sec.wB * k, sec.hT * k, sec.hB * k, sec.nT, sec.nB, 0, 0];
  parts.push({ g: tagPart(sectionLoft([key(0.14, 1), key(0.0, 1.04)], ir, 2, { capEnd: true }), -1), mat: 'paint', tag: -2 });
  parts.push({ g: tagPart(sectionLoft([key(0.138, 0.84), key(0.11, 0.84)], ir, 2, { capStart: true }), SW.inlet), mat: 'paint', tag: -2 });
  if (c.airbox === 'tri') parts.push({ g: tagPart(strip(new BoxGeometry(0.012, 0.1, 0.05).translate(0, sec.cy + 0.004, 0.118)), -1), mat: 'paint', tag: -2 });
  // Shark fin (thin plate on the spine): full to the rear wing, cut short behind the airbox, or only a low spine ridge.
  const fins: Record<Concept['fin'], [number, number][]> = {
    full: [[-0.36, 0.86], [-0.58, 0.945], [-1.0, 0.95], [-1.6, 0.94], [-1.95, 0.915], [-2.06, 0.85], [-2.07, 0.45], [-1.5, 0.57], [-0.9, 0.76], [-0.5, 0.875]],
    cut: [[-0.36, 0.86], [-0.58, 0.945], [-1.0, 0.95], [-1.42, 0.93], [-1.58, 0.82], [-1.6, 0.6], [-1.5, 0.57], [-0.9, 0.76], [-0.5, 0.875]],
    none: [[-0.36, 0.86], [-0.6, 0.935], [-0.95, 0.9], [-1.25, 0.8], [-1.2, 0.71], [-0.9, 0.765], [-0.5, 0.875]],
  };
  const sharp = c.fin === 'full' ? [6, 7] : c.fin === 'cut' ? [5, 6] : [4, 5];
  const finOutline = fins[c.fin];
  const fin = plateZY(d.lod === 0 ? rounded(finOutline, 2, sharp) : finOutline, 0, 0.012, d.lod === 0 ? 0.003 : 0);
  parts.push({ g: tagPart(fin, -1), mat: 'paint', tag: -2 });
  if (c.cannon) {
    // Cooling "cannon": a short painted outlet tube on the cover's tail with a dark exit.
    const cannon = tube(V(0, 0.535, -1.66), V(0, 0.585, -1.93), 0.04, 0.034, d.lod === 0 ? 14 : 8, 1, false);
    parts.push({ g: tagPart(cannon, -1), mat: 'paint', tag: -2 });
    const exit = strip(new CylinderGeometry(0.031, 0.031, 0.004, d.lod === 0 ? 14 : 8).rotateX(Math.PI / 2 + 0.18).translate(0, 0.584, -1.928));
    parts.push({ g: tagPart(exit, SW.inlet), mat: 'paint', tag: -2 });
  }
  // T-cam: stem + T bar, colour per driver (swatch).
  parts.push({ g: tagPart(strip(new BoxGeometry(0.024, 0.05, 0.05).translate(0, 0.975, -0.13)), SW.tcam), mat: 'paint', tag: -2 });
  parts.push({ g: tagPart(strip(new BoxGeometry(0.15, 0.024, 0.11).translate(0, 1.006, -0.13)), SW.tcam), mat: 'paint', tag: -2 });
}

function sidepods(d: Detail, parts: Part[], c: Concept): void {
  // Per-concept pod: inlet face (first row), undercut (wB/wT), downwash ramp and coke-bottle waist to the floor.
  const keys = podKeys(c.pod, c.podN);
  const left = tagPart(sectionLoft(keys, d.ring, d.lod === 0 ? 48 : d.st, { capEnd: true, capStart: d.lod === 2 }), -1);
  parts.push({ g: left, mat: 'paint', tag: -2 }, { g: tagPart(mirrorX(left), -1), mat: 'paint', tag: -2 });
  if (d.lod === 2) return;
  // Inlet: a rolled lip (body paint) from the pod's front ring into the opening, then the dark duct behind it.
  const r0 = keys[0]!;
  const rn = d.ring; // same ring as the pod loft: the lip closes the opening exactly (no gaps to see through)
  const ring = sectionRing({ cx: r0[1]!, cy: r0[2]!, wT: r0[3]!, wB: r0[4]!, hT: r0[5]!, hB: r0[6]!, nT: r0[7]!, nB: r0[8]! }, r0[0]!, rn, new Float32Array(rn * 3));
  const scaled = (sx: number, sy: number, z: number): Float32Array => {
    const out = ring.slice();
    for (let i = 0; i < out.length; i += 3) {
      out[i] = r0[1]! + (ring[i]! - r0[1]!) * sx;
      out[i + 1] = r0[2]! + (ring[i + 1]! - r0[2]!) * sy;
      out[i + 2] = z;
    }
    return out;
  };
  // Thin flush painted lip (outer edge → 1.5 cm inward), then the dark duct receding towards the radiator.
  const lipIn = scaled(0.9, 0.86, r0[0]! - 0.015);
  const lip = tagPart(loftRings([ring, lipIn], { closed: true, flip: true }), -1);
  parts.push({ g: lip, mat: 'paint', tag: -2 }, { g: tagPart(mirrorX(lip), -1), mat: 'paint', tag: -2 });
  // Short dark duct closed by a dark back face 6 cm in (reads as a deep radiator opening; blocks the view into the pod).
  // Walls face inwards (seen from inside the opening); the back face faces forwards.
  const ductEnd = scaled(0.84, 0.8, r0[0]! - 0.06);
  const mouth = tagPart(loftRings([lipIn, ductEnd], { closed: true, flip: true }), SW.inlet);
  const back = tagPart(loftRings([ductEnd, ductEnd], { closed: true, capEnd: true }), SW.inlet);
  for (const g of [mouth, back]) parts.push({ g, mat: 'paint', tag: -2 }, { g: tagPart(mirrorX(g), SW.inlet), mat: 'paint', tag: -2 });
  if (!c.gills || d.lod !== 0) return;
  // Cooling gills: five dark slots across the pod shoulder ahead of the waist (follow the downwash slope).
  const at = (z: number, k: number): number => podAt(c.pod, z, k);
  for (let i = 0; i < 5; i++) {
    const z = -0.32 - i * 0.075;
    const xm = (at(z, 1) + at(z, 2)) / 2;
    const y = at(z, 3);
    const slope = Math.atan2(at(z + 0.05, 3) - at(z - 0.05, 3), 0.1);
    const g = strip(new BoxGeometry(0.17, 0.014, 0.022).rotateX(slope).translate(xm + 0.02, y - 0.003, z));
    parts.push({ g: tagPart(g, SW.inlet), mat: 'paint', tag: -2 }, { g: tagPart(mirrorX(g), SW.inlet), mat: 'paint', tag: -2 });
  }
}

function halo(d: Detail, parts: Part[]): void {
  const hoop = new CatmullRomCurve3([
    V(-0.235, 0.645, -0.08), V(-0.262, 0.75, 0.12), V(-0.25, 0.805, 0.42), V(-0.16, 0.822, 0.74), V(0, 0.826, 0.86),
    V(0.16, 0.822, 0.74), V(0.25, 0.805, 0.42), V(0.262, 0.75, 0.12), V(0.235, 0.645, -0.08),
  ], false, 'centripetal');
  const n = d.lod === 0 ? 48 : d.lod === 1 ? 14 : 6;
  const pts = hoop.getPoints(n);
  // Halo painted in the team colour (2022 show-car look), flowing into the cockpit rim.
  parts.push({ g: tagPart(tubePath(pts, 0.036, 0.024, d.tube), SW.primary), mat: 'paint', tag: -2 });
  const pillar = new CatmullRomCurve3([V(0, 0.62, 1.2), V(0, 0.71, 1.07), V(0, 0.79, 0.94), V(0, 0.826, 0.85)]).getPoints(d.lod === 0 ? 10 : 3);
  parts.push({ g: tagPart(tubePath(pillar, 0.02, 0.017, d.tube, true, V(1, 0, 0)), SW.primary), mat: 'paint', tag: -2 });
  if (d.lod === 0) {
    // Streamlined fairings bury the tube ends in the chassis (no exposed round caps at the rear mounts and the pillar foot).
    for (const sx of [-1, 1]) {
      const boot = new SphereGeometry(1, 14, 8).scale(0.05, 0.034, 0.1).translate(sx * 0.236, 0.655, -0.07);
      parts.push({ g: tagPart(strip(boot), SW.primary), mat: 'paint', tag: -2 });
    }
    const foot = new SphereGeometry(1, 12, 8).scale(0.03, 0.02, 0.08).rotateX(-0.3).translate(0, 0.632, 1.17);
    parts.push({ g: tagPart(strip(foot), SW.primary), mat: 'paint', tag: -2 });
  }
}

function driver(d: Detail, parts: Part[]): void {
  const hc = V(0, 0.8, 0.25);
  const s = d.sphere;
  const helmet = new SphereGeometry(0.132, s + 4, Math.max(4, Math.round(s * 0.8)));
  helmet.scale(1, 1.05, 1.13).translate(hc.x, hc.y, hc.z);
  parts.push({ g: tagPart(strip(helmet), 100), mat: 'paint', tag: -2 });
  if (d.lod === 2) return;
  // Visor band (front, eye level).
  const visor = new SphereGeometry(0.1345, s, Math.max(3, Math.round(s / 4)), Math.PI / 2 - 0.95, 1.9, 1.3, 0.5);
  visor.scale(1, 1.05, 1.13).translate(hc.x, hc.y, hc.z);
  parts.push({ g: tagPart(strip(visor), SW.black), mat: d.lod === 0 ? 'visor' : 'paint', tag: SW.black });
  // HANS / shoulders and arms (suit colour), gloves.
  const shoulders = new SphereGeometry(0.2, Math.max(6, s / 2), Math.max(4, s / 4));
  shoulders.scale(1, 0.45, 0.6).translate(0, 0.6, 0.18);
  parts.push({ g: tagPart(strip(shoulders), SW.suit), mat: 'paint', tag: -2 });
  for (const sx of [1, -1]) {
    const arm = tube(V(0.16 * sx, 0.6, 0.24), V(0.13 * sx, 0.6, 0.55), 0.04, 0.04, d.lod === 0 ? 14 : 5, 1, true);
    parts.push({ g: tagPart(arm, SW.suit), mat: 'paint', tag: -2 });
    const glove = new SphereGeometry(0.038, d.lod === 0 ? 14 : 6, d.lod === 0 ? 10 : 4).scale(1, 0.9, 1.3).translate(0.12 * sx, 0.6, 0.58);
    parts.push({ g: tagPart(strip(glove), SW.glove), mat: 'paint', tag: -2 });
  }
}

function suspension(d: Detail, parts: Part[], concept: ConceptId): void {
  if (d.lod === 2) return;
  const sides = d.lod === 0 ? 8 : 4;
  const add = (g: BufferGeometry): void => {
    parts.push({ g, mat: 'carbon', tag: 0 }, { g: mirrorX(g), mat: 'carbon', tag: 0 });
  };
  const link = (a: Vector3, b: Vector3, rx = 0.032, ry = 0.013): void => add(tube(a, b, rx, ry, sides, 1, true));
  // Inboard pickups sit ON the bodywork surface (computed from the lofts) with a small clevis bracket; outboard ends meet
  // a simple upright inside the wheel (between the tyre's inner sidewall and the rim). Links follow wheels.ts sizes.
  const chassisK = symKeys(chassisRows(concept));
  const cover = coverKeys();
  const on = (keys: Keys, z: number, y: number): Vector3 => V(surfX(keys, z, y) - 0.004, y, z);
  const bracket = (p: Vector3): void => {
    if (d.lod === 0) add(strip(new BoxGeometry(0.036, 0.04, 0.055).translate(p.x + 0.01, p.y, p.z)));
  };
  const upright = (x: number, z: number): void => {
    // Hub carrier: a slim vertical block inside the wheel plus a stub axle towards the hub.
    add(strip(new BoxGeometry(0.032, 2 * TYRE_R * 0.47, 0.075).translate(x, TYRE_R, z)));
    if (d.lod === 0) add(tube(V(x, TYRE_R, z), V(x + 0.05, TYRE_R, z), 0.03, 0.03, sides, 1, true));
  };
  // Front (axle z 1.962; tyre inner face at x 0.8 − FRONT_W / 2).
  const fx = 0.8 - FRONT_W / 2 + 0.028;
  upright(fx, 1.962);
  const fLo = V(fx, 0.205, 1.962), fUp = V(fx, 0.515, 1.952), fTr = V(fx, 0.335, 2.07), fPr = V(fx, 0.225, 1.94);
  const fp = [on(chassisK, 2.28, 0.19), on(chassisK, 1.62, 0.19), on(chassisK, 2.22, 0.4), on(chassisK, 1.72, 0.42), on(chassisK, 1.82, 0.44), on(chassisK, 2.06, 0.32)];
  link(fp[0]!, fLo);
  link(fp[1]!, fLo);
  link(fp[2]!, fUp);
  link(fp[3]!, fUp);
  link(fPr, fp[4]!, 0.017, 0.017);
  link(fp[5]!, fTr, 0.02, 0.01);
  for (const p of fp) bracket(p);
  // Rear (axle z −1.638; tyre inner face at x 0.775 − REAR_W / 2): pickups on the gearbox and the engine cover.
  const rx = 0.775 - REAR_W / 2 + 0.028;
  upright(rx, -1.638);
  const rLo = V(rx, 0.2, -1.638), rUp = V(rx, 0.515, -1.63), rToe = V(rx, 0.33, -1.8), rPull = V(rx, 0.48, -1.66);
  const rp = [on(GEARBOX_KEYS, -1.47, 0.2), on(GEARBOX_KEYS, -1.97, 0.21), on(cover, -1.42, 0.42), on(cover, -1.9, 0.4), on(GEARBOX_KEYS, -1.56, 0.21), on(GEARBOX_KEYS, -1.95, 0.32)];
  link(rp[0]!, rLo);
  link(rp[1]!, rLo);
  link(rp[2]!, rUp);
  link(rp[3]!, rUp);
  link(rPull, rp[4]!, 0.017, 0.017);
  link(rp[5]!, rToe, 0.02, 0.01);
  for (const p of rp) bracket(p);
  // Driveshafts (gearbox output to the hub).
  const ds = tube(on(GEARBOX_KEYS, -1.638, 0.36), V(rx + 0.04, TYRE_R, -1.638), 0.024, 0.024, sides, 1, false);
  parts.push({ g: constUv(ds, ...trimUv(TRIM.satinBlack)), mat: 'trim', tag: TRIM.satinBlack }, { g: constUv(mirrorX(ds), ...trimUv(TRIM.satinBlack)), mat: 'trim', tag: TRIM.satinBlack });
}

/**
 * Mirror geometry shared with the live glass (mirrors.ts, D-051 #5 follow-up). Model space, left mirror (+x); the right
 * one is x-mirrored. The housing face is centred on (x, y, pivotZ) and yawed `yaw` towards the driver's eye; a painted
 * bezel 3 cm deep frames a recessed glass of w × h (the live glass sits at z = glassZ, in front of the trim glass).
 */
export const MIRROR_GEO = { x: 0.4, y: 0.705, pivotZ: 0.705, glassZ: 0.695, w: 0.15, h: 0.054, yaw: deg(12) } as const;

function mirrors(d: Detail, parts: Part[], c: Concept): void {
  if (d.lod === 2) return;
  const { x: mx, y: my, pivotZ: mz, w: gw, h: gh, yaw } = MIRROR_GEO;
  /** Yaw a part about the housing face centre (inward, towards the driver). */
  const aim = (g: BufferGeometry, sx: number): BufferGeometry => g.translate(-mx * sx, -my, -mz).rotateY(sx * yaw).translate(mx * sx, my, mz);
  for (const sx of [1, -1]) {
    const housing = sectionLoft([
      [0.775, mx * sx, my, 0.07, 0.07, 0.026, 0.026, 3, 3, 0, 0],
      [0.75, mx * sx, my, 0.094, 0.094, 0.042, 0.042, 4, 4, 0, 0],
      [mz, mx * sx, my, 0.095, 0.095, 0.043, 0.043, 5, 5, 0, 0],
    ], Math.max(10, d.ring / 2), 4, { capStart: true, capEnd: true });
    parts.push({ g: tagPart(aim(housing, sx), SW.primary), mat: 'paint', tag: -2 });
    // Bezel: four painted bars (housing colour) around the glass opening, 3 cm proud of the face (the glass reads as recessed in the pod).
    const bw = 0.095 - gw / 2, bh = 0.043 - gh / 2, bd = 0.03, bz = mz - bd / 2;
    for (const [w, h, x, y] of [
      [0.19, bh, 0, gh / 2 + bh / 2], [0.19, bh, 0, -gh / 2 - bh / 2], [bw, gh, gw / 2 + bw / 2, 0], [bw, gh, -gw / 2 - bw / 2, 0],
    ] as const) {
      parts.push({ g: tagPart(aim(strip(new BoxGeometry(w, h, bd).translate(mx * sx + x, my + y, bz)), sx), SW.primary), mat: 'paint', tag: -2 });
    }
    const glass = strip(new BoxGeometry(gw, gh, 0.004).translate(mx * sx, my, mz - 0.006));
    // u = mirror cell centre, v follows height so the static "reflection" gradient spans the glass.
    const gp = glass.getAttribute('position');
    const guv = new Float32Array(gp.count * 2);
    for (let i = 0; i < gp.count; i++) {
      guv[i * 2] = trimUv(TRIM.mirror)[0];
      guv[i * 2 + 1] = 0.08 + 0.84 * ((gp.getY(i) - (my - gh / 2)) / gh);
    }
    glass.setAttribute('uv', new BufferAttribute(guv, 2));
    parts.push({ g: aim(glass, sx), mat: 'trim', tag: TRIM.mirror });
    // Curved aero stalk rising from the sidepod top into the housing (2022 show-car layout).
    const zb = 0.5;
    const xb = Math.min(0.4, Math.max(podAt(c.pod, zb, 1) + 0.05, (podAt(c.pod, zb, 1) + podAt(c.pod, zb, 2)) / 2));
    const yb = podAt(c.pod, zb, 3) - 0.015;
    const stalkPts = new CatmullRomCurve3([V(xb * sx, yb, zb), V((xb * 0.5 + 0.2) * sx, yb + 0.05, 0.6), V(0.385 * sx, 0.68, 0.72), V(0.395 * sx, 0.69, 0.74)]).getPoints(d.lod === 0 ? 8 : 3);
    parts.push({ g: tubePath(stalkPts, 0.016, 0.007, d.lod === 0 ? 8 : 5), mat: 'carbon', tag: 0 });
  }
}

function cockpitDetails(d: Detail, parts: Part[]): void {
  if (d.lod !== 0) return;
  // Padded cockpit rim (black) around the opening.
  const rim = new CatmullRomCurve3([
    V(-0.16, 0.705, -0.12), V(-0.235, 0.69, 0.08), V(-0.24, 0.68, 0.4), V(-0.19, 0.672, 0.66), V(0, 0.668, 0.77),
    V(0.19, 0.672, 0.66), V(0.24, 0.68, 0.4), V(0.235, 0.69, 0.08), V(0.16, 0.705, -0.12),
  ], true, 'centripetal').getPoints(40);
  parts.push({ g: constUv(tubePath(rim, 0.022, 0.016, 6, false), ...trimUv(TRIM.satinBlack)), mat: 'trim', tag: TRIM.satinBlack });
  // Headrest pads.
  for (const sx of [1, -1]) {
    const pad = new SphereGeometry(1, 10, 6);
    pad.scale(0.07, 0.07, 0.17).translate(0.18 * sx, 0.68, 0.1);
    parts.push({ g: constUv(strip(pad), ...trimUv(TRIM.rubber)), mat: 'trim', tag: TRIM.rubber });
  }
  // Antenna and pitot.
  parts.push({ g: constUv(tube(V(0, 0.7, -0.25), V(0, 0.82, -0.3), 0.004, 0.004, 4, 1, true), ...trimUv(TRIM.satinBlack)), mat: 'trim', tag: TRIM.satinBlack });
  // Roll-hoop camera pods.
  for (const sx of [1, -1]) {
    const pod = new SphereGeometry(1, 8, 5);
    pod.scale(0.022, 0.022, 0.06).translate(0.16 * sx, 0.86, -0.1);
    parts.push({ g: constUv(strip(pod), ...trimUv(TRIM.satinBlack)), mat: 'trim', tag: TRIM.satinBlack });
  }
}

/** Steering wheel built around its own origin (rotation axis = local +z). */
function steeringWheel(): BufferGeometry {
  // Rounded body (super-elliptic slab), grips, display and shift paddles; rotation axis = local +z.
  const body = sectionLoft([
    [0.016, 0, 0, 0.088, 0.088, 0.05, 0.05, 4, 4, 0, 0],
    [-0.016, 0, 0, 0.09, 0.09, 0.052, 0.052, 4, 4, 0, 0],
  ], 32, 2, { capStart: true, capEnd: true });
  const grips = [0.112, -0.112].map((x) => sectionLoft([
    [0.02, x, -0.005, 0.024, 0.024, 0.06, 0.06, 2.4, 2.4, 0, 0],
    [-0.02, x, -0.005, 0.024, 0.024, 0.06, 0.06, 2.4, 2.4, 0, 0],
  ], 16, 2, { capStart: true, capEnd: true }));
  const display = strip(new BoxGeometry(0.085, 0.045, 0.004).translate(0, 0.012, -0.0175));
  const paddles = [0.06, -0.06].map((x) => strip(new BoxGeometry(0.05, 0.035, 0.004).translate(x, 0.0, 0.02)));
  const parts = [body, ...grips].map((g) => constUv(g, ...trimUv(TRIM.satinBlack)));
  parts.push(constUv(display, ...trimUv(TRIM.display)));
  for (const p of paddles) parts.push(constUv(p, ...trimUv(TRIM.fastener)));
  return mergeParts(parts);
}

// ---------------------------------------------------------------------------------------------
// Assembly

export interface BodyLod {
  /** Geometry per material key (absent when the LOD has no such part). */
  geo: Partial<Record<CarMat, BufferGeometry>>;
  triangles: number;
}

const CARBON_TILE = 0.08;

export function buildBody(lod: 0 | 1 | 2, concept: ConceptId = 'arrow'): BodyLod {
  const d = DETAIL[lod];
  const c = CONCEPTS[concept];
  const parts: Part[] = [];
  chassis(d, parts, concept);
  engineCover(d, parts, c);
  sidepods(d, parts, c);
  halo(d, parts);
  driver(d, parts);
  const ctx = partCtx(d, concept, parts);
  buildFront(ctx);
  buildRear(ctx);
  suspension(d, parts, concept);
  mirrors(d, parts, c);
  cockpitDetails(d, parts);

  const by = (m: CarMat): BufferGeometry[] => parts.filter((p) => p.mat === m).map((p) => p.g);
  const geo: Partial<Record<CarMat, BufferGeometry>> = {};
  const paintParts = by('paint').map((g) => (g.getAttribute('aTag') ? g : tagPart(g, -1)));
  // Visor parts in LOD1+ become dark paint.
  const paint = mergeParts(paintParts.map((g) => strip2(g, ['aTag'])));
  // aHead = 1 on the helmet (hidden by the paint shader for the cockpit car); aZone for the LOD2 instanced body.
  const tagA = paint.getAttribute('aTag');
  const pp = paint.getAttribute('position');
  const head = new Float32Array(tagA.count);
  const zone = new Float32Array(tagA.count * 2);
  for (let i = 0; i < tagA.count; i++) {
    const t = tagA.getX(i);
    head[i] = t >= 100 ? 1 : 0;
    const dark = t === SW.black || t === SW.inlet || t === SW.carbon || t === SW.glove;
    const z = pp.getZ(i), y = pp.getY(i);
    const sec = t === SW.secondary || (t < 0 && z < 0.75 && y < 0.36 + (0.62 - z) * 0.2126 && y > 0.115);
    zone[i * 2] = dark ? 0 : 1;
    zone[i * 2 + 1] = dark ? 0 : sec ? 1 : 0;
  }
  paint.setAttribute('aHead', new BufferAttribute(head, 1));
  if (lod === 2) paint.setAttribute('aZone', new BufferAttribute(zone, 2));
  geo.paint = projectPaintUv(paint);
  const flapParts = by('flap');
  if (flapParts.length) {
    // The flap mesh is stored pivot-relative: project its livery UVs at its real position (projected at the origin it
    // landed in the carbon strip of the side elevation and the wing top read dark), then move it back.
    const fg = mergeParts(flapParts.map((g) => strip2(g, ['aTag']))).translate(0, REAR_FLAP_PIVOT.y, REAR_FLAP_PIVOT.z);
    geo.flap = projectPaintUv(fg, V(0, 0.8, 0.25)).translate(0, -REAR_FLAP_PIVOT.y, -REAR_FLAP_PIVOT.z);
  }
  const carbon = by('carbon');
  const trim = by('trim');
  if (lod === 0) {
    if (carbon.length) geo.carbon = boxUv(mergeParts(carbon.map((g) => strip(g))), CARBON_TILE);
    if (trim.length) geo.trim = mergeParts(trim.map((g) => strip2(g, ['uv'])));
    const visor = by('visor');
    if (visor.length) geo.visor = mergeParts(visor.map((g) => strip(g)));
    geo.steer = steeringWheel();
  } else {
    // LOD1/LOD2: carbon + trim merged with vertex colours (one draw).
    const col = (hex: number): [number, number, number] => {
      const s = (c: number): number => ((c / 255) <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
      return [s((hex >> 16) & 255), s((hex >> 8) & 255), s(hex & 255)];
    };
    const ct: BufferGeometry[] = [];
    for (const g of carbon) ct.push(constColor(strip(g), ...col(0x17191c)));
    for (const p of parts.filter((q) => q.mat === 'trim')) ct.push(constColor(strip(p.g), ...col(TRIM_SWATCHES[p.tag]?.[0] ?? 0x101010)));
    if (ct.length) geo.trim = mergeParts(ct);
  }
  const em = by('emissive');
  if (em.length) geo.emissive = mergeParts(em.map((g) => strip2(g, ['color'])));
  let triangles = 0;
  for (const g of Object.values(geo)) if (g) triangles += g.getAttribute('position').count / 3;
  for (const g of Object.values(geo)) g?.computeBoundingSphere();
  return { geo, triangles };
}

/** Keeps position, normal and the listed attributes. */
function strip2(g: BufferGeometry, keep: string[]): BufferGeometry {
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && !keep.includes(name)) g.deleteAttribute(name);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  return g;
}

/** Overall bounds (for tests and the footprint check). */
export function boundsOf(lod: BodyLod): { min: Vector3; max: Vector3 } {
  const min = V(Infinity, Infinity, Infinity);
  const max = V(-Infinity, -Infinity, -Infinity);
  for (const [key, g] of Object.entries(lod.geo)) {
    // The DRS flap and steering wheel are stored relative to their pivots.
    if (!g || key === 'flap' || key === 'steer') continue;
    const p = g.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      min.x = Math.min(min.x, p.getX(i)); min.y = Math.min(min.y, p.getY(i)); min.z = Math.min(min.z, p.getZ(i));
      max.x = Math.max(max.x, p.getX(i)); max.y = Math.max(max.y, p.getY(i)); max.z = Math.max(max.z, p.getZ(i));
    }
  }
  return { min, max };
}

export const ATLAS_LAYOUT = AT;

/** Centre of the left sidepod inlet face (tests: the duct must be closed, nothing visible through it). */
export function inletCentre(concept: ConceptId): Vector3 {
  const r = CONCEPTS[concept].pod[0]!;
  return V((r[1]! + r[2]!) / 2, (r[3]! + r[4]!) / 2, r[0]!);
}
