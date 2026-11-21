// Sim layer: shape of src/track/data/<id>.raw.json (written by scripts/fetch-track.mjs) and one export per track.

import rawJson from './istanbul.raw.json';
import lombardiaJson from './lombardia.raw.json';
import bosphorusJson from './bosphorus.raw.json';
import ardennesJson from './ardennes.raw.json';

export type RawFeatureKind = 'bleachers' | 'grandstand' | 'building' | 'forest' | 'scrub' | 'farmland' | 'residential' | 'grass' | 'parking' | 'ruin' | 'coast' | 'bridge';

export interface RawFeature {
  kind: RawFeatureKind;
  id: number;
  /** World XZ polygon (metres, S/F origin); an open polyline for 'ruin' / 'coast' (land on the left); the two tower
   *  positions for 'bridge'. OSM name tags are never stored (Ek A). */
  xz: [number, number][];
  /** 'ruin' only: the way is a bridge (crosses over the circuit). */
  bridge?: boolean;
  building?: string;
  levels?: number;
  height?: number;
}

export interface RawTrack {
  version: 1;
  source: 'osm' | 'fallback' | 'osm+fallback-elevation' | 'authored' | 'authored+osm';
  /** Authored tracks: the local shore frame (tracks.md §3.2). x = ax + u·sinβ − v·cosβ, z = az − u·cosβ − v·sinβ. */
  local?: { beta: number; anchor: [number, number]; seawallV: number; seawallU: number };
  attribution: string[];
  origin: { nodeId: number; lat: number; lon: number };
  projection: { phiDeg: number; mLat: number; mLon: number };
  main: { closed: true; length: number; xz: [number, number][] };
  pit: { length: number; xz: [number, number][] };
  /** Centreline elevation y (relative to S/F) at raw-polyline arc length s. */
  elevation: { ref: number; step: number; s: number[]; y: number[] };
  pitElevation: { step: number; s: number[]; y: number[] } | null;
  /** Row-major (z rows, x columns) heights relative to S/F; null in the fallback. */
  terrain: { x0: number; z0: number; step: number; nx: number; nz: number; y: number[] } | null;
  features: RawFeature[];
}

export const ISTANBUL_RAW: RawTrack = rawJson as unknown as RawTrack;
export const LOMBARDIA_RAW: RawTrack = lombardiaJson as unknown as RawTrack;
export const BOSPHORUS_RAW: RawTrack = bosphorusJson as unknown as RawTrack;
export const ARDENNES_RAW: RawTrack = ardennesJson as unknown as RawTrack;
