// Sim layer: track-module-internal data that the TrackData contract has no field for (racing-line approximation,
// pit ↔ main mappings, authoring results used by the presentation meshes). Keyed by the TrackData object.

import type { Side } from '../../contracts/common';
import type { WallKind } from '../../contracts/track';
import type { TrackAuthoring } from '../authoring/types';
import type { RawFeature } from '../data/raw';
import type { Registration } from './centreline';

export type RunoffPaint = { fromS: number; toS: number; side: Side };

export interface WallChain {
  /** Index into TrackData.walls of each piece, in order along the chain. */
  pieces: number[];
  closed: boolean;
  /** 'right' = the closed loop on the side away from the pit, 'leftOuter' = the closed pit-side loop (main pit-side
   *  barrier + the pit lane's garage-side barrier); the names date from İstanbul (pit on the left). */
  role: 'right' | 'leftOuter' | 'pitWallMain' | 'pitWallPit';
}

export interface TrackExtras {
  /** Approximate racing line: lateral offset (+left) per main sample. */
  lineD: Float32Array;
  /** Main-track s of every pit sample. */
  pitMainS: Float32Array;
  /** +1 = pit on the left of the main track, −1 = on the right. */
  pitSide: Side;
  /** |main d| below which a pit sample counts as running beside the main track. */
  pitNearD: number;
  /** Main-frame lateral offset of every pit sample. */
  pitMainD: Float32Array;
  /** Pit sample spacing (sp of sample j = j · pitDsp). */
  pitDsp: number;
  /** Pit sp for each main sample in the pit-adjacent range, NaN elsewhere. */
  mainPitSp: Float32Array;
  /** Pit wall face (signed main d, facing the main track) per main sample; NaN where there is no pit wall. */
  pitWallD: Float32Array;
  pitWallThickness: number;
  /** Main s range [from, to] (wrapping) where the pit lane runs beside the main track. */
  pitRange: { from: number; to: number };
  /** Signed lateral offset (pit frame, +left) of the pit lane's outer (garage-side) barrier, per pit sample. */
  pitOuterWallD: Float32Array;
  /** Painted (red/blue) run-off areas. */
  paint: RunoffPaint[];
  /** Kerb kind per side per sample: 0 none, 1 flat apex kerb, 2 flat exit kerb. */
  kerbL: Uint8Array;
  kerbR: Uint8Array;
  /** Wall kind per side per sample (for the mesh). */
  wallKindL: WallKind[];
  wallKindR: WallKind[];
  chains: WallChain[];
  /** Bumpy sections in final s (authoring BUMPS); empty on most tracks. */
  bumps: { from: number; to: number; amp: number; wave: number }[];
  /** Fall zones in final s (authoring FALLS): side, lip offset beyond the edge. */
  falls: { from: number; to: number; side: 1 | -1; lip: number }[];
  /** Ash ranges in final s (authoring ASH). */
  ash: { from: number; to: number }[];
  /** Puddle ellipses in final s. */
  puddles: { s: number; d: number; len: number; width: number }[];
  /** Raw → world registration (apply to raw feature coordinates and the terrain grid). */
  reg: Registration;
  /** OSM basis → final s scale (s_final = s_osm · sScale). */
  sScale: number;
  features: readonly RawFeature[];
  terrain: { x0: number; z0: number; step: number; nx: number; nz: number; y: readonly number[] } | null;
  source: string;
  /** Authored tracks: the local shore frame in raw coordinates (tracks.md §3.2); null otherwise. */
  local: { beta: number; anchor: [number, number]; seawallV: number; seawallU: number } | null;
  /** Box positions on the main track (for scenery: garages). */
  boxMainS: number[];
  /** The authoring table the track was built from (scenery reads TRACKSIDE / THEME). */
  authoring: TrackAuthoring;
}

const registry = new WeakMap<object, TrackExtras>();

export function setTrackExtras(data: object, e: TrackExtras): void {
  registry.set(data, e);
}

export function getTrackExtras(data: object): TrackExtras | undefined {
  return registry.get(data);
}
