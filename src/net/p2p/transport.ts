// D-064 transport abstraction. Every link between a game client and a room is a `Transport`: the WebSocket-shaped surface the
// netClient already speaks (SocketLike) plus the send-buffer size the room reads (Peer.bufferedAmount). Implementations:
//   * WebSocket: the browser socket itself (server mode, unchanged);
//   * loopback pair: in-memory, both ends in one realm (tests, headless host);
//   * MessagePort: the host's page <-> its room Web Worker (the host's own client, and each guest's bridged data channel);
//   * RTCDataChannel: a guest's page <-> the host's page.
// Wire semantics match a WebSocket: ordered, reliable, string = JSON text, ArrayBuffer = binary; both ends see `onclose`.

import type { SocketLike } from '../netClient';

export interface Transport extends SocketLike {
  /** Bytes queued for sending (0 when unknown). */
  bufferedAmount(): number;
}

export const CONNECTING = 0;
export const OPEN = 1;
export const CLOSED = 3;

/** Abnormal close (no close frame): what a dropped link reports. */
export const CLOSE_ABNORMAL = 1006;

/** Copies outgoing binary data: callers reuse their buffers (netClient's state buffer, the room's scratch). */
export function toWire(data: string | ArrayBufferView | ArrayBuffer): string | ArrayBuffer {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return data.slice(0);
  const out = new Uint8Array(data.byteLength);
  out.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return out.buffer;
}

/** Shared event plumbing of the transports below. */
abstract class BaseTransport implements Transport {
  binaryType = 'arraybuffer';
  readyState = CONNECTING;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  protected fireOpen(): void {
    if (this.readyState !== CONNECTING) return;
    this.readyState = OPEN;
    this.onopen?.({});
  }

  protected fireMessage(data: unknown): void {
    if (this.readyState === OPEN) this.onmessage?.({ data });
  }

  protected fireClose(code: number): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.onclose?.({ code });
  }

  abstract send(data: string | ArrayBufferView | ArrayBuffer): void;
  abstract close(code?: number, reason?: string): void;
  bufferedAmount(): number {
    return 0;
  }
}

// ---- loopback ------------------------------------------------------------------------------------------------------------------

class LoopbackEnd extends BaseTransport {
  peer: LoopbackEnd | null = null;
  constructor(private readonly schedule: (fn: () => void) => void) {
    super();
    schedule(() => this.fireOpen());
  }
  send(data: string | ArrayBufferView | ArrayBuffer): void {
    if (this.readyState !== OPEN) return;
    const wire = toWire(data);
    const to = this.peer;
    this.schedule(() => to?.fireMessage(wire));
  }
  close(code = 1000): void {
    if (this.readyState === CLOSED) return;
    const to = this.peer;
    this.fireClose(code);
    this.schedule(() => to?.fireClose(code));
  }
  /** Tests: the link drops without a close handshake (both ends see 1006). */
  drop(): void {
    const to = this.peer;
    this.fireClose(CLOSE_ABNORMAL);
    to?.fireClose(CLOSE_ABNORMAL);
  }
}

/** Two connected in-memory ends. Delivery is asynchronous (like a socket); `schedule` defaults to a microtask. */
export function createLoopbackPair(schedule: (fn: () => void) => void = queueMicrotask): [LoopbackEnd, LoopbackEnd] {
  const a = new LoopbackEnd(schedule);
  const b = new LoopbackEnd(schedule);
  a.peer = b;
  b.peer = a;
  return [a, b];
}

// ---- MessagePort -----------------------------------------------------------------------------------------------------------

/**
 * Event handler slot that DOM handlers (`(this: X, ev: MessageEvent) => any`) and test fakes both fit: a method signature is
 * checked bivariantly, so the DOM's narrower event parameter is accepted.
 */
type Handler<E> = { bivarianceHack(ev: E): void }['bivarianceHack'];

/** The part of MessagePort the port transport uses (a real MessagePort in the browser, a fake in tests). */
export interface PortLike {
  onmessage: Handler<{ data: unknown }> | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  close(): void;
}

/** Close frame on a port (data frames are strings or ArrayBuffers). */
interface PortClose { c: number }

const isPortClose = (d: unknown): d is PortClose => typeof d === 'object' && d !== null && typeof (d as PortClose).c === 'number';

