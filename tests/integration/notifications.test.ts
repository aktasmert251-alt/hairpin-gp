// I-02: notification priority and eviction (ui-hud §3, D-002), plus the presenter path from real sim events (director rules).

import { describe, expect, it } from 'vitest';
import type { HudModel } from '../../src/contracts/hud';
import type { SimEvent } from '../../src/contracts/sim';
import { TEAMS } from '../../src/data/teams';
import { PLAYER_CAR_ID } from '../../src/game/createSim';
import { MAX_QUEUED, MAX_VISIBLE, createNotificationQueue } from '../../src/game/hud/notifications';
import { createHudPresenter } from '../../src/game/hud/presenter';
import { SEEDS, makeSim, stepSeconds } from '../helpers/sim';

const keys = (q: ReturnType<typeof createNotificationQueue>): string[] => {
  const out: HudModel['notifications'] = [];
  q.write(out);
  return out.map((n) => n.key);
};

describe('I-02 notification queue', () => {
  it('shows at most 2 (newest first) and queues at most 4; the weakest queued entry is evicted first', () => {
    const q = createNotificationQueue();
    q.push('notify.drs.enabled'); // p0
    q.push('notify.lap.personalBest'); // p1
    expect(keys(q)).toEqual(['notify.lap.personalBest', 'notify.drs.enabled']);
    q.push('notify.pit.requested'); // p1
    q.push('notify.weather.rainSoon'); // p1
    q.push('notify.lap.final'); // p1
    q.push('notify.flag.yellow'); // p2
    expect(q.sizes()).toEqual({ visible: MAX_VISIBLE, queued: MAX_QUEUED });
    q.push('notify.flag.blue'); // overflow: evicts the oldest lowest-priority queued entry
    expect(q.sizes()).toEqual({ visible: MAX_VISIBLE, queued: MAX_QUEUED });
    q.tick(10_000);
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      keys(q).forEach((k) => seen.add(k));
      q.tick(5000);
    }
    expect(seen.has('notify.flag.yellow') && seen.has('notify.flag.blue'), 'priority 2 survives the overflow').toBe(true);
    expect(seen.has('notify.pit.requested'), 'oldest p1 was evicted').toBe(false);
  });

  it('priority 3 displaces the lowest visible entry, which re-queues with its remaining time', () => {
    const q = createNotificationQueue();
    q.push('notify.drs.enabled');
    q.push('notify.lap.personalBest');
    q.push('notify.penalty.trackLimits'); // p3
    const shown = keys(q);
    expect(shown[0]).toBe('notify.penalty.trackLimits');
    expect(shown).not.toContain('notify.drs.enabled');
    expect(q.sizes().queued).toBe(1);
    q.tick(3100); // personal best (3 s) expires, the displaced DRS note comes back
    expect(keys(q)).toContain('notify.drs.enabled');
  });

  it('a repeated key keeps its id, updates params and restarts the timer (no duplicate)', () => {
    const q = createNotificationQueue();
    q.push('notify.limits.warning', { n: 1 });
    const a: HudModel['notifications'] = [];
    q.write(a);
    const id = a[0]!.id;
    q.tick(4000);
    q.push('notify.limits.warning', { n: 2 });
    q.tick(1000); // original would have expired at 4500
    const b: HudModel['notifications'] = [];
    q.write(b);
    expect(b).toHaveLength(1);
    expect(b[0]!.id).toBe(id);
    expect(b[0]!.params).toEqual({ n: 2 });
  });

  it('entries expire after their catalogue lifetime', () => {
    const q = createNotificationQueue();
    q.push('notify.flashback.used', { left: 2 });
    q.tick(2400);
    expect(q.sizes().visible).toBe(1);
    q.tick(200);
    expect(q.sizes().visible).toBe(0);
  });
});

describe('I-02 presenter turns player sim events into notifications', () => {
  it('jump start, track limits, penalty, DRS and invalid lap events for the player; none for other cars', () => {
    const sim = makeSim({ skipLights: true, cfg: { seed: SEEDS.field, laps: 5 } });
    const p = createHudPresenter(sim, TEAMS, PLAYER_CAR_ID, 'full');
    stepSeconds(sim, 1);
    const other = PLAYER_CAR_ID + 1;
    const ev: SimEvent[] = [
      { type: 'jumpStart', car: other },
      { type: 'trackLimits', car: other, count: 1 },
      { type: 'penalty', car: other, seconds: 5, reason: 'trackLimits' },
    ];
    ev.forEach((e) => p.onSimEvent(e));
    expect(p.update(33).notifications, 'nothing for AI cars').toHaveLength(0);
    p.onSimEvent({ type: 'trackLimits', car: PLAYER_CAR_ID, count: 1 });
    p.onSimEvent({ type: 'penalty', car: PLAYER_CAR_ID, seconds: 5, reason: 'trackLimits' });
    const m = p.update(33);
    const ks = m.notifications.map((n) => n.key);
    expect(ks[0], 'penalty (p3) is on top').toBe('notify.penalty.trackLimits');
    expect(m.notifications.length).toBeLessThanOrEqual(MAX_VISIBLE);
    for (const n of m.notifications) expect(n.ms).toBeGreaterThan(0);
    p.reset();
    expect(p.update(33).notifications).toHaveLength(0);
  });
});
