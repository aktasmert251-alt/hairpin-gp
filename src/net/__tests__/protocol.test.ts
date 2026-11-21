import { describe, expect, it } from 'vitest';
import { NET_HZ, NET_STATE_BYTES, PROTOCOL_VERSION, type NetCarState, type NetRoomSettings } from '../../contracts/net';
import {
  BATCH_HEADER_BYTES, CONTACT_BYTES, MSG_CONTACT, MSG_CONTACT_RELAY, MSG_STATE, NET_FLAG_DRS_OPEN, NET_FLAG_RESET, NET_LIMITS, PING_BYTES,
  PONG_BYTES, batchBytes, copyStateToBatch, decodeBatchEntry, decodeBatchHeader, decodeContact, decodePing, decodePong, decodeState,
  encodeContact, encodePing, encodePong, encodeState, isRoomCode, newNetCarState, newNetContact, normalizeName, parseClientMessage,
  parseServerMessage, seqNewer, utf8Length, viewOf, writeBatchEntry, writeBatchHeader, type NetBatchHeader,
} from '../protocol';

function sample(patch: Partial<NetCarState> = {}): NetCarState {
  return {
    ...newNetCarState(),
    flags: NET_FLAG_DRS_OPEN | NET_FLAG_RESET, seq: 65535, simMs: 123_456, x: -1234.5, y: 12.25, z: 987.125, progress: 5432.1,
    yaw: 2.5, vx: -81.37, vz: 12.04, yawRate: -0.731, steerAngle: 0.2, throttle: 0.8, brake: 0.1, gear: 7, rpm: 11_250, drsFlap: 1,
    compound: 'inter', ersDeploying: true, ...patch,
  };
}

function enc(s: NetCarState): DataView {
  const dv = new DataView(new ArrayBuffer(NET_STATE_BYTES));
  encodeState(s, dv);
  return dv;
}

function expectClose(a: NetCarState, b: NetCarState): void {
  expect(a.flags).toBe(b.flags);
  expect(a.seq).toBe(b.seq);
  expect(a.simMs).toBe(b.simMs);
  expect(a.x).toBeCloseTo(b.x, 2);
  expect(a.y).toBeCloseTo(b.y, 3);
  expect(a.z).toBeCloseTo(b.z, 2);
  expect(Math.abs(a.progress - b.progress)).toBeLessThan(0.001);
  expect(Math.abs(a.yaw - b.yaw)).toBeLessThan(Math.PI / 32768 + 1e-9);
  expect(Math.abs(a.vx - b.vx)).toBeLessThanOrEqual(0.005 + 1e-9);
  expect(Math.abs(a.vz - b.vz)).toBeLessThanOrEqual(0.005 + 1e-9);
  expect(Math.abs(a.yawRate - b.yawRate)).toBeLessThanOrEqual(0.0005 + 1e-9);
  expect(Math.abs(a.steerAngle - b.steerAngle)).toBeLessThanOrEqual(1 / 600 + 1e-9);
  expect(Math.abs(a.throttle - b.throttle)).toBeLessThanOrEqual(1 / 510 + 1e-9);
  expect(Math.abs(a.brake - b.brake)).toBeLessThanOrEqual(1 / 510 + 1e-9);
  expect(a.gear).toBe(b.gear);
  expect(a.rpm).toBe(b.rpm);
  expect(Math.abs(a.drsFlap - b.drsFlap)).toBeLessThanOrEqual(1 / 510 + 1e-9);
  expect(a.compound).toBe(b.compound);
  expect(a.ersDeploying).toBe(b.ersDeploying);
}

const SETTINGS: NetRoomSettings = { visibility: 'public', trackId: 'istanbul', laps: 3, tod: 'day', weather: 'dry', aiCount: 16, difficulty: 70, mode: 'normal' };

describe('contract constants (CR-NET-9)', () => {
  it('match the design', () => {
    expect(PROTOCOL_VERSION).toBe(2);
    expect(NET_STATE_BYTES).toBe(40);
    expect(NET_HZ).toBe(20);
  });
});

