// HUD notification queue (ui-hud §3.1, D-002). Presentation-side glue, owned by the HudPresenter.
// ≤ 2 visible (newest first) + ≤ 4 waiting. A repeated key reuses its id, updates params and restarts its timer.
// Priority 3 displaces the lowest-priority visible entry (which re-queues with its remaining time).

import type { HudModel } from '../../contracts/hud';

export type NotifyLevel = HudModel['notifications'][number]['level'];
export type NotifyPriority = 0 | 1 | 2 | 3;
export type HudNotification = HudModel['notifications'][number];

export const MAX_VISIBLE = 2;
export const MAX_QUEUED = 4;

/** ui-hud §3.2 catalogue: level, priority and lifetime per key (keys outside it use the level defaults). */
export const NOTIFY_CATALOGUE: Readonly<Record<string, { level: NotifyLevel; priority: NotifyPriority; ms: number }>> = {
  'notify.start.jumpStart': { level: 'penalty', priority: 3, ms: 4500 },
  'notify.limits.warning': { level: 'warn', priority: 2, ms: 4500 },
  'notify.limits.blackWhite': { level: 'warn', priority: 2, ms: 4500 },
  'notify.penalty.trackLimits': { level: 'penalty', priority: 3, ms: 4500 },
  'notify.penalty.cornerCut': { level: 'penalty', priority: 3, ms: 4500 },
  // D-056
  'notify.penalty.collision': { level: 'penalty', priority: 3, ms: 5000 },
  'notify.penalty.safetyCar': { level: 'penalty', priority: 3, ms: 5000 },
  'notify.collision.warning': { level: 'warn', priority: 3, ms: 4500 },
  'notify.sc.deployed': { level: 'warn', priority: 3, ms: 8000 },
  'notify.sc.ending': { level: 'info', priority: 2, ms: 6000 },
  'notify.sc.restart': { level: 'info', priority: 2, ms: 4000 },
  'notify.penalty.pitSpeeding': { level: 'penalty', priority: 3, ms: 4500 },
  'notify.penalty.twoCompound': { level: 'penalty', priority: 3, ms: 6000 },
  'notify.penalty.served': { level: 'info', priority: 1, ms: 3000 },
  'notify.penalty.pending': { level: 'warn', priority: 2, ms: 4500 },
  'notify.lap.invalid': { level: 'warn', priority: 2, ms: 3000 },
  'notify.lap.personalBest': { level: 'good', priority: 1, ms: 3000 },
  'notify.lap.fastest': { level: 'good', priority: 1, ms: 3000 },
  'notify.lap.final': { level: 'info', priority: 1, ms: 3000 },
  'notify.flag.yellow': { level: 'warn', priority: 2, ms: 3000 },
  'notify.flag.blue': { level: 'warn', priority: 2, ms: 3000 },
  'notify.flag.chequered': { level: 'info', priority: 2, ms: 3000 },
  'notify.drs.enabled': { level: 'info', priority: 0, ms: 2500 },
  'notify.drs.disabled': { level: 'info', priority: 0, ms: 2500 },
  'notify.weather.rainSoon': { level: 'info', priority: 1, ms: 4500 },
  'notify.weather.rainStarted': { level: 'info', priority: 1, ms: 3000 },
  'notify.weather.drying': { level: 'info', priority: 1, ms: 3000 },
  'notify.weather.intersNow': { level: 'warn', priority: 2, ms: 4500 },
  'notify.weather.wetsNow': { level: 'warn', priority: 2, ms: 4500 },
  'notify.weather.slicksNow': { level: 'warn', priority: 2, ms: 4500 },
  'notify.pit.requested': { level: 'info', priority: 1, ms: 2500 },
  'notify.pit.cancelled': { level: 'info', priority: 1, ms: 2500 },
  'notify.pit.limiter': { level: 'warn', priority: 3, ms: 1500 },
  'notify.pit.stopTime': { level: 'info', priority: 1, ms: 3000 },
  'notify.car.reset': { level: 'info', priority: 1, ms: 2500 },
  'notify.net.notice': { level: 'info', priority: 2, ms: 8000 },
  'notify.flashback.used': { level: 'info', priority: 1, ms: 2500 },
  'notify.flashback.none': { level: 'warn', priority: 1, ms: 2500 },
  'notify.racingLine.mode': { level: 'info', priority: 0, ms: 1500 },
  'notify.settings.modifierRefused': { level: 'warn', priority: 2, ms: 3000 },
  'notify.error.runtime': { level: 'warn', priority: 3, ms: 6000 },
};

