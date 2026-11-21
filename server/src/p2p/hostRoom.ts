// D-064 host-in-browser room: the SAME game hub and room as the Node server (HubCore, Room, server AI, validation, timing),
// fed by transport links instead of ws sockets. Runs in the host's Web Worker (src/net/p2p/hostWorker.ts) and in Node tests.
// Per link it applies the transport limits of ws.ts: payload size (WS_LIMITS.maxPayloadBytes → 1009), per-class rate limits
// with flood close (PeerLimits), server JSON size cap. Runtime-neutral: no Node or DOM API.
import type { NetServerMsg } from '../../../src/contracts/net';
import { NET_LIMITS, utf8Length } from '../../../src/net/protocol';
import type { Transport } from '../../../src/net/p2p/transport';
import type { GameConfig } from '../config';
import { HubCore, serverNow } from '../hubCore';
import { PeerLimits, WS_LIMITS } from '../limits';
import type { Peer, Player } from '../player';
import type { Log } from '../room';

/** One host room per browser tab: a single room, up to the server's player cap (config.ts maxPlayersPerRoom = 20). */
export const HOST_GAME_CONFIG: Partial<GameConfig> = { maxRooms: 1 };

class LinkPeer implements Peer {
  player: Player | null = null;
  pingMs = 0;
  closed = false;
  /** Send-buffer bytes of the far transport (a guest's data channel), reported by the host page. */
  remoteBuffered = 0;
  private readonly limits: PeerLimits;

  constructor(
    private readonly t: Transport,
    /** Link label ('host', 'guest-3'): stands in for the address in the hub's per-address limits; never an IP. */
    readonly ip: string,
    private readonly hub: HubCore,
    private readonly log: Log,
    now: number,
    onGone: (p: LinkPeer) => void,
  ) {
    this.limits = new PeerLimits(now);
    t.onmessage = (ev) => this.receive(ev.data);
    t.onclose = () => {
      this.closed = true;
      onGone(this);
      this.hub.onClose(this);
    };
  }

  private receive(data: unknown): void {
    if (this.closed) return;
    const isText = typeof data === 'string';
    const bin = data instanceof ArrayBuffer ? new Uint8Array(data) : null;
    if (!isText && !bin) return;
    const size = isText ? utf8Length(data) : bin!.byteLength;
    if (size > WS_LIMITS.maxPayloadBytes) {
      this.close(1009, 'too big');
      return;
    }
    const verdict = this.limits.admit(!isText, bin ? (bin[0] ?? -1) : -1, this.hub.now());
    if (verdict === 'flood') {
      this.log('wsFlood', { net: this.ip });
      this.close(1008, 'rate');
      return;
    }
    if (verdict !== 'ok') {
      if (verdict === 'dropControl' && this.player) this.sendJson({ type: 'error', code: 'rate' });
      return;
    }
    try {
      if (isText) this.hub.onText(this, data);
      else this.hub.onBinary(this, bin!);
    } catch (err) {
      this.log('messageError', { net: this.ip, error: err instanceof Error ? err.name : 'Error' });
      this.close(1011, 'error');
    }
  }

  sendJson(msg: NetServerMsg): void {
    const text = JSON.stringify(msg);
    if (utf8Length(text) > NET_LIMITS.maxServerJsonBytes) {
      this.log('serverJsonTooBig', { type: msg.type });
      return;
    }
    if (!this.closed) this.t.send(text);
  }

  sendBinary(buf: Uint8Array): void {
    if (!this.closed) this.t.send(buf);
  }

  bufferedAmount(): number {
    return Math.max(this.t.bufferedAmount(), this.remoteBuffered);
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.t.close(code, reason);
  }
}

export interface HostRoomOptions {
  cfg?: Partial<GameConfig>;
  log?: Log;
  now?: () => number;
}

export class HostRoom {
  readonly hub: HubCore;
  private readonly links = new Map<string, LinkPeer>();
  private readonly log: Log;
  private ended = false;

  constructor(opts: HostRoomOptions = {}) {
    this.log = opts.log ?? (() => {});
    this.hub = new HubCore(this.log, { ...HOST_GAME_CONFIG, ...opts.cfg }, opts.now ?? serverNow);
  }

  /** A new client link (the host's own client or a guest). A label in use replaces the old link (a guest reconnecting). */
  attach(t: Transport, label: string): void {
    if (this.ended) {
      t.close(1001, 'ended');
      return;
    }
    this.links.get(label)?.close(4000, 'replaced');
    const open = (): void => {
      const peer = new LinkPeer(t, label, this.hub, this.log, this.hub.now(), (p) => {
        if (this.links.get(label) === p) this.links.delete(label);
      });
      this.links.set(label, peer);
      this.hub.onOpen(peer);
    };
    if (t.readyState === 1) open();
    else t.onopen = open;
  }

  /** Link quality measured by the host page (RTCPeerConnection stats): RTT for the lobby ping, data-channel send buffer. */
  linkStats(label: string, pingMs: number, buffered: number): void {
    const p = this.links.get(label);
    if (!p) return;
    p.pingMs = Number.isFinite(pingMs) ? pingMs : 0;
    p.remoteBuffered = Number.isFinite(buffered) ? buffered : 0;
  }

  /** Ends the room for good: every link closes (1001 going away) and the room tick stops. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const p of [...this.links.values()]) p.close(1001, 'host left');
    this.links.clear();
    this.hub.dispose();
  }

  linkCount(): number {
    return this.links.size;
  }
}
