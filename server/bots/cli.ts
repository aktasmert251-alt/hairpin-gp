// Replay-bot CLI: N headless bots race on a server (manual T1/T4/T8 runs without browsers).
//   node server/dist/tools/apex-bot.mjs [--url ws://localhost:8787/ws] [--n 2] [--track bosphorus] [--laps 1] [--ai 0]
//        [--hz 20] [--tamper none|teleport|speed|fakeProgress|earlyStart] [--join CODE]
// Without --join the first bot creates the room and starts it when the others are ready. Prints the results JSON.
import { randomBytes } from 'node:crypto';
import type { NetRoomSettings, NetServerMsg } from '../../src/contracts/net';
import { Bot, DEFAULT_SETTINGS, type Tamper } from './bot';

function opt(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? def) : def;
}

async function main(): Promise<void> {
  const url = opt('url', 'ws://localhost:8787/ws');
  const n = Math.max(1, Math.min(20, Number(opt("n", "2"))));
  const join = opt('join', '');
  const settings: NetRoomSettings = {
    ...DEFAULT_SETTINGS, trackId: opt('track', 'bosphorus') as NetRoomSettings['trackId'], laps: Number(opt('laps', '1')) as NetRoomSettings['laps'],
    aiCount: Number(opt('ai', '0')),
  };
  const bots: Bot[] = [];
  for (let i = 0; i < n; i++) {
    const b = new Bot({ url, name: `Bot ${i + 1}`, deviceId: randomBytes(12).toString('base64url'), hz: Number(opt('hz', '20')), tamper: (i === 0 ? 'none' : opt('tamper', 'none')) as Tamper });
    const w = await b.connect();
    if (w.type !== 'welcome') throw new Error(`hello failed: ${JSON.stringify(w)}`);
    bots.push(b);
  }
  let code = join;
  if (!code) {
    bots[0]!.send({ type: 'create', settings });
    code = ((await bots[0]!.waitFor((m) => m.type === 'room')) as Extract<NetServerMsg, { type: 'room' }>).code;
  }
  console.log(`room ${code}`);
  for (const b of join ? bots : bots.slice(1)) {
    b.send({ type: 'join', code });
    await b.waitFor((m) => m.type === 'room');
    b.send({ type: 'setReady', ready: true });
  }
  if (!join) {
    await bots[0]!.waitFor((m) => m.type === 'room' && m.players.length === n && m.players.every((p) => p.ready || p.id === bots[0]!.id));
    bots[0]!.send({ type: 'start' });
  }
  const res = await bots[0]!.waitFor((m) => m.type === 'results', 30 * 60_000);
  console.log(JSON.stringify(res, null, 1));
  console.log(JSON.stringify(bots.map((b) => ({ id: b.id, sent: b.sent, batches: b.batches, aiSeen: b.seenAiIds.size }))));
  for (const b of bots) b.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
