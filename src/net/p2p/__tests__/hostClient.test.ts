// D-064: the game's real netClient (as main.ts creates it) against the browser host room over loopback transports: the host's
// own client creates the room, guests join by its code, the lobby stores follow, and the host ending the room closes every guest.
import { afterEach, describe, expect, it } from 'vitest';
import { HostRoom } from '../../../../server/src/p2p/hostRoom';
import type { NetLobbyModel } from '../../../contracts/net';
import { createStore } from '../../../core/store';
import { OFFLINE_LOBBY, createNetClient, type NetClient } from '../../netClient';
import { createLoopbackPair } from '../transport';

const until = async (ok: () => boolean, ms = 3000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

let room: HostRoom | null = null;
const clients: NetClient[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.close(true);
  room?.end();
  room = null;
});

function client(r: HostRoom, name: string, label: string): NetClient {
  const lobby = createStore<NetLobbyModel>({ ...OFFLINE_LOBBY });
  const c = createNetClient({ url: label === 'host' ? 'p2p:host' : 'p2p:guest', name, build: 'test', lobby }, {
    storage: null, deviceStorage: null,
    socket: () => {
      const [a, b] = createLoopbackPair();
      r.attach(b, label);
      return a;
    },
  });
  clients.push(c);
  c.connect();
  return c;
}

describe('netClient over the host room', () => {
  it('host creates, 4 guests join by code, settings and ready flow through; host ends → guests drop', async () => {
    room = new HostRoom();
    const host = client(room, 'Ev Sahibi', 'host');
    host.send({ type: 'create', settings: { visibility: 'private', trackId: 'bosphorus', laps: 3, tod: 'day', weather: 'dry', aiCount: 5, difficulty: 80 } });
    await until(() => !!host.lobby.get().room);
    const code = host.lobby.get().room!.code;
    const guests = [2, 3, 4, 5].map((n) => client(room!, `Misafir ${n}`, `guest-${n}`));
    for (const g of guests) g.send({ type: 'join', code });
    await until(() => host.lobby.get().room?.players.length === 5);
    expect(host.lobby.get().room!.ownerId).toBe(host.lobby.get().myId);
    host.send({ type: 'setSettings', settings: { visibility: 'private', trackId: 'bosphorus', laps: 5, tod: 'night', weather: 'dry', aiCount: 3, difficulty: 90 } });
    for (const g of guests) g.send({ type: 'setReady', ready: true });
    await until(() => guests.every((g) => g.lobby.get().room?.settings.laps === 5 && g.lobby.get().room!.players.filter((p) => p.ready).length === 4));
    // A guest cannot change the owner's settings.
    guests[0]!.send({ type: 'setSettings', settings: { visibility: 'private', trackId: 'bosphorus', laps: 1, tod: 'day', weather: 'dry', aiCount: 0, difficulty: 0 } });
    await until(() => guests[0]!.lobby.get().error === 'phase');
    expect(host.lobby.get().room!.settings.laps).toBe(5);

    room.end();
    await until(() => guests.every((g) => g.lobby.get().status !== 'online'));
  });
});