describe('binary state 0x10', () => {
  it('round-trips within the quantisation steps', () => {
    const s = sample();
    const out = newNetCarState();
    expect(decodeState(enc(s), out)).toBe(true);
    expectClose(out, s);
    for (const compound of ['soft', 'medium', 'hard', 'inter', 'wet'] as const) {
      expect(decodeState(enc(sample({ compound, ersDeploying: false, gear: -1 })), out)).toBe(true);
      expect([out.compound, out.ersDeploying, out.gear]).toEqual([compound, false, -1]);
    }
  });

  it('uses the exact little-endian layout of design §8.2', () => {
    const dv = enc(sample());
    expect(dv.byteLength).toBe(40);
    const b = new Uint8Array(dv.buffer);
    expect(b[0]).toBe(MSG_STATE);
    expect(b[1]).toBe(NET_FLAG_DRS_OPEN | NET_FLAG_RESET);
    expect([b[2], b[3]]).toEqual([0xff, 0xff]); // seq 65535
    expect(b[4]! | (b[5]! << 8) | (b[6]! << 16) | (b[7]! << 24)).toBe(123_456); // u32 LE
    expect(dv.getFloat32(8, true)).toBeCloseTo(-1234.5, 3);
    expect(dv.getInt16(26, true)).toBe(-8137); // vx cm/s
    expect(dv.getInt8(35)).toBe(7);
    expect(dv.getUint16(36, true)).toBe(11_250);
    expect(b[39]).toBe(3 | 8); // inter + ERS bit
    // Big-endian reading gives a different value: the format is really LE.
    expect(dv.getUint16(36, false)).not.toBe(11_250);
  });

  it('wraps yaw (±π and multiples) and clamps out-of-range scalars', () => {
    const out = newNetCarState();
    for (const yaw of [Math.PI, -Math.PI, 3 * Math.PI + 0.25, -7.5]) {
      expect(decodeState(enc(sample({ yaw })), out)).toBe(true);
      const d = Math.atan2(Math.sin(out.yaw - yaw), Math.cos(out.yaw - yaw));
      expect(Math.abs(d)).toBeLessThan(1e-4);
    }
    expect(decodeState(enc(sample({ vx: 500, vz: -500, throttle: 3, brake: -1, rpm: 99_999, steerAngle: 2, gear: 12, simMs: -5 })), out)).toBe(true);
    expect([out.vx, out.vz, out.throttle, out.brake, out.rpm, out.gear, out.simMs]).toEqual([327.67, -327.68, 1, 0, 65535, 8, 0]);
    expect(out.steerAngle).toBeCloseTo(127 / 300, 9);
  });

  it('rejects wrong size, wrong type, NaN/huge coordinates and bad enums', () => {
    const out = newNetCarState();
    const good = enc(sample());
    const u = new Uint8Array(good.buffer);
    expect(decodeState(new DataView(u.slice(0, 39).buffer), out)).toBe(false); // truncated
    const longer = new Uint8Array(41);
    longer.set(u);
    expect(decodeState(new DataView(longer.buffer), out)).toBe(false); // oversized
    expect(decodeState(new DataView(new ArrayBuffer(0)), out)).toBe(false);
    const t = u.slice();
    t[0] = 0x11;
    expect(decodeState(new DataView(t.buffer), out)).toBe(false);
    expect(decodeState(enc(sample({ x: Number.NaN })), out)).toBe(false);
    expect(decodeState(enc(sample({ z: Infinity })), out)).toBe(false);
    expect(decodeState(enc(sample({ x: NET_LIMITS.maxCoordM + 1 })), out)).toBe(false);
    expect(decodeState(enc(sample({ progress: Number.NaN })), out)).toBe(false);
    const g = u.slice();
    new DataView(g.buffer).setInt8(35, 9);
    expect(decodeState(new DataView(g.buffer), out)).toBe(false);
    const c = u.slice();
    c[39] = 5; // compound index 5
    expect(decodeState(new DataView(c.buffer), out)).toBe(false);
    c[39] = 0x11; // stray high bits
    expect(decodeState(new DataView(c.buffer), out)).toBe(false);
  });

  it('never throws on random bytes', () => {
    const out = newNetCarState();
    let seed = 12345;
    for (let i = 0; i < 2000; i++) {
      const n = i % 50;
      const u = new Uint8Array(n);
      for (let k = 0; k < n; k++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        u[k] = seed >>> 24;
      }
      if (n > 0 && i % 3 === 0) u[0] = MSG_STATE;
      const r = decodeState(new DataView(u.buffer), out);
      if (r) {
        expect(Number.isFinite(out.x) && Number.isFinite(out.progress)).toBe(true);
      }
    }
  });

  it('works on a DataView into a larger buffer (Node Buffer case)', () => {
    const big = new Uint8Array(100);
    big.set(new Uint8Array(enc(sample()).buffer), 30);
    const out = newNetCarState();
    expect(decodeState(viewOf(big.subarray(30, 70)), out)).toBe(true);
    expectClose(out, sample());
  });
});

