// D-055: feedback without replies. Payloads never enter operational logs.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { normalizeIp } from '../limits';
import { netHash } from '../privacy';
import { securityHeaders } from '../http';
import { clientIp, isLoopback, isSecure, type TrustProxy } from '../proxy';

export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_BODY_BYTES = 8192;
export const TYPES = ['bug', 'suggestion', 'complaint', 'other'] as const;
export const STATUSES = ['new', 'read', 'archived'] as const;
export type ContactType = typeof TYPES[number];
export type ContactStatus = typeof STATUSES[number];
export interface ContactInput { type: ContactType; message: string; nickname?: string; roomCode?: string; deviceId: string; website: string }
export interface ContactMessage { id: string; createdAt: number; status: ContactStatus; type: ContactType; message: string; nickname?: string; roomCode?: string }

const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(v);
export function validateContact(v: unknown): ContactInput | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const b = v as Record<string, unknown>;
  if (Object.keys(b).some((k) => !['type', 'message', 'nickname', 'roomCode', 'deviceId', 'website'].includes(k))) return null;
  if (!TYPES.includes(b.type as ContactType) || !text(b.message, 1000) || !b.message.trim()
    || typeof b.deviceId !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(b.deviceId) || !text(b.website, 200)) return null;
  if (b.nickname !== undefined && (!text(b.nickname, 32) || b.type !== 'complaint')) return null;
  if (b.roomCode !== undefined && (typeof b.roomCode !== 'string' || !/^([A-HJ-NP-Z2-9]{5})?$/.test(b.roomCode) || b.type !== 'complaint')) return null;
  return { type: b.type as ContactType, message: b.message.trim(), deviceId: b.deviceId, website: b.website,
    ...(typeof b.nickname === 'string' ? { nickname: b.nickname.trim() } : {}), ...(typeof b.roomCode === 'string' ? { roomCode: b.roomCode } : {}) };
}

/** Fixed one-hour windows; bounded, salted keys exist only in memory. */
export class ContactLimiter {
  private windows = new Map<string, { count: number; until: number }>();
  private salt = randomBytes(32).toString('hex');
  constructor(private now: () => number = Date.now) {}
  take(ip: string, device: string): boolean {
    const t = this.now();
    for (const [k, w] of this.windows) if (w.until <= t) this.windows.delete(k);
    const keys = [netHash(ip, this.salt), createHash('sha256').update(this.salt + device).digest('hex')];
    if (keys.some((k, i) => (this.windows.get(k)?.count ?? 0) >= (i === 0 ? 20 : 5))) return false;
    if (this.windows.size + keys.filter((k) => !this.windows.has(k)).length > 10_000) return false;
    for (const k of keys) { const w = this.windows.get(k) ?? { count: 0, until: t + 3_600_000 }; w.count++; this.windows.set(k, w); }
    return true;
  }
}

export class ContactStore {
  private rows: ContactMessage[] = [];
  private timer: ReturnType<typeof setInterval>;
  constructor(private file: string, private now: () => number = Date.now, private cap = MAX_FILE_BYTES) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (fs.existsSync(file)) {
      if (fs.statSync(file).size > cap) throw new Error('Contact storage exceeds cap');
      fs.chmodSync(file, 0o600);
      try { this.rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((s) => JSON.parse(s) as ContactMessage); }
      catch { throw new Error('Invalid contact storage'); }
    }
    this.prune();
    this.timer = setInterval(() => { try { this.prune(); } catch { /* Retry next hour; no payload in logs. */ } }, 3_600_000);
    this.timer.unref();
  }
  private save(rows: ContactMessage[]): void {
    const data = rows.map((r) => JSON.stringify(r) + '\n').join('');
    if (Buffer.byteLength(data) > this.cap) throw new Error('Contact storage full');
    const tmp = this.file + '.tmp';
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.fchmodSync(fd, 0o600); fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, this.file);
    this.rows = rows;
  }
  prune(): void {
    // A failed or interrupted atomic write must not leave an unpruned copy of messages.
    fs.rmSync(this.file + '.tmp', { force: true });
    const rows = this.rows.filter((r) => r.createdAt > this.now() - RETENTION_MS);
    if (rows.length !== this.rows.length) this.save(rows);
  }
  list(type?: ContactType, status?: ContactStatus): ContactMessage[] {
    this.prune();
    return this.rows.filter((r) => (!type || r.type === type) && (!status || r.status === status)).slice().reverse().map((r) => ({ ...r }));
  }
  add(b: ContactInput): ContactMessage {
    this.prune();
    const row: ContactMessage = { id: randomUUID(), createdAt: this.now(), status: 'new', type: b.type, message: b.message,
      ...(b.nickname ? { nickname: b.nickname } : {}), ...(b.roomCode ? { roomCode: b.roomCode } : {}) };
    this.save([...this.rows, row]); return row;
  }
  change(id: string, status: ContactStatus | 'delete'): boolean {
    this.prune();
    if (!this.rows.some((r) => r.id === id)) return false;
    this.save(status === 'delete' ? this.rows.filter((r) => r.id !== id) : this.rows.map((r) => r.id === id ? { ...r, status } : r));
    return true;
  }
  close(): void { clearInterval(this.timer); }
}

export function contactHandler(
  store: ContactStore, tls: boolean, origins: readonly string[] = [], trust: TrustProxy = 'none',
): (req: IncomingMessage, res: ServerResponse) => void {
  const limiter = new ContactLimiter();
  return (req, res) => {
    const origin = req.headers.origin;
    const secure = isSecure(req, tls, trust);
    const allowed = origin === `${secure ? 'https' : 'http'}://${req.headers.host}` || (origin !== undefined && origins.includes(origin));
    const headers: Record<string, string> = { ...securityHeaders(tls, secure), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    if (allowed && origin) { headers['Access-Control-Allow-Origin'] = origin; headers.Vary = 'Origin'; }
    const send = (status: number, error?: string): void => { res.writeHead(status, headers); res.end(JSON.stringify(error ? { error } : { ok: true })); };
    const ip = clientIp(req, trust);
    if (!secure && !isLoopback(req.socket.remoteAddress)) return send(426, 'httpsRequired');
    if (!allowed) return send(403, 'origin');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(); return;
    }
    if (req.method !== 'POST') return send(405, 'method');
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(req.headers['content-type'] ?? '')) return send(415, 'contentType');
    let size = 0;
    const chunks: Buffer[] = [];
    let done = false;
    req.on('data', (c: Buffer) => { size += c.length; if (!done && size > MAX_BODY_BYTES) { done = true; chunks.length = 0; send(413, 'size'); } else if (!done) chunks.push(c); });
    req.on('end', () => {
      if (done) return; done = true;
      let body: ContactInput | null = null;
      try { body = validateContact(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { /* Invalid JSON. */ }
      if (!body) return send(400, 'validation');
      if (!limiter.take(ip, body.deviceId)) return send(429, 'rate');
      if (body.website) return send(200);
      try { store.add(body); send(200); } catch { send(503, 'unavailable'); }
    });
    req.on('error', () => { done = true; chunks.length = 0; });
  };
}
