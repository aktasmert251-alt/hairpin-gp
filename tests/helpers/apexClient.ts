// Typed Playwright wrapper around `window.__APEX__` (contract: src/contracts/debug.ts, ARCHITECTURE §9.2).
// Every method evaluates in the page; waits use `waitForFunction` with an explicit timeout so that a stuck flow fails with a
// readable message (including the page's own `__APEX__.errors`) instead of hanging until the test timeout.

import type { Page } from '@playwright/test';
import type { CameraId, QualityId, Vec3 } from '../../src/contracts/common';
import type { ApexDebugApi, LaunchParams, PerfStats, RaceInfo, Telemetry } from '../../src/contracts/debug';
import type { AppStateId } from '../../src/contracts/events';
import type { ActionId } from '../../src/contracts/input';
import type { RacePhase, SessionConfig } from '../../src/contracts/race';
import type { HudModel } from '../../src/contracts/hud';
import type { ScreenId } from '../../src/contracts/ui';

type ApexWindow = Window & { __APEX__: ApexDebugApi };
type Api = ApexDebugApi;

export type StartSessionConfig = Parameters<Api['startSession']>[0];
export type ConditionsPatch = Parameters<Api['setConditions']>[0];

export type UrlParams = Record<string, string | number | boolean | null | undefined>;

/** Builds `/?a=1&b=x` from a record (booleans become 1/0, null/undefined are dropped). */
export function urlWith(params: UrlParams): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue;
    qs.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  const s = qs.toString();
  return s ? `/?${s}` : '/';
}

export const DEFAULT_WAIT_MS = 60_000;

export class ApexClient {
  constructor(readonly page: Page) {}

  // ---- navigation and readiness -----------------------------------------------------------------------------------------

  /** Opens `/?...` (string = path+query as is) and returns once the document has loaded. Does not wait for `ready`. */
  async goto(target: string | UrlParams): Promise<void> {
    const url = typeof target === 'string' ? target : urlWith(target);
    await this.page.goto(url, { waitUntil: 'load' });
  }

  /** `goto` followed by `whenReady(what)`. */
  async open(target: string | UrlParams, what: 'ready' | 'sceneReady' = 'sceneReady', timeoutMs = DEFAULT_WAIT_MS): Promise<void> {
    await this.goto(target);
    await this.whenReady(what, timeoutMs);
  }

  /** Resolves when `__APEX__.ready` / `.sceneReady` is true. Fails with the page errors attached after `timeoutMs`. */
  async whenReady(what: 'ready' | 'sceneReady' = 'ready', timeoutMs = DEFAULT_WAIT_MS): Promise<void> {
    await this.guarded(`__APEX__.${what}`, timeoutMs, () => this.page.waitForFunction(
      (flag) => Boolean((window as unknown as { __APEX__?: Record<string, unknown> }).__APEX__?.[flag]), what, { timeout: timeoutMs, polling: 100 },
    ));
  }