describe('binary batch 0x90 (D-043: server-sourced AI entries)', () => {
  it('sizes: 8 + 40·k; 3 opponents = 128 B; a full 20-car grid fits the 1 KB payload', () => {
    expect(BATCH_HEADER_BYTES).toBe(8);
    expect(batchBytes(3)).toBe(128);
    expect(batchBytes(NET_LIMITS.maxBatchCars)).toBeLessThanOrEqual(1024);
  });

  it('round-trips relayed human states and server AI states with the source bit', () => {
    const human = sample({ seq: 7 });
    const ai = sample({ seq: 9, x: 50, compound: 'hard', ersDeploying: false });
    const raw = new Uint8Array(enc(human).buffer);
    const buf = new Uint8Array(batchBytes(2));
    const dv = viewOf(buf);
    writeBatchHeader(dv, 2, 0x1_0005, 777_000);
    copyStateToBatch(raw, buf, 0, 3, false);
    writeBatchEntry(dv, 1, 42, true, ai);
    const h: NetBatchHeader = { count: 0, serverSeq: 0, serverMs: 0 };
    expect(decodeBatchHeader(dv, h)).toBe(true);
    expect(h).toEqual({ count: 2, serverSeq: 5, serverMs: 777_000 });
    const out = newNetCarState();
    expect(decodeBatchEntry(dv, 0, out)).toBe(true);
    expect([out.id, out.fromServer]).toEqual([3, false]);
    expectClose(out, human);
    expect(decodeBatchEntry(dv, 1, out)).toBe(true);
    expect([out.id, out.fromServer]).toEqual([42, true]);
    expectClose(out, ai);
    // Relaying keeps bytes 1..39 identical.
    expect(buf.subarray(BATCH_HEADER_BYTES + 1, BATCH_HEADER_BYTES + 40)).toEqual(raw.subarray(1));
  });

  it('rejects a wrong length, too many cars, duplicate ids and bad entries', () => {
    const h: NetBatchHeader = { count: 0, serverSeq: 0, serverMs: 0 };
    const mk = (count: number, bytes = batchBytes(count)): DataView => {
      const dv = new DataView(new ArrayBuffer(bytes));
      writeBatchHeader(dv, count, 1, 1);
      for (let k = 0; k < count && batchBytes(k + 1) <= bytes; k++) writeBatchEntry(dv, k, k, false, sample());
      return dv;
    };
    expect(decodeBatchHeader(mk(0), h)).toBe(true);
    expect(decodeBatchHeader(mk(2, batchBytes(2) - 1), h)).toBe(false);
    expect(decodeBatchHeader(mk(2, batchBytes(2) + 1), h)).toBe(false);
    expect(decodeBatchHeader(mk(21), h)).toBe(false);
    expect(decodeBatchHeader(new DataView(new ArrayBuffer(4)), h)).toBe(false);
    const dup = mk(3);
    writeBatchEntry(dup, 2, 1, true, sample()); // id 1 again (source bit does not make it unique)
    expect(decodeBatchHeader(dup, h)).toBe(false);
    const ids = mk(2);
    writeBatchEntry(ids, 1, 127, false, sample());
    expect(decodeBatchHeader(ids, h)).toBe(true);
    const nan = mk(1);
    writeBatchEntry(nan, 0, 0, false, sample({ y: Number.NaN }));
    expect(decodeBatchEntry(nan, 0, newNetCarState())).toBe(false);
    expect(decodeBatchEntry(mk(1), 1, newNetCarState())).toBe(false); // past the end
  });
});

