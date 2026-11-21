// Sandbox only: no sockets. Mutable snapshots emulate server replies to real UiActions.
import type { NetLobbyModel, NetPlayerInfo, NetRoomSettings } from '../../contracts/net';
import type { UiAction } from '../../contracts/ui';
import { createStore } from '../../core/store';
import { TEAMS } from '../../data/teams';
import { canStartLobby, carAvailable, clampRoomSettings } from '../screens/onlineLogic';

export function createMockNet(freeze: boolean, humanCount = 3) {
  const store = createStore<NetLobbyModel>({ status: 'offline', error: null, myId: null, room: null, t0ServerMs: null, rttMs: 38 });
  store.set({ rooms: [
    { code: 'APX27', track: 'istanbul', laps: 5, weather: 'dry', tod: 'sunset', humans: 8, capacity: 20, state: 'lobby', owner: 'Deniz' },
    { code: 'HRP42', track: 'ardennes', laps: 3, weather: 'light', tod: 'day', humans: 12, capacity: 20, state: 'lobby', owner: 'Çağrı' },
    { code: 'RCE89', track: 'bosphorus', laps: 10, weather: 'variable', tod: 'night', humans: 20, capacity: 20, state: 'racing', owner: 'Ece' },
  ] });
  let elapsed = 0;
  let autoJoined = false;
  const defaults: NetRoomSettings = { trackId: 'istanbul', laps: 5, tod: 'sunset', weather: 'dry', aiCount: 19, difficulty: 70, visibility: 'public' };
  const player = (id: number, name: string, ready: boolean): NetPlayerInfo => ({
    id, name, teamId: TEAMS[id % 10]!.id, driverIdx: id < 10 ? 0 : 1, ready, connected: true, pingMs: [38, 42, 67, 51][id % 4]!,
  });
  const open = (name: string, owner: boolean, code = 'APX27', settings = defaults): void => {
    elapsed = 0; autoJoined = false;
    const myId = owner ? 0 : 1;
    const count = Math.max(owner ? 1 : 2, Math.min(20, Math.floor(humanCount) || 3));
    const names = ['Deniz', 'Çağrı', 'Ece', 'Selin', 'İpek', 'Özgür', 'Gül', 'Arda', 'Yağmur', 'Can', 'Duru', 'Eren', 'Ada', 'Barış', 'Bora', 'Defne', 'Elif', 'Ozan', 'Sarp', 'Zeynep'];
    const players = Array.from({ length: count }, (_, i) => player(i, names[i]!, i === 1));
    players[myId] = player(myId, name, false);
    store.set({ status: 'online', error: null, myId, t0ServerMs: null,
      room: { code, ownerId: 0, phase: 'lobby', settings: clampRoomSettings(settings, players.length), players } });
  };
  const remoteReady = (ready: boolean): void => {
    const m = store.get();
    if (!m.room) return;
    store.set({ room: { ...m.room, players: m.room.players.map((p) => p.id === m.myId ? p : { ...p, ready }) } });
  };
  const handle = (action: UiAction): boolean => {
    const m = store.get();
    const room = m.room;
    switch (action.type) {
      case 'onlineListRooms':
        store.set({ status: 'online', error: null }); return true;
      case 'onlineQuickJoin': {
        const candidate = [...(m.rooms ?? [])].filter((r) => r.state === 'lobby' && r.humans < r.capacity).sort((a, b) => b.humans - a.humans)[0];
        open(action.name, !candidate, candidate?.code ?? 'APX27', { ...defaults, visibility: 'public',
          trackId: candidate?.track ?? 'istanbul', laps: candidate?.laps ?? 5, weather: candidate?.weather ?? 'dry', tod: candidate?.tod ?? 'day', difficulty: 55 });
        return true;
      }
      case 'onlineCreate': open(action.name, true, 'APX27', action.settings); return true;
      case 'onlineJoin': open(action.name, false, action.code); return true;
      case 'onlineLeave': store.set({ status: 'offline', room: null, myId: null, t0ServerMs: null, error: null }); return true;
      case 'onlineReady':
        if (room?.phase === 'lobby') store.set({ room: { ...room, players: room.players.map((p) => p.id === m.myId ? { ...p, ready: action.ready } : p) } });
        return true;
      case 'onlineSetCar':
        if (room?.phase === 'lobby' && carAvailable(room.players, m.myId, action.teamId, action.driverIdx)) {
          store.set({ room: { ...room, players: room.players.map((p) => p.id === m.myId ? { ...p, teamId: action.teamId, driverIdx: action.driverIdx, ready: false } : p) } });
        }
        return true;
      case 'onlineSettings':
        if (room?.phase === 'lobby' && room.ownerId === m.myId) store.set({ room: { ...room, settings: clampRoomSettings(action.settings, room.players.length), players: room.players.map((p) => ({ ...p, ready: false })) } });
        return true;
      case 'onlineStart':
        if (canStartLobby(m)) store.set({ room: { ...room!, phase: 'countdown' }, t0ServerMs: Date.now() + 3000 });
        return true;
      default: return false;
    }
  };
  const countdown = (): void => {
    const room = store.get().room;
    if (room) store.set({ room: { ...room, phase: 'countdown' }, t0ServerMs: Date.now() + 3000 });
  };
  const update = (dt: number): void => {
    const m = store.get();
    if (!m.room) return;
    elapsed += dt;
    if (!freeze && m.room.phase === 'lobby') {
      if (!autoJoined && elapsed > 2 && m.room.players.length < 20) {
        autoJoined = true;
        const players = [...m.room.players, player(m.room.players.length, 'Selin', false)];
        store.set({ room: { ...m.room, settings: clampRoomSettings(m.room.settings, players.length), players } });
      }
      if (elapsed > 4 && m.room.players.some((p) => p.id !== m.myId && !p.ready)) remoteReady(true);
    }
    if (m.room.phase === 'countdown' && m.t0ServerMs !== null && Date.now() > m.t0ServerMs + 500) {
      store.set({ room: { ...m.room, phase: 'racing' }, t0ServerMs: null });
    }
  };
  return { store, open, handle, update, remoteReady, countdown };
}
