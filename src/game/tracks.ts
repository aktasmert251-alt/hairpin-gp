// Track selection glue (L-T1, tracks.md §1). A track counts as available only when the track module builds it under
// its own id; until Çevre lands lombardia/bosphorus the loader ignores the id (or throws), and every session safely
// falls back to İstanbul with a console warning.

import type { TrackModule } from '../contracts/modules';
import type { RaceTrackId, TrackBundle } from '../contracts/track';
import { DEFAULT_TRACK, RACE_TRACKS } from '../data/tracks';
import { loadTrack } from '../track/index';

const load: TrackModule['loadTrack'] = loadTrack;
const availability = new Map<RaceTrackId, boolean>();

function tryLoad(id: RaceTrackId): TrackBundle | null {
  try {
    const t = load(id);
    return t.data.id === id ? t : null;
  } catch (err) {
    console.warn(`[apex] track '${id}' failed to load`, err);
    return null;
  }
}

export function isTrackAvailable(id: RaceTrackId): boolean {
  let ok = availability.get(id);
  if (ok === undefined) {
    ok = tryLoad(id) !== null;
    availability.set(id, ok);
  }
  return ok;
}

/** The selectable tracks in menu order (İstanbul always). */
export function availableRaceTracks(): RaceTrackId[] {
  return RACE_TRACKS.filter(isTrackAvailable);
}

/** `id` when it can be built, else İstanbul (with a console warning). */
export function resolveTrackId(id: RaceTrackId | null | undefined): RaceTrackId {
  if (!id || id === DEFAULT_TRACK || isTrackAvailable(id)) return id ?? DEFAULT_TRACK;
  console.warn(`[apex] track '${id}' is not available yet; using '${DEFAULT_TRACK}'`);
  return DEFAULT_TRACK;
}

/** The session's track bundle; falls back to İstanbul when `id` is not built yet. */
export function loadRaceTrack(id: RaceTrackId): TrackBundle {
  return (resolveTrackId(id) !== DEFAULT_TRACK && tryLoad(id)) || load(DEFAULT_TRACK);
}