describe('binary contact 0x11 / 0x91', () => {
  const c = { ...newNetContact(), other: 5, fromServer: true, seq: 300, simMs: 61_000, j: 4200.5, nx: 0.6, nz: -0.8, px: -310.25, pz: 1200.5, vRelN: -7.31, episode: 65535 };

  it('is 28 bytes and round-trips both directions', () => {
    expect(CONTACT_BYTES).toBe(28);
    for (const type of [MSG_CONTACT, MSG_CONTACT_RELAY] as const) {
      const dv = new DataView(new ArrayBuffer(CONTACT_BYTES));
      expect(encodeContact(c, type, dv)).toBe(28);
      const out = newNetContact();
      expect(decodeContact(dv, type, out)).toBe(true);
      expect(out.other).toBe(5);
      expect(out.fromServer).toBe(true);
      expect([out.seq, out.simMs, out.episode]).toEqual([300, 61_000, 65535]);
      expect(out.j).toBeCloseTo(4200.5, 2);
      expect(out.nx).toBeCloseTo(0.6, 4);
      expect(out.nz).toBeCloseTo(-0.8, 4);
      expect(out.px).toBeCloseTo(-310.25, 3);
      expect(out.vRelN).toBeCloseTo(-7.31, 6);
      // The other direction's type is refused.
      expect(decodeContact(dv, type === MSG_CONTACT ? MSG_CONTACT_RELAY : MSG_CONTACT, out)).toBe(false);
    }
  });

  it('rejects truncated/oversized frames, negative or NaN j, a non-unit normal and far points', () => {
    const out = newNetContact();
    const bad = (patch: Partial<typeof c>): boolean => {
      const dv = new DataView(new ArrayBuffer(CONTACT_BYTES));
      encodeContact({ ...c, ...patch }, MSG_CONTACT, dv);
      return decodeContact(dv, MSG_CONTACT, out);
    };
    expect(bad({})).toBe(true);
    expect(bad({ j: -1 })).toBe(false);
    expect(bad({ j: Number.NaN })).toBe(false);
    expect(bad({ j: Infinity })).toBe(false);
    expect(bad({ nx: 0, nz: 0 })).toBe(false);
    expect(bad({ nx: 0.5, nz: 0.5 })).toBe(false);
    expect(bad({ px: 1e6 })).toBe(false);
    expect(bad({ pz: Number.NaN })).toBe(false);
    expect(decodeContact(new DataView(new ArrayBuffer(27)), MSG_CONTACT, out)).toBe(false);
    expect(decodeContact(new DataView(new ArrayBuffer(29)), MSG_CONTACT, out)).toBe(false);
  });
});

describe('ping / pong', () => {
  it('sizes 12 / 20 B, round-trip with f64 precision', () => {
    const ping = new DataView(new ArrayBuffer(PING_BYTES));
    expect(encodePing(70_000, 123456.789, ping)).toBe(12);
    const p = { seq: 0, clientMs: 0 };
    expect(decodePing(ping, p)).toBe(true);
    expect(p).toEqual({ seq: 70_000 & 0xffff, clientMs: 123456.789 });
    const pong = new DataView(new ArrayBuffer(PONG_BYTES));
    expect(encodePong(9, 1.5, 1_760_000_000_123.25, pong)).toBe(20);
    const q = { seq: 0, clientMs: 0, serverMs: 0 };
    expect(decodePong(pong, q)).toBe(true);
    expect(q).toEqual({ seq: 9, clientMs: 1.5, serverMs: 1_760_000_000_123.25 });
  });

  it('rejects wrong sizes, types and non-finite times', () => {
    expect(decodePing(new DataView(new ArrayBuffer(11)), { seq: 0, clientMs: 0 })).toBe(false);
    expect(decodePong(new DataView(new ArrayBuffer(21)), { seq: 0, clientMs: 0, serverMs: 0 })).toBe(false);
    const ping = new DataView(new ArrayBuffer(PING_BYTES));
    encodePing(1, Number.NaN, ping);
    expect(decodePing(ping, { seq: 0, clientMs: 0 })).toBe(false);
    const pong = new DataView(new ArrayBuffer(PONG_BYTES));
    encodePong(1, 1, Infinity, pong);
    expect(decodePong(pong, { seq: 0, clientMs: 0, serverMs: 0 })).toBe(false);
    encodePing(1, 1, new DataView(pong.buffer, 0, PING_BYTES));
    expect(decodePong(pong, { seq: 0, clientMs: 0, serverMs: 0 })).toBe(false); // type 0x01 in a 20-byte frame
  });

  it('seqNewer handles u16 wrap', () => {
    expect(seqNewer(1, 0)).toBe(true);
    expect(seqNewer(0, 65535)).toBe(true);
    expect(seqNewer(65535, 0)).toBe(false);
    expect(seqNewer(5, 5)).toBe(false);
  });
});

