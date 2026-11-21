// Typed, synchronous event bus (§3.5). Listener arrays are copy-on-write, so emit never allocates
// and (un)subscribing from inside a handler is safe. A throwing handler is reported and does not stop the others.

import type { Unsubscribe } from '../contracts/common';
import type { EventBus } from '../contracts/events';

type Handler = (payload: never) => void;

export interface EventBusImpl<M> extends EventBus<M> {
  listenerCount(type?: keyof M): number;
  clear(): void;
}

export function createEventBus<M>(): EventBusImpl<M> {
  const map = new Map<keyof M, readonly Handler[]>();

  const off = <K extends keyof M>(type: K, cb: (payload: M[K]) => void): void => {
    const list = map.get(type);
    if (!list) return;
    const i = list.indexOf(cb as Handler);
    if (i < 0) return;
    const next = list.slice();
    next.splice(i, 1);
    if (next.length === 0) map.delete(type);
    else map.set(type, next);
  };

  const on = <K extends keyof M>(type: K, cb: (payload: M[K]) => void): Unsubscribe => {
    const list = map.get(type);
    map.set(type, list ? [...list, cb as Handler] : [cb as Handler]);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      off(type, cb);
    };
  };

  const once = <K extends keyof M>(type: K, cb: (payload: M[K]) => void): Unsubscribe => {
    const wrapper = (payload: M[K]): void => {
      unsub();
      cb(payload);
    };
    const unsub = on(type, wrapper);
    return unsub;
  };

  const emit = <K extends keyof M>(type: K, payload: M[K]): void => {
    const list = map.get(type);
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      try {
        (list[i] as (p: M[K]) => void)(payload);
      } catch (err) {
        console.error(`[eventBus] handler for "${String(type)}" threw`, err);
      }
    }
  };

  return {
    on,
    off,
    once,
    emit,
    listenerCount(type?: keyof M): number {
      if (type !== undefined) return map.get(type)?.length ?? 0;
      let n = 0;
      for (const list of map.values()) n += list.length;
      return n;
    },
    clear() {
      map.clear();
    },
  };
}
