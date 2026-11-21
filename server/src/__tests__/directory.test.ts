import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type NetClientMsg, type NetServerMsg } from '../../../src/contracts/net';
import { parseServerMessage } from '../../../src/net/protocol';
import { DEFAULT_SETTINGS } from '../../bots/bot';
import { Hub } from '../hub';
import type { Peer } from '../player';

function fixture(maxRooms = 6, maxPlayersPerRoom = 20) {
  const hub = new Hub(() => {}, { maxRooms, maxPlayersPerRoom });
  const send = (p: Peer, m: NetClientMsg) => hub.onText(p, JSON.stringify(m));
  let n = 0;
  const peer = () => {
    const inbox: NetServerMsg[] = [];
    const p: Peer = { ip: `192.0.2.${++n}`, player: null, pingMs: 20,
      sendJson: (m) => inbox.push(m), sendBinary() {}, bufferedAmount: () => 0, close() {} };
    hub.onOpen(p); send(p, { type: 'hello', v: PROTOCOL_VERSION, build: 'test', name: `Player${n}` });
    return { p, inbox, last: () => inbox.at(-1) };
  };
  return { hub, send, peer };
}

describe('D-052 public room directory', () => {
  it('lists public lobby and racing rooms, excludes private, and permits joining private by code', () => {
    const { hub, send, peer } = fixture();
    try {
      const a = peer(), b = peer(), c = peer(), viewer = peer();
      send(a.p, { type: 'create', settings: DEFAULT_SETTINGS });
      send(b.p, { type: 'create', settings: { ...DEFAULT_SETTINGS, visibility: 'private' } });
      send(c.p, { type: 'create', settings: DEFAULT_SETTINGS });
      send(c.p, { type: 'start' });
      send(viewer.p, { type: 'listRooms' });
      const msg = viewer.last();
      expect(msg?.type).toBe('rooms');
      if (msg?.type !== 'rooms') throw new Error('Missing directory');
      expect(msg.rooms).toHaveLength(2);
      expect(msg.rooms.map((r) => r.state)).toEqual(['lobby', 'racing']);
      expect(msg.rooms[0]).toMatchObject({ humans: 1, capacity: 20, owner: 'Player1' });
      expect(parseServerMessage(JSON.stringify(msg))).toEqual(msg);
      send(viewer.p, { type: 'join', code: b.p.player!.room!.code });
      expect(viewer.p.player!.room).toBe(b.p.player!.room);
      send(a.p, { type: 'setSettings', settings: { ...DEFAULT_SETTINGS, visibility: 'private' } });
      send(a.p, { type: 'listRooms' });
      expect(a.last()).toMatchObject({ type: 'rooms', rooms: [{ state: 'racing' }] });
      send(c.p, { type: 'setSettings', settings: { ...DEFAULT_SETTINGS, visibility: 'private' } });
      expect(c.last()).toEqual({ type: 'error', code: 'phase' });
      expect(c.p.player!.room!.settings.visibility).toBe('public');
    } finally { hub.dispose(); }
  });

  it('quick joins the fullest available public lobby, ignoring private, full and racing rooms', () => {
    const { hub, send, peer } = fixture(6, 3);
    try {
      const a = peer(), b = peer(), c = peer(), d = peer(), visitor = peer();
      send(a.p, { type: 'create', settings: DEFAULT_SETTINGS });
      send(b.p, { type: 'create', settings: DEFAULT_SETTINGS });
      send(c.p, { type: 'join', code: b.p.player!.room!.code });
      send(d.p, { type: 'create', settings: { ...DEFAULT_SETTINGS, visibility: 'private' } });
      send(visitor.p, { type: 'quickJoin' });
      expect(visitor.p.player!.room).toBe(b.p.player!.room);
      const next = peer(); send(next.p, { type: 'quickJoin' });
      expect(next.p.player!.room).toBe(a.p.player!.room);
      send(a.p, { type: 'setReady', ready: true });
      send(next.p, { type: 'setReady', ready: true });
      send(a.p, { type: 'start' });
      const last = peer(); send(last.p, { type: 'quickJoin' });
      expect(last.p.player!.room).not.toBe(a.p.player!.room);
      expect(last.p.player!.room!.settings).toMatchObject({ visibility: 'public', difficulty: 70 });
    } finally { hub.dispose(); }
  });

  it('creates public defaults when needed, returns full at cap, and maintenance rejects all directory actions', () => {
    const { hub, send, peer } = fixture(1, 1);
    try {
      const a = peer(), b = peer();
      send(a.p, { type: 'quickJoin' });
      expect(a.p.player!.room!.settings).toMatchObject({ visibility: 'public', laps: 5, difficulty: 70 });
      send(b.p, { type: 'quickJoin' });
      expect(b.last()).toEqual({ type: 'error', code: 'full' });
      hub.admission.maintenance = true;
      for (const msg of [{ type: 'listRooms' }, { type: 'quickJoin' }, { type: 'join', code: a.p.player!.room!.code }, { type: 'create', settings: DEFAULT_SETTINGS }] as NetClientMsg[]) {
        send(b.p, msg); expect(b.last()).toEqual({ type: 'error', code: 'maintenance' });
      }
    } finally { hub.dispose(); }
  });

  it('supports six full human rooms', () => {
    const { hub, send, peer } = fixture();
    try {
      const owners: ReturnType<typeof peer>[] = [];
      for (let room = 0; room < 6; room++) {
        const owner = peer(); owners.push(owner);
        send(owner.p, { type: 'create', settings: { ...DEFAULT_SETTINGS, aiCount: 19 } });
        for (let i = 1; i < 20; i++) {
          const guest = peer(); send(guest.p, { type: 'join', code: owner.p.player!.room!.code });
        }
      }
      expect(hub.players.size).toBe(120);
      for (const member of owners[5]!.p.player!.room!.members) member.ready = true;
      const owner = owners[5]!;
      send(owner.p, { type: 'start' });
      const load = owner.inbox.find((m) => m.type === 'load');
      if (load?.type !== 'load') throw new Error('Missing load');
      expect(new Set(load.roster.map((r) => r.id)).size).toBe(20);
      expect(parseServerMessage(JSON.stringify(load))).not.toBeNull();
    } finally { hub.dispose(); }
  });
  it('skips human ids in the preferred AI range when building a solo grid', () => {
    const { hub, send, peer } = fixture();
    try {
      for (let i = 0; i < 64; i++) peer();
      const owner = peer();
      expect(owner.p.player!.id).toBe(64);
      send(owner.p, { type: 'create', settings: { ...DEFAULT_SETTINGS, aiCount: 19 } });
      send(owner.p, { type: 'start' });
      const load = owner.inbox.find((m) => m.type === 'load');
      if (load?.type !== 'load') throw new Error('Missing load');
      expect(new Set(load.roster.map((r) => r.id)).size).toBe(20);
      expect(load.roster.filter((r) => r.kind === 'ai').every((r) => r.id !== 64)).toBe(true);
    } finally { hub.dispose(); }
  });

});
