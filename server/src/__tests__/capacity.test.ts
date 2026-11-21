import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type NetClientMsg, type NetServerMsg } from '../../../src/contracts/net';
import { NET_LIMITS, parseServerMessage, utf8Length } from '../../../src/net/protocol';
import { DEFAULT_SETTINGS } from '../../bots/bot';
import { Hub } from '../hub';
import type { Peer } from '../player';
import type { Bot } from '../../bots/bot';
import { bot, isType, startServer } from './helpers';

describe('twenty-human room capacity', () => {
  it('joins twenty clients through the real transport from the same public address', async () => {
    const srv = await startServer();
    const clients: Bot[] = [];
    try {
      const owner = await bot(srv, 'Player0'); clients.push(owner);
      owner.send({ type: 'create', settings: DEFAULT_SETTINGS });
      const room = await owner.waitFor(isType('room'));
      if (room.type !== 'room') throw new Error('Missing room');
      for (let i = 1; i < 20; i++) {
        const client = await bot(srv, `Player${i}`); clients.push(client);
        client.send({ type: 'join', code: room.code });
        await client.waitFor((msg) => msg.type === 'room' && msg.players.length === i + 1);
      }
      expect(srv.apex.hub.rooms.get(room.code)?.members).toHaveLength(20);
      expect(srv.apex.metrics.sockets).toBe(20);
    } finally { for (const client of clients) client.close(); await srv.stop(); }
  });
  it('assigns twenty distinct seats, rejects a twenty-first player and sends a valid full load', () => {
    const hub = new Hub(() => {});
    const messages: NetServerMsg[][] = [];
    const peers: Peer[] = Array.from({ length: 21 }, (_, id) => {
      const inbox: NetServerMsg[] = []; messages.push(inbox);
      return { ip: `192.0.2.${id + 1}`, player: null, pingMs: 40, sendJson(msg) { inbox.push(msg); }, sendBinary() {}, bufferedAmount: () => 0, close() {} };
    });
    const send = (peer: Peer, msg: NetClientMsg): void => hub.onText(peer, JSON.stringify(msg));
    try {
      for (const [id, peer] of peers.entries()) {
        hub.onOpen(peer);
        send(peer, { type: 'hello', v: PROTOCOL_VERSION, build: 'test', name: `Player${id}` });
      }
      send(peers[0]!, { type: 'create', settings: { ...DEFAULT_SETTINGS, aiCount: 19 } });
      const room = [...hub.rooms.values()][0]!;
      for (const peer of peers.slice(1, 20)) send(peer, { type: 'join', code: room.code });
      expect(room.members).toHaveLength(20);
      expect(new Set(room.members.map((p) => `${p.teamId}/${p.driverIdx}`)).size).toBe(20);
      send(peers[20]!, { type: 'join', code: room.code });
      expect(messages[20]!.at(-1)).toEqual({ type: 'error', code: 'full' });
      for (const peer of peers.slice(0, 20)) send(peer, { type: 'setReady', ready: true });
      send(peers[0]!, { type: 'start' });
      for (const inbox of messages.slice(0, 20)) {
        const load = inbox.find((msg) => msg.type === 'load');
        expect(load?.type).toBe('load');
        if (load?.type !== 'load') throw new Error('Missing load');
        expect(load.roster).toHaveLength(20);
        expect(load.config.aiCount).toBe(0);
        const json = JSON.stringify(load);
        expect(utf8Length(json)).toBeLessThanOrEqual(NET_LIMITS.maxServerJsonBytes);
        expect(parseServerMessage(json)).not.toBeNull();
      }
    } finally { hub.dispose(); }
  });
});
