import { describe, expect, test } from 'vitest';
import { RACE_TRACKS } from '../../src/data/tracks';
import { startRace } from './bots';
import { scenario } from './scenario';

// T12 here is the requested server race matrix, in addition to the existing regression gate.
describe.each(RACE_TRACKS)('T12 full race on %s', (trackId) => {
  // Each case already simulates up to a full grid. T4 covers simultaneous rooms separately.
  test.each([2, 4, 8, 20])('%i human bots: lobby -> load -> start -> laps -> results', async (n) => {
    await scenario(`t12-${trackId}-${n}`, async (srv, fleet) => {
      const bots = await fleet.group(n, 'Racer');
      await startRace(bots, { trackId, laps: 1, aiCount: 0, difficulty: 100 });
      const results = await Promise.all(bots.map((b) => b.waitFor((m) => m.type === 'results', 220_000)));
      const first = results[0]!;
      if (first.type !== 'results') throw new Error('Missing results');
      expect(first.rows).toHaveLength(n);
      expect(first.rows.map((r) => r.id).sort()).toEqual(bots.map((b) => b.id).sort());
      expect(first.rows.every((r) => r.status === 'finished' && r.totalMs > 0 && r.bestLapMs > 0 && r.penaltySec === 0)).toBe(true);
      expect(first.rows.map((r) => r.pos)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      for (const b of bots) {
        expect(b.results).toEqual(first);
        expect(b.load!.roster).toHaveLength(n);
        expect(b.load!.config).toMatchObject({ trackId, aiCount: 0, laps: 1 });
        expect(new Set(b.load!.roster.map((r) => r.gridSlot)).size).toBe(n);
        expect(b.msgs.some((m) => m.type === 'finishing')).toBe(true);
        expect(b.msgs.filter((m) => m.type === 'lap' && m.lap === 1)).toHaveLength(n);
        expect([...b.seenIds].sort()).toEqual(bots.filter((x) => x !== b).map((x) => x.id).sort());
      }
      expect(srv.logs.filter((l) => ['strike', 'hardViolation', 'lapRejected', 'roomError', 'messageError', 'timingMismatch'].includes(l.event))).toEqual([]);
      expect(first.rows[0]!.points).toBe(25);
      return { rows: first.rows };
    });
  });
});