describe('names and room codes', () => {
  it('accepts Turkish letters, digits, space and _-. ; NFC-normalises and trims', () => {
    expect(normalizeName('  Şükrü_34 ')).toBe('Şükrü_34');
    expect(normalizeName('İlker')).toBe('İlker'); // I + combining dot → precomposed İ
    expect(normalizeName('xá́')).toBeNull(); // a leftover combining mark (zalgo) is rejected
    expect(normalizeName('Ö'.normalize('NFD') + 'zge')).toBe('Özge'); // NFD → NFC
    expect(normalizeName('a.b-c d')).toBe('a.b-c d');
    expect(normalizeName('ab')).toBe('ab');
    expect(normalizeName('abcdefghijklmnop')).toBe('abcdefghijklmnop');
  });

  it('rejects short/long names, HTML, control and bidi characters', () => {
    for (const bad of ['a', 'abcdefghijklmnopq', '<script>', 'a‮b', 'a\u0000b', 'tab\tx', '😀😀', '', '   ', 42, null, 'x'.repeat(65)]) {
      expect(normalizeName(bad)).toBeNull();
    }
  });

  it('room codes: 5 characters of the unambiguous alphabet', () => {
    expect(isRoomCode('AB2CD')).toBe(true);
    expect(isRoomCode('AB0CD')).toBe(false); // 0 excluded
    expect(isRoomCode('ABICD')).toBe(false); // I excluded
    expect(isRoomCode('abcde')).toBe(false);
    expect(isRoomCode('ABCD')).toBe(false);
    expect(isRoomCode('ABCDEF')).toBe(false);
  });

  it('utf8Length counts bytes', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('ş')).toBe(2);
    expect(utf8Length('€')).toBe(3);
    expect(utf8Length('😀')).toBe(4);
  });
});

describe('JSON client → server', () => {
  const ok = (m: unknown) => parseClientMessage(JSON.stringify(m));

  it('accepts every valid message and returns only known fields', () => {
    expect(ok({ type: 'hello', v: 1, build: 'abc', name: 'Ali' })).toEqual({ type: 'hello', v: 1, build: 'abc', name: 'Ali' });
    expect(ok({ type: 'hello', v: 1, build: 'abc', name: 'Ali', resume: 'a'.repeat(32) })).toMatchObject({ resume: 'a'.repeat(32) });
    expect(ok({ type: 'create', settings: SETTINGS })).toEqual({ type: 'create', settings: SETTINGS });
    expect(ok({ type: 'setSettings', settings: { ...SETTINGS, laps: 10, trackId: 'bosphorus', aiCount: 0 } })).not.toBeNull();
    expect(ok({ type: 'join', code: 'XK7PQ' })).toEqual({ type: 'join', code: 'XK7PQ' });
    expect(ok({ type: 'setCar', teamId: 'anka', driverIdx: 1 })).toEqual({ type: 'setCar', teamId: 'anka', driverIdx: 1 });
    expect(ok({ type: 'setReady', ready: true })).toEqual({ type: 'setReady', ready: true });
    expect(ok({ type: 'loaded', trackHash: 'deadbeef' })).toEqual({ type: 'loaded', trackHash: 'deadbeef' });
    expect(ok({ type: 'report', kind: 'trackLimits', seconds: 5, lap: 2 })).toEqual({ type: 'report', kind: 'trackLimits', seconds: 5, lap: 2 });
    expect(ok({ type: 'report', kind: 'lapInvalidated', lap: 0 })).toEqual({ type: 'report', kind: 'lapInvalidated', lap: 0 });
    for (const type of ['leave', 'start', 'retire', 'backToLobby']) expect(ok({ type })).toEqual({ type });
  });

  it('rejects malformed, unknown, extra-key, out-of-range and oversized messages', () => {
    const bad: unknown[] = [
      { type: 'nope' }, { type: 'start', x: 1 }, { type: 'hello', v: 1.5, build: 'a', name: 'Ali' }, { type: 'hello', v: 1, build: 'a' },
      { type: 'hello', v: 1, build: 'a', name: 'Ali', resume: 'zz' }, { type: 'create', settings: { ...SETTINGS, laps: 2 } },
      { type: 'create', settings: { ...SETTINGS, trackId: 'oval' } }, { type: 'create', settings: { ...SETTINGS, aiCount: 20 } },
      { type: 'create', settings: { ...SETTINGS, extra: 1 } }, { type: 'create', settings: { ...SETTINGS, difficulty: Number.NaN } },
      { type: 'join', code: 'abcde' }, { type: 'setCar', teamId: 'noteam', driverIdx: 0 }, { type: 'setCar', teamId: 'anka', driverIdx: 2 },
      { type: 'setReady', ready: 'yes' }, { type: 'loaded', trackHash: 'XYZ' }, { type: 'report', kind: 'speeding', lap: 1 },
      { type: 'report', kind: 'cornerCut', lap: 1, seconds: -1 }, { type: 'report', kind: 'cornerCut', lap: 100 },
      [], 'str', 42, null, { type: 1 }, { __proto__: { type: 'start' } },
    ];
    for (const m of bad) expect(parseClientMessage(JSON.stringify(m)), JSON.stringify(m)).toBeNull();
    expect(parseClientMessage('{not json')).toBeNull();
    expect(parseClientMessage('')).toBeNull();
    expect(parseClientMessage(new ArrayBuffer(4))).toBeNull();
    expect(parseClientMessage('{"type":"start","__proto__":{"x":1}}')).toBeNull();
    const big = JSON.stringify({ type: 'hello', v: 1, build: 'x', name: 'Ali', pad: 'x'.repeat(1100) });
    expect(parseClientMessage(big)).toBeNull();
    // 1024 bytes counted as UTF-8: 400 two-byte chars + overhead > 1024 although .length < 1024.
    const wide = `{"type":"hello","v":1,"build":"${'ş'.repeat(500)}","name":"Ali"}`;
    expect(wide.length).toBeLessThan(1024);
    expect(parseClientMessage(wide)).toBeNull();
  });
});

