// D-056: penalties the server sim gives AI cars (causing a collision, overtaking under the safety car, …) reach the online
// results: forwarded to Room.penalise (timing + `penalty` broadcast). Human penalties stay client-reported.
import { afterAll, describe, expect, it } from 'vitest';
import type { NetServerMsg } from '../../../src/contracts/net';
import type { RoomSim } from '../serverAi';
import { bot, isType, startRace, startServer, type TestServer } from './helpers';

interface RaceView { race: { sim: RoomSim | null; cars: { id: number; index: number; human: boolean; timing: { penaltySec: number } }[] } | null }

describe('AI penalties from the server sim (D-056)', () => {
  let srv: TestServer | null = null;
  afterAll(async () => {
    await srv?.stop();
  });

  it('a sim penalty on an AI car is broadcast and counted; one on a human puppet is not', async () => {
    srv = await startServer({ countdownMs: 300 });
    const a = await bot(srv, 'Penalty');
    const code = await startRace([a], { trackId: 'bosphorus', laps: 1, aiCount: 1, difficulty: 55 });
    await a.waitFor(isType('start'));
    const room = srv.apex.hub.rooms.get(code) as unknown as RaceView;
    const race = room.race!;
    const ai = race.cars.find((c) => !c.human)!;
    const human = race.cars.find((c) => c.human)!;
    const events = race.sim!.runner.world.events;
    events.push({ type: 'penalty', car: ai.index, seconds: 10, reason: 'collision' });
    events.push({ type: 'penalty', car: human.index, seconds: 5, reason: 'collision' });
    events.push({ type: 'penalty', car: ai.index, seconds: 5, reason: 'safetyCar' });
    const got = (await a.waitFor((m) => m.type === 'penalty' && m.reason === 'safetyCar', 5000)) as Extract<NetServerMsg, { type: 'penalty' }>;
    expect(got).toMatchObject({ id: ai.id, seconds: 5 });
    const pens = a.msgs.filter((m) => m.type === 'penalty') as Extract<NetServerMsg, { type: 'penalty' }>[];
    expect(pens.map((p) => [p.id, p.seconds, p.reason])).toEqual([[ai.id, 10, 'collision'], [ai.id, 5, 'safetyCar']]);
    expect(ai.timing.penaltySec).toBe(15);
    expect(human.timing.penaltySec).toBe(0);
    a.close();
  }, 30_000);
});
