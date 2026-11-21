// Sim layer: race-track registry (tracks.md §1.3). track id → baked raw file + authoring table; bundles are built
// once per id on first use and then shared (TrackData is immutable). Static JSON imports (each raw file ≤ 80 KB).

import type { TrackBundle } from '../contracts/track';
import { ISTANBUL } from './authoring/istanbul';
import { LOMBARDIA } from './authoring/lombardia';
import { BOSPHORUS } from './authoring/bosphorus';
import { ARDENNES } from './authoring/ardennes';
import { ALPINE } from './authoring/alpine';
import { CLIFF } from './authoring/cliff';
import type { BuiltTrackId, TrackAuthoring } from './authoring/types';
import { buildTrackData } from './build/buildTrackData';
import { ARDENNES_RAW, BOSPHORUS_RAW, ISTANBUL_RAW, LOMBARDIA_RAW, type RawTrack } from './data/raw';
import { ALPINE_RAW } from './data/alpine-raw';
import { CLIFF_RAW } from './data/cliff-raw';
import { EIFEL } from './authoring/eifel';
import { AEGEAN } from './authoring/aegean';
import { aegeanRaw } from './data/aegean-raw';
import { eifelRaw } from './data/eifel-raw';
import { CAPPADOCIA } from './authoring/cappadocia';
import { cappadociaRaw } from './data/cappadocia-raw';
import { VOLCANO } from './authoring/volcano';
import { volcanoRaw } from './data/volcano-raw';
import { createTrackBundle } from './query/trackQuery';

export interface TrackSource { raw: RawTrack; authoring: TrackAuthoring }

export const TRACK_SOURCES: Partial<Record<BuiltTrackId, TrackSource>> = {
  istanbul: { raw: ISTANBUL_RAW, authoring: ISTANBUL },
  lombardia: { raw: LOMBARDIA_RAW, authoring: LOMBARDIA },
  bosphorus: { raw: BOSPHORUS_RAW, authoring: BOSPHORUS },
  ardennes: { raw: ARDENNES_RAW, authoring: ARDENNES },
  alpine: { raw: ALPINE_RAW, authoring: ALPINE },
  cliff: { raw: CLIFF_RAW, authoring: CLIFF },
  // Built on first access (≈ 10 km terrain): importing the registry stays cheap for the other tracks and the server.
  eifel: { get raw() { return eifelRaw(); }, authoring: EIFEL },
  aegean: { get raw() { return aegeanRaw(); }, authoring: AEGEAN },
  cappadocia: { get raw() { return cappadociaRaw(); }, authoring: CAPPADOCIA },
  volcano: { get raw() { return volcanoRaw(); }, authoring: VOLCANO },
};

const cache = new Map<BuiltTrackId, TrackBundle>();

/** Builds (once) and returns a race track; ids without a registered source fall back to İstanbul with a warning. */
export function loadRaceTrack(id: BuiltTrackId): TrackBundle {
  let src = TRACK_SOURCES[id];
  if (!src) {
    console.warn(`[track] no data for '${id}', using istanbul`);
    id = 'istanbul';
    src = TRACK_SOURCES.istanbul!;
  }
  let b = cache.get(id);
  if (!b) {
    b = createTrackBundle(buildTrackData(src.raw, src.authoring));
    cache.set(id, b);
  }
  return b;
}
