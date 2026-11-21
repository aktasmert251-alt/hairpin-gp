// QA-19-04 regression: __APEX__.track() follows the current track (menu selection / session), not the launch track.
import { describe, expect, it } from 'vitest';
import type { RaceTrackId } from '../../contracts/track';
import { createTrackAccessor } from '../trackAccessor';
import { loadRaceTrack } from '../tracks';

describe('track debug accessor', () => {
  it('reports the currently selected track and switches with it', () => {
    let id: RaceTrackId = 'istanbul';
    const track = createTrackAccessor(() => id);
    expect(track().id).toBe('istanbul');
    for (const next of ['lombardia', 'bosphorus', 'ardennes', 'alpine', 'cliff', 'eifel', 'aegean', 'cappadocia', 'volcano', 'istanbul'] as RaceTrackId[]) {
      id = next;
      const info = track();
      const t = loadRaceTrack(next);
      expect(info.id).toBe(next);
      expect(info.length).toBe(t.query.length);
      const p = { x: 0, y: 0, z: 0 };
      t.query.worldFromSD(100, 2, p);
      expect(info.worldFromSD(100, 2)).toEqual(p);
    }
    expect(track()).toBe(track()); // cached per id
  });
});
