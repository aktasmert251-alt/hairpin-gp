import { describe, expect, it } from 'vitest';
import { MAX_ROOM_LISTINGS, NET_LIMITS, parseClientMessage, parseServerMessage } from '../protocol';

const settings = { trackId: 'istanbul', laps: 5, tod: 'day', weather: 'dry', aiCount: 19, difficulty: 55 };
const row = { code: 'APX27', track: 'istanbul', laps: 5, weather: 'dry', tod: 'day', humans: 1, capacity: 20, state: 'lobby', owner: 'Çağrı' };
const client = (m: unknown) => parseClientMessage(JSON.stringify(m));
const server = (m: unknown) => parseServerMessage(JSON.stringify(m));
describe('D-052 strict directory messages', () => {
  it('defaults omitted visibility to public and accepts both settings', () => {
    expect(client({ type: 'create', settings })).toMatchObject({ settings: { visibility: 'public' } });
    for (const visibility of ['public', 'private']) expect(client({ type: 'setSettings', settings: { ...settings, visibility } })).not.toBeNull();
    for (const visibility of [null, 1, 'secret', true]) expect(client({ type: 'create', settings: { ...settings, visibility } })).toBeNull();
  });
  it('accepts only empty listRooms/quickJoin requests', () => {
    for (const type of ['listRooms', 'quickJoin']) {
      expect(client({ type })).toEqual({ type });
      expect(client({ type, code: 'APX27' })).toBeNull();
    }
  });
  it('strictly parses capped directory rows and preserves racing state', () => {
    for (const state of ['lobby', 'racing']) expect(server({ type: 'rooms', rooms: [{ ...row, state }] })).toEqual({ type: 'rooms', rooms: [{ ...row, state }] });
    expect(server({ type: 'rooms', rooms: [] })).toEqual({ type: 'rooms', rooms: [] });
    for (const patch of [{ code: 'abcde' }, { track: 'oval' }, { laps: 2 }, { humans: 21 }, { humans: 0 }, { capacity: 21 }, { humans: 1.5 }, { state: 'loading' }, { owner: null }, { owner: 7 }, { owner: ' Deniz ' }, { owner: 'a\u202eb' }, { extra: true }]) {
      expect(server({ type: 'rooms', rooms: [{ ...row, ...patch }] }), JSON.stringify(patch)).toBeNull();
    }
    expect(server({ type: 'rooms', rooms: [row, row] })).toBeNull();
    expect(server({ type: 'rooms', rooms: Array(MAX_ROOM_LISTINGS + 1).fill(row) })).toBeNull();
    expect(server({ type: 'rooms', rooms: [], extra: 1 })).toBeNull();
    expect(parseServerMessage(' '.repeat(NET_LIMITS.maxServerJsonBytes) + JSON.stringify({ type: 'rooms', rooms: [] }))).toBeNull();
  });
});
