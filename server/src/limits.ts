// Per-connection limits (design §7.1). Plain data, time injected by the caller so tests are deterministic.

import { MSG_CONTACT, MSG_PING, MSG_STATE } from '../../src/net/protocol';
import { DEFAULT_GAME_CONFIG } from './config';

/** Per-connection limits (design §7.1): one token bucket per message class. */
export const WS_LIMITS = {
  maxPayloadBytes: 1024,
  /** Defaults for 6 rooms × 20 + headroom (server.ts derives the total from the room config); per IP 24 for LAN parties (D-048). */
  maxSocketsTotal: DEFAULT_GAME_CONFIG.maxRooms * DEFAULT_GAME_CONFIG.maxPlayersPerRoom + 8,
  maxSocketsPerIp: 24,
  /** Binary `state` and `contact` messages per second and burst for one connection. */
  ratePerS: 30,
  burst: 10,
  /** JSON control messages. */
  controlPerS: 5,
  controlBurst: 10,
  /** Binary pings. */
  pingPerS: 4,
  pingBurst: 4,
  /** Dropping more than ratePerS × windowS messages within windowS (= sending > 2× the limit) closes the socket. */
  floodWindowS: 3,
  /** Protocol ping interval; two missed pongs terminate the socket. */
  pingIntervalMs: 15_000,
} as const;

export class TokenBucket {
  private tokens: number;
  private lastMs: number;

  constructor(
    private readonly ratePerS: number,
    private readonly burst: number,
    nowMs: number,
  ) {
    this.tokens = burst;
    this.lastMs = nowMs;
  }

  /** Takes one token; false when the bucket is empty. */
  take(nowMs: number): boolean {
    const dt = Math.max(0, nowMs - this.lastMs) / 1000;
    this.lastMs = nowMs;
    this.tokens = Math.min(this.burst, this.tokens + dt * this.ratePerS);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Counts dropped messages in fixed windows; `drop()` returns true once the connection should be closed. */
export class FloodGuard {
  private windowStartMs: number;
  private drops = 0;

  constructor(
    private readonly maxDropsPerWindow: number,
    private readonly windowMs: number,
    nowMs: number,
  ) {
    this.windowStartMs = nowMs;
  }

  drop(nowMs: number): boolean {
    if (nowMs - this.windowStartMs >= this.windowMs) {
      this.windowStartMs = nowMs;
      this.drops = 0;
    }
    this.drops += 1;
    return this.drops >= this.maxDropsPerWindow;
  }
}

/** Message class (design §7.1): binary state/contact, binary ping, everything else (JSON control, unknown binary). */
interface ClassBucket { tb: TokenBucket; flood: FloodGuard }

function classBucket(rate: number, burst: number, now: number): ClassBucket {
  return { tb: new TokenBucket(rate, burst, now), flood: new FloodGuard(rate * WS_LIMITS.floodWindowS, WS_LIMITS.floodWindowS * 1000, now) };
}

/**
 * Per-connection message admission shared by every transport (ws.ts sockets, D-064 browser-host links): 'ok' = deliver,
 * 'drop' = over the rate (a dropped control message is answered with error 'rate'), 'flood' = > 2× the limit → close 1008.
 */
export class PeerLimits {
  private readonly state: ClassBucket;
  private readonly control: ClassBucket;
  private readonly ping: ClassBucket;

  constructor(now: number) {
    this.state = classBucket(WS_LIMITS.ratePerS, WS_LIMITS.burst, now);
    this.control = classBucket(WS_LIMITS.controlPerS, WS_LIMITS.controlBurst, now);
    this.ping = classBucket(WS_LIMITS.pingPerS, WS_LIMITS.pingBurst, now);
  }

  /** `firstByte` = the binary message type (ignored for text). */
  admit(isBinary: boolean, firstByte: number, now: number): 'ok' | 'drop' | 'dropControl' | 'flood' {
    const b = !isBinary ? this.control : firstByte === MSG_PING ? this.ping : firstByte === MSG_STATE || firstByte === MSG_CONTACT ? this.state : this.control;
    if (b.tb.take(now)) return 'ok';
    if (b.flood.drop(now)) return 'flood';
    return b === this.control ? 'dropControl' : 'drop';
  }
}

/** Open sockets per remote address. */
export class IpCounter {
  private readonly counts = new Map<string, number>();
  total = 0;

  count(ip: string): number {
    return this.counts.get(ip) ?? 0;
  }

  add(ip: string): void {
    this.counts.set(ip, this.count(ip) + 1);
    this.total += 1;
  }

  remove(ip: string): void {
    const n = this.count(ip) - 1;
    if (n <= 0) this.counts.delete(ip);
    else this.counts.set(ip, n);
    this.total -= 1;
  }
}

/** `::ffff:1.2.3.4` and `1.2.3.4` are the same client. */
export function normalizeIp(addr: string | undefined): string {
  if (!addr) return 'unknown';
  return addr.startsWith('::ffff:') ? addr.slice(7) : addr;
}
