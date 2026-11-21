// D-061 race modes (Normal / Kasap) and D-062 custom teams online: server validation, room snapshots, load, listing.
import { afterAll, describe, expect, it } from 'vitest';
import type { NetCustomTeam, NetServerMsg } from '../../../src/contracts/net';
import { DEFAULT_SETTINGS } from '../../bots/bot';
import { bot, isType, sleep, startRace, startServer, type TestServer } from './helpers';

type Room = Extract<NetServerMsg, { type: 'room' }>;
const TEAM: NetCustomTeam = { id: 'custom-mine', name: 'Kartal Racing', baseTeamId: 'vortex', primary: 'teal', secondary: 'white', accent: 'gold', finish: 'matte' };

const servers: TestServer[] = [];
afterAll(async () => {
  for (const s of servers) await s.stop();
});

describe('D-062 custom teams online', () => {
  it('creator takes the base car, a teammate joins the 2nd seat, others cannot take the base, the team is in load', async () => {
    const srv = await startServer({ countdownMs: 300 });
    servers.push(srv);
    const a = await bot(srv, 'Kurucu');
    const b = await bot(srv, 'Takimci');
    const c = await bot(srv, 'Baskasi');
    a.send({ type: 'create', settings: DEFAULT_SETTINGS });
    const r0 = (await a.waitFor(isType('room'))) as Room;
    for (const x of [b, c]) {
      x.send({ type: 'join', code: r0.code });
      await x.waitFor((m) => m.type === 'room' && m.players.some((p) => p.id === x.id));
    }
    a.send({ type: 'setTeam', team: TEAM });
    const r1 = (await a.next((m) => m.type === 'room' && (m.teams?.length ?? 0) === 1)) as Room;
    expect(r1.teams).toEqual([{ ownerId: a.id, team: { ...TEAM, id: 'custom-vortex' } }]);
    expect(r1.players.find((p) => p.id === a.id)).toMatchObject({ teamId: 'vortex' });
    // Another player cannot put a second custom team on the same base car.
    b.send({ type: 'setTeam', team: { ...TEAM, name: 'Baska Takim' } });
    expect(await b.next(isType('error'))).toMatchObject({ code: 'taken' });
    // A teammate joins the free seat of the base car (the custom team's 2nd driver).
    const seat = r1.players.find((p) => p.id === a.id)!.driverIdx === 0 ? 1 : 0;
    b.send({ type: 'setCar', teamId: 'vortex', driverIdx: seat });
    await a.next((m) => m.type === 'room' && m.players.some((p) => p.id === b.id && p.teamId === 'vortex'));
    // Both seats taken: a third player's team on that base is refused; an invalid team never reaches the room.
    c.send({ type: 'setTeam', team: { ...TEAM, name: 'Ucuncu Takim' } });
    expect(await c.next(isType('error'))).toMatchObject({ code: 'taken' });
    c.send({ type: 'setTeam', team: { ...TEAM, primary: 'neon-pink' } });
    expect(await c.next(isType('error'))).toMatchObject({ code: 'badMessage' });
    // Edits by the creator replace the team.
    a.send({ type: 'setTeam', team: { ...TEAM, name: 'Kartal GP' } });
    await a.next((m) => m.type === 'room' && m.teams?.[0]?.team.name === 'Kartal GP');
    for (const x of [b, c]) x.send({ type: 'setReady', ready: true });
    await a.waitFor((m) => m.type === 'room' && m.players.filter((p) => p.ready).length === 2);
    a.send({ type: 'start' });
    const load = (await b.waitFor(isType('load'))) as Extract<NetServerMsg, { type: 'load' }>;
    expect(load.teams).toEqual([{ ...TEAM, name: 'Kartal GP', id: 'custom-vortex' }]);
    for (const x of [a, b, c]) x.close();
  }, 30_000);

  it('two players bring their own custom teams on different base cars; both reach load; names are unique per room', async () => {
    const srv = await startServer({ countdownMs: 300 });
    servers.push(srv);
    const a = await bot(srv, 'Birinci');
    const b = await bot(srv, 'Ikinci');
    a.send({ type: 'create', settings: DEFAULT_SETTINGS });
    const r0 = (await a.waitFor(isType('room'))) as Room;
    b.send({ type: 'join', code: r0.code });
    await b.waitFor((m) => m.type === 'room' && m.players.some((p) => p.id === b.id));
    a.send({ type: 'setTeam', team: TEAM });
    await a.next((m) => m.type === 'room' && m.teams?.length === 1);
    // Same name (case / spacing variant) on a free base car is refused; a different name is accepted.
    b.send({ type: 'setTeam', team: { ...TEAM, id: 'custom-other', baseTeamId: 'nova', name: 'kartal  RACING' } });
    expect(await b.next(isType('error'))).toMatchObject({ code: 'taken' });
    const teamB: NetCustomTeam = { ...TEAM, id: 'custom-other', baseTeamId: 'nova', name: 'Mavi Ok', primary: 'navy', finish: 'gloss' };
    b.send({ type: 'setTeam', team: teamB });
    const r1 = (await a.next((m) => m.type === 'room' && m.teams?.length === 2)) as Room;
    expect(r1.teams).toEqual(expect.arrayContaining([
      { ownerId: a.id, team: { ...TEAM, id: 'custom-vortex' } },
      { ownerId: b.id, team: { ...teamB, id: 'custom-nova' } },
    ]));
    expect(r1.players.find((p) => p.id === b.id)).toMatchObject({ teamId: 'nova' });
    b.send({ type: 'setReady', ready: true });
    await a.waitFor((m) => m.type === 'room' && m.players.some((p) => p.id === b.id && p.ready));
    a.send({ type: 'start' });
    const load = (await b.waitFor(isType('load'))) as Extract<NetServerMsg, { type: 'load' }>;
    expect(load.teams).toEqual(expect.arrayContaining([{ ...TEAM, id: 'custom-vortex' }, { ...teamB, id: 'custom-nova' }]));
    expect(load.teams).toHaveLength(2);
    for (const x of [a, b]) x.close();
  }, 30_000);

  it('the creator leaving its base car (or the room) drops the team', async () => {
    const srv = await startServer();
    servers.push(srv);
    const a = await bot(srv, 'Kurucu');
    a.send({ type: 'create', settings: DEFAULT_SETTINGS });
    await a.waitFor(isType('room'));
    a.send({ type: 'setTeam', team: TEAM });
    await a.next((m) => m.type === 'room' && m.teams?.length === 1);
    a.send({ type: 'setCar', teamId: 'nova', driverIdx: 0 });
    const r = (await a.next((m) => m.type === 'room' && m.players[0]!.teamId === 'nova')) as Room;
    expect(r.teams).toEqual([]);
    a.send({ type: 'setTeam', team: TEAM });
    await a.next((m) => m.type === 'room' && m.teams?.length === 1);
    a.send({ type: 'setTeam', team: null });
    expect(((await a.next(isType('room'))) as Room).teams).toEqual([]);
    a.close();
  }, 20_000);
});