describe('JSON server → client', () => {
  const ok = (m: unknown) => parseServerMessage(JSON.stringify(m));
  const roster = [
    { id: 0, kind: 'human', name: 'Ali', teamId: 'anka', driverIdx: 0, gridSlot: 3 },
    { id: 9, kind: 'ai', name: 'Kerem Aydın', teamId: 'anka', driverIdx: 1, gridSlot: 0 },
  ];

  it('accepts every valid message', () => {
    const msgs: unknown[] = [
      { type: 'welcome', id: 3, resumeToken: '0123456789abcdef0123456789abcdef', serverMs: 1e12, limits: { maxPlayers: 4, hz: 20 } },
      { type: 'room', code: 'XK7PQ', ownerId: 3, phase: 'lobby', settings: SETTINGS, players: [{ id: 3, name: 'Ali', teamId: 'anka', driverIdx: 0, ready: false, connected: true, pingMs: 40 }] },
      { type: 'error', code: 'full' },
      { type: 'load', raceId: 'r-1', config: { ...SETTINGS, seed: -5 }, roster, lightsOutAtMs: 9000 },
      { type: 'start', t0ServerMs: 1e12 },
      { type: 'lap', id: 9, lap: 2, ms: 84_000.5, valid: true, bestMs: 83_900 },
      { type: 'penalty', id: 0, seconds: 5, reason: 'jumpStart' },
      { type: 'standings', order: [9, 0], laps: [2, 2], gapMs: [0, 1200], status: ['running', 'running'] },
      { type: 'finishing', byId: 9, windowMs: 120_000 },
      { type: 'player', id: 0, connected: false, stale: true },
      { type: 'results', rows: [{ pos: 1, id: 9, name: 'Kerem Aydın', teamId: 'anka', totalMs: 250_000, gapMs: 0, lapsDown: 0, bestLapMs: 83_000, stops: 0, penaltySec: 0, points: 25, status: 'finished' }] },
    ];
    for (const m of msgs) expect(ok(m), JSON.stringify(m)).toEqual(m);
  });

  it('a 20-car load/results fits the server JSON limit', () => {
    const big = Array.from({ length: 20 }, (_, i) => ({ id: i, kind: i < 4 ? 'human' : 'ai', name: 'Abcdefghijklmnop', teamId: 'aurora', driverIdx: 1, gridSlot: i }));
    expect(ok({ type: 'load', raceId: 'r-1', config: { ...SETTINGS, seed: 1 }, roster: big, lightsOutAtMs: 9000 })).not.toBeNull();
    const rows = big.map((r, i) => ({ pos: i + 1, id: r.id, name: r.name, teamId: r.teamId, totalMs: 1e6, gapMs: 1e5, lapsDown: 0, bestLapMs: 9e4, stops: 1, penaltySec: 5, points: 0, status: 'dnf' }));
    const text = JSON.stringify({ type: 'results', rows });
    expect(utf8Length(text)).toBeLessThanOrEqual(NET_LIMITS.maxServerJsonBytes);
    expect(parseServerMessage(text)).not.toBeNull();
  });

  it('rejects malformed server messages', () => {
    const bad: unknown[] = [
      { type: 'welcome', id: 128, resumeToken: '0'.repeat(32), serverMs: 1, limits: { maxPlayers: 4, hz: 20 } },
      { type: 'welcome', id: 1, resumeToken: '0'.repeat(32), serverMs: 1, limits: { maxPlayers: 4 } },
      { type: 'room', code: 'XK7PQ', ownerId: 3, phase: 'warmup', settings: SETTINGS, players: [] },
      { type: 'room', code: 'XK7PQ', ownerId: 3, phase: 'lobby', settings: SETTINGS, players: [{ id: 3, name: 'A‮', teamId: 'anka', driverIdx: 0, ready: false, connected: true, pingMs: 1 }] },
      { type: 'error', code: 'oops' },
      { type: 'load', raceId: 'r 1', config: { ...SETTINGS, seed: 1 }, roster, lightsOutAtMs: 9000 },
      { type: 'load', raceId: 'r', config: { ...SETTINGS, seed: 1.5 }, roster, lightsOutAtMs: 9000 },
      { type: 'load', raceId: 'r', config: { ...SETTINGS, seed: 1 }, roster: [roster[0], { ...roster[1], gridSlot: 3 }], lightsOutAtMs: 9000 },
      { type: 'load', raceId: 'r', config: { ...SETTINGS, seed: 1 }, roster: [roster[0], { ...roster[1], id: 0 }], lightsOutAtMs: 9000 },
      { type: 'load', raceId: 'r', config: { ...SETTINGS, seed: 1 }, roster: [{ ...roster[0], kind: 'bot' }], lightsOutAtMs: 9000 },
      { type: 'load', raceId: 'r', config: { ...SETTINGS, seed: 1 }, roster: [], lightsOutAtMs: 9000 },
      { type: 'standings', order: [1, 2], laps: [1], gapMs: [0, 1], status: ['running', 'running'] },
      { type: 'standings', order: [1, 1], laps: [1, 1], gapMs: [0, 1], status: ['running', 'running'] },
      { type: 'penalty', id: 0, seconds: 5, reason: 'rudeness' },
      { type: 'results', rows: [{ pos: 0, id: 1 }] },
    ];
    for (const m of bad) expect(parseServerMessage(JSON.stringify(m)), JSON.stringify(m)).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: 'error', code: 'full', pad: 'x'.repeat(20_000) }))).toBeNull();
  });
});

