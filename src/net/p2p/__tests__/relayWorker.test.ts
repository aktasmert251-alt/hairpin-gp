// The optional signaling mailbox (p2p-signal/src/worker.ts) with an in-memory KV, driven by the game's relay client.
import { describe, expect, it } from 'vitest';
import { LIMITS, OWNER_HEADER, RateLimiter, handle, safeEqual, type Env, type MailboxKV } from '../../../../p2p-signal/src/worker';
import { answerKey, offerKey, relayGet, relayPut } from '../relay';

function env(origin = ''): Env & { ttl: number[]; box: Map<string, string> } {
  const box = new Map<string, string>();
  const ttl: number[] = [];
  const kv: MailboxKV = {
    get: async (k) => box.get(k) ?? null,
    put: async (k, v, o) => { box.set(k, v); ttl.push(o?.expirationTtl ?? 0); },
    delete: async (k) => { box.delete(k); },
  };
  return { MAILBOX: kv, ALLOWED_ORIGIN: origin, ttl, box };
}

const BASE = 'https://signal.test';
const OWNER_A = 'ownerAAAAAAAAAAAAAAAAAAA';
const OWNER_B = 'ownerBBBBBBBBBBBBBBBBBBB';

function client(e: Env, limiter = new RateLimiter()) {
  const f = ((input: string, init?: RequestInit) => handle(new Request(input, init), e, limiter)) as typeof fetch;
  const req = (path: string, init: RequestInit & { owner?: string; ip?: string } = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (init.owner) headers.set(OWNER_HEADER, init.owner);
    headers.set('cf-connecting-ip', init.ip ?? '198.51.100.1');
    return handle(new Request(BASE + path, { ...init, headers }), e, limiter);
  };
  return { f, req };
}

describe('p2p-signal worker', () => {
  it('stores an invite and an answer with a short TTL; the game relay client reads them back', async () => {
    const e = env();
    const { f } = client(e);
    expect(await relayPut(BASE, offerKey('K7M2PQ'), 'HP1I.abc_DEF-123', f)).toBe(true);
    expect(await relayGet(BASE, offerKey('K7M2PQ'), f)).toBe('HP1I.abc_DEF-123');
    expect(await relayPut(BASE, answerKey('K7M2PQ', 2), 'HP1A.xyz', f)).toBe(true);
    expect(await relayGet(BASE, answerKey('K7M2PQ', 2), f)).toBe('HP1A.xyz');
    expect(await relayGet(BASE, answerKey('K7M2PQ', 3), f)).toBeNull();
    // The same page may replace its own invite (next guest slot).
    expect(await relayPut(BASE, offerKey('K7M2PQ'), 'HP1I.next', f)).toBe(true);
    expect(await relayGet(BASE, offerKey('K7M2PQ'), f)).toBe('HP1I.next');
    expect(e.ttl).toEqual([300, 300, 300]);
  });

  it('binds a key to its first writer: others cannot replace or delete it; only a hash of the token is stored', async () => {
    const e = env();
    const { req } = client(e);
    expect((await req('/m/K7M2PQ-o', { method: 'PUT', body: 'HP1I.real', owner: OWNER_A })).status).toBe(204);
    expect((await req('/m/K7M2PQ-o', { method: 'PUT', body: 'HP1I.evil', owner: OWNER_B })).status).toBe(409);
    expect((await req('/m/K7M2PQ-o', { method: 'DELETE', owner: OWNER_B })).status).toBe(409);
    expect((await req('/m/K7M2PQ-o', { method: 'PUT', body: 'HP1I.evil' })).status).toBe(401);
    expect((await req('/m/K7M2PQ-o', { method: 'DELETE' })).status).toBe(401);
    expect(await (await req('/m/K7M2PQ-o')).text()).toBe('HP1I.real');
    expect([...e.box.values()].join()).not.toContain(OWNER_A);
    expect((await req('/m/K7M2PQ-o', { method: 'DELETE', owner: OWNER_A })).status).toBe(204);
    expect((await req('/m/K7M2PQ-o')).status).toBe(404);
  });

  it('rejects bad keys, wrong code kinds, oversized bodies and other methods', async () => {
    const { req } = client(env());
    expect((await req('/m/k7m2pq-o')).status).toBe(404);
    expect((await req('/m/IOIOIO-o')).status).toBe(404);
    expect((await req('/other')).status).toBe(404);
    expect((await req('/m/K7M2PQ-o', { method: 'PUT', body: 'hello', owner: OWNER_A })).status).toBe(400);
    expect((await req('/m/K7M2PQ-o', { method: 'PUT', body: 'HP1A.answer', owner: OWNER_A })).status).toBe(400);
    expect((await req('/m/K7M2PQ-a2', { method: 'PUT', body: 'HP1I.invite', owner: OWNER_A })).status).toBe(400);
    expect((await req('/m/K7M2PQ-o', { method: 'PUT', body: `HP1I.${'A'.repeat(17_000)}`, owner: OWNER_A })).status).toBe(413);
    expect((await req('/m/K7M2PQ-o', { method: 'POST', body: 'HP1I.a' })).status).toBe(405);
  });

  it('rate-limits writes and invite-code guessing per IP', async () => {
    const { req } = client(env());
    for (let i = 0; i < LIMITS.write.n; i++) expect((await req('/m/K7M2PQ-o', { method: 'PUT', body: 'HP1I.a', owner: OWNER_A })).status).toBe(204);
    expect((await req('/m/K7M2PQ-o', { method: 'PUT', body: 'HP1I.a', owner: OWNER_A })).status).toBe(429);
    expect((await req('/m/K7M2PQ-o', { method: 'PUT', body: 'HP1I.a', owner: OWNER_A, ip: '203.0.113.2' })).status).toBe(204);
    for (let i = 0; i < LIMITS.miss.n; i++) expect((await req('/m/ZZZZZZ-o', { ip: '192.0.2.9' })).status).toBe(404);
    expect((await req('/m/K7M2PQ-o', { ip: '192.0.2.9' })).status).toBe(429);
    // Answer polling by the host never counts as guessing.
    for (let i = 0; i < LIMITS.miss.n + 5; i++) expect((await req('/m/K7M2PQ-a2', { ip: '192.0.2.10' })).status).toBe(404);
  });

  it('CORS: preflight allows the owner header; ALLOWED_ORIGIN (comma list) refuses other sites', async () => {
    const open = await handle(new Request(`${BASE}/m/K7M2PQ-o`, { method: 'OPTIONS' }), env(), new RateLimiter());
    expect(open.status).toBe(204);
    expect(open.headers.get('access-control-allow-origin')).toBe('*');
    expect(open.headers.get('access-control-allow-headers')).toContain(OWNER_HEADER);
    const e = env('https://game.test, http://localhost:5173');
    const evil = await handle(new Request(`${BASE}/m/K7M2PQ-o`, { headers: { origin: 'https://evil.test' } }), e, new RateLimiter());
    expect(evil.status).toBe(403);
    const dev = await handle(new Request(`${BASE}/m/K7M2PQ-o`, { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } }), e, new RateLimiter());
    expect(dev.status).toBe(204);
    expect(dev.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('compares token hashes in constant time', () => {
    expect(safeEqual('ab12', 'ab12')).toBe(true);
    expect(safeEqual('ab12', 'ab13')).toBe(false);
    expect(safeEqual('ab1', 'ab12')).toBe(false);
  });
});
