import { WebSocket } from 'ws';
import { Bot, DEFAULT_SETTINGS, type BotOptions } from '../../server/bots/bot';
import type { NetCarState, NetContact, NetRoomSettings, NetServerMsg } from '../../src/contracts/net';
import {
  MSG_CONTACT, MSG_CONTACT_RELAY, MSG_STATE, MSG_STATES, NET_FLAG_RESET, decodeBatchHeader, decodeBatchEntry, decodeContact, decodeState, encodeContact, encodeState,
  newNetCarState, newNetContact, viewOf,
} from '../../src/net/protocol';
import { sleep, until } from './runtime';

export { DEFAULT_SETTINGS };
export interface Traffic { messages: number; bytes: number; maxBytes: number }
const traffic = (): Traffic => ({ messages: 0, bytes: 0, maxBytes: 0 });

export class ProbeBot extends Bot {
  readonly tx = traffic();
  readonly rx = traffic();
  readonly contacts: NetContact[] = [];
  readonly receivedStates = new Map<number, NetCarState>();
  /** Reset is a one-frame event; retain it even if another state arrives before a test polls. */
  readonly receivedResets = new Map<number, NetCarState>();
  readonly receivedCounts = new Map<number, number>();
  lastState: NetCarState | null = null;
  transformState?: (s: NetCarState) => void;
  suppressStates = false;
  private disposing = false;
  private readonly abortWaits = new AbortController();
  disconnects = 0;
  readonly errors: string[] = [];
  welcomeMs = 0;
  connectMs = 0;
  private helloAt = Number.NaN;

  override async connect(resume?: string): Promise<NetServerMsg> {
    const start = performance.now();
    const promise = super.connect(resume);
    // Bot creates the socket synchronously before its first await.
    this.ws.on('message', (data: Buffer, binary: boolean) => {
      this.count(this.rx, data.byteLength);
      if (!binary) {
        const msg = JSON.parse(data.toString()) as NetServerMsg;
        if (msg.type === 'welcome') {
          // The stock Bot assigns identity after its awaited welcome. Resume load/start can arrive first in the
          // same socket read; bind now so its onLoad can find the local roster entry and start the driving sim.
          this.id = msg.id; this.token = msg.resumeToken;
          this.connectMs = performance.now() - start;
          this.welcomeMs = performance.now() - this.helloAt;
        }
      }
      if (binary && data[0] === MSG_STATES) {
        const header = { count: 0, serverSeq: 0, serverMs: 0 };
        if (decodeBatchHeader(viewOf(data), header)) {
          for (let i = 0; i < header.count; i++) {
            const state = newNetCarState();
            if (decodeBatchEntry(viewOf(data), i, state)) {
              this.receivedStates.set(state.id, state);
              if ((state.flags & NET_FLAG_RESET) !== 0) this.receivedResets.set(state.id, state);
              this.receivedCounts.set(state.id, (this.receivedCounts.get(state.id) ?? 0) + 1);
            }
          }
        }
      }
      if (binary && data[0] === MSG_CONTACT_RELAY) {
        const c = newNetContact();
        if (decodeContact(viewOf(data), MSG_CONTACT_RELAY, c)) this.contacts.push(c);
      }
    });
    this.ws.on('error', (err) => this.errors.push(String(err)));
    this.ws.on('close', () => { if (!this.disposing) this.disconnects++; });
    const welcome = await promise;
    if (welcome.type !== 'welcome') this.connectMs = performance.now() - start;
    return welcome;
  }

  private count(t: Traffic, bytes: number): void { t.messages++; t.bytes += bytes; t.maxBytes = Math.max(t.maxBytes, bytes); }

  override send(obj: unknown): void {
    if (typeof obj === 'object' && obj !== null && 'type' in obj && obj.type === 'hello') this.helloAt = performance.now();
    if (this.ws?.readyState === WebSocket.OPEN) this.count(this.tx, Buffer.byteLength(JSON.stringify(obj)));
    super.send(obj);
  }

