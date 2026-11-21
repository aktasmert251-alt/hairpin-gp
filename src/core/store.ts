// Minimal Store<T> (contracts/ui.ts): shallow-merge set, synchronous subscribers.

import type { Unsubscribe } from '../contracts/common';
import type { Store } from '../contracts/ui';

export function createStore<T extends object>(initial: T): Store<T> {
  let value: T = initial;
  let subs: readonly ((v: Readonly<T>) => void)[] = [];
  return {
    get: () => value,
    set(patch) {
      value = { ...value, ...patch };
      for (const cb of subs) {
        try {
          cb(value);
        } catch (err) {
          console.error('[store] subscriber threw', err);
        }
      }
    },
    subscribe(cb): Unsubscribe {
      subs = [...subs, cb];
      return () => {
        subs = subs.filter((s) => s !== cb);
      };
    },
  };
}
