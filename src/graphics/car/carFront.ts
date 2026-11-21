// Front of the car (owner: front module, Grafik-3): 2022-regulation show-car shape language.
//  - Nose rows (merged into the chassis loft by carModel): long, slim, low nose with an ellipsoidal rounded tip that rests
//    directly on the front wing (no pylons).
//  - Front wing: 3–4 thin cambered elements; outboard they fan upward and finally curl up into large endplates that roll
//    outward towards their top. Top surfaces take the livery, undersides the carbon swatch.
//  - Small flap-adjuster tabs, wheel-wake deflectors over the front tyres (static, like the body upright), pitot.
// Three front variants (needle / shovel / raised) are mapped to the four body concepts by FRONT_VARIANT_OF.
// Model space: +Z nose, +Y up, +X left. Every part is a closed (capped) mesh.

import { BufferAttribute, BufferGeometry } from 'three';
import { SW, tagPart } from './atlas';
import { type ConceptId, deg, type PartBuildCtx, sstep, TRIM, trimUv, V } from './carParts';
import { airfoil, constUv, type Keys, loftRings, mirrorX, monotoneCurve, plateZY, type SweepStation, sweepFoil, tube, type WingStation, wingLoft } from './geom';

export type FrontVariantId = 'needle' | 'shovel' | 'raised';

/** Which front each body concept carries (4 concepts, 3 fronts). */
export const FRONT_VARIANT_OF: Readonly<Record<ConceptId, FrontVariantId>> = {
  arrow: 'needle', overbite: 'needle', bathtub: 'shovel', slim: 'raised',
};

interface NoseSpec {
  tipZ: number; tipTop: number; tipBot: number; tipW: number;
  /** Length of the ellipsoidal tip cap (m). */
  cap: number;
  /** Growth exponents of the top line and of the width towards the monocoque (z 2.0). */
  pTop: number; pW: number;
  /** Superellipse exponents at the tip (top, bottom); they blend to the chassis values. */
  nT: number; nB: number;
}

interface ElSpec {
  chord: number;
  /** Incidence (deg) at the centre and at the outboard end of the straight part. */
  a0: number; a1: number;
  /** Slot gap (y) and overlap (z) to the previous element; ignored for element 0. */
  gap: number; ov: number;
  /** true = one piece across the centre line (under the nose), false = starts buried in the nose side. */
  full: boolean;
  /** Extra outboard rise relative to the previous element (the "sweep up towards the tips"). */
  rise: number;
  /** Centre lift (raised nose: the element arches up to carry the nose tip). */
  lift: number;
}

interface FrontVariant {
  nose: NoseSpec;
  /** Mainplane leading edge at the centre (z, y), its outboard sweep-back and the mid-span dip. */
  leZ: number; leY: number; sweepBack: number; dip: number;
  els: ElSpec[];
  /** Final curl into the endplate: height gained and end angle (deg). */
  curlRise: number; curlPhi: number;
  /** Endplate: centre x at the foot, outward roll at the top, outline (top and bottom edge, [z, y] from front to rear). */
  epX: number; roll: number; epTop: Keys; epBot: Keys;
}

const CHASSIS_JOIN = { z: 2.0, top: 0.495, bot: 0.112, wT: 0.172, wB: 0.13, nT: 2.6, nB: 3.2 } as const;
const EP_T = 0.013;
const EP_Y0 = 0.035;
const EP_H = 0.27;

