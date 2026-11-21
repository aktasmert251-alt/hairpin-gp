// D-048: a room of 20 humans races one lap to the results. Real time (~90 s). Also checks the 16 KB JSON limit with long names.
import { afterAll, describe, expect, it } from 'vitest';
import type { NetServerMsg } from '../../../src/contracts/net';
import { NET_LIMITS } from '../../../src/net/protocol';
import type { Bot } from '../../bots/bot';
import { bot, startRace, startServer, type TestServer } from './helpers';

let srv: TestServer | null = null;
const bots: Bot[] = [];
afterAll(async () => {
  for (const b of bots) b.close();
  await srv?.stop();
});

describe('20 humans in one room (D-048)', () => {
  it('all 20 finish 1 lap with 0 strikes; every JSON message fits 16 KB; a 21st player is refused', { timeout: 240_000 }, async () => {
    srv = await startServer({ countdownMs: 1000 });
    for (let i = 0; i < 20; i++) bots.push(await bot(srv, `LongNameDriver${String(i).padStart(2, '0')}`, { hz: 20 }));
    await startRace(bots, { trackId: 'bosphorus', laps: 1, aiCount: 10 });
    const load = bots[0]!.load!;
    expect(load.config.aiCount).toBe(0); // AI fills only empty slots: none left
    expect(load.roster).toHaveLength(20);
    expect(load.roster.every((r) => r.kind === 'human')).toBe(true);

    const res = (await bots[0]!.waitFor((m) => m.type === 'results', 200_000)) as Extract<NetServerMsg, { type: 'results' }>;
    expect(res.rows).toHaveLength(20);
    expect(res.rows.every((r) => r.status === 'finished')).toBe(true);
    for (const b of bots) {
      const car = [...srv.apex.hub.rooms.values()][0]!.race!.byId[b.id]!;
      expect(car.strikes).toBe(0);
      expect(car.hardViolations).toBe(0);
    }
    expect(srv.apex.metrics.maxJsonBytes).toBeGreaterThan(0);
    expect(srv.apex.metrics.maxJsonBytes).toBeLessThanOrEqual(NET_LIMITS.maxServerJsonBytes);
    expect(srv.logs.filter((l) => l.event === 'serverJsonTooBig')).toHaveLength(0);
    console.log(`room20: largest JSON ${srv.apex.metrics.maxJsonBytes} B (${srv.apex.metrics.maxJsonType})`);

    // Back in the lobby the room is still full at 20.
    bots[0]!.send({ type: 'backToLobby' });
    await bots[0]!.next((m) => m.type === 'room' && m.phase === 'lobby');
    const extra = await bot(srv, 'Extra');
    bots.push(extra);
    extra.send({ type: 'join', code: bots[0]!.room!.code });
    expect(await extra.next((m) => m.type === 'error')).toEqual({ type: 'error', code: 'full' });
  });
});
