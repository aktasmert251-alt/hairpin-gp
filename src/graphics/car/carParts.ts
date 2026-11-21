// Shared car-part contract (body = carModel.ts, front = carFront.ts, rear = carRear.ts): concept ids, detail levels,
// material slots, trim swatches, small geometry helpers and the key dimensions every module builds against.
// Model space: +Z nose, +Y up, +X left; the wheel sizes come from wheels.ts.

import { type BufferGeometry, Vector3 } from 'three';
import type { Keys } from './geom';

export type CarMat = 'paint' | 'carbon' | 'trim' | 'visor' | 'emissive' | 'flap' | 'steer';

/** Trim swatch cells (shared trim texture: colour + roughness/metalness per cell). */
export const TRIM = {
  rawCarbon: 0, satinBlack: 1, exhaust: 2, fastener: 3, mirror: 4, cockpit: 5, inletBlack: 6, rubber: 7, display: 8, titanium: 9, gold: 10,
} as const;
export const TRIM_CELLS = 16;
/** [linear-ish sRGB hex, roughness, metalness] per trim cell. */
export const TRIM_SWATCHES: readonly [number, number, number][] = [
  [0x0f1011, 0.62, 0.1], [0x141518, 0.5, 0.2], [0x8a6a4f, 0.35, 1.0], [0x9a9ea3, 0.4, 1.0], [0x2a3038, 0.28, 0.55], [0x0b0b0c, 0.8, 0.0],
  [0x060607, 0.55, 0.0], [0x1a1a1c, 0.85, 0.0], [0x101418, 0.3, 0.0], [0x6d6f73, 0.38, 1.0], [0xb8902e, 0.3, 1.0],
  [0x101010, 0.6, 0], [0x101010, 0.6, 0], [0x101010, 0.6, 0], [0x101010, 0.6, 0], [0x101010, 0.6, 0],
];
export const trimUv = (cell: number): [number, number] => [(cell + 0.5) / TRIM_CELLS, 0.5];

export interface Detail { lod: 0 | 1 | 2; ring: number; st: number; foil: number; span: number; tube: number; sphere: number }
export const DETAIL: Readonly<Record<0 | 1 | 2, Detail>> = {
  0: { lod: 0, ring: 44, st: 40, foil: 26, span: 14, tube: 10, sphere: 24 },
  1: { lod: 1, ring: 18, st: 14, foil: 10, span: 5, tube: 5, sphere: 10 },
  2: { lod: 2, ring: 8, st: 6, foil: 4, span: 2, tube: 3, sphere: 5 },
};

export interface Part { g: BufferGeometry; mat: CarMat; tag: number }

export const V = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
export const deg = (d: number): number => (d * Math.PI) / 180;
export const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Chaikin corner cutting on a closed outline (`iter` passes, each cut at 1/4 and 3/4 of an edge). Points listed in
 * `sharp` (indices into the input) keep their corner (e.g. where a plate meets the floor or a wing).
 */
export function rounded(pts: readonly [number, number][], iter: number, sharp: readonly number[] = []): [number, number][] {
  let cur = pts.map((p, i) => ({ p, hard: sharp.includes(i) }));
  for (let k = 0; k < iter; k++) {
    const next: { p: [number, number]; hard: boolean }[] = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i]!, b = cur[(i + 1) % cur.length]!;
      if (a.hard) next.push(a);
      else next.push({ p: [a.p[0] * 0.75 + b.p[0] * 0.25, a.p[1] * 0.75 + b.p[1] * 0.25], hard: false });
      if (!b.hard) next.push({ p: [a.p[0] * 0.25 + b.p[0] * 0.75, a.p[1] * 0.25 + b.p[1] * 0.75], hard: false });
    }
    cur = next;
  }
  return cur.map((c) => c.p);
}

/** Car concept (per team; see carModel.ts conceptOf). */
export type ConceptId = 'arrow' | 'bathtub' | 'overbite' | 'slim';
export const CONCEPT_IDS: readonly ConceptId[] = ['arrow', 'bathtub', 'overbite', 'slim'];

/**
 * Rear wing main geometry (carRear.ts): leading edge at the centre line, chord, angle of attack; the DRS split runs
 * diagonally from the upper surface at `cutUpper` to the lower surface at `cutLower` (chord fractions), so the flap's
 * leading edge overlaps the main plane's thin trailing edge as on a real two-element wing.
 */
export const REAR_WING = { le: { y: 0.7494, z: -2.0972 }, chord: 0.5, angle: deg(12), cutUpper: 0.45, cutLower: 0.55, hingeU: 0.97, hingeV: 0.02 } as const;
/** DRS flap hinge (inside the flap near its trailing edge, chord fraction hingeU / normal offset hingeV) in model space;
 * carVisuals rotates the flap mesh about x here. */
export const REAR_FLAP_PIVOT = {
  y: REAR_WING.le.y + REAR_WING.chord * (REAR_WING.hingeU * Math.sin(REAR_WING.angle) + REAR_WING.hingeV * Math.cos(REAR_WING.angle)),
  z: REAR_WING.le.z - REAR_WING.chord * (REAR_WING.hingeU * Math.cos(REAR_WING.angle) - REAR_WING.hingeV * Math.sin(REAR_WING.angle)),
} as const;
/** Fully open DRS flap rotation (rad, leading edge up about the hinge): ≈19.5°, opening a ≈70 mm slot between the main
 * plane's trailing edge and the flap (geometry check in __tests__/rearWing.test.ts). */
export const DRS_FLAP_OPEN = 0.34;

export const GEARBOX_KEYS: Keys = [
  [-1.45, 0, 0.27, 0.13, 0.13, 0.13, 0.13, 3, 3, 0, 0],
  [-2.05, 0, 0.3, 0.09, 0.09, 0.1, 0.1, 3, 3, 0, 0],
];

/** Key dimensions (metres, model space). */
export const CAR_DIMS = {
  frontAxleZ: 1.962, rearAxleZ: -1.638,
  /** Wheel centre |x| (front / rear); tyre widths and radius: wheels.ts FRONT_W, REAR_W, TYRE_R. */
  frontWheelX: 0.8, rearWheelX: 0.775,
  /** Chassis half-width at the front axle (≈ y 0.2 … 0.45) and nose tip z range of the concepts. */
  chassisHalfWidthFront: 0.16, noseTipZ: [2.94, 3.1] as const,
  /** Floor plate: top y, thickness; plank under it. */
  floorY: 0.058, floorThick: 0.022,
  /** Rear crash structure (carbon) from z0 to z1 at height y, and the rain light at its tail. */
  crash: { z0: -2.0, z1: -2.5, y: 0.405 },
  /** Overall limits (tests): nose tip ≤ 3.16, rear ≥ −2.66, |x| ≤ 1.0, y 0.025 … 1.04. */
} as const;

/** What a part builder gets: the detail level, the car concept and the shared parts list. */
export interface PartBuildCtx {
  lod: 0 | 1 | 2;
  detail: Detail;
  concept: ConceptId;
  parts: Part[];
  /** tag: −1 = project the livery (paint), a swatch cell (atlas SW) for paint, a TRIM cell for 'trim', 0 for carbon. */
  add(g: BufferGeometry, mat: CarMat, tag: number): void;
}

export function partCtx(detail: Detail, concept: ConceptId, parts: Part[]): PartBuildCtx {
  return { lod: detail.lod, detail, concept, parts, add: (g, mat, tag) => parts.push({ g, mat, tag }) };
}

void Vector3;