const FRONT_VARIANTS: Readonly<Record<FrontVariantId, FrontVariant>> = {
  // Long narrow low nose resting on the mainplane; 4 elements, strong sweep, strongly rolled endplates.
  needle: {
    nose: { tipZ: 3.06, tipTop: 0.166, tipBot: 0.106, tipW: 0.034, cap: 0.065, pTop: 1.35, pW: 1.5, nT: 2.2, nB: 2.8 },
    leZ: 3.075, leY: 0.085, sweepBack: 0.075, dip: 0.012,
    els: [
      { chord: 0.3, a0: 3, a1: 6, gap: 0, ov: 0, full: true, rise: -0.01, lift: 0 },
      { chord: 0.17, a0: 10, a1: 15, gap: 0.011, ov: 0.045, full: false, rise: 0.022, lift: 0 },
      { chord: 0.14, a0: 17, a1: 23, gap: 0.01, ov: 0.04, full: false, rise: 0.022, lift: 0 },
      { chord: 0.115, a0: 24, a1: 30, gap: 0.01, ov: 0.035, full: false, rise: 0.022, lift: 0 },
    ],
    curlRise: 0.028, curlPhi: 42, epX: 0.925, roll: 0.06,
    epTop: [[3.09, 0.06], [3.05, 0.15], [2.92, 0.235], [2.76, 0.295], [2.6, 0.325], [2.48, 0.33], [2.42, 0.31]],
    epBot: [[3.09, 0.045], [3.05, 0.035], [2.7, 0.035], [2.6, 0.045], [2.5, 0.08], [2.42, 0.15]],
  },
  // Wide low nose tip; 4 elements with a gentler sweep and less roll.
  shovel: {
    nose: { tipZ: 3.0, tipTop: 0.17, tipBot: 0.104, tipW: 0.09, cap: 0.05, pTop: 1.3, pW: 1.2, nT: 2.6, nB: 3.0 },
    leZ: 3.07, leY: 0.085, sweepBack: 0.05, dip: 0.008,
    els: [
      { chord: 0.31, a0: 3, a1: 5, gap: 0, ov: 0, full: true, rise: 0, lift: 0 },
      { chord: 0.18, a0: 9, a1: 13, gap: 0.011, ov: 0.045, full: false, rise: 0.016, lift: 0 },
      { chord: 0.145, a0: 15, a1: 20, gap: 0.01, ov: 0.04, full: false, rise: 0.016, lift: 0 },
      { chord: 0.12, a0: 21, a1: 26, gap: 0.01, ov: 0.035, full: false, rise: 0.016, lift: 0 },
    ],
    curlRise: 0.025, curlPhi: 38, epX: 0.93, roll: 0.04,
    epTop: [[3.09, 0.07], [3.05, 0.15], [2.9, 0.23], [2.72, 0.285], [2.56, 0.31], [2.46, 0.315], [2.42, 0.3]],
    epBot: [[3.09, 0.045], [3.05, 0.035], [2.66, 0.035], [2.56, 0.05], [2.48, 0.085], [2.42, 0.14]],
  },
  // Narrow, high nose tip carried by the arched 2nd element (mainplane runs underneath); 3 large elements, steep sweep.
  raised: {
    nose: { tipZ: 2.88, tipTop: 0.222, tipBot: 0.15, tipW: 0.034, cap: 0.06, pTop: 1.25, pW: 1.5, nT: 2.2, nB: 2.6 },
    leZ: 3.075, leY: 0.088, sweepBack: 0.08, dip: 0.014,
    els: [
      { chord: 0.31, a0: 3, a1: 6, gap: 0, ov: 0, full: true, rise: -0.01, lift: 0 },
      { chord: 0.2, a0: 11, a1: 17, gap: 0.011, ov: 0.045, full: true, rise: 0.035, lift: 0.04 },
      { chord: 0.16, a0: 19, a1: 26, gap: 0.01, ov: 0.04, full: false, rise: 0.035, lift: 0 },
    ],
    curlRise: 0.03, curlPhi: 45, epX: 0.915, roll: 0.07,
    epTop: [[3.09, 0.06], [3.05, 0.14], [2.92, 0.22], [2.76, 0.285], [2.6, 0.31], [2.48, 0.31], [2.42, 0.285]],
    epBot: [[3.09, 0.045], [3.05, 0.035], [2.7, 0.035], [2.6, 0.045], [2.5, 0.08], [2.42, 0.15]],
  },
};

