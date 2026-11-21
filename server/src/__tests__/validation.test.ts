// Unit tests: state validation (design §7.2), lap timing (§6.1), contact clamp (§6.2), and a wire fuzz against the server (T6).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../../../src/contracts/net';
import type { NetCarState, NetContact } from '../../../src/contracts/net';
import {
  MSG_CONTACT, NET_FLAG_RESET, NET_LIMITS, encodeContact, newNetCarState, newNetContact, viewOf,
} from '../../../src/net/protocol';
import { loadRaceTrack } from '../../../src/track/registry';
import { checkContact, type ContactPose, type ContactReject } from '../contact';
import { CarTiming, LAP_CREDIT, LAP_NONE, LAP_REJECT, buildResults } from '../timing';
import { StateValidator, WindowCounter } from '../validate';
import { bot, isType, sleep, startRace, startServer, type TestServer } from './helpers';

const track = loadRaceTrack('istanbul');
const q = track.query;
const L = q.length;

/** A state on the centreline at progress p moving forward at `v` m/s. */
function onTrack(p: number, simMs: number, seq: number, v = 50): NetCarState {
  const f = q.frameAt(q.wrapS(p), { s: 0, px: 0, py: 0, pz: 0, tx: 0, tz: 0, lx: 0, lz: 0, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 });
  const s = newNetCarState();
  Object.assign(s, { seq, simMs, x: f.px, y: f.py, z: f.pz, progress: p, vx: f.tx * v, vz: f.tz * v });
  return s;
}

describe('StateValidator', () => {
  const drive = (v: StateValidator, s: NetCarState, raceMs = s.simMs) => {
    const r = v.check(s, raceMs);
    if (r === 'ok') v.accept(s, raceMs);
    return r;
  };

  it('accepts a legit sequence and rejects old/duplicate seq silently', () => {
    const v = new StateValidator(q, 100);
    expect(drive(v, onTrack(100, 1000, 1))).toBe('ok');
    expect(drive(v, onTrack(102.5, 1050, 2))).toBe('ok');
    expect(drive(v, onTrack(105, 1100, 2))).toBe('drop');
    expect(drive(v, onTrack(105, 1100, 1))).toBe('drop');
  });

  it('impossible speed: > 105 m/s strike, > 150 m/s hard', () => {
    const v = new StateValidator(q, 100);
    drive(v, onTrack(100, 1000, 1));
    expect(drive(v, onTrack(105, 1050, 2, 120))).toBe('strike');
    expect(v.reason).toBe('speed');
    expect(drive(v, onTrack(105, 1050, 3, 160))).toBe('hard');
  });

  it('teleport: > 50 m between samples is hard, small jumps beyond 105·dt + 3 are strikes', () => {
    const v = new StateValidator(q, 100);
    drive(v, onTrack(100, 1000, 1));
    expect(drive(v, onTrack(400, 1050, 2))).toBe('hard');
    expect(v.reason).toBe('teleport');
    expect(drive(v, onTrack(115, 1050, 3))).toBe('strike');
    expect(v.reason).toBe('displacement');
    // With the reset flag a nearby on-track pose is accepted.
    const r = onTrack(108, 1100, 4);
    r.flags = NET_FLAG_RESET;
    expect(drive(v, r)).toBe('ok');
  });

  it('fake progress and positions off the track are strikes', () => {
    const v = new StateValidator(q, 100);
    drive(v, onTrack(100, 1000, 1));
    const fake = onTrack(102, 1050, 2);
    fake.progress = 600;
    expect(drive(v, fake)).toBe('strike');
    expect(v.reason).toBe('progress');
    const off = onTrack(103, 1050, 3);
    off.x += 300;
    expect(drive(v, off)).not.toBe('ok');
    const lie = onTrack(104, 1100, 4);
    lie.progress = 160; // claims 56 m further than where it is
    expect(drive(v, lie)).toBe('strike');
  });

  it('simMs ahead of the race clock is a strike; NaN never reaches the validator (codec)', () => {
    const v = new StateValidator(q, 100);
    expect(drive(v, onTrack(100, 5000, 1), 1000)).toBe('strike');
    expect(v.reason).toBe('ahead');
  });
});

