import type { Page } from '@playwright/test';
import type { NetClientMsg, NetServerMsg } from '../../src/contracts/net';
import { parseClientMessage } from '../../src/net/protocol';

/** Local wire peer for UI integration tests. No socket reaches a real server. */
export async function mockLobby(page: Page): Promise<NetClientMsg[]> {
  const requests: NetClientMsg[] = [];
  const room: Extract<NetServerMsg, { type: 'room' }> = {
    type: 'room', code: 'HRP42', ownerId: 0, phase: 'lobby',
    settings: { visibility: 'public', mode: 'normal', trackId: 'ardennes', laps: 1, weather: 'dry', tod: 'day', aiCount: 19, difficulty: 55 },
    players: [{ id: 0, name: 'Deniz', teamId: 'anka', driverIdx: 0, connected: true, ready: false, pingMs: 0 }], teams: [],
  };
  await page.routeWebSocket('**/ws', socket => {
    const send = (message: NetServerMsg) => socket.send(JSON.stringify(message));
    socket.onMessage(raw => {
      if (typeof raw !== 'string') return;
      const message = parseClientMessage(raw);
      if (!message) return;
      requests.push(message);
      switch (message.type) {
        case 'hello':
          room.players[0]!.name = message.name;
          send({ type: 'welcome', id: 0, resumeToken: 'a'.repeat(32), serverMs: Date.now(), limits: { maxPlayers: 20, hz: 20 } });
          break;
        case 'listRooms':
          send({ type: 'rooms', rooms: [{ code: room.code, track: room.settings.trackId, laps: room.settings.laps,
            weather: room.settings.weather, tod: room.settings.tod, mode: room.settings.mode,
            humans: 1, capacity: 20, state: 'lobby', owner: room.players[0]!.name }] });
          break;
        case 'create': case 'quickJoin': case 'join': send(room); break;
        case 'setSettings': room.settings = message.settings; send(room); break;
        case 'setCar': Object.assign(room.players[0]!, { teamId: message.teamId, driverIdx: message.driverIdx }); send(room); break;
        case 'setTeam':
          room.teams = message.team ? [{ ownerId: 0, team: message.team }] : [];
          if (message.team) Object.assign(room.players[0]!, { teamId: message.team.baseTeamId, driverIdx: 0 });
          send(room);
          break;
        case 'setReady': room.players[0]!.ready = message.ready; send(room); break;
        case 'start': {
          const me = room.players[0]!;
          room.phase = 'loading'; send(room);
          send({ type: 'load', raceId: 'HRP42-1', config: { ...room.settings, aiCount: 0, seed: 42 }, lightsOutAtMs: 9000,
            roster: [
              { id: 0, kind: 'human', name: me.name, teamId: me.teamId, driverIdx: 0, gridSlot: 0 },
              { id: 1, kind: 'human', name: 'Selin', teamId: me.teamId, driverIdx: 1, gridSlot: 1 },
            ], teams: room.teams?.map(entry => entry.team) });
          break;
        }
        case 'loaded': send({ type: 'start', t0ServerMs: Date.now() + 500 }); break;
      }
    });
  });
  return requests;
}
