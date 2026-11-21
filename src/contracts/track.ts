// Contract: track data + spatial queries. Implemented by: Çevre (src/track/**).

import type { Side, SurfaceType, Vec3 } from './common';

/** Deviation from §4: §4 had `id: 'istanbul'` only; the Sprint 0 placeholders need their own ids. */
/** CR-TRK-6: 'ardennes' (D-048 Spa-inspired track). */
/** D-063: 'alpine' (Alpine Pass Circuit, authored). */
/** 'cliff' (Desert Cliff Circuit, authored). 'eifel' (Eifel Forest Ring, authored, ≈ 20 km).
 *  'aegean' (Aegean Islands Circuit, authored, mostly on bridges over the sea). */
/** 'cappadocia' (Cappadocia Valley Circuit, authored, technical). 'volcano' (Volcano Rim, authored, fall zones). */
export type TrackId = 'istanbul' | 'lombardia' | 'bosphorus' | 'ardennes' | 'alpine' | 'cliff' | 'eifel' | 'aegean' | 'cappadocia' | 'volcano' | 'oval' | 'straight';
/** CR-TRK-1 (tracks.md §1.2): the tracks a race / Time Trial session can run on (test tracks excluded). */
export type RaceTrackId = Exclude<TrackId, 'oval' | 'straight'>;

export interface TrackFrame {
  s: number; px: number; py: number; pz: number;    // centreline ground point
  tx: number; tz: number;                           // horizontal unit tangent (driving dir)
  lx: number; lz: number;                           // horizontal unit LEFT vector
  halfWidthL: number; halfWidthR: number;           // white-line edges = track limits (>0)
  crossSlope: number;                               // dy/dd; ground y at offset d = py + crossSlope*d
  curvature: number; vCurvature: number; grade: number; // 1/m (+left), d²y/ds² (+compression), dy/ds
  sector: 0 | 1 | 2;
}

/** Persistent per car/wheel search hint. */
export interface TrackHint { s: number; ribbon: 'main' | 'pit'; sp: number }

export interface GroundHit {
  y: number; nx: number; ny: number; nz: number; surface: SurfaceType;
  /** CR-TR-1: on the pit ribbon `d` is pit-local (lateral offset from the pit-lane centreline). */
  ribbon: 'main' | 'pit'; s: number; d: number; sp: number;  // s always = main-track s (projected); sp NaN on main
  inLimits: boolean; wetLocal: number;                        // wetness multiplier hint (puddle/line), filled by query if provided
}

export type WallKind = 'armco' | 'concrete' | 'tyres' | 'tecpro' | 'pitwall' | 'fence';

/** dist < 0 = penetration; n points to the drivable side. */
export interface WallHit { nx: number; nz: number; px: number; pz: number; dist: number; wallId: number; kind: WallKind }

export interface SurfaceProps {
  mu: number; muWetMul: number; rollingResistance: number;
  /** m/s² at full effect; physics scales gravel by min(1, v/10). */
  dragDecel: number;
  /** m */
  bumpAmp: number;
  /** m */
  bumpWavelength: number;
  /** 0..1 load-noise fraction */
  loadNoise: number;
}

export interface TrackQuery {
  readonly data: TrackData; readonly length: number;
  frameAt(s: number, out: TrackFrame): TrackFrame;
  worldFromSD(s: number, d: number, out: Vec3): Vec3;
  pitWorldFromSD(sp: number, d: number, out: Vec3): Vec3;
  /** Local search ±40 m around hint.s. */
  project(x: number, z: number, hint: TrackHint, out: { s: number; d: number }): void;
  /** Updates hint in place; ≤1 µs target. */
  ground(x: number, z: number, hint: TrackHint, out: GroundHit): GroundHit;
  /** Fills pre-allocated `out` entries [0, n) and returns n (≤ max). Callers pre-allocate `max` WallHit objects. */
  wallsNear(x: number, z: number, radius: number, out: WallHit[], max: number): number;
  surfaceProps(t: SurfaceType): SurfaceProps;
  wrapS(s: number): number;
  /** Shortest signed difference to - from, in (-L/2, L/2]. */
  deltaS(from: number, to: number): number;
  sectorAt(s: number): 0 | 1 | 2;
}

export type TimingLineKind = 'finish' | 'sector2' | 'sector3' | 'speedTrap' | 'drsDetect' | 'drsActivate' | 'drsEnd' | 'pitEntry' | 'pitExit';

export interface TrackData {
  id: TrackId; name: { tr: string; en: string }; length: number; ds: 1; count: number;
  x: Float32Array; y: Float32Array; z: Float32Array; tx: Float32Array; tz: Float32Array;
  curvature: Float32Array; vCurvature: Float32Array; grade: Float32Array; crossSlope: Float32Array;
  halfWidthL: Float32Array; halfWidthR: Float32Array;
  /** 4 bands/side/sample (index = sample*4 + band); type codes are track-module internal; outer offsets in m (>0). */
  bandTypeL: Uint8Array; bandOuterL: Float32Array; bandTypeR: Uint8Array; bandOuterR: Float32Array;
  /** Lateral distance to the barrier face. */
  wallL: Float32Array; wallR: Float32Array;
  /** s where S2, S3 start. */
  sectors: [number, number];
  /** `ref` = DRS zone id for DRS lines, 0 otherwise. CR-TR-2: `pitEntry` / `pitExit` lines carry the main-track s. */
  timingLines: { kind: TimingLineKind; s: number; ref: number }[];
  drsZones: { id: number; detectS: number; activateS: number; endS: number }[];
  corners: { n: number; dir: 'L' | 'R'; entryS: number; apexS: number; exitS: number; minRadius: number }[];
  cutZones: { id: string; side: Side; fromS: number; toS: number; gates: number[] }[];
  /** 20 slots, index 0 = pole. */
  grid: { s: number; d: number }[];
  pit: PitLaneData;
  walls: { id: number; kind: WallKind; height: number; xz: Float32Array; drivableSide: Side }[];
  startGantryS: number; attribution: string[];
}

export interface PitLaneData {
  /** A track without a pit lane uses length 0, count 0, empty arrays, no boxes and split/merge = -1. */
  length: number; count: number; x: Float32Array; y: Float32Array; z: Float32Array; tx: Float32Array; tz: Float32Array; halfWidth: Float32Array;
  mainSAtSplit: number; mainSAtMerge: number; limitStartSp: number; limitEndSp: number; speedLimitKmh: 80;
  /** +d toward garages */
  fastLaneD: number; workingLaneD: number;
  boxes: { teamId: string; sp: number; d: number }[];
}

export interface TrackBundle { data: TrackData; query: TrackQuery }
