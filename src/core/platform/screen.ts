// Phone screen helpers (mobile, 2026-11-21): landscape check, fullscreen + orientation lock on the first tap, and a
// screen wake lock while racing. Every API is optional (desktop, iOS Safari, insecure origins): failures are silent.

/** Portrait on a touch UI = show the "rotate the device" overlay and keep the game paused behind it. */
export function needsRotate(width: number, height: number, touchUi: boolean): boolean {
  return touchUi && height > width;
}

interface FsDoc { fullscreenElement?: Element | null; webkitFullscreenElement?: Element | null }
interface FsEl { requestFullscreen?(o?: { navigationUI?: string }): Promise<void>; webkitRequestFullscreen?(): void }
interface OrientationLock { lock?(o: string): Promise<void> }

/** Fullscreen (Android Chrome; iPadOS) and a landscape lock where allowed. Call from a user gesture. */
export async function enterLandscapeFullscreen(): Promise<void> {
  if (typeof document === 'undefined') return;
  const d = document as Document & FsDoc;
  const el = document.documentElement as HTMLElement & FsEl;
  try {
    if (!d.fullscreenElement && !d.webkitFullscreenElement) {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else el.webkitRequestFullscreen?.();
    }
  } catch {
    /* not allowed (iPhone Safari has no element fullscreen) */
  }
  try {
    await (screen.orientation as unknown as OrientationLock | undefined)?.lock?.('landscape');
  } catch {
    /* lock needs fullscreen on Android and is unsupported on iOS */
  }
}

interface Sentinel { release(): Promise<void>; addEventListener?(t: string, cb: () => void): void }

/** Keeps the screen on while `want()` is true (races); re-acquired when the tab comes back (the lock drops on hide). */
export function createWakeLock(): { set(on: boolean): void; dispose(): void } {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<Sentinel> } }) : null;
  let want = false;
  let sentinel: Sentinel | null = null;
  let pending = false;
  const acquire = (): void => {
    if (!want || sentinel || pending || !nav?.wakeLock || document.visibilityState !== 'visible') return;
    pending = true;
    nav.wakeLock.request('screen').then((s) => {
      pending = false;
      if (!want) {
        void s.release().catch(() => {});
        return;
      }
      sentinel = s;
      s.addEventListener?.('release', () => {
        if (sentinel === s) sentinel = null;
      });
    }, () => {
      pending = false;
    });
  };
  const onVis = (): void => acquire();
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
  return {
    set(on) {
      want = on;
      if (on) acquire();
      else if (sentinel) {
        const s = sentinel;
        sentinel = null;
        void s.release().catch(() => {});
      }
    },
    dispose() {
      this.set(false);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    },
  };
}