  /** Waits until two animation frames have been presented (screenshots after state changes). */
  async nextFrames(n = 2): Promise<void> {
    await this.page.evaluate((count) => new Promise<void>((resolve) => {
      let left = count;
      const step = (): void => {
        if (--left <= 0) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }), n);
  }

  async waitForState(state: AppStateId, timeoutMs = DEFAULT_WAIT_MS): Promise<void> {
    await this.guarded(`app state "${state}"`, timeoutMs, () => this.page.waitForFunction(
      (s) => (window as unknown as ApexWindow).__APEX__?.state() === s, state, { timeout: timeoutMs, polling: 100 },
    ));
  }

  /** Waits until the race phase (`getRace().phase`) equals `phase`. */
  async waitForPhase(phase: RacePhase, timeoutMs = 30_000): Promise<void> {
    await this.guarded(`race phase "${phase}"`, timeoutMs, () => this.page.waitForFunction(
      (p) => (window as unknown as ApexWindow).__APEX__?.getRace()?.phase === p, phase, { timeout: timeoutMs, polling: 100 },
    ));
  }

  /** Waits until car `car` (default: the player, id 0) has completed at least `n` laps. */
  async waitForLap(n: number, timeoutMs = 180_000, car = 0): Promise<void> {
    await this.guarded(`car ${car} completing lap ${n}`, timeoutMs, () => this.page.waitForFunction(
      (a) => {
        const c = (window as unknown as ApexWindow).__APEX__?.getRace()?.cars.find((x) => x.id === a.car);
        return c !== undefined && c.lapsCompleted >= a.n;
      },
      { n, car },
      { timeout: timeoutMs, polling: 100 },
    ));
  }

  /** Waits until `getTelemetry().kmh` is at least `kmh`. */
  async waitForSpeed(kmh: number, timeoutMs = 30_000, car = 0): Promise<void> {
    await this.guarded(`car ${car} reaching ${kmh} km/h`, timeoutMs, () => this.page.waitForFunction(
      (a) => ((window as unknown as ApexWindow).__APEX__?.getTelemetry(a.car)?.kmh ?? 0) >= a.kmh, { kmh, car }, { timeout: timeoutMs, polling: 100 },
    ));
  }

  /** Runs a wait and, on failure, reports what the page had logged so far. */
  private async guarded(what: string, timeoutMs: number, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (err) {
      const errors = await this.errors().catch(() => ['(page unavailable)']);
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}. __APEX__.errors: ${JSON.stringify(errors)}
${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ---- thin typed wrappers ------------------------------------------------------------------------------------------------

  state(): Promise<AppStateId> { return this.page.evaluate(() => (window as unknown as ApexWindow).__APEX__.state()); }
  launch(): Promise<LaunchParams> { return this.page.evaluate(() => (window as unknown as ApexWindow).__APEX__.launch); }
  isReady(): Promise<boolean> { return this.page.evaluate(() => (window as unknown as ApexWindow).__APEX__.ready); }
  isSceneReady(): Promise<boolean> { return this.page.evaluate(() => (window as unknown as ApexWindow).__APEX__.sceneReady); }

  /** `startSession` goes through `loading` and resolves after the first session frame. */
  startSession(cfg?: StartSessionConfig): Promise<void> {
    return this.page.evaluate((c) => (window as unknown as ApexWindow).__APEX__.startSession(c), cfg);
  }

  async pause(): Promise<void> { await this.page.evaluate(() => (window as unknown as ApexWindow).__APEX__.pause()); }
  async resume(): Promise<void> { await this.page.evaluate(() => (window as unknown as ApexWindow).__APEX__.resume()); }
  async step(ticks: number): Promise<void> { await this.page.evaluate((n) => (window as unknown as ApexWindow).__APEX__.step(n), ticks); }
  async setTimeScale(s: number): Promise<void> { await this.page.evaluate((v) => (window as unknown as ApexWindow).__APEX__.setTimeScale(v), s); }

  async teleport(car: number, s: number, d: number, kmh: number): Promise<void> {
    await this.page.evaluate((a) => (window as unknown as ApexWindow).__APEX__.teleport(a[0], a[1], a[2], a[3]), [car, s, d, kmh] as const);
  }
  async setCamera(id: CameraId): Promise<void> { await this.page.evaluate((v) => (window as unknown as ApexWindow).__APEX__.setCamera(v), id); }
  async freeCam(pos: Vec3, look: Vec3): Promise<void> {
    await this.page.evaluate((a) => (window as unknown as ApexWindow).__APEX__.freeCam(a.pos, a.look), { pos, look });
  }
  async setConditions(c: ConditionsPatch): Promise<void> { await this.page.evaluate((v) => (window as unknown as ApexWindow).__APEX__.setConditions(v), c); }
  async setQuality(id: QualityId): Promise<void> { await this.page.evaluate((v) => (window as unknown as ApexWindow).__APEX__.setQuality(v), id); }
  async setAutodrive(on: boolean): Promise<void> { await this.page.evaluate((v) => (window as unknown as ApexWindow).__APEX__.setAutodrive(v), on); }

  /** Synthetic input through InputManager (same latching as a key). Without `ms` the action is held until `release`. */
  async press(action: ActionId, ms?: number): Promise<void> {
    await this.page.evaluate((a) => (window as unknown as ApexWindow).__APEX__.input.press(a.action, a.ms), { action, ms });
  }
  async release(action: ActionId): Promise<void> { await this.page.evaluate((a) => (window as unknown as ApexWindow).__APEX__.input.release(a), action); }

  telemetry(car?: number): Promise<Telemetry | null> { return this.page.evaluate((c) => (window as unknown as ApexWindow).__APEX__.getTelemetry(c), car); }
  race(): Promise<RaceInfo | null> { return this.page.evaluate(() => (window as unknown as ApexWindow).__APEX__.getRace()); }
  perf(): Promise<PerfStats> { return this.page.evaluate(() => (window as unknown as ApexWindow).__APEX__.getPerf()); }
  async resetPerf(): Promise<void> { await this.page.evaluate(() => (window as unknown as ApexWindow).__APEX__.resetPerf()); }
  hashState(): Promise<string | null> { return this.page.evaluate(() => (window as unknown as ApexWindow).__APEX__.hashState()); }
  getHud(): Promise<HudModel | null> { return this.page.evaluate(() => (window as unknown as ApexWindow).__APEX__.getHud()); }
  uiScreen(): Promise<ScreenId | null> { return this.page.evaluate(() => (window as unknown as ApexWindow).__APEX__.ui.screen()); }
  focusId(): Promise<string | null> { return this.page.evaluate(() => (window as unknown as ApexWindow).__APEX__.ui.focusId()); }
  errors(): Promise<string[]> { return this.page.evaluate(() => [...((window as unknown as { __APEX__?: ApexDebugApi }).__APEX__?.errors ?? [])]); }
  gpu(): Promise<string> { return this.page.evaluate(() => (window as unknown as ApexWindow).__APEX__.gpu); }

  /** Convenience: a session config patch that matches the smoke URL flags, for `startSession`. */
  static quickRaceConfig(patch: Partial<SessionConfig> = {}): Partial<SessionConfig> & { skipLights: boolean } {
    return { mode: 'race', laps: 1, aiCount: 0, autodrive: true, skipLights: true, ...patch };
  }
}
