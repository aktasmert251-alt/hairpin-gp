// HAIRPIN GP optional signaling mailbox (D-064): a tiny Cloudflare Worker + Workers KV namespace (free plan, no Durable Objects).
// It only stores the same invite / answer codes players would otherwise copy-paste, for a few minutes, so a guest can type a
// 6-character room code instead. It never sees game traffic, keeps no logs of its own and stores no IP addresses.
//
//   PUT    /m/<KEY>   body = code (text, <= 16 KB), header x-hp-owner  -> 204   stored with a short TTL
//   GET    /m/<KEY>                                                    -> 200 code | 404
//   DELETE /m/<KEY>   header x-hp-owner                                -> 204
//   KEY = <6 chars A-Z 2-9>-o  (host's open invite, HP1I.)  |  <6 chars>-a<slot>  (a guest's answer, HP1A.)
//
// Ownership: the first PUT of a key binds it to the writer's x-hp-owner token (a random per-page secret; only its SHA-256 is
// stored). Later PUT / DELETE need the same token, so nobody who learns a room code can replace the host's invite or a
// guest's answer. Rate limits use the client IP as an in-memory key only (per Worker isolate, never stored or logged).

/** The Workers KV methods used (structural, so this file needs no Cloudflare type package). */
export interface MailboxKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
  MAILBOX: MailboxKV;
  /** Allowed page origins for CORS, comma-separated (e.g. https://<user>.github.io); empty / unset = any origin. */
  ALLOWED_ORIGIN?: string;
}

export const KEY_RE = /^[A-HJ-NP-Z2-9]{6}-(o|a\d{1,2})$/;
export const MAX_BODY = 16 * 1024;
/** Workers KV minimum TTL is 60 s; 5 minutes covers a slow copy / answer round trip. */
export const TTL_S = 300;
export const OWNER_HEADER = 'x-hp-owner';
const OWNER_RE = /^[A-Za-z0-9_-]{16,64}$/;
/** Only codes of the game's own format are stored: invites under `-o`, answers under `-a<slot>`. */
const INVITE_RE = /^HP1I\.[A-Za-z0-9_-]+$/;
const ANSWER_RE = /^HP1A\.[A-Za-z0-9_-]+$/;

/** Per client IP and Worker isolate (memory only): writes, and lookups of invite keys that do not exist (code guessing). */
export const LIMITS = { write: { n: 30, ms: 600_000 }, miss: { n: 30, ms: 600_000 } } as const;

export class RateLimiter {
  private readonly m = new Map<string, { n: number; until: number }>();
  /** Counts one hit; false once the window's limit is passed. */
  hit(key: string, limit: { n: number; ms: number }, now = Date.now()): boolean {
    if (this.m.size > 10_000) this.m.clear();
    const e = this.m.get(key);
    if (!e || e.until <= now) {
      this.m.set(key, { n: 1, until: now + limit.ms });
      return true;
    }
    return ++e.n <= limit.n;
  }
  /** True while the key is still under its limit (does not count). */
  ok(key: string, limit: { n: number; ms: number }, now = Date.now()): boolean {
    const e = this.m.get(key);
    return !e || e.until <= now || e.n < limit.n;
  }
}

const defaultLimiter = new RateLimiter();

interface Stored { h: string; c: string }

async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let s = '';
  for (const b of d) s += b.toString(16).padStart(2, '0');
  return s;
}

/** Constant-time string comparison (both sides are 64-char hex digests). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parse(raw: string | null): Stored | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as Partial<Stored>;
    if (typeof v.h === 'string' && typeof v.c === 'string') return { h: v.h, c: v.c };
  } catch {
    /* not ours */
  }
  return null;
}

function cors(allowed: string[], origin: string | null): Record<string, string> {
  return {
    'access-control-allow-origin': allowed.length === 0 ? '*' : origin && allowed.includes(origin) ? origin : allowed[0]!,
    'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': `content-type, ${OWNER_HEADER}`,
    'access-control-max-age': '600',
    'cache-control': 'no-store',
    vary: 'origin',
  };
}

export async function handle(req: Request, env: Env, limiter: RateLimiter = defaultLimiter): Promise<Response> {
  const allowed = (env.ALLOWED_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get('origin');
  const headers = cors(allowed, origin);
  // A browser page from another site is refused outright (non-browser clients are covered by the rate limits).
  if (allowed.length > 0 && origin !== null && !allowed.includes(origin)) return new Response('forbidden', { status: 403, headers });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const url = new URL(req.url);
  const m = /^\/m\/([^/]+)$/.exec(url.pathname);
  if (!m || !KEY_RE.test(m[1]!)) return new Response('not found', { status: 404, headers });
  const key = m[1]!;
  const ip = req.headers.get('cf-connecting-ip') ?? '';
  const isInvite = key.endsWith('-o');

  if (req.method === 'GET') {
    if (isInvite && !limiter.ok(`miss|${ip}`, LIMITS.miss)) return new Response('slow down', { status: 429, headers });
    const v = parse(await env.MAILBOX.get(key));
    if (!v) {
      if (isInvite) limiter.hit(`miss|${ip}`, LIMITS.miss);
      return new Response('not found', { status: 404, headers });
    }
    return new Response(v.c, { status: 200, headers: { ...headers, 'content-type': 'text/plain' } });
  }
  if (req.method !== 'PUT' && req.method !== 'DELETE') return new Response('method not allowed', { status: 405, headers });

  const owner = req.headers.get(OWNER_HEADER) ?? '';
  if (!OWNER_RE.test(owner)) return new Response('owner token required', { status: 401, headers });
  if (!limiter.hit(`write|${ip}`, LIMITS.write)) return new Response('slow down', { status: 429, headers });
  const h = await sha256Hex(owner);

  if (req.method === 'PUT') {
    const len = Number(req.headers.get('content-length') ?? '0');
    if (len > MAX_BODY) return new Response('too large', { status: 413, headers });
    const body = (await req.text()).trim();
    if (body.length > MAX_BODY) return new Response('too large', { status: 413, headers });
    if (!(isInvite ? INVITE_RE : ANSWER_RE).test(body)) return new Response('bad code', { status: 400, headers });
    const prev = parse(await env.MAILBOX.get(key));
    if (prev && !safeEqual(prev.h, h)) return new Response('taken', { status: 409, headers });
    await env.MAILBOX.put(key, JSON.stringify({ h, c: body } satisfies Stored), { expirationTtl: TTL_S });
    return new Response(null, { status: 204, headers });
  }
  const prev = parse(await env.MAILBOX.get(key));
  if (prev && !safeEqual(prev.h, h)) return new Response('taken', { status: 409, headers });
  if (prev) await env.MAILBOX.delete(key);
  return new Response(null, { status: 204, headers });
}

export default { fetch: (req: Request, env: Env): Promise<Response> => handle(req, env) };
