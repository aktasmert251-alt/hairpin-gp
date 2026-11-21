// HudPresenter v2 + notification queue (ui-hud §1–§3, CR-05, D-002).

import { describe, expect, it } from 'vitest';
import { SIM_DT, type SimWorld } from '../../../contracts/sim';
import { createEventBus } from '../../../core/eventBus';
import type { EventMap } from '../../../contracts/events';
import { TEAMS } from '../../../data/teams';
import { createRaceDirector } from '../../../race/director';
import { forecast } from '../../../race/index';
import { createStraightTrack, loadTrack } from '../../../track/index';
import { PLAYER_CAR_ID, createSim, defaultSessionConfig } from '../../createSim';
import { createNotificationQueue } from '../notifications';
import { createHudPresenter } from '../presenter';

describe('notification queue (D-002)', () => {
  it('a repeated key keeps its id, updates params and restarts the timer', () => {
    const q = createNotificationQueue();
    const out: { id: number; key: string; ms: number; params: Record<string, string | number> }[] = [];
    q.push('notify.limits.warning', { n: 1 });
    q.write(out as never);
    const id = out[0]!.id;
    expect(out[0]!.ms).toBe(4500);
    q.tick(4000);
    q.push('notify.limits.warning', { n: 2 });
    q.tick(4000); // would have expired without the restart
    q.write(out as never);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(id);
    expect(out[0]!.params.n).toBe(2);
    q.tick(600);
    q.write(out as never);
    expect(out).toHaveLength(0);
  });

  it('≤ 2 visible, ≤ 4 queued (weakest dropped), priority 3 displaces and the displaced entry re-queues', () => {
    const q = createNotificationQueue();
    const out: { key: string; priority: number }[] = [];
    q.push('notify.drs.enabled'); // prio 0
    q.push('notify.lap.final'); // prio 1
    q.push('notify.car.reset'); // 1, queued
    q.push('notify.flag.yellow'); // 2, queued
    q.push('notify.weather.drying'); // 1, queued
    q.push('notify.flag.blue'); // 2, queued (4)
    q.push('notify.racingLine.mode'); // 0 → queue overflows, the weakest (this prio-0 entry) is dropped
    expect(q.sizes()).toEqual({ visible: 2, queued: 4 });
    q.push('notify.penalty.cornerCut'); // prio 3 → displaces drs.enabled (prio 0), which re-queues
    q.write(out as never);
    expect(out.map((x) => x.key)).toEqual(['notify.penalty.cornerCut', 'notify.lap.final']);
    expect(q.sizes().queued).toBe(4);
    q.tick(3000); // lap.final (3 s) expires → highest-priority waiting entry comes in
    q.write(out as never);
    expect(out.map((x) => x.priority)).toEqual([2, 3]);
  });
});

function scripted(world: SimWorld): { tick(progA: number, progB: number): void } {
  const dir = createRaceDirector();
  const len = world.static.track.query.length;
  const set = (car: number, prog: number): void => {
    const v = world.state.cars[car]!.vehicle;
    v.lapWraps = Math.floor(prog / len);
    v.s = prog - v.lapWraps * len;
  };
  return {
    tick(a, b) {
      set(0, a);
      set(1, b);
      world.state.tick++;
      world.state.time += SIM_DT;
      dir.step(world, SIM_DT);
    },
  };
}

describe('HudPresenter v2', () => {
  it('race delta against the best lap (deltaRef best), notifications from sim events via the bus', () => {
    const sim = createSim(defaultSessionConfig({ aiCount: 1, laps: 5, gridPos: 1 }), { track: createStraightTrack(1000), skipLights: true });
    const w = sim.world;
    w.events.drain(() => {});
    const bus = createEventBus<EventMap>();
    const hud = createHudPresenter(sim, TEAMS, PLAYER_CAR_ID, 'full', { bus, forecast });
    w.state.cars[0]!.race.progress = 0;
    w.state.cars[1]!.race.progress = -3000;
    const s = scripted(w);
    let prog = 0;
    let deltaSeen: number | null = null;
    for (let i = 0; i < 240 * 60; i++) {
      const lap = Math.floor(prog / 1000);
      prog += (lap >= 2 ? 45 : 50) * SIM_DT; // lap 3 is slower than lap 2
      s.tick(prog, -3000);
      w.events.drain((e) => hud.onSimEvent(e));
      if (i % 8 === 0) {
        const m = hud.update(1000 / 30);
        if (lap === 2 && prog % 1000 > 500 && m.timing.deltaMs !== null && deltaSeen === null) {
          expect(m.timing.deltaRef).toBe('best');
          deltaSeen = m.timing.deltaMs;
        }
      }
      if (lap >= 3) break;
    }
    // Half a lap at 45 vs 50 m/s: 500/45 − 500/50 ≈ 1.11 s behind (10 m marker resolution).
    expect(deltaSeen).not.toBeNull();
    expect(deltaSeen!).toBeGreaterThan(900);
    expect(deltaSeen!).toBeLessThan(1300);
    hud.onSimEvent({ type: 'jumpStart', car: 0 });
    hud.onSimEvent({ type: 'drsEnabled' });
    const m = hud.update(10);
    expect(m.notifications.map((x) => x.key)).toContain('notify.start.jumpStart');
    expect(m.notifications.every((x) => x.ms > 0)).toBe(true);
    expect(m.notifications.find((x) => x.key === 'notify.start.jumpStart')!.priority).toBe(3);
    // pit-weather §5: horizons beyond the remaining session + 5 min drop (minimum two).
    expect(m.mfd.forecast.length).toBeGreaterThanOrEqual(2);
    expect(m.mfd.forecast.length).toBeLessThanOrEqual(4);
    expect(m.penalty.toServeSec).toBe(0);
    hud.dispose();
  });

  it('update() ≤ 1 ms mean and < 64 KB heap growth over 1,000 updates (20 cars, İstanbul)', () => {
    const sim = createSim(defaultSessionConfig({ aiCount: 19 }), { track: loadTrack(), skipLights: true });
    for (let i = 0; i < 240 * 5; i++) sim.step();
    sim.world.events.drain(() => {});
    const hud = createHudPresenter(sim, TEAMS, PLAYER_CAR_ID, 'full', { forecast });
    for (let i = 0; i < 200; i++) hud.update(33);
    const gc = (globalThis as { gc?: () => void }).gc;
    gc?.();
    const h0 = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) hud.update(33);
    const mean = (performance.now() - t0) / 1000;
    gc?.();
    const grow = process.memoryUsage().heapUsed - h0;
    expect(mean).toBeLessThan(1);
    if (gc) expect(grow).toBeLessThan(64 * 1024);
  });
});