describe('D-050 protocol additions', () => {
  it('hello.deviceId: optional, ^[A-Za-z0-9_-]{16,64}$', async () => {
    const { parseClientMessage } = await import('../protocol');
    const base = { type: 'hello', v: PROTOCOL_VERSION, build: 'b', name: 'Ayşe' };
    expect(parseClientMessage(JSON.stringify({ ...base, deviceId: 'A'.repeat(16) }))).toMatchObject({ deviceId: 'A'.repeat(16) });
    expect(parseClientMessage(JSON.stringify(base))).not.toHaveProperty('deviceId');
    for (const bad of ['short', 'A'.repeat(65), 'has space in it!!', 7]) expect(parseClientMessage(JSON.stringify({ ...base, deviceId: bad }))).toBeNull();
  });

  it('notice, kicked and the maintenance error parse strictly', async () => {
    const { parseServerMessage, NOTICE_MAX } = await import('../protocol');
    expect(parseServerMessage('{"type":"notice","text":"Back at 22:00"}')).toEqual({ type: 'notice', text: 'Back at 22:00' });
    expect(parseServerMessage('{"type":"notice","text":""}')).toEqual({ type: 'notice', text: '' });
    expect(parseServerMessage(JSON.stringify({ type: 'notice', text: 'x'.repeat(NOTICE_MAX + 1) }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: 'notice', text: 'a‮b' }))).toBeNull();
    expect(parseServerMessage('{"type":"kicked","reason":"kicked"}')).toEqual({ type: 'kicked', reason: 'kicked' });
    expect(parseServerMessage('{"type":"kicked","reason":"banned","until":null}')).toEqual({ type: 'kicked', reason: 'banned', until: null });
    expect(parseServerMessage('{"type":"kicked","reason":"banned","until":1790000000000}')).toMatchObject({ until: 1790000000000 });
    expect(parseServerMessage('{"type":"kicked","reason":"bye"}')).toBeNull();
    expect(parseServerMessage('{"type":"kicked","reason":"kicked","until":"soon"}')).toBeNull();
    expect(parseServerMessage('{"type":"error","code":"maintenance"}')).toEqual({ type: 'error', code: 'maintenance' });
  });
});