describe('CarTiming', () => {
  const [s1, s2] = track.data.sectors;
  it('credits a lap only after both sectors, interpolates the crossing and applies the floor', () => {
    const t = new CarTiming(L, track.data.sectors, 79_800, 8000);
    expect(t.sample(8000, -10)).toBe(LAP_NONE);
    expect(t.sample(20_000, s1 + 1)).toBe(LAP_NONE);
    expect(t.sample(50_000, s2 + 1)).toBe(LAP_NONE);
    expect(t.sample(91_000, L - 10)).toBe(LAP_NONE);
    expect(t.sample(92_000, L + 10)).toBe(LAP_CREDIT);
    expect(t.lastLapMs).toBeCloseTo(91_500 - 8000, 6);
    expect(t.lapsCompleted).toBe(1);
  });

  it('a line crossing that skipped a sector (shortcut) gets no credit', () => {
    const t = new CarTiming(L, track.data.sectors, 1, 0);
    t.sample(0, -5);
    t.sample(10_000, s1 + 1);
    expect(t.sample(20_000, L + 5)).toBe(LAP_REJECT); // jumped from S1 straight to the line
    expect(t.rejectReason).toBe('sectors');
    expect(t.lapsCompleted).toBe(0);
  });

  it('rejects a lap under the floor; results order by laps then time incl. penalties', () => {
    const t = new CarTiming(L, track.data.sectors, 79_800, 0);
    t.sample(0, -5);
    t.sample(10_000, s1 + 1);
    t.sample(20_000, s2 + 1);
    expect(t.sample(60_000, L + 1)).toBe(LAP_REJECT);
    expect(t.rejectReason).toBe('floor');

    const mk = (id: number, laps: number, finishMs: number, pen: number) => {
      const c = new CarTiming(L, track.data.sectors, 1, 0);
      c.lapsCompleted = laps;
      c.status = finishMs > 0 ? 'finished' : 'running';
      c.finishMs = finishMs;
      c.penaltySec = pen;
      return { id, name: `N${id}`, teamId: 'anka', timing: c };
    };
    const rows = buildResults([mk(1, 3, 300_000, 5), mk(2, 3, 297_000, 0), mk(3, 2, 0, 0), mk(4, 3, 303_000, 0)], 0);
    expect(rows.map((r) => r.id)).toEqual([2, 4, 1, 3]); // id 1 loses P2 to its 5 s penalty
    expect(rows.map((r) => r.points)).toEqual([25, 18, 15, 0]);
    expect(rows[1]!.gapMs).toBe(6000);
    expect(rows[2]!.gapMs).toBe(8000);
    expect(rows[3]!.lapsDown).toBe(1);
  });
});

describe('checkContact', () => {
  const why: { r: ContactReject } = { r: '' };
  const pose = (x: number, vx: number): ContactPose => ({ x, z: 0, vx, vz: 0, simMs: 20_000 });
  const contact = (j: number): NetContact => ({ ...newNetContact(), simMs: 20_000, j, nx: 1, nz: 0, px: 1, pz: 0, vRelN: -5 });

  it('clamps j to the plausible two-body impulse and the 15 kN·s cap', () => {
    // Sender at 0 m doing 30 m/s, other 3 m ahead doing 25 m/s: closing 5 m/s → bound 1.15·5·400·1.5 + 500 = 3950.
    expect(checkContact(contact(3000), pose(0, 30), pose(3, 25), 20_000, 8000, why)).toBe(3000);
    expect(checkContact(contact(9000), pose(0, 30), pose(3, 25), 20_000, 8000, why)).toBeCloseTo(3950, 6);
    expect(checkContact(contact(1e6), pose(0, 30), pose(3, 25), 20_000, 8000, why)).toBe(-1);
    expect(why.r).toBe('impulse');
    expect(NET_LIMITS.contactJMax).toBe(15_000);
  });

  it('rejects far-apart cars, the grid start and stale poses', () => {
    expect(checkContact(contact(1000), pose(0, 30), pose(40, 25), 20_000, 8000, why)).toBe(-1);
    expect(why.r).toBe('far');
    expect(checkContact({ ...contact(1000), simMs: 8500 }, pose(0, 30), pose(3, 25), 20_000, 8000, why)).toBe(-1);
    expect(why.r).toBe('early');
    expect(checkContact(contact(1000), { ...pose(0, 30), simMs: 15_000 }, pose(3, 25), 20_000, 8000, why)).toBe(-1);
    expect(why.r).toBe('stale');
  });
});

describe('WindowCounter', () => {
  it('fires at the limit within the window only', () => {
    const w = new WindowCounter(3, 1000);
    expect([w.hit(0), w.hit(100), w.hit(200)]).toEqual([false, false, true]);
    expect([w.hit(300), w.hit(1500), w.hit(2600)]).toEqual([false, false, false]);
  });
});

