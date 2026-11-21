// Test helpers: a real server on an ephemeral port (no dist needed for /ws) and bot factories.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { Bot, DEFAULT_SETTINGS, type BotOptions } from '../../bots/bot';
import type { NetRoomSettings, NetServerMsg } from '../../../src/contracts/net';
import type { GameConfig, NetDelayConfig } from '../config';
import { createApexServer, type ApexServer } from '../server';

export interface TestServer { apex: ApexServer; url: string; logs: { event: string; data: Record<string, unknown> }[]; stop: () => Promise<void> }

export async function startServer(game: Partial<GameConfig> = {}, netDelay?: NetDelayConfig): Promise<TestServer> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-game-'));
  const logs: TestServer['logs'] = [];
  const apex = createApexServer({ distDir: tmp, certDir: path.join(tmp, 'certs'), log: (event, data = {}) => logs.push({ event, data }), game, netDelay });
  await new Promise<void>((r) => apex.server.listen(0, '127.0.0.1', r));
  const port = (apex.server.address() as AddressInfo).port;
  return {
    apex, url: `ws://127.0.0.1:${port}/ws`, logs,
    stop: async () => {
      await apex.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

export async function bot(srv: TestServer, name: string, opts: Partial<BotOptions> = {}): Promise<Bot> {
  const b = new Bot({ url: srv.url, name, ...opts });
  const w = await b.connect();
  if (w.type !== 'welcome') throw new Error(`no welcome: ${JSON.stringify(w)}`);
  return b;
}

export const isType = <T extends NetServerMsg['type']>(t: T) => (m: NetServerMsg): m is Extract<NetServerMsg, { type: T }> => m.type === t;

/** Owner creates a room; the others join; everyone else readies; owner starts. Resolves when all got `load`. */
export async function startRace(bots: Bot[], settings: Partial<NetRoomSettings> = {}): Promise<string> {
  const [owner, ...rest] = bots;
  owner!.send({ type: 'create', settings: { ...DEFAULT_SETTINGS, ...settings } });
  const room = (await owner!.waitFor(isType('room'))) as Extract<NetServerMsg, { type: 'room' }>;
  for (const b of rest) {
    b.send({ type: 'join', code: room.code });
    await b.waitFor((m) => m.type === 'room' && m.players.some((p) => p.id === b.id));
  }
  for (const b of rest) {
    b.send({ type: 'setReady', ready: true });
    await owner!.waitFor((m) => m.type === 'room' && m.players.some((p) => p.id === b.id && p.ready));
  }
  owner!.send({ type: 'start' });
  await Promise.all(bots.map((b) => b.waitFor(isType('load'))));
  return room.code;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
