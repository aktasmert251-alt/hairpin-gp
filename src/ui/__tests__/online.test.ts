import { describe, expect, it } from 'vitest';
import type { NetLobbyModel, NetPlayerInfo, NetRoomSettings } from '../../contracts/net';
import { canStartLobby, carAvailable, clampRoomSettings, codeInput, countdownNumber, onlineIdentity, validServer } from '../screens/onlineLogic';

const settings: NetRoomSettings = { trackId: 'istanbul', laps: 5, weather: 'dry', tod: 'day', aiCount: 19, difficulty: 70 };
const player = (id: number): NetPlayerInfo => ({ id, name: 'Deniz', teamId: 'anka', driverIdx: id === 0 ? 0 : 1, ready: true, connected: true, pingMs: 40 });
const model = (): NetLobbyModel => ({ status: 'online', error: null, myId: 0, rttMs: 40, t0ServerMs: null,
  room: { code: 'APX27', ownerId: 0, phase: 'lobby', settings, players: [player(0), player(1)] } });

describe('online UI rules', () => {
  it('normalizes Turkish names and validates code alphabet without silently removing invalid characters', () => {
    expect(onlineIdentity('  Çağrı Işık  ', ' apx27 ')).toEqual({ name: 'Çağrı Işık', code: 'APX27' });
    expect(onlineIdentity('Gu\u0308l')).toEqual({ name: 'Gül' });
    for (const name of ['A', 'a'.repeat(17), '<b>', 'Deniz\u202e']) expect(onlineIdentity(name)).toBeNull();
    for (const code of ['ABCD', 'ABCDE2', 'AIO01', 'ABC!2']) expect(onlineIdentity('Deniz', code)).toBeNull();
    expect(codeInput('ab!23')).toBe('AB!23');
  });
  it('accepts same-origin and websocket addresses and rejects insecure mixed content', () => {
    expect(validServer('', true)).toBe(true);
    expect(validServer('wss://localhost/ws', true)).toBe(true);
    expect(validServer('ws://localhost/ws', false)).toBe(true);
    for (const url of ['ws://localhost/ws', 'https://localhost/ws', 'wss://user:pass@localhost/ws', 'bad address']) expect(validServer(url, true)).toBe(false);
  });
  it('clamps grid capacity and difficulty including invalid numeric input', () => {
    expect(clampRoomSettings(settings, 4).aiCount).toBe(16);
    expect(clampRoomSettings({ ...settings, aiCount: 50, difficulty: 111 }, 1)).toMatchObject({ aiCount: 19, difficulty: 110 });
    expect(clampRoomSettings({ ...settings, aiCount: -1, difficulty: -9 }, 4)).toMatchObject({ aiCount: 0, difficulty: 0 });
    expect(clampRoomSettings({ ...settings, aiCount: NaN, difficulty: Infinity }, 4)).toMatchObject({ aiCount: 0, difficulty: 0 });
  });
  it('reserves occupied cars while allowing the local player’s own car', () => {
    expect(carAvailable([player(0), player(1)], 0, 'anka', 0)).toBe(true);
    expect(carAvailable([player(0), player(1)], 0, 'anka', 1)).toBe(false);
  });
  it('keeps opponents off across joins and leaves, and clamps a filled grid to the human count', () => {
    for (const humans of [1, 3, 20, 2]) {
      expect(clampRoomSettings({ ...settings, aiCount: 0 }, humans).aiCount).toBe(0);
      expect(clampRoomSettings(settings, humans).aiCount).toBe(20 - humans);
    }
    expect(clampRoomSettings({ ...settings, aiCount: 5 }, 3).aiCount).toBe(5);
  });
  it('starts for a connected owner alone or with up to twenty humans', () => {
    expect(canStartLobby(model())).toBe(true);
    expect(canStartLobby({ ...model(), room: { ...model().room!, players: [player(0)] } })).toBe(true);
    expect(canStartLobby({ ...model(), room: { ...model().room!, players: Array.from({ length: 20 }, (_, id) => player(id)) } })).toBe(true);
    expect(canStartLobby({ ...model(), room: { ...model().room!, players: [player(0), { ...player(1), connected: false, ready: false }] } })).toBe(false);
    expect(canStartLobby({ ...model(), room: { ...model().room!, players: [{ ...player(0), ready: false }] } })).toBe(true);
    for (const status of ['offline', 'connecting', 'reconnecting', 'error'] as const) expect(canStartLobby({ ...model(), status })).toBe(false);
    expect(canStartLobby({ ...model(), myId: 1 })).toBe(false);
    expect(canStartLobby({ ...model(), room: null })).toBe(false);
    for (const patch of [{ phase: 'countdown' as const }, { players: [] }, { players: [player(1)] }, { players: [{ ...player(0), connected: false }] }, { players: [player(0), { ...player(1), ready: false }] }]) {
      expect(canStartLobby({ ...model(), room: { ...model().room!, ...patch } })).toBe(false);
    }
  });
  it('uses ceiling seconds for 3–2–1 and reaches zero without going negative', () => {
    expect([0, 999, 1000, 2000, 3000, 4000].map((now) => countdownNumber(3000, now))).toEqual([3, 3, 2, 1, 0, 0]);
  });
});
