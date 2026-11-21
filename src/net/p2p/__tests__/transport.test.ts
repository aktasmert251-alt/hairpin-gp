import { describe, expect, it } from 'vitest';
import {
  CLOSE_ABNORMAL, DeferredTransport, channelTransport, closedTransport, createLoopbackPair, pipeTransports, portTransport, type ChannelLike, type Transport,
} from '../transport';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

function record(t: Transport) {
  const got: unknown[] = [];
  const closes: number[] = [];
  let opened = 0;
  t.onopen = () => opened++;
  t.onmessage = (ev) => got.push(ev.data);
  t.onclose = (ev) => closes.push(ev.code);
  return { got, closes, opened: () => opened };
}

class FakeChannel implements ChannelLike {
  binaryType = 'blob';
  readyState = 'connecting';
  bufferedAmount = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  sent: (string | ArrayBuffer)[] = [];
  send(d: string | ArrayBuffer): void {
    this.sent.push(d);
  }
  close(): void {
    this.readyState = 'closed';
    this.onclose?.({});
  }
  open(): void {
    this.readyState = 'open';
    this.onopen?.({});
  }
}

describe('loopback transport pair', () => {
  it('opens asynchronously, delivers text and binary in order, and copies binary buffers (callers reuse them)', async () => {
    const [a, b] = createLoopbackPair();
    const ra = record(a);
    const rb = record(b);
    expect(a.readyState).toBe(0);
    await tick();
    expect([ra.opened(), rb.opened(), a.readyState]).toEqual([1, 1, 1]);
    const buf = new Uint8Array([1, 2, 3]);
    a.send('hello');
    a.send(buf);
    buf[0] = 99;
    a.send(new Uint8Array([7]).subarray(0, 1));
    await tick();
    expect(rb.got[0]).toBe('hello');
    expect([...new Uint8Array(rb.got[1] as ArrayBuffer)]).toEqual([1, 2, 3]);
    expect([...new Uint8Array(rb.got[2] as ArrayBuffer)]).toEqual([7]);
  });

  it('close reaches both ends with the code; sends after close are dropped', async () => {
    const [a, b] = createLoopbackPair();
    const ra = record(a);
    const rb = record(b);
    await tick();
    a.close(4000);
    a.send('late');
    await tick();
    expect(ra.closes).toEqual([4000]);
    expect(rb.closes).toEqual([4000]);
    expect(rb.got).toEqual([]);
    expect(b.readyState).toBe(3);
  });
});

describe('MessagePort transport', () => {
  it('carries text and transferred binary across a real MessageChannel and closes the far end', async () => {
    const ch = new MessageChannel();
    const a = portTransport(ch.port1);
    const b = portTransport(ch.port2);
    const rb = record(b);
    record(a);
    await tick();
    a.send('{"type":"x"}');
    a.send(new Uint8Array([0x10, 1]));
    await tick();
    expect(rb.got[0]).toBe('{"type":"x"}');
    expect([...new Uint8Array(rb.got[1] as ArrayBuffer)]).toEqual([0x10, 1]);
    a.close(1001);
    await tick();
    expect(rb.closes).toEqual([1001]);
  });
});

describe('RTCDataChannel transport', () => {
  it('opens with the channel, sets arraybuffer binary type, reports bufferedAmount, maps a remote close to 1006', async () => {
    const dc = new FakeChannel();
    const t = channelTransport(dc);
    const r = record(t);
    expect(dc.binaryType).toBe('arraybuffer');
    dc.open();
    expect(r.opened()).toBe(1);
    t.send(new Uint8Array([5, 6]));
    expect(new Uint8Array(dc.sent[0] as ArrayBuffer)).toEqual(new Uint8Array([5, 6]));
    dc.bufferedAmount = 123;
    expect(t.bufferedAmount()).toBe(123);
    dc.onmessage?.({ data: 'hi' });
    expect(r.got).toEqual(['hi']);
    dc.close();
    expect(r.closes).toEqual([CLOSE_ABNORMAL]);
  });
});

describe('deferred, closed and piped transports', () => {
  it('a deferred transport opens when its channel is bound; fail() closes it unopened', async () => {
    const d = new DeferredTransport();
    const r = record(d);
    const dc = new FakeChannel();
    d.bind(channelTransport(dc));
    expect(r.opened()).toBe(0);
    dc.open();
    expect(r.opened()).toBe(1);
    d.send('x');
    expect(dc.sent).toEqual(['x']);
    const d2 = new DeferredTransport();
    const r2 = record(d2);
    d2.fail();
    expect([r2.opened(), r2.closes]).toEqual([0, [CLOSE_ABNORMAL]]);
  });

  it('closedTransport never opens', async () => {
    const t = closedTransport();
    const r = record(t);
    await tick();
    expect([r.opened(), r.closes]).toEqual([0, [CLOSE_ABNORMAL]]);
  });

  it('pipe forwards both ways, honours the drop filter one way, and propagates close', async () => {
    const [c1, s1] = createLoopbackPair();
    const [s2, c2] = createLoopbackPair();
    const r1 = record(c1);
    const r2 = record(c2);
    pipeTransports(s1, s2, (d) => d === 'drop');
    await tick();
    c1.send('to-2');
    c1.send('drop');
    c2.send('to-1');
    await tick();
    expect(r2.got).toEqual(['to-2']);
    expect(r1.got).toEqual(['to-1']);
    c1.close(1001);
    await tick();
    expect(r2.closes).toEqual([1001]);
  });
});
