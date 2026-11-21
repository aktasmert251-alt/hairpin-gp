// Contract: audio system. Implemented by: Sürüş (src/audio/**).

import type { EventBus, EventMap } from './events';
import type { ListenerPose, RenderFrame } from './render';
import type { SimEvent } from './sim';

/** All volumes 0..1. */
export interface AudioSettings { master: number; engine: number; sfx: number; ambience: number; ui: number }

export interface AudioSystem {
  init(bus: EventBus<EventMap>, s: AudioSettings): void;
  /** Resumes/creates the AudioContext; call from a user gesture (title screen key press). */
  unlock(): Promise<void>;
  isUnlocked(): boolean;
  update(frame: RenderFrame, listener: ListenerPose, dt: number): void;
  onSimEvent(e: SimEvent): void;
  setVolumes(v: AudioSettings): void;
  setPaused(p: boolean): void;
  dispose(): void;
  /** CR-07 support: active AI engine voices, for `__APEX__.audio().voices`. */
  voices(): number;
}
