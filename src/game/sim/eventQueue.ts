// Fixed-capacity SimEventQueue (sim layer). Never grows: when full the oldest event is dropped and counted.

import type { SimEvent, SimEventQueue } from '../../contracts/sim';

export interface SimEventQueueImpl extends SimEventQueue {
  size(): number;
  dropped(): number;
  clear(): void;
}

export function createEventQueue(capacity = 4096): SimEventQueueImpl {
  const items: (SimEvent | null)[] = new Array<SimEvent | null>(capacity).fill(null);
  let head = 0;
  let count = 0;
  let dropped = 0;
  let listeners: readonly ((e: SimEvent) => void)[] = [];
  return {
    push(e) {
      for (let i = 0; i < listeners.length; i++) listeners[i]!(e);
      if (count === capacity) {
        items[head] = null;
        head = (head + 1) % capacity;
        count--;
        dropped++;
      }
      items[(head + count) % capacity] = e;
      count++;
    },
    drain(cb) {
      while (count > 0) {
        const e = items[head]!;
        items[head] = null;
        head = (head + 1) % capacity;
        count--;
        cb(e);
      }
    },
    listen(cb) {
      listeners = [...listeners, cb];
      return () => {
        listeners = listeners.filter((l) => l !== cb);
      };
    },
    size: () => count,
    dropped: () => dropped,
    clear() {
      items.fill(null);
      head = 0;
      count = 0;
    },
  };
}