describe('D-061 / D-062 protocol', () => {
  const team = { id: 'custom-abc', name: 'Kartal Racing', baseTeamId: 'anka', primary: 'teal', secondary: 'white', accent: 'gold', finish: 'gloss' };
  const settings = { trackId: 'istanbul', laps: 3, tod: 'day', weather: 'dry', aiCount: 0, difficulty: 55 };

  it('room settings carry the race mode (default normal); listings show it', async () => {
    const { parseClientMessage, parseServerMessage } = await import('../protocol');
    expect(parseClientMessage(JSON.stringify({ type: 'create', settings }))).toMatchObject({ settings: { mode: 'normal' } });
    expect(parseClientMessage(JSON.stringify({ type: 'create', settings: { ...settings, mode: 'kasap' } }))).toMatchObject({ settings: { mode: 'kasap' } });
    expect(parseClientMessage(JSON.stringify({ type: 'create', settings: { ...settings, mode: 'chaos' } }))).toBeNull();
    const listing = { code: 'ABCDE', track: 'istanbul', laps: 3, weather: 'dry', tod: 'day', humans: 1, capacity: 20, state: 'lobby', owner: 'Ayşe' };
    expect(parseServerMessage(JSON.stringify({ type: 'rooms', rooms: [{ ...listing, mode: 'kasap' }] }))).toMatchObject({ rooms: [{ mode: 'kasap' }] });
    expect(parseServerMessage(JSON.stringify({ type: 'rooms', rooms: [listing] }))).toEqual({ type: 'rooms', rooms: [listing] }); // absent = normal
  });

  it('setTeam: a valid custom team or null; names, palette ids and the base car are checked', async () => {
    const { parseClientMessage } = await import('../protocol');
    expect(parseClientMessage(JSON.stringify({ type: 'setTeam', team }))).toEqual({ type: 'setTeam', team });
    expect(parseClientMessage(JSON.stringify({ type: 'setTeam', team: null }))).toEqual({ type: 'setTeam', team: null });
    for (const bad of [
      { ...team, name: 'x' }, { ...team, name: '<b>Bold</b>' }, { ...team, name: 'Fe' + 'rrari Team' }, { ...team, primary: '#ff0000' },
      { ...team, baseTeamId: 'nope' }, { ...team, finish: 'chrome' }, { ...team, extra: 1 }, { ...team, id: 'Custom ID' },
    ]) expect(parseClientMessage(JSON.stringify({ type: 'setTeam', team: bad })), JSON.stringify(bad)).toBeNull();
  });

  it('room snapshots and load carry the custom teams (one per base car)', async () => {
    const { parseServerMessage } = await import('../protocol');
    const room = { type: 'room', code: 'ABCDE', ownerId: 1, phase: 'lobby', settings, players: [] };
    expect(parseServerMessage(JSON.stringify({ ...room, teams: [{ ownerId: 1, team }] }))).toMatchObject({ teams: [{ ownerId: 1, team }] });
    expect(parseServerMessage(JSON.stringify({ ...room, teams: [{ ownerId: 1, team }, { ownerId: 2, team }] }))).toBeNull();
    const load = { type: 'load', raceId: 'ABCDE-1', config: { ...settings, seed: 1 }, roster: [{ id: 1, kind: 'human', name: 'Ayşe', teamId: 'anka', driverIdx: 0, gridSlot: 0 }], lightsOutAtMs: 9000 };
    expect(parseServerMessage(JSON.stringify({ ...load, teams: [team] }))).toMatchObject({ teams: [team] });
    expect(parseServerMessage(JSON.stringify({ ...load, teams: [{ ...team, primary: 'nope' }] }))).toBeNull();
  });
});