// ---------------------------------------------------------------------------------------------
// Nose

/** Nose rows for the chassis loft ([z, top, bottom, wT, wB, nT, nB], tip first, all z > 2.0). */
export function frontNoseRows(concept: ConceptId): number[][] {
  const n = FRONT_VARIANTS[FRONT_VARIANT_OF[concept]].nose;
  const J = CHASSIS_JOIN;
  const span = n.tipZ - J.z;
  const at = (z: number): number[] => {
    const u = Math.min(1, Math.max(0, (n.tipZ - z) / span));
    const wT = n.tipW + (J.wT - n.tipW) * u ** n.pW;
    const wB = n.tipW * 0.94 + (J.wB - n.tipW * 0.94) * u ** n.pW;
    return [z, n.tipTop + (J.top - n.tipTop) * u ** n.pTop, n.tipBot + (J.bot - n.tipBot) * u, wT, wB, n.nT + (J.nT - n.nT) * u, n.nB + (J.nB - n.nB) * u];
  };
  const rows: number[][] = [];
  // Ellipsoidal tip cap: section scaled by sin(θ) about the loft centre (belly 0.45, as carModel's symKeys).
  for (const th of [0.14, 0.42, 0.72, 1.04, 1.32]) {
    const z = n.tipZ - n.cap + n.cap * Math.cos(th);
    const r = at(z);
    const s = Math.sin(th);
    const cy = r[2]! + (r[1]! - r[2]!) * 0.45;
    rows.push([z, cy + (r[1]! - cy) * s, cy - (cy - r[2]!) * s, r[3]! * s, r[4]! * s, r[5]!, r[6]!]);
  }
  const z0 = n.tipZ - n.cap;
  for (let k = 0; k <= 5; k++) rows.push(at(z0 - ((z0 - 2.12) * k) / 5));
  return rows;
}

/** Nose half-width at z (used to bury the inner ends of the flaps in the nose side). */
function noseHalfWidth(v: FrontVariant, z: number): number {
  const n = v.nose;
  const u = Math.min(1, Math.max(0, (n.tipZ - z) / (n.tipZ - CHASSIS_JOIN.z)));
  return n.tipW * 0.94 + (CHASSIS_JOIN.wB - n.tipW * 0.94) * u ** n.pW;
}

// ---------------------------------------------------------------------------------------------
// Front wing

interface El { y: number; z: number; chord: number; angle: number }
const X_TIP = 0.93;

/** Straight-part leading edge of element k at span x (stacked on the previous element's trailing edge). */
function elementAt(v: FrontVariant, k: number, x: number): El {
  const xn = Math.min(1, x / X_TIP);
  const e = v.els[k]!;
  const lift = e.lift * (1 - sstep(0.04, 0.2, x));
  const chord = e.chord * (1 - 0.15 * xn);
  const angle = deg(e.a0 + (e.a1 - e.a0) * xn);
  if (k === 0) {
    return {
      y: v.leY - v.dip * sstep(0.1, 0.5, xn) + e.rise * sstep(0.62, 1, xn) + lift,
      z: v.leZ - v.sweepBack * sstep(0.15, 1, xn), chord, angle,
    };
  }
  const p = elementAt(v, k - 1, x);
  return {
    y: p.y + p.chord * Math.sin(p.angle) + e.gap + e.rise * sstep(0.62, 1, xn) + lift,
    z: p.z - p.chord * Math.cos(p.angle) + e.ov * (1 - 0.7 * sstep(0.6, 1, xn)),
    chord, angle,
  };
}

/** Endplate centre-surface x at height y (outward roll towards the top). */
const epXAt = (v: FrontVariant, y: number): number => {
  const q = Math.min(1, Math.max(0, (y - EP_Y0) / EP_H));
  return v.epX + v.roll * q * q;
};

const FOIL_T = 0.075;

