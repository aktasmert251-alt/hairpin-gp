// WebSocket endpoint /ws: transport limits of design §7.1 (payload size, per-class message rates with flood close,
// sockets per IP and in total, same-origin check, protocol ping with two missed pongs → terminate) and the optional
// artificial latency (--net-delay). Game messages go to the Hub as Peer callbacks.
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { NetServerMsg } from '../../src/contracts/net';
import { NET_LIMITS, utf8Length } from '../../src/net/protocol';
import { NO_NET_DELAY, type NetDelayConfig } from './config';
import type { Hub } from './hub';
import { IpCounter, PeerLimits, WS_LIMITS } from './limits';
import { clientIp, isSecure, type TrustProxy } from './proxy';
import type { Metrics } from './metrics';
import type { Peer, Player } from './player';
import { logTag } from './privacy';

export const WS_PATH = '/ws';

/**
 * Browsers always send Origin on a WebSocket handshake; it must match the Host the page was served from.
 * Non-browser clients (bots, Node) send none and are allowed. Over plain HTTP (local dev) any localhost
 * origin is allowed too, so a Vite dev page on another port can reach the dev server.
 */
export function originAllowed(origin: string | undefined, host: string | undefined, tls: boolean): boolean {
  if (origin === undefined) return true;
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if (host !== undefined && o.host === host && o.protocol === (tls ? 'https:' : 'http:')) return true;
  return !tls && o.protocol === 'http:' && (o.hostname === 'localhost' || o.hostname === '127.0.0.1' || o.hostname === '[::1]');
}

