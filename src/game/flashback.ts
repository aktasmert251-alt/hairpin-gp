// FlashbackController (YÖN glue; rules §11, ui-hud §5). Opens on R while driving, scrubs through the SnapshotSystem's
// 10 Hz × 15 s history with preview restores (no stepping, history untouched), applies with SimRunner.restore (which
// drops newer snapshots) or cancels back to the "now" snapshot. After an apply the caller ramps the time scale
// 0.25 → 1 over 0.8 s of wall-clock time (pacing only; sim results unaffected).

import type { EventBus, EventMap } from '../contracts/events';
import type { HudModel } from '../contracts/hud';
import type { SimSnapshot, SimRunner } from '../contracts/sim';
import { invalidateLap } from '../race/limits';
import { FLASHBACK_MIN_HISTORY_S, FLASHBACK_WINDOW_S } from '../race/rules';
import { deepAssign } from './sim/stateUtils';

export const FLASHBACK_TAP_S = 0.5;
export const FLASHBACK_HOLD_DELAY_S = 0.25;
export const FLASHBACK_HOLD_RATE = 5;
export const FLASHBACK_OPEN_AT_S = 3;
export const FLASHBACK_RAMP_S = 0.8;
export const FLASHBACK_RAMP_FROM = 0.25;

export interface FlashbackDeps {
  sim: SimRunner;
  playerId: number;
  bus: EventBus<EventMap>;
  /** HudModel.flashback, written in place. */
  hud: HudModel['flashback'];
  /** Called after any restore (preview, apply, cancel): reset interpolation, clear VFX, etc. */
  onRestored(kind: 'preview' | 'apply' | 'cancel'): void;
}

export interface FlashbackController {
  /** Rules §11 availability: phase running, player not finished, flashbacks left, ≥ 1 s of history. */
  available(): boolean;
  /** Opens the timeline (returns false when unavailable; the caller shows notify.flashback.none). */
  open(): boolean;
  isOpen(): boolean;
  /** Moves the offset by `ds` seconds (clamped to [−maxSec, 0], 0.1 s granularity) and preview-restores. */
  scrub(ds: number): void;
  /** Per frame while open: hold-to-scrub (`dir` −1 / 0 / +1 from the held keys), wall-clock dt in s. */
  update(dir: -1 | 0 | 1, dtWall: number): void;
  apply(): void;
  cancel(): void;
  /** Time-scale multiplier of the post-apply ramp (1 when idle); advance with wall dt. */
  ramp(dtWall: number): number;
}

export function createFlashbackController(d: FlashbackDeps): FlashbackController {
  const { sim, playerId, bus, hud } = d;
  const world = sim.world;
  let open = false;
  let now: SimSnapshot | null = null;
  let nowTime = 0;
  let offset = 0;
  let maxSec = 0;
  let holdDir: -1 | 0 | 1 = 0;
  let holdT = 0;
  let rampT = FLASHBACK_RAMP_S;
  /** Allowance at open time: a preview may restore an older value (before a previous apply). */
  let leftAtOpen = 0;

  const span = (): number => {
    const h = sim.history;
    return h.count() > 0 ? world.state.time - h.oldestTime() : 0;
  };

  const available = (): boolean => {
    const st = world.state;
    const me = st.cars[playerId];
    return !!me && st.race.phase === 'running' && !me.race.finished && me.race.status === 'running' && st.race.flashbacksLeft !== 0 && span() >= FLASHBACK_MIN_HISTORY_S;
  };

  const target = (): SimSnapshot | null => sim.history.at(nowTime + offset + 1e-6);

  const preview = (): void => {
    const snap = offset >= 0 ? now : target();
    if (!snap) return;
    deepAssign(world.state, snap.state);
    d.onRestored('preview');
  };

  const setOffset = (o: number): void => {
    const c = Math.max(-maxSec, Math.min(0, Math.round(o * 10) / 10));
    if (c === offset) return;
    offset = c;
    hud.offsetSec = offset;
    preview();
  };

  const close = (): void => {
    open = false;
    now = null;
    hud.open = false;
    hud.offsetSec = 0;
    holdDir = 0;
    holdT = 0;
  };

  return {
    available,
    open() {
      if (open || !available()) return false;
      world.events.drain(() => {});
      now = sim.snapshot();
      nowTime = world.state.time;
      maxSec = Math.min(FLASHBACK_WINDOW_S, span());
      leftAtOpen = world.state.race.flashbacksLeft;
      open = true;
      offset = 0;
      hud.open = true;
      hud.maxSec = maxSec;
      hud.left = world.state.race.flashbacksLeft;
      bus.emit('flashback:open', { left: world.state.race.flashbacksLeft });
      setOffset(-Math.min(FLASHBACK_OPEN_AT_S, maxSec));
      return true;
    },
    isOpen: () => open,
    scrub(ds) {
      if (open) setOffset(offset + ds);
    },
    update(dir, dtWall) {
      if (!open) return;
      if (dir !== holdDir) {
        holdDir = dir;
        holdT = 0;
        return;
      }
      if (dir === 0) return;
      holdT += dtWall;
      if (holdT > FLASHBACK_HOLD_DELAY_S) setOffset(offset + dir * FLASHBACK_HOLD_RATE * dtWall);
    },
    apply() {
      if (!open) return;
      const snap = offset >= 0 ? null : target();
      const leftBefore = leftAtOpen;
      if (snap) sim.restore(snap);
      else if (now) deepAssign(world.state, now.state);
      world.events.drain(() => {});
      const left = leftBefore < 0 ? -1 : Math.max(0, leftBefore - 1);
      world.state.race.flashbacksLeft = left;
      const me = world.state.cars[playerId]!;
      if (world.static.config.mode === 'timeTrial') invalidateLap(world, me, 'flashback');
      close();
      hud.left = left;
      rampT = 0;
      d.onRestored('apply');
      bus.emit('flashback:applied', { toTime: world.state.time, left });
    },
    cancel() {
      if (!open) return;
      if (now) deepAssign(world.state, now.state);
      world.events.drain(() => {});
      world.state.race.flashbacksLeft = leftAtOpen;
      close();
      d.onRestored('cancel');
      bus.emit('flashback:cancel', {});
    },
    ramp(dtWall) {
      if (rampT >= FLASHBACK_RAMP_S) return 1;
      rampT = Math.min(FLASHBACK_RAMP_S, rampT + dtWall);
      return FLASHBACK_RAMP_FROM + (1 - FLASHBACK_RAMP_FROM) * (rampT / FLASHBACK_RAMP_S);
    },
  };
}