/** Leading-edge path of element k (half span, +x), straight part then the curl into the endplate. */
function elementPath(v: FrontVariant, k: number, lod: 0 | 1 | 2): SweepStation[] {
  const e = v.els[k]!;
  const nS = lod === 0 ? 9 : lod === 1 ? 3 : 2;
  const nC = lod === 0 ? 6 : lod === 1 ? 2 : 0;
  let x0 = 0;
  if (!e.full) x0 = Math.max(0.02, 0.7 * noseHalfWidth(v, elementAt(v, k, 0.05).z));
  const phi = deg(v.curlPhi);
  const rise = nC > 0 ? v.curlRise : 0;
  const r = rise / (1 - Math.cos(phi));
  const h = nC > 0 ? r * Math.sin(phi) : 0;
  // Curl start: end x sits so the slat's outer surface stays inside the endplate's outer face.
  let xb = 0.8;
  for (let i = 0; i < 5; i++) {
    const s = elementAt(v, k, xb);
    const th = s.chord * FOIL_T;
    const xEnd = epXAt(v, s.y + rise) + EP_T / 2 - th / 2 - 0.002;
    xb = xEnd - h;
  }
  const out: SweepStation[] = [];
  for (let i = 0; i <= nS; i++) {
    const x = x0 + ((xb - x0) * i) / nS;
    const s = elementAt(v, k, x);
    out.push({ p: V(x, s.y, s.z), chord: s.chord, angle: s.angle });
  }
  const b = elementAt(v, k, xb);
  const aTip = deg(3);
  for (let i = 1; i <= nC; i++) {
    const t = i / nC;
    const a = phi * t;
    out.push({ p: V(xb + r * Math.sin(a), b.y + r * (1 - Math.cos(a)), b.z), chord: b.chord * (1 - 0.08 * t), angle: b.angle + (aTip - b.angle) * sstep(0, 1, t) });
  }
  return out;
}

/** Tags the lower aerofoil surface with the carbon swatch (top keeps the projected livery). */
function tagFoil(g: BufferGeometry, n: number): BufferGeometry {
  const count = g.getAttribute('position').count;
  const tags = new Float32Array(count).fill(-1);
  const rings = Math.floor(count / n);
  for (let v = 0; v < rings * n; v++) {
    const j = v % n;
    if (j > n / 2) tags[v] = SW.carbon;
  }
  // End-cap centre vertices: carbon, so every cap triangle maps to the carbon cell (the curled flap tips showed small
  // livery-coloured caps on the endplate's inner face).
  for (let v = rings * n; v < count; v++) tags[v] = SW.carbon;
  g.setAttribute('aTag', new BufferAttribute(tags, 1));
  return g;
}

function wing(ctx: PartBuildCtx, v: FrontVariant): void {
  const lod = ctx.lod;
  const nEls = lod === 2 ? 1 : v.els.length;
  for (let k = 0; k < nEls; k++) {
    const e = v.els[k]!;
    const nf = lod === 0 ? (k === 0 ? 26 : 18) : lod === 1 ? 8 : 6;
    // LOD2: one thick element stands for the whole stack.
    const foil = lod === 2 ? airfoil(nf, 0.16, 0.12) : airfoil(nf, FOIL_T, 0.06);
    const half = elementPath(v, k, lod);
    if (lod === 2) for (const s of half) s.chord *= 1.9;
    if (e.full) {
      const path: SweepStation[] = [];
      for (let i = half.length - 1; i >= 1; i--) path.push({ ...half[i]!, p: V(-half[i]!.p.x, half[i]!.p.y, half[i]!.p.z) });
      for (const s of half) path.push(s);
      ctx.add(tagFoil(sweepFoil(path, foil), nf), 'paint', -2);
    } else {
      const g = tagFoil(sweepFoil(half, foil), nf);
      ctx.add(g, 'paint', -2);
      ctx.add(mirrorX(g), 'paint', -2);
    }
  }
  endplates(ctx, v);
  if (lod === 0) adjusters(ctx, v);
}