class PortTransport extends BaseTransport {
  constructor(private readonly port: PortLike) {
    super();
    port.onmessage = (ev) => {
      const d = ev.data;
      if (isPortClose(d)) {
        this.port.close();
        this.fireClose(d.c);
      } else if (typeof d === 'string' || d instanceof ArrayBuffer) this.fireMessage(d);
    };
    queueMicrotask(() => this.fireOpen());
  }
  send(data: string | ArrayBufferView | ArrayBuffer): void {
    if (this.readyState !== OPEN) return;
    const wire = toWire(data);
    if (typeof wire === 'string') this.port.postMessage(wire);
    else this.port.postMessage(wire, [wire]);
  }
  close(code = 1000): void {
    if (this.readyState === CLOSED) return;
    try {
      this.port.postMessage({ c: code } satisfies PortClose);
      this.port.close();
    } catch {
      /* already detached */
    }
    this.fireClose(code);
  }
}

export function portTransport(port: PortLike): Transport {
  return new PortTransport(port);
}

// ---- RTCDataChannel ----------------------------------------------------------------------------------------------------------

/** The part of RTCDataChannel the channel transport uses. */
export interface ChannelLike {
  binaryType: string;
  readonly readyState: string;
  readonly bufferedAmount: number;
  onopen: Handler<unknown> | null;
  onclose: Handler<unknown> | null;
  onmessage: Handler<{ data: unknown }> | null;
  send(data: string | ArrayBuffer): void;
  close(): void;
}

class ChannelTransport extends BaseTransport {
  private closeCode = CLOSE_ABNORMAL;
  constructor(private readonly dc: ChannelLike) {
    super();
    dc.binaryType = 'arraybuffer';
    dc.onmessage = (ev) => this.fireMessage(ev.data);
    dc.onclose = () => this.fireClose(this.closeCode);
    if (dc.readyState === 'open') queueMicrotask(() => this.fireOpen());
    else if (dc.readyState === 'closed' || dc.readyState === 'closing') queueMicrotask(() => this.fireClose(CLOSE_ABNORMAL));
    else dc.onopen = () => this.fireOpen();
  }
  send(data: string | ArrayBufferView | ArrayBuffer): void {
    if (this.readyState !== OPEN || this.dc.readyState !== 'open') return;
    this.dc.send(toWire(data));
  }
  close(code = 1000): void {
    if (this.readyState === CLOSED) return;
    this.closeCode = code;
    try {
      this.dc.close();
    } catch {
      /* already closed */
    }
    this.fireClose(code);
  }
  override bufferedAmount(): number {
    return this.dc.bufferedAmount;
  }
}

export function channelTransport(dc: ChannelLike): Transport {
  return new ChannelTransport(dc);
}

/** A transport whose real link arrives later (a guest's data channel still connecting); `fail` closes it unopened. */
export class DeferredTransport extends BaseTransport {
  private inner: Transport | null = null;
  bind(t: Transport): void {
    if (this.readyState === CLOSED) {
      t.close(1000);
      return;
    }
    this.inner = t;
    t.onmessage = (ev) => this.fireMessage(ev.data);
    t.onclose = (ev) => this.fireClose(ev.code);
    if (t.readyState === OPEN) this.fireOpen();
    else t.onopen = () => this.fireOpen();
  }
  fail(code = CLOSE_ABNORMAL): void {
    this.fireClose(code);
  }
  send(data: string | ArrayBufferView | ArrayBuffer): void {
    if (this.readyState === OPEN) this.inner?.send(data);
  }
  close(code = 1000): void {
    this.inner?.close(code);
    this.fireClose(code);
  }
  override bufferedAmount(): number {
    return this.inner?.bufferedAmount() ?? 0;
  }
}

/** Forwards everything between two transports (host page: a guest's data channel <-> its port to the room worker). */
export function pipeTransports(a: Transport, b: Transport, dropAtoB?: (data: unknown) => boolean): void {
  a.onmessage = (ev) => {
    if (!dropAtoB?.(ev.data)) b.send(ev.data as string | ArrayBuffer);
  };
  b.onmessage = (ev) => a.send(ev.data as string | ArrayBuffer);
  a.onclose = (ev) => b.close(ev.code);
  b.onclose = (ev) => a.close(ev.code);
}

/** A transport that closes right away (a guest without a live data channel: the netClient backs off and retries). */
export function closedTransport(code = CLOSE_ABNORMAL): Transport {
  return new DeadTransport(code);
}

class DeadTransport extends BaseTransport {
  constructor(code: number) {
    super();
    queueMicrotask(() => this.fireClose(code));
  }
  send(): void {}
  close(code = 1000): void {
    this.fireClose(code);
  }
}
