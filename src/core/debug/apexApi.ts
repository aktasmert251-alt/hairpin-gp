// window.__APEX__ (§3.8): always present, production builds included. Installed first thing at boot.
// Session-dependent calls are delegated to handlers attached by the active session (main flow or sandbox scene).

import type { QualityId, Vec3 } from '../../contracts/common';
import type { ApexDebugApi, LaunchParams, PerfStats, RaceInfo, Telemetry } from '../../contracts/debug';
import type { AppStateId } from '../../contracts/events';
import type { HudModel } from '../../contracts/hud';
import type { ActionId } from '../../contracts/input';
import type { NetStats } from '../../contracts/net';
import type { SessionConfig } from '../../contracts/race';
import type { RendererPerf, ViewId } from '../../contracts/render';
import type { ScreenId } from '../../contracts/ui';
import { createPerfRecorder, type PerfRecorder } from '../perf';

export interface ApexSessionHandlers {
  pause(): void;
  resume(): void;
  step(ticks: number): void;
  setTimeScale(s: number): void;
  teleport(car: number, s: number, d: number, kmh: number): void;
  setCamera(id: ViewId): void;
  freeCam(pos: Vec3, look: Vec3): void;
  setConditions(c: Parameters<ApexDebugApi['setConditions']>[0]): void;
  setAutodrive(on: boolean): void;
  getTelemetry(car?: number): Telemetry | null;
  getRace(): RaceInfo | null;
  hashState(): string | null;
  rendererPerf(): RendererPerf;
  /** CR-07: latest HUD model of the session (null when no presenter). */
  getHud?(): HudModel | null;
}

export interface ApexAppHandlers {
  state(): AppStateId;
  startSession(cfg?: Partial<SessionConfig> & { skipLights?: boolean }): Promise<void>;
  setQuality(id: QualityId): void;
  press(action: ActionId, ms?: number): void;
  release(action: ActionId): void;
  /** CR-17: the visible UI screen. */
  screen(): ScreenId | null;
  /** CR-07: audio state. */
  audio(): { unlocked: boolean; voices: number };
  /** CR-18: last encoded replay. */
  lastReplay(): ArrayBuffer | null;
  /** B-6: track accessor. */
  track(): ReturnType<ApexDebugApi['track']>;
  /** CR-NET-4: online stats (absent / null offline). */
  net(): NetStats | null;
}

export interface ApexController {
  readonly api: ApexDebugApi;
  /** Shared frame recorder: whoever drives frames records into it. */
  readonly perf: PerfRecorder;
  setReady(v: boolean): void;
  setSceneReady(v: boolean): void;
  attachApp(h: Partial<ApexAppHandlers>): () => void;
  attachSession(h: ApexSessionHandlers): () => void;
  setGpu(s: string): void;
  pushError(msg: string): void;
}

declare global {
  interface Window {
    __APEX__: ApexDebugApi;
  }
}

const MAX_ERRORS = 500;
const ZERO_PERF: RendererPerf = { calls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0 };

