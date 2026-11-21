// Reverse-proxy awareness (TRUST_PROXY): behind a Cloudflare tunnel (cloudflared on this machine) every TCP peer is 127.0.0.1, so
// per-IP limits, network bans and log tags would see one client. With `trust = 'cloudflare'` the client IP comes from
// `CF-Connecting-IP` and the public scheme from `X-Forwarded-Proto` — ONLY when the TCP peer is loopback (cloudflared), never from
// a remote peer (anyone could send those headers). Default 'none': headers are ignored.
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { normalizeIp } from './limits';

export type TrustProxy = 'none' | 'cloudflare';

/** `TRUST_PROXY` env value → mode (anything but 'cloudflare' = none). */
export function trustProxyFrom(v: string | undefined): TrustProxy {
  return v?.trim().toLowerCase() === 'cloudflare' ? 'cloudflare' : 'none';
}

export function isLoopback(addr: string | undefined): boolean {
  const a = normalizeIp(addr);
  return a === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? undefined : v?.trim(); // a repeated header is ambiguous: ignore it
}

/** True when the request came through the trusted local proxy. */
function viaTrustedProxy(req: IncomingMessage, trust: TrustProxy): boolean {
  return trust === 'cloudflare' && isLoopback(req.socket.remoteAddress);
}

/** The client's IP: CF-Connecting-IP (validated) behind the trusted proxy, else the TCP peer. */
export function clientIp(req: IncomingMessage, trust: TrustProxy): string {
  if (viaTrustedProxy(req, trust)) {
    const cf = header(req, 'cf-connecting-ip');
    if (cf && cf.length <= 64 && isIP(cf) !== 0) return normalizeIp(cf.toLowerCase());
  }
  return normalizeIp(req.socket.remoteAddress);
}

/** The page's scheme is https: real TLS here, or the trusted proxy says the public side is https. */
export function isSecure(req: IncomingMessage, tls: boolean, trust: TrustProxy): boolean {
  return tls || (viaTrustedProxy(req, trust) && header(req, 'x-forwarded-proto')?.toLowerCase() === 'https');
}