function reject(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/** Ordered delivery after delay + jitter (TCP keeps order), per direction and socket. */
class DelayLine {
  private lastAt = 0;
  constructor(private readonly cfg: NetDelayConfig) {}
  run(fn: () => void): void {
    const now = performance.now();
    const at = Math.max(this.lastAt, now + this.cfg.delayMs + Math.random() * this.cfg.jitterMs);
    this.lastAt = at;
    setTimeout(fn, at - now);
  }
}

class WsPeer implements Peer {
  player: Player | null = null;
  pingMs = 0;
  missedPongs = 0;
  pingSentAt = 0;
  closed = false;
  readonly limits: PeerLimits;
  readonly outLine: DelayLine | null;
  readonly inLine: DelayLine | null;

  constructor(
    readonly ws: WebSocket,
    readonly ip: string,
    private readonly metrics: Metrics,
    private readonly net: NetDelayConfig,
    private readonly log: (event: string, data?: Record<string, unknown>) => void,
  ) {
    this.limits = new PeerLimits(performance.now());
    const delayed = net.delayMs > 0 || net.jitterMs > 0;
    this.outLine = delayed ? new DelayLine(net) : null;
    this.inLine = delayed ? new DelayLine(net) : null;
  }

  sendJson(msg: NetServerMsg): void {
    const text = JSON.stringify(msg);
    const bytes = utf8Length(text);
    if (bytes > this.metrics.maxJsonBytes) {
      this.metrics.maxJsonBytes = bytes;
      this.metrics.maxJsonType = msg.type;
    }
    if (bytes > NET_LIMITS.maxServerJsonBytes) {
      this.log('serverJsonTooBig', { type: msg.type, bytes });
      return;
    }
    this.raw(text, false);
  }

  sendBinary(buf: Uint8Array, lossy: boolean): void {
    if (lossy && this.net.lossPct > 0 && Math.random() * 100 < this.net.lossPct) return;
    this.raw(buf, true);
  }

  private raw(data: string | Uint8Array, binary: boolean): void {
    const send = (): void => {
      if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(data, { binary });
      this.metrics.msgOut += 1;
      this.metrics.bytesOut += typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    };
    if (this.outLine) this.outLine.run(send);
    else send();
  }

  bufferedAmount(): number {
    return this.ws.bufferedAmount;
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.ws.close(code, reason);
    // A peer that ignores the close handshake is cut after a moment.
    setTimeout(() => this.ws.terminate(), 2000).unref();
  }

  /** Rate class of an incoming message; false = dropped (and maybe closed for flooding). */
  admit(data: RawData, isBinary: boolean, now: number): boolean {
    const verdict = this.limits.admit(isBinary, isBinary ? ((data as Buffer)[0] ?? -1) : -1, now);
    if (verdict === 'ok') return true;
    if (verdict === 'flood') {
      this.log('wsFlood', { net: logTag(this.ip) });
      this.close(1008, 'rate');
    } else if (verdict === 'dropControl' && this.player) this.sendJson({ type: 'error', code: 'rate' });
    return false;
  }
}

export function attachWs(
  server: Server, metrics: Metrics, tls: boolean, log: (event: string, data?: Record<string, unknown>) => void, hub: Hub,
  net: NetDelayConfig = NO_NET_DELAY, sockets: { total: number; perIp: number } = { total: WS_LIMITS.maxSocketsTotal, perIp: WS_LIMITS.maxSocketsPerIp },
  trust: TrustProxy = 'none',
): () => void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_LIMITS.maxPayloadBytes, perMessageDeflate: false });
  const ips = new IpCounter();
  const peers = new Set<WsPeer>();

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => socket.destroy());
    // TRUST_PROXY: behind the local tunnel the client IP / public scheme come from the proxy headers (proxy.ts).
    const ip = clientIp(req, trust);
    if ((req.url ?? '').split('?')[0] !== WS_PATH) return reject(socket, 404, 'Not Found');
    if (!originAllowed(req.headers.origin, req.headers.host, isSecure(req, tls, trust))) return reject(socket, 403, 'Forbidden');
    if (ips.total >= sockets.total) return reject(socket, 503, 'Service Unavailable');
    if (ips.count(ip) >= sockets.perIp) return reject(socket, 429, 'Too Many Requests');
    // Count before the async handshake completes so parallel upgrades cannot overshoot the limits.
    ips.add(ip);
    let counted = true;
    const release = (): void => {
      if (counted) {
        counted = false;
        ips.remove(ip);
        metrics.sockets = ips.total;
      }
    };
    socket.once('close', release);
    wss.handleUpgrade(req, socket, head, (ws) => {
      metrics.sockets = ips.total;
      const peer = new WsPeer(ws, ip, metrics, net, log);
      peers.add(peer);
      hub.onOpen(peer);
      ws.on('pong', () => {
        peer.missedPongs = 0;
        peer.pingMs = performance.now() - peer.pingSentAt;
      });
      ws.on('message', (data: RawData, isBinary: boolean) => {
        metrics.msgIn += 1;
        if (peer.closed || !peer.admit(data, isBinary, performance.now())) return;
        const deliver = (): void => {
          if (peer.closed) return;
          try {
            if (isBinary) hub.onBinary(peer, data as Buffer);
            else hub.onText(peer, (data as Buffer).toString('utf8'));
          } catch (err) {
            log('messageError', { net: logTag(ip), error: err instanceof Error ? err.name : 'Error' });
            peer.close(1011, 'error');
          }
        };
        if (peer.inLine) peer.inLine.run(deliver);
        else deliver();
      });
      ws.on('error', () => ws.terminate());
      ws.on('close', () => {
        peer.closed = true;
        peers.delete(peer);
        release();
        hub.onClose(peer);
      });
    });
  });

  const heartbeat = setInterval(() => {
    for (const peer of peers) {
      if (peer.missedPongs >= 2) {
        peer.ws.terminate();
        continue;
      }
      peer.missedPongs += 1;
      peer.pingSentAt = performance.now();
      peer.ws.ping();
    }
  }, WS_LIMITS.pingIntervalMs);
  heartbeat.unref();

  return () => {
    clearInterval(heartbeat);
    for (const peer of peers) peer.ws.close(1001, 'shutdown');
    wss.close();
  };
}
