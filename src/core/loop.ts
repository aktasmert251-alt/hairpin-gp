// Main loop and fixed timestep (§3.2): 240 Hz sim, at most 12 ticks per frame, interpolation alpha,
// driven by renderer.setAnimationLoop (or advanced manually by a sandbox scene / test).

import { SIM_DT } from '../contracts/sim';
import type { PerfRecorder } from './perf';

export const MAX_TICKS_PER_FRAME = 12;
export const MAX_FRAME_DT = 0.1;
/** CR-NET-7: tick cap per frame while slaved to the server clock (≈ 0.2 s of sim per frame, so a stalled tab catches up). */
export const MAX_TARGET_TICKS = 48;
/** Tolerance so that e.g. 1/60 s reliably yields 4 ticks despite float rounding. */
const ACC_EPS = 1e-9;

export interface LoopHooks {
  /** Once per frame, before ticking (input.pollFrame()). */
  pollInput?(): void;
  /** True while a session is running and not paused. */
  isRunning(): boolean;
  /** Before every tick: save the previous pose and latch DriverControls. */
  beforeTick(): void;
  /** One fixed sim step. */
  tick(): void;
  /**
   * CR-NET-7 (online clock slaving): ticks the sim is behind the shared clock, e.g. `(serverNow − T0) / SIM_DT − state.tick`
   * (fractional allowed). The loop runs floor(clamp(v, 0, MAX_TARGET_TICKS)) ticks this frame, uses the fraction as `alpha` and
   * ignores the accumulator and timeScale. `null` (or no hook) = the normal accumulator path.
   */
  targetTicks?(): number | null;
  /** After the tick batch (may be 0 ticks): drain sim events to the bus. */
  afterTicks?(ticks: number): void;
  /** Presentation: build the RenderFrame with `alpha`, update camera/env/cars/vfx/audio/HUD, render. */
  frame(alpha: number, frameDt: number): void;
  /** Tab hidden or window blurred (only when auto-pause is enabled). */
  onAutoPause?(reason: 'hidden' | 'blur'): void;
}

/** Structural subset of THREE.WebGLRenderer. */
export interface AnimationDriver { setAnimationLoop(cb: ((time: number) => void) | null): void }

export interface LoopOptions {
  maxTicks?: number;
  /** Listen to visibilitychange / blur and call hooks.onAutoPause. */
  autoPause?: boolean;
  perf?: PerfRecorder;
}

export interface Loop {
  /** Starts driving the loop from `driver.setAnimationLoop`. */
  start(driver: AnimationDriver): void;
  stop(): void;
  running(): boolean;
  /** Advances by a wall-clock delta in seconds (clamped to [0, 0.1]); used by external drivers and tests. */
  advance(dtSec: number): void;
  /** Advances using an absolute timestamp in ms (first call yields dt = 0). */
  frameAt(nowMs: number): void;
  /** Runs `n` ticks immediately, even while paused (debug `__APEX__.step`). */
  stepNow(n: number): void;
  resetAccumulator(): void;
  timeScale: number;
  readonly simOverrun: number;
  readonly totalTicks: number;
  readonly lastTicks: number;
  readonly accumulator: number;
  readonly alpha: number;
  dispose(): void;
}

export function createLoop(hooks: LoopHooks, opts: LoopOptions = {}): Loop {
  const maxTicks = opts.maxTicks ?? MAX_TICKS_PER_FRAME;
  let acc = 0;
  let alpha = 0;
  let lastNow = -1;
  let simOverrun = 0;
  let totalTicks = 0;
  let lastTicks = 0;
  let driver: AnimationDriver | null = null;
  let detachVisibility: (() => void) | null = null;

  const advance = (dtSec: number, rawMs: number): void => {
    const frameDt = dtSec > MAX_FRAME_DT ? MAX_FRAME_DT : dtSec > 0 ? dtSec : 0;
    hooks.pollInput?.();
    let n = 0;
    let overrun = false;
    const target = hooks.isRunning() && hooks.targetTicks ? hooks.targetTicks() : null;
    if (target !== null) {
      const t = target > MAX_TARGET_TICKS ? MAX_TARGET_TICKS : target > 0 ? target : 0;
      const want = Math.floor(t + ACC_EPS);
      while (n < want) {
        hooks.beforeTick();
        hooks.tick();
        n++;
      }
      overrun = target >= MAX_TARGET_TICKS + 1;
      if (overrun) simOverrun++;
      acc = 0;
      alpha = t - want > 0 ? t - want : 0;
    } else if (hooks.isRunning()) {
      acc += frameDt * loop.timeScale;
      while (acc >= SIM_DT - ACC_EPS && n < maxTicks) {
        hooks.beforeTick();
        hooks.tick();
        acc -= SIM_DT;
        n++;
      }
      if (acc < 0) acc = 0;
      if (acc >= SIM_DT - ACC_EPS) {
        // Cap hit: drop the backlog so the game slows down instead of spiralling.
        acc = 0;
        simOverrun++;
        overrun = true;
      }
      alpha = acc / SIM_DT;
    }
    lastTicks = n;
    totalTicks += n;
    hooks.afterTicks?.(n);
    hooks.frame(alpha > 1 ? 1 : alpha, frameDt);
    opts.perf?.record(rawMs, n, overrun);
  };

  const onAnimationFrame = (time: number): void => {
    loop.frameAt(time);
  };

  const attachVisibility = (): void => {
    if (!opts.autoPause || typeof document === 'undefined' || typeof window === 'undefined') return;
    const onVis = (): void => {
      if (document.hidden) hooks.onAutoPause?.('hidden');
    };
    const onBlur = (): void => {
      hooks.onAutoPause?.('blur');
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    detachVisibility = () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
    };
  };

  const loop: Loop = {
    timeScale: 1,
    start(d) {
      if (driver) driver.setAnimationLoop(null);
      driver = d;
      lastNow = -1;
      d.setAnimationLoop(onAnimationFrame);
    },
    stop() {
      if (driver) driver.setAnimationLoop(null);
      driver = null;
      lastNow = -1;
    },
    running: () => driver !== null,
    advance(dtSec) {
      advance(dtSec, dtSec * 1000);
    },
    frameAt(nowMs) {
      const rawMs = lastNow < 0 ? 0 : nowMs - lastNow;
      lastNow = nowMs;
      advance(rawMs / 1000, rawMs);
    },
    stepNow(n) {
      let i = 0;
      for (; i < n; i++) {
        hooks.beforeTick();
        hooks.tick();
      }
      totalTicks += i;
      hooks.afterTicks?.(i);
    },
    resetAccumulator() {
      acc = 0;
      alpha = 0;
    },
    get simOverrun() {
      return simOverrun;
    },
    get totalTicks() {
      return totalTicks;
    },
    get lastTicks() {
      return lastTicks;
    },
    get accumulator() {
      return acc;
    },
    get alpha() {
      return alpha;
    },
    dispose() {
      loop.stop();
      detachVisibility?.();
      detachVisibility = null;
    },
  };

  attachVisibility();
  return loop;
}