function describe(v: unknown): string {
  if (v instanceof Error) return v.stack ?? `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/** Reads the WebGL2 renderer string via a throw-away context. */
export function probeGpu(): { webgl2: boolean; renderer: string } {
  if (typeof document === 'undefined') return { webgl2: false, renderer: 'unavailable' };
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return { webgl2: false, renderer: 'unavailable' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { webgl2: true, renderer };
  } catch {
    return { webgl2: false, renderer: 'unavailable' };
  }
}

/** CR-17: value of the focused element's closest `data-focus-id`. */
export function focusIdOf(el: Element | null): string | null {
  const host = el?.closest<HTMLElement>('[data-focus-id]');
  return host?.dataset.focusId ?? null;
}

let installed: ApexController | null = null;

/** The controller installed at boot (sandbox scenes reach it through here). Installs one on first use. */
export function apexController(launch?: LaunchParams): ApexController {
  if (installed) return installed;
  const fallback: LaunchParams = launch ?? {
    scene: null, mode: 'menu', autostart: false, autodrive: false, weather: null, tod: null, laps: null, ai: null, difficulty: null, quality: null,
    seed: null, cam: null, lang: null, team: null, tyre: null, grid: null, skipLights: false, timescale: 1, freeze: false, mute: false, debug: false,
    nopost: false, s: null, t: null, autopause: null, record: false, track: null, server: null, room: null, name: null,
  };
  return installApexApi(fallback);
}

export function installApexApi(launch: LaunchParams): ApexController {
  if (installed) return installed;
  const perf = createPerfRecorder();
  let app: Partial<ApexAppHandlers> = {};
  let session: ApexSessionHandlers | null = null;
  const waiters: { what: 'ready' | 'sceneReady'; resolve: () => void }[] = [];

  const noSession = (what: string): void => {
    console.warn(`[__APEX__] ${what}: no active session`);
  };

  const flushWaiters = (): void => {
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i]!;
      if ((w.what === 'ready' && api.ready) || (w.what === 'sceneReady' && api.sceneReady)) {
        waiters.splice(i, 1);
        w.resolve();
      }
    }
  };

  const api: ApexDebugApi = {
    ready: false,
    sceneReady: false,
    launch,
    errors: [],
    gpu: '',
    whenReady(what = 'ready') {
      if ((what === 'ready' && api.ready) || (what === 'sceneReady' && api.sceneReady)) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.push({ what, resolve }));
    },
    state: () => app.state?.() ?? 'boot',
    startSession(cfg) {
      if (!app.startSession) return Promise.reject(new Error('startSession is not available in this view'));
      return app.startSession(cfg);
    },
    pause: () => (session ? session.pause() : noSession('pause')),
    resume: () => (session ? session.resume() : noSession('resume')),
    step: (ticks) => (session ? session.step(ticks) : noSession('step')),
    setTimeScale: (s) => (session ? session.setTimeScale(s) : noSession('setTimeScale')),
    teleport: (car, s, d, kmh) => (session ? session.teleport(car, s, d, kmh) : noSession('teleport')),
    setCamera: (id) => (session ? session.setCamera(id) : noSession('setCamera')),
    freeCam: (pos, look) => (session ? session.freeCam(pos, look) : noSession('freeCam')),
    setConditions: (c) => (session ? session.setConditions(c) : noSession('setConditions')),
    setQuality: (id) => (app.setQuality ? app.setQuality(id) : console.warn('[__APEX__] setQuality unavailable')),
    setAutodrive: (on) => (session ? session.setAutodrive(on) : noSession('setAutodrive')),
    input: {
      press: (a, ms) => (app.press ? app.press(a, ms) : console.warn('[__APEX__] input unavailable')),
      release: (a) => (app.release ? app.release(a) : console.warn('[__APEX__] input unavailable')),
    },
    getTelemetry: (car) => (session ? session.getTelemetry(car) : null),
    getRace: () => (session ? session.getRace() : null),
    getPerf: (): PerfStats => perf.stats(session ? session.rendererPerf() : ZERO_PERF),
    resetPerf: () => perf.reset(),
    hashState: () => (session ? session.hashState() : null),
    getHud: () => (session?.getHud ? session.getHud() : null),
    ui: {
      screen: () => app.screen?.() ?? null,
      focusId: () => focusIdOf(typeof document === 'undefined' ? null : document.activeElement),
    },
    audio: () => app.audio?.() ?? { unlocked: false, voices: 0 },
    lastReplay: () => app.lastReplay?.() ?? null,
    track: () => app.track?.() ?? null,
    net: () => app.net?.() ?? null,
  };

  const pushError = (msg: string): void => {
    if (api.errors.length >= MAX_ERRORS) api.errors.shift();
    api.errors.push(msg);
  };

  if (typeof window !== 'undefined') {
    const original = console.error.bind(console);
    console.error = (...args: unknown[]): void => {
      pushError(args.map(describe).join(' '));
      original(...args);
    };
    window.addEventListener('error', (e) => {
      const where = e.filename ? ` (${e.filename}:${e.lineno}:${e.colno})` : '';
      pushError(`Uncaught ${e.error ? describe(e.error) : e.message}${where}`);
    });
    window.addEventListener('unhandledrejection', (e) => {
      pushError(`Unhandled rejection: ${describe(e.reason)}`);
    });
    window.__APEX__ = api;
  }

  installed = {
    api,
    perf,
    setReady(v) {
      api.ready = v;
      flushWaiters();
    },
    setSceneReady(v) {
      api.sceneReady = v;
      flushWaiters();
    },
    attachApp(h) {
      app = { ...app, ...h };
      return () => {
        for (const k of Object.keys(h) as (keyof ApexAppHandlers)[]) if (app[k] === h[k]) delete app[k];
      };
    },
    attachSession(h) {
      session = h;
      return () => {
        if (session === h) session = null;
      };
    },
    setGpu(s) {
      api.gpu = s;
    },
    pushError,
  };
  return installed;
}
