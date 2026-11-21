// AI module context: caches derived from world.static (racing line, per-car speed profiles and per-car static
// driver data). Created by createAIModule; never stores sim state. Sim layer.

import type { RacingLine, SpeedProfile } from '../contracts/ai';
import type { Compound, Vec3 } from '../contracts/common';
import type { SimWorld } from '../contracts/sim';
import type { TrackFrame, TrackQuery } from '../contracts/track';
import type { VehicleParams } from '../contracts/vehicle';
import type { CornerWindows, VarietyDriver } from './line/variety';
import type { PitGeometry } from './pit/pitDriver';
import type { LineTrackCache } from './profile/speedProfile';

export interface AiCarStatic {
  perfect: boolean;
  pace: number;
  aggression: number;
  startSkill: number;
  wetSkill: number;
  /** Start reaction (s) after lights out. */
  reaction: number;
  /** Grid column side (+1 left, −1 right) for the start lanes. */
  startSide: number;
  /** Grid lateral position d (m): the start lane until the first brake zone. */
  startD: number;
  compound: Compound;
  mistakeChance: number;
  /** 1 while rejoining from the pit lane (set in the 'exit' phase, cleared 150 m past the merge). */
  fromPit: number;
  /** Race-day pace factor on grip (seeded per race). */
  form: number;
  /** Line / pace variety inputs (line/variety.ts). */
  vd: VarietyDriver;
}

export interface AiContext {
  track: TrackQuery | null;
  params: VehicleParams[];
  line: RacingLine | null;
  dMin: Float32Array;
  dMax: Float32Array;
  cache: LineTrackCache | null;
  profiles: SpeedProfile[];
  /** 1 = profile needs a rebuild. */
  dirty: Uint8Array;
  lastBuildTick: number;
  cars: AiCarStatic[];
  /** Main-track s where the first brake zone after the S/F line starts (start-lane fade point). */
  startBrakeS: number;
  /** Progress (m) where start mode ends: the exit of the first braking corner. */
  startEndS: number;
  /** The session world (set in initCar): getProfile reads the player's fitted compound from it. */
  world: SimWorld | null;
  /** Pit-lane speed curve and entry / exit offsets (null: no pit lane). */
  pit: PitGeometry | null;
  corners: CornerWindows | null;
  difficulty: number;
  wetness: number;
  airC: number;
  // Scratch (reused, allocation-free per call).
  frame: TrackFrame;
  p0: Vec3;
}

export function newCarStatic(): AiCarStatic {
  return {
    perfect: true, pace: 1, aggression: 0.5, startSkill: 1, wetSkill: 1, reaction: 0.24, startSide: 1, startD: 0,
    compound: 'medium', mistakeChance: 0.002, fromPit: 0, form: 1, vd: { seed: 0, bias: 0, consistency: 1, aggression: 0.5, tyreMgmt: 0.5, sigmaV: 0 },
  };
}

export function newContext(): AiContext {
  return {
    track: null, params: [], line: null, dMin: new Float32Array(0), dMax: new Float32Array(0), cache: null, profiles: [], dirty: new Uint8Array(0), lastBuildTick: -1, cars: [],
    pit: null, corners: null, difficulty: 70, wetness: 0, airC: 24, startBrakeS: 120, startEndS: 600, world: null,
    frame: { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 },
    p0: { x: 0, y: 0, z: 0 },
  };
}