describe('wire fuzz (T6)', () => {
  let srv: TestServer;
  beforeAll(async () => {
    srv = await startServer({ countdownMs: 100, maxRooms: 4 });
  });
  afterAll(async () => {
    await srv.stop();
  });

  it('survives random bytes, wrong sizes, NaN, unknown types, huge JSON and floods; a normal client still works', async () => {
    const victims: Promise<number>[] = [];
    const send = async (payloads: (string | Buffer)[]) => {
      const ws = new WebSocket(srv.url);
      await new Promise((r) => ws.once('open', r));
      victims.push(new Promise((r) => ws.once('close', (c) => r(c))));
      ws.send(JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, build: 'f', name: 'Fuzz' }));
      for (const p of payloads) ws.send(p);
      setTimeout(() => ws.close(), 500);
    };
    const nan = Buffer.alloc(40);
    nan[0] = 0x10;
    nan.writeFloatLE(Number.NaN, 8);
    const rnd = (n: number) => Buffer.from(Array.from({ length: n }, () => Math.floor(Math.random() * 256)));
    await send([rnd(40), Buffer.alloc(39, 0x10), Buffer.alloc(41, 0x10), nan, rnd(7), Buffer.from([0x7f])]);
    await send(['{"type":"nope"}', '{"type":"create","settings":{"trackId":"x"}}', '[]', 'null', '{"__proto__":{"a":1},"type":"leave"}']);
    await send(['{"type":"hello"' + ' '.repeat(2000) + '}']);
    await send(Array.from({ length: 300 }, () => Buffer.alloc(40, 0x10)));
    const codes = await Promise.all(victims);
    expect(codes).toContain(1008); // bad-message limit / flood
    expect(codes).toContain(1009); // > 1024 B
    expect(srv.logs.filter((l) => l.event === 'messageError')).toEqual([]);
    const ok = await bot(srv, 'Normal');
    ok.send({ type: 'create', settings: { trackId: 'istanbul', laps: 1, tod: 'night', weather: 'dry', aiCount: 0, difficulty: 50 } });
    await ok.waitFor(isType('room'));
    ok.close();
  });

  it('contacts naming a car of another room, oneself or an AI without the source bit are rejected (impersonation)', async () => {
    const [a, b, c, d] = [await bot(srv, 'Ca'), await bot(srv, 'Cb'), await bot(srv, 'Cc'), await bot(srv, 'Cd')];
    await startRace([a, b], { trackId: 'istanbul' });
    await startRace([c, d], { trackId: 'istanbul', aiCount: 1 });
    await a.waitFor(isType('start'));
    await sleep(srv.apex.hub.cfg.countdownMs + 300);
    const buf = new Uint8Array(28);
    const send = (other: number, fromServer: boolean) => {
      const ct = { ...newNetContact(), other, fromServer, simMs: 100, j: 1000, nx: 1, nz: 0 };
      encodeContact(ct, MSG_CONTACT, viewOf(buf));
      a.sendRaw(buf);
    };
    send(c.id, false); // other room
    send(a.id, false); // self
    send(64, false); // AI id without the bit (and not in this room)
    await sleep(200);
    const rejects = srv.logs.filter((l) => l.event === 'contactReject' && l.data.id === a.id).map((l) => l.data.why);
    expect(rejects).toEqual(['target', 'target', 'target']);
    expect(c.contactsIn + b.contactsIn).toBe(0);
    for (const x of [a, b, c, d]) x.close();
  });

  it('a human reset (NET_FLAG_RESET) is a 3 s ghost: contacts to or from it are refused, then allowed again', async () => {
    const [a, b] = [await bot(srv, 'Ga'), await bot(srv, 'Gb')];
    await startRace([a, b], { trackId: 'istanbul' });
    await a.waitFor(isType('start'));
    // Past the countdown, lights out + 1 s and the 2 s connect window.
    await sleep(srv.apex.hub.cfg.countdownMs + 2500);
    const buf = new Uint8Array(28);
    const whys = (): unknown[] => srv.logs.filter((l) => l.event === 'contactReject' && (l.data.id === a.id || l.data.id === b.id)).map((l) => l.data.why);
    const hit = (from: typeof a, to: typeof a): void => {
      encodeContact({ ...newNetContact(), other: to.id, simMs: 0, j: 1000, nx: 1, nz: 0 }, MSG_CONTACT, viewOf(buf));
      from.sendRaw(buf);
    };
    hit(b, a);
    await sleep(100);
    expect(whys().at(-1)).not.toBe('ghost'); // refused for its timing/distance, not as a ghost
    const before = whys().length;
    a.nextFlags = NET_FLAG_RESET;
    await sleep(150); // the reset state is relayed (accepted)
    hit(b, a); // into the ghost
    hit(a, b); // from the ghost
    await sleep(100);
    expect(whys().slice(before)).toEqual(['ghost', 'ghost']);
    await sleep(3000);
    hit(b, a);
    await sleep(100);
    expect(whys().at(-1)).not.toBe('ghost');
    a.close();
    b.close();
  }, 20_000);
});
