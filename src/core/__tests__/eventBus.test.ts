import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../eventBus';

interface M {
  a: { n: number };
  b: string;
}

describe('EventBus', () => {
  it('delivers synchronously in subscription order with typed payloads', () => {
    const bus = createEventBus<M>();
    const seen: string[] = [];
    bus.on('a', (p) => seen.push(`1:${p.n}`));
    bus.on('a', (p) => seen.push(`2:${p.n}`));
    bus.on('b', (s) => seen.push(`b:${s}`));
    bus.emit('a', { n: 7 });
    bus.emit('b', 'x');
    expect(seen).toEqual(['1:7', '2:7', 'b:x']);
  });

  it('supports off, unsubscribe handles and once', () => {
    const bus = createEventBus<M>();
    const f = vi.fn();
    const g = vi.fn();
    const h = vi.fn();
    bus.on('a', f);
    const un = bus.on('a', g);
    bus.once('a', h);
    bus.emit('a', { n: 1 });
    bus.off('a', f);
    un();
    un();
    bus.emit('a', { n: 2 });
    expect(f).toHaveBeenCalledTimes(1);
    expect(g).toHaveBeenCalledTimes(1);
    expect(h).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount()).toBe(0);
  });

  it('is safe to unsubscribe during emit and isolates throwing handlers', () => {
    const bus = createEventBus<M>();
    const order: string[] = [];
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let unB: () => void = () => {};
    bus.on('a', () => {
      order.push('a');
      unB();
    });
    unB = bus.on('a', () => order.push('b'));
    bus.on('a', () => {
      throw new Error('boom');
    });
    bus.on('a', () => order.push('d'));
    bus.emit('a', { n: 0 });
    // b still runs in the emit that removed it (copy-on-write), not afterwards.
    expect(order).toEqual(['a', 'b', 'd']);
    bus.emit('a', { n: 0 });
    expect(order).toEqual(['a', 'b', 'd', 'a', 'd']);
    expect(err).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });
});