const LEVEL_DEFAULTS: Readonly<Record<NotifyLevel, { priority: NotifyPriority; ms: number }>> = {
  info: { priority: 1, ms: 3000 },
  good: { priority: 1, ms: 3000 },
  warn: { priority: 2, ms: 4500 },
  penalty: { priority: 3, ms: 4500 },
};

interface Entry { n: HudNotification; leftMs: number; seq: number }

export interface NotificationQueue {
  /** Adds or coalesces a notification. `ms` / `level` override the catalogue when given. */
  push(key: string, params?: Record<string, string | number>, level?: NotifyLevel, ms?: number): void;
  /** Advances timers by wall-clock ms and refills the visible slots. */
  tick(dtMs: number): void;
  /** Writes the visible entries (newest first) into `out` in place. */
  write(out: HudNotification[]): void;
  clear(): void;
  /** Visible + queued counts (tests). */
  sizes(): { visible: number; queued: number };
}

export function createNotificationQueue(): NotificationQueue {
  let nextId = 1;
  let seq = 0;
  const visible: Entry[] = [];
  const queued: Entry[] = [];

  const find = (list: Entry[], key: string): Entry | undefined => {
    for (const e of list) if (e.n.key === key) return e;
    return undefined;
  };

  /** Index of the lowest-priority, oldest entry (smallest priority, then smallest seq). */
  const weakest = (list: Entry[]): number => {
    let idx = -1;
    for (let i = 0; i < list.length; i++) {
      const e = list[i]!;
      const w = idx < 0 ? null : list[idx]!;
      if (!w || e.n.priority < w.n.priority || (e.n.priority === w.n.priority && e.seq < w.seq)) idx = i;
    }
    return idx;
  };

  const enqueue = (e: Entry): void => {
    queued.push(e);
    if (queued.length > MAX_QUEUED) queued.splice(weakest(queued), 1);
  };

  const fill = (): void => {
    while (visible.length < MAX_VISIBLE && queued.length > 0) {
      // Highest priority first, then oldest.
      let best = 0;
      for (let i = 1; i < queued.length; i++) {
        const a = queued[i]!;
        const b = queued[best]!;
        if (a.n.priority > b.n.priority || (a.n.priority === b.n.priority && a.seq < b.seq)) best = i;
      }
      visible.unshift(queued.splice(best, 1)[0]!);
    }
  };

  return {
    push(key, params = {}, level, ms) {
      const cat = NOTIFY_CATALOGUE[key];
      const lvl = level ?? cat?.level ?? 'info';
      const life = ms ?? cat?.ms ?? LEVEL_DEFAULTS[lvl].ms;
      const prio = cat?.priority ?? LEVEL_DEFAULTS[lvl].priority;
      const existing = find(visible, key) ?? find(queued, key);
      if (existing) {
        // D-002: same key → same id, params updated, timer restarted.
        existing.n.params = params;
        existing.n.level = lvl;
        existing.n.ms = life;
        existing.leftMs = life;
        return;
      }
      const e: Entry = { n: { id: nextId++, key, params, level: lvl, ms: life, priority: prio }, leftMs: life, seq: seq++ };
      if (visible.length < MAX_VISIBLE) {
        visible.unshift(e);
        return;
      }
      if (prio === 3) {
        const w = weakest(visible);
        if (w >= 0 && visible[w]!.n.priority < 3) {
          const displaced = visible.splice(w, 1)[0]!;
          visible.unshift(e);
          if (displaced.leftMs > 0) enqueue(displaced);
          return;
        }
      }
      enqueue(e);
    },
    tick(dtMs) {
      for (let i = visible.length - 1; i >= 0; i--) {
        const e = visible[i]!;
        e.leftMs -= dtMs;
        if (e.leftMs <= 0) visible.splice(i, 1);
      }
      fill();
    },
    write(out) {
      if (out.length !== visible.length) out.length = visible.length;
      for (let i = 0; i < visible.length; i++) out[i] = visible[i]!.n;
    },
    clear() {
      visible.length = 0;
      queued.length = 0;
    },
    sizes: () => ({ visible: visible.length, queued: queued.length }),
  };
}