/** Endplate: a thin ribbon sliced along z, rolled outward towards the top, rounded front/rear edges (thickness taper). */
function endplates(ctx: PartBuildCtx, v: FrontVariant): void {
  const lod = ctx.lod;
  const m = lod === 0 ? 8 : lod === 1 ? 3 : 1;
  const nz = lod === 0 ? 16 : lod === 1 ? 6 : 4;
  const top = monotoneCurve(v.epTop), bot = monotoneCurve(v.epBot);
  const zF = v.epTop[0]![0]!, zR = v.epTop[v.epTop.length - 1]![0]!;
  const o: number[] = [0];
  const rings: Float32Array[] = [];
  for (let s = 0; s < nz; s++) {
    const u = 0.5 - 0.5 * Math.cos((Math.PI * s) / (nz - 1));
    const z = zF + (zR - zF) * u;
    const yt = top(z, o)[0]!, yb = Math.min(yt - 0.01, bot(z, o)[0]!);
    const t = EP_T * (0.45 + 0.55 * Math.sqrt(Math.sin(Math.PI * u)));
    const cx: number[] = [], cy: number[] = [], nx: number[] = [], ny: number[] = [];
    for (let i = 0; i <= m; i++) {
      const y = yb + ((yt - yb) * i) / m;
      const q = Math.min(1, Math.max(0, (y - EP_Y0) / EP_H));
      const dxdy = (2 * v.roll * q) / EP_H * (y > EP_Y0 ? 1 : 0);
      const l = Math.hypot(1, dxdy);
      cx.push(epXAt(v, y)); cy.push(y); nx.push(1 / l); ny.push(-dxdy / l);
    }
    const pts: number[] = [];
    const push = (x: number, y: number): void => void pts.push(x, y, z);
    for (let i = 0; i <= m; i++) push(cx[i]! + (nx[i]! * t) / 2, cy[i]! + (ny[i]! * t) / 2);
    push(cx[m]! - ny[m]! * t * 0.5, cy[m]! + nx[m]! * t * 0.5);
    for (let i = m; i >= 0; i--) push(cx[i]! - (nx[i]! * t) / 2, cy[i]! - (ny[i]! * t) / 2);
    push(cx[0]! + ny[0]! * t * 0.5, cy[0]! - nx[0]! * t * 0.5);
    rings.push(new Float32Array(pts));
  }
  const ep = tagPart(outward(loftRings(rings, { closed: true, capStart: true, capEnd: true })), -1);
  ctx.add(ep, 'paint', -2);
  ctx.add(tagPart(mirrorX(ep), -1), 'paint', -2);
}

