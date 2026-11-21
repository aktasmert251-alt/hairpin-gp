import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContactLimiter, ContactStore, MAX_BODY_BYTES, RETENTION_MS, contactHandler, validateContact } from '../contact/index';
import type { IncomingMessage, ServerResponse } from 'node:http';

const body = { type: 'bug', message: 'Feedback <script>sample</script>', deviceId: 'a'.repeat(22), website: '' };
const stores: ContactStore[] = [], dirs: string[] = [];
function file(): string { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'contact-')); dirs.push(d); return path.join(d, 'contact.jsonl'); }
function store(f: string, now?: () => number, cap?: number): ContactStore { const s = new ContactStore(f, now, cap); stores.push(s); return s; }
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); vi.useRealTimers(); });

describe('contact validation', () => {
  it('requires TLS for remote submission while permitting loopback development', () => {
    const s = store(file());
    const req = { headers: { origin: 'http://game.test', host: 'game.test' }, method: 'OPTIONS', socket: { remoteAddress: '192.0.2.1' } } as unknown as IncomingMessage;
    const res = { writeHead: vi.fn(), end: vi.fn() };
    contactHandler(s, false)(req, res as unknown as ServerResponse);
    expect(res.writeHead.mock.calls[0]![0]).toBe(426);
    req.headers.origin = 'https://game.test';
    contactHandler(s, true)(req, res as unknown as ServerResponse);
    expect(res.writeHead.mock.calls[1]![0]).toBe(204);
    expect(res.writeHead.mock.calls[1]![1]).toHaveProperty('Strict-Transport-Security', 'max-age=31536000');
  });
  it('accepts each type and complaint metadata, preserves plain text', () => {
    for (const type of ['bug', 'suggestion', 'complaint', 'other']) expect(validateContact({ ...body, type })?.message).toBe(body.message);
    expect(validateContact({ ...body, type: 'complaint', nickname: 'Deniz', roomCode: 'ABCDE' })).not.toBeNull();
    expect(validateContact({ ...body, message: 'x'.repeat(1000) })).not.toBeNull();
  });
  it.each([null, [], { ...body, type: 'unknown' }, { ...body, message: '' }, { ...body, message: '  ' }, { ...body, message: 'x'.repeat(1001) },
    { ...body, message: '\u0000' }, { ...body, deviceId: '' }, { ...body, email: 'unused@example.test' }, { ...body, consent: true },
    { ...body, nickname: 'unexpected' }, { ...body, type: 'complaint', roomCode: 'bad' }, { ...body, website: 1 }])('rejects malformed or obsolete data', (b) => {
    expect(validateContact(b)).toBeNull();
  });
});
describe('contact rate limits', () => {
  it('limits each device across networks and each network across devices; expires windows', () => {
    let now = 0; const limiter = new ContactLimiter(() => now);
    for (let n = 0; n < 5; n++) expect(limiter.take(`${n}.0.0.1`, 'same-device')).toBe(true);
    expect(limiter.take('9.0.0.1', 'same-device')).toBe(false);
    for (let n = 0; n < 20; n++) expect(limiter.take(`10.0.0.${n}`, `device-${n}`)).toBe(true);
    expect(limiter.take('10.0.0.250', 'fresh')).toBe(false);
    now = 3_600_000; expect(limiter.take('10.0.0.250', 'same-device')).toBe(true);
  });
});
describe('contact persistence', () => {
  it('removes abandoned atomic-write copies on startup and pruning', () => {
    const f = file(); fs.writeFileSync(f + '.tmp', 'abandoned feedback');
    const s = store(f); expect(fs.existsSync(f + '.tmp')).toBe(false);
    fs.writeFileSync(f + '.tmp', 'abandoned feedback'); s.prune();
    expect(fs.existsSync(f + '.tmp')).toBe(false);
  });
  it('filters, changes status, deletes and reloads; stores no transport identifiers', () => {
    const f = file(), s = store(f); const a = s.add(validateContact(body)!);
    s.add(validateContact({ ...body, type: 'suggestion' })!);
    expect(s.list('bug', 'new')).toHaveLength(1); expect(s.change(a.id, 'read')).toBe(true);
    expect(s.list('bug', 'new')).toHaveLength(0); expect(s.list('bug', 'read')).toHaveLength(1);
    expect(s.change(a.id, 'archived')).toBe(true); expect(store(f).list('bug', 'archived')).toHaveLength(1);
    expect(s.change(a.id, 'delete')).toBe(true); expect(s.change(a.id, 'read')).toBe(false);
    expect(fs.readFileSync(f, 'utf8')).not.toMatch(/deviceId|network|email/);
    if (process.platform !== 'win32') expect(fs.statSync(f).mode & 0o777).toBe(0o600);
  });
  it('prunes at startup, hourly and before reads, with the exact 30-day boundary', () => {
    vi.useFakeTimers(); let now = 100; const f = file(), s = store(f, () => now); s.add(validateContact(body)!); s.close();
    now += RETENTION_MS; const restarted = store(f, () => now); expect(restarted.list()).toEqual([]); expect(fs.readFileSync(f, 'utf8')).toBe('');
    restarted.add(validateContact(body)!); now += RETENTION_MS; vi.advanceTimersByTime(3_600_000);
    expect(fs.readFileSync(f, 'utf8')).toBe('');
  });
  it('caps storage without losing existing messages', () => {
    const f = file(), s = store(f, undefined, 500); s.add(validateContact(body)!); const original = fs.readFileSync(f, 'utf8');
    expect(() => s.add(validateContact({ ...body, message: 'x'.repeat(500) })!)).toThrow('full'); expect(fs.readFileSync(f, 'utf8')).toBe(original);
    expect(MAX_BODY_BYTES).toBe(8192);
  });
});