describe('D-061 race modes', () => {
  async function reportInRace(mode: 'normal' | 'kasap'): Promise<NetServerMsg[]> {
    const srv = await startServer({ countdownMs: 300 });
    servers.push(srv);
    const a = await bot(srv, `Mod ${mode}`);
    await startRace([a], { mode, aiCount: 0 });
    await a.waitFor(isType('start'));
    await a.waitFor((m) => m.type === 'room' && m.phase === 'racing', 5000);
    a.send({ type: 'report', kind: 'collision', seconds: 5, lap: 0 });
    await sleep(400);
    a.close();
    return a.msgs.filter((m) => m.type === 'penalty');
  }

  it('Normal relays a reported penalty; Kasap applies none', async () => {
    expect(await reportInRace('normal')).toHaveLength(1);
    expect(await reportInRace('kasap')).toHaveLength(0);
  }, 30_000);

  it('the mode is a room setting shown in the public room list', async () => {
    const srv = await startServer();
    servers.push(srv);
    const a = await bot(srv, 'Kasapci');
    a.send({ type: 'create', settings: { ...DEFAULT_SETTINGS, mode: 'kasap' } });
    const r = (await a.waitFor(isType('room'))) as Room;
    expect(r.settings.mode).toBe('kasap');
    const b = await bot(srv, 'Bakan');
    b.send({ type: 'listRooms' });
    const list = (await b.waitFor(isType('rooms'))) as Extract<NetServerMsg, { type: 'rooms' }>;
    expect(list.rooms.find((x) => x.code === r.code)?.mode).toBe('kasap');
    a.close();
    b.close();
  }, 20_000);
});
