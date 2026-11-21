// App state machine (§3.6). Screen-level navigation inside `menu` is the UI's business; this machine
// only tracks the coarse app states and rejects illegal transitions.

import type { AppStateId, EventBus, EventMap } from '../contracts/events';

export const APP_TRANSITIONS: Readonly<Record<AppStateId, readonly AppStateId[]>> = {
  boot: ['title', 'menu', 'loading', 'sandbox'],
  title: ['menu', 'loading'],
  menu: ['loading', 'title'],
  loading: ['session', 'menu'],
  session: ['results', 'menu', 'loading'],
  results: ['loading', 'menu'],
  sandbox: [],
};

/** Session-internal UI sub-state (§3.6). */
export type SessionUiState = 'driving' | 'paused' | 'flashback' | 'finished';

export interface AppStateMachine {
  current(): AppStateId;
  can(to: AppStateId): boolean;
  /** Returns false (and reports) on an illegal transition; same-state is a no-op that returns true. */
  go(to: AppStateId): boolean;
}

export function createAppStateMachine(bus: EventBus<EventMap>, initial: AppStateId = 'boot'): AppStateMachine {
  let state: AppStateId = initial;
  return {
    current: () => state,
    can: (to) => to === state || APP_TRANSITIONS[state].includes(to),
    go(to) {
      if (to === state) return true;
      if (!APP_TRANSITIONS[state].includes(to)) {
        console.error(`[appState] illegal transition ${state} -> ${to}`);
        return false;
      }
      const from = state;
      state = to;
      bus.emit('app:state', { from, to });
      return true;
    },
  };
}
