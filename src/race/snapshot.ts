// SnapshotSystem (§3.3 #7, YÖN): 10 Hz ring buffer covering 15 s, kept outside SimState.
// Slots are primed with clones once, then refilled in place by deepAssign, so step() never allocates.

import { SIM_HZ, type SimSnapshot, type SimState, type SimSystem, type SnapshotHistory } from '../contracts/sim';
import { deepAssign } from '../game/sim/stateUtils';

export interface SnapshotRing extends SnapshotHistory {
  /** Pre-allocates every slot from a template state (call once at sim creation). */
  prime(template: SimState): void;
  record(state: SimState): void;
}

interface Slot { used: boolean; snap: SimSnapshot }

export function createSnapshotHistory(hz = 10, seconds = 15): SnapshotRing {
  const capacity = Math.round(hz * seconds);
  const slots: (Slot | null)[] = new Array<Slot | null>(capacity).fill(null);
  let head = 0; // next write position
  let count = 0;

  const slotAt = (i: number): Slot => slots[(head - count + i + capacity * 2) % capacity]!;

  const ring: SnapshotRing = {
    hz,
    capacity,
    count: () => count,
    prime(template) {
      for (let i = 0; i < capacity; i++) {
        if (!slots[i]) slots[i] = { used: false, snap: { tick: 0, time: 0, state: structuredClone(template) } };
      }
    },
    record(state) {
      let slot = slots[head];
      if (!slot) {
        slot = { used: false, snap: { tick: 0, time: 0, state: structuredClone(state) } };
        slots[head] = slot;
      } else deepAssign(slot.snap.state, state);
      slot.used = true;
      slot.snap.tick = state.tick;
      slot.snap.time = state.time;
      head = (head + 1) % capacity;
      if (count < capacity) count++;
    },
    oldestTime: () => (count > 0 ? slotAt(0).snap.time : NaN),
    newestTime: () => (count > 0 ? slotAt(count - 1).snap.time : NaN),
    at(t) {
      for (let i = count - 1; i >= 0; i--) {
        const s = slotAt(i);
        if (s.snap.time <= t + 1e-9) return s.snap;
      }
      return null;
    },
    truncateAfter(tick) {
      while (count > 0 && slotAt(count - 1).snap.tick > tick) {
        slotAt(count - 1).used = false;
        head = (head - 1 + capacity) % capacity;
        count--;
      }
    },
    clear() {
      for (const s of slots) if (s) s.used = false;
      head = 0;
      count = 0;
    },
  };
  return ring;
}

export function createSnapshotSystem(history: SnapshotRing): SimSystem {
  const every = Math.max(1, Math.round(SIM_HZ / history.hz));
  return {
    name: 'snapshot',
    step(world) {
      if (world.state.tick % every === 0) history.record(world.state);
    },
  };
}
