// Frame-time governor (mobile, 2026-11-21): when the average frame rate over a full window stays under the floor, step
// the quality down one preset (ultra → high → medium → low) for the rest of the run. Runtime only: the saved setting is
// not changed (the user's choice stays theirs), and nothing happens on desktop unless the glue enables it.

import type { QualityId } from '../../contracts/common';

const ORDER: readonly QualityId[] = ['low', 'medium', 'high', 'ultra'];

export interface GovernorOptions {
  /** Averaging window in seconds (default 5). */
  windowS?: number;
  /** Drop below this average fps (default 30). */
  minFps?: number;
  /** Seconds ignored after a start / reset / drop (shader compile, first frames). */
  settleS?: number;
}

export interface FrameGovernor {
  /** One rendered frame of `dtMs`; returns the lower preset to switch to, or null. */
  frame(dtMs: number, current: QualityId): QualityId | null;
  /** Restart measuring (new session, pause → resume, tab back in front). */
  reset(): void;
}

export function lowerQuality(id: QualityId): QualityId | null {
  const i = ORDER.indexOf(id);
  return i > 0 ? ORDER[i - 1]! : null;
}

export function createFrameGovernor(o: GovernorOptions = {}): FrameGovernor {
  const windowMs = (o.windowS ?? 5) * 1000;
  const minFps = o.minFps ?? 30;
  const settleMs = (o.settleS ?? 2) * 1000;
  let settle = settleMs;
  let sumMs = 0;
  let frames = 0;
  return {
    frame(dtMs, current) {
      // A hitch longer than 1 s is a stall (tab switch, GC, alert), not a frame rate.
      if (!(dtMs > 0) || dtMs > 1000) return null;
      if (settle > 0) {
        settle -= dtMs;
        return null;
      }
      sumMs += dtMs;
      frames++;
      if (sumMs < windowMs) return null;
      const fps = (frames * 1000) / sumMs;
      sumMs = 0;
      frames = 0;
      if (fps >= minFps) return null;
      const next = lowerQuality(current);
      if (next) settle = settleMs;
      return next;
    },
    reset() {
      settle = settleMs;
      sumMs = 0;
      frames = 0;
    },
  };
}
