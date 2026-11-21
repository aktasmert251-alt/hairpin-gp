// `__APEX__.track()` (B-6, QA-19-04): describes the track the game is on right now — the running session's, else the one selected
// in the menus — not the launch track. Bundles are built once per id (loadRaceTrack caches) and the descriptor per id.

import type { ApexDebugApi } from '../contracts/debug';
import type { RaceTrackId } from '../contracts/track';
import { loadRaceTrack } from './tracks';

type TrackInfo = NonNullable<ReturnType<ApexDebugApi['track']>>;

export function createTrackAccessor(currentId: () => RaceTrackId): () => TrackInfo {
  const cache = new Map<RaceTrackId, TrackInfo>();
  return () => {
    const id = currentId();
    let info = cache.get(id);
    if (!info) {
      const t = loadRaceTrack(id);
      info = {
        id: t.data.id, length: t.query.length,
        worldFromSD: (s, d) => {
          const o = { x: 0, y: 0, z: 0 };
          t.query.worldFromSD(s, d, o);
          return o;
        },
      };
      cache.set(id, info);
    }
    return info;
  };
}