/** Flips an indexed closed mesh whose signed volume is negative (inward normals). */
function outward(g: BufferGeometry): BufferGeometry {
  const p = g.getAttribute('position');
  const idx = g.index!;
  let vol = 0;
  for (let k = 0; k < idx.count; k += 3) {
    const a = idx.getX(k), b = idx.getX(k + 1), c = idx.getX(k + 2);
    const ax = p.getX(a), ay = p.getY(a), az = p.getZ(a), bx = p.getX(b), by = p.getY(b), bz = p.getZ(b), cx = p.getX(c), cy = p.getY(c), cz = p.getZ(c);
    vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  if (vol < 0) {
    const arr = idx.array;
    for (let k = 0; k < arr.length; k += 3) {
      const t = arr[k + 1]!;
      arr[k + 1] = arr[k + 2]!;
      arr[k + 2] = t;
    }
    idx.needsUpdate = true;
    g.computeVertexNormals();
  }
  return g;
}

/** Flap-adjuster tabs between the upper elements (small carbon brackets) and a satin-black adjuster fairing. */
function adjusters(ctx: PartBuildCtx, v: FrontVariant): void {
  const n = v.els.length;
  for (const x of [0.3, 0.56]) {
    for (let k = n - 2; k < n - 1; k++) {
      const a = elementAt(v, k, x), b = elementAt(v, k + 1, x);
      const teY = a.y + a.chord * Math.sin(a.angle), teZ = a.z - a.chord * Math.cos(a.angle);
      const zf = Math.max(teZ, b.z) + 0.02, zr = Math.min(teZ, b.z) - 0.035;
      const y0 = teY - 0.004, y1 = b.y + 0.02;
      const tab = plateZY([[zf, y0], [zr, y0 + 0.004], [zr, y1 + 0.012], [zf, y1]], x, 0.006);
      ctx.add(tab, 'carbon', 0);
      ctx.add(mirrorX(tab), 'carbon', 0);
    }
  }
  // Adjuster fairing where the top element meets the nose.
  const k = n - 1;
  const x0 = Math.max(0.03, noseHalfWidth(v, elementAt(v, k, 0.05).z));
  const s = elementAt(v, k, x0 + 0.04);
  const pod = tube(V(x0 - 0.01, s.y + 0.012, s.z - 0.01), V(x0 + 0.06, s.y + s.chord * 0.5 * Math.sin(s.angle) + 0.01, s.z - s.chord * 0.5), 0.012, 0.008, 8, 1, true);
  constUv(pod, ...trimUv(TRIM.satinBlack));
  ctx.add(pod, 'trim', TRIM.satinBlack);
  ctx.add(constUv(mirrorX(pod), ...trimUv(TRIM.satinBlack)), 'trim', TRIM.satinBlack);
}

/**
 * Wheel-wake deflectors: small cambered winglets above the inboard half of each front tyre (crown y 0.72; their
 * underside stays above 0.735, so a steered tyre never touches them), on a slim strut down to the upright / duct.
 */
function deflectors(ctx: PartBuildCtx): void {
  if (ctx.lod === 2) return;
  const lod0 = ctx.lod === 0;
  const st: WingStation[] = [];
  const ns = lod0 ? 4 : 1;
  for (let i = 0; i <= ns; i++) {
    const t = i / ns;
    st.push({ x: 0.6 + 0.2 * t, y: 0.748 + 0.012 * t * t, z: 2.13 - 0.02 * t, chord: 0.14 - 0.03 * t, angle: deg(-6 + 4 * t) });
  }
  const w = wingLoft(st, airfoil(lod0 ? 10 : 4, 0.09, 0.05));
  ctx.add(w, 'carbon', 0);
  ctx.add(mirrorX(w), 'carbon', 0);
  // Mount: a short bracket from the top of the upright (inside the wheel, carModel suspension: x 0.676, y ≈ 0.53)
  // inboard past the tyre's inner sidewall (x 0.648), then the strut up to the winglet — it used to start in mid-air.
  const bracket = tube(V(0.676, 0.528, 1.962), V(0.625, 0.535, 1.975), 0.014, 0.01, lod0 ? 8 : 4, 1, true);
  // A swept carbon fin (not a thin rod, which read as a stick standing in the air) carries the winglet.
  const strut = plateZY([[2.0, 0.52], [1.955, 0.52], [2.045, 0.755], [2.1, 0.755]], 0.625, 0.008);
  for (const g of [bracket, strut]) {
    ctx.add(g, 'carbon', 0);
    ctx.add(mirrorX(g), 'carbon', 0);
  }
}

export function buildFront(ctx: PartBuildCtx): void {
  const v = FRONT_VARIANTS[FRONT_VARIANT_OF[ctx.concept]];
  wing(ctx, v);
  deflectors(ctx);
  if (ctx.lod === 0) {
    // Pitot from the nose tip.
    const n = v.nose;
    const ty = n.tipBot + (n.tipTop - n.tipBot) * 0.45;
    ctx.add(constUv(tube(V(0, ty, n.tipZ - 0.06), V(0, ty, n.tipZ + 0.04), 0.004, 0.004, 4, 1, true), ...trimUv(TRIM.fastener)), 'trim', TRIM.fastener);
  }
}