  override sendRaw(data: string | Uint8Array): void {
    if (typeof data !== 'string' && data[0] === MSG_STATE && data.byteLength === 40) {
      if (this.suppressStates) return;
      const s = newNetCarState();
      if (decodeState(viewOf(data), s)) {
        this.transformState?.(s);
        if (this.transformState) encodeState(s, viewOf(data));
        this.lastState = s;
      }
    }
    if (this.ws?.readyState === WebSocket.OPEN) this.count(this.tx, typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength);
    super.sendRaw(data);
  }

  override async waitFor(pred: (m: NetServerMsg) => boolean, timeoutMs = 10_000): Promise<NetServerMsg> {
    return until(() => {
      if (this.abortWaits.signal.aborted) throw new Error(`Disposed bot ${this.opts.name}`);
      const hit = this.msgs.find(pred);
      if (hit) return hit;
      if (this.closeCode !== -1) throw new Error(`Bot ${this.opts.name} closed ${this.closeCode}; errors ${this.errors.join('; ')}`);
      return undefined;
    }, timeoutMs, `bot ${this.opts.name} message; last=${JSON.stringify(this.msgs.at(-1))}`);
  }

  contact(c: NetContact): void {
    const buf = new Uint8Array(28);
    encodeContact(c, MSG_CONTACT, viewOf(buf)); this.sendRaw(buf);
  }

  dispose(): void { this.disposing = true; this.abortWaits.abort(); this.drop(); }
}

export class Fleet {
  readonly bots: ProbeBot[] = [];
  constructor(readonly url: string) {}
  async add(name: string, options: Partial<BotOptions> = {}, resume?: string): Promise<ProbeBot> {
    const b = new ProbeBot({ url: this.url, name, ...options });
    this.bots.push(b); // Register before connection: refused upgrades must also be cleaned up.
    const w = await b.connect(resume);
    if (w.type !== 'welcome') throw new Error(`Admission ${name}: ${JSON.stringify(w)}`);
    return b;
  }
  async group(n: number, prefix: string, options: Partial<BotOptions> = {}): Promise<ProbeBot[]> {
    const bots: ProbeBot[] = [];
    for (let i = 0; i < n; i++) bots.push(await this.add(`${prefix} ${i + 1}`, options));
    return bots;
  }
  async dispose(): Promise<void> {
    for (const b of this.bots) b.dispose();
    await sleep(50);
  }
}

export async function makeLobby(bots: ProbeBot[], settings: Partial<NetRoomSettings> = {}): Promise<string> {
  const owner = bots[0]!;
  const receive = owner.next((m) => m.type === 'room' || m.type === 'error');
  owner.send({ type: 'create', settings: { ...DEFAULT_SETTINGS, ...settings } });
  const room = await receive;
  if (room.type !== 'room') throw new Error(`Create: ${JSON.stringify(room)}`);
  for (const b of bots.slice(1)) {
    const joined = b.next((m) => m.type === 'room' || m.type === 'error');
    b.send({ type: 'join', code: room.code });
    const answer = await joined;
    if (answer.type !== 'room') throw new Error(`Join ${b.opts.name} into ${room.code}: ${JSON.stringify(answer)}`);
    b.send({ type: 'setReady', ready: true });
    await owner.waitFor((m) => m.type === 'room' && m.players.some((p) => p.id === b.id && p.ready));
  }
  return room.code;
}

export async function startLobby(bots: ProbeBot[]): Promise<void> {
  const started = bots.map((b) => b.next((m) => m.type === 'start' || m.type === 'error', 30_000));
  bots[0]!.send({ type: 'start' });
  const replies = await Promise.all(started);
  for (const reply of replies) if (reply.type !== 'start') throw new Error(`Start: ${JSON.stringify(reply)}`);
}

export async function startRace(bots: ProbeBot[], settings: Partial<NetRoomSettings> = {}): Promise<string> {
  const code = await makeLobby(bots, settings); await startLobby(bots); return code;
}
