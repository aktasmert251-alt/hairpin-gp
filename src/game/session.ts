// Session controller (YÖN): builds the sim and every presentation module from the module factories,
// drives the §3.2 frame order through the core loop, attaches the session half of window.__APEX__ and
// disposes everything cleanly (the renderer itself is owned by the caller and survives the session).

import type { AudioSystem } from '../contracts/audio';
import type { CameraId, Unsubscribe } from '../contracts/common';
import type { ConditionsFrame } from '../contracts/conditions';
import type { TeamDef } from '../contracts/data';
import type { LaunchParams, RaceInfo, Telemetry } from '../contracts/debug';
import type { GamepadApi, TouchApi } from '../contracts/input';
import type { EventBus, EventMap } from '../contracts/events';
import type { HudModel } from '../contracts/hud';
import type { SessionConfig } from '../contracts/race';
import type { GraphicsSystem, ListenerPose, RenderContext, ViewId } from '../contracts/render';
import type { SimEvent, SimRunner } from '../contracts/sim';
import type { DriverControls } from '../contracts/vehicle';
import type { I18n, ResultsModel, Store, TimeTrialModel, UiSystem } from '../contracts/ui';
import type { Settings, SettingsStore } from '../contracts/settings';
import type { AssetLoader } from '../contracts/render';
import type { SessionUiState } from '../core/appState';
import type { ApexController } from '../core/debug/apexApi';
import type { InputManager } from '../core/input/InputManager';
import { createLoop, type Loop } from '../core/loop';
import { SIM_HZ } from '../contracts/sim';
import { createCameraRig, createCarVisuals, createRacingLineVisual, createVfx } from '../graphics/index';
import { applyConditionsOverride, conditionsFrame, forecast } from '../race/index';
import { retireCar } from '../race/penalties';
import { RESULTS_AFTER_PLAYER_FINISH_S } from '../race/rules';
import { buildEnvironment } from '../track/index';
import { PERFECT_PROFILE, PLAYER_CAR_ID, createSim } from './createSim';
import { createFlashbackController } from './flashback';
import { createMfdController } from './strategy';
import { createTimeTrial } from './timeTrial';
import { createHudPresenter } from './hud/presenter';
import { SAFETY_CAR_TEAM, createRenderFrameBuilder, type CarStaticSpec } from './renderFrame';
import { buildResults } from './results';
import { latchPlayerControls, type LatchedSettings } from './sim/latchControls';
import { teleportCar } from './sim/teleport';
import { createReplayRecorder } from './replay/index';
import type { ReplayData } from '../contracts/replay';
import type { OnlineRace } from './net/onlineSession';

export interface SessionServices {
  bus: EventBus<EventMap>;
  input: InputManager;
  settings: SettingsStore;
  i18n: I18n;
  assets: AssetLoader;
  apex: ApexController;
  launch: LaunchParams;
  teams: readonly TeamDef[];
  /** Gamepad (2026-10-27): rumble + hot-unplug pause; absent = keyboard only. */
  pad?: GamepadApi;
  /** Mobile (2026-11-21): light haptic taps on kerbs / contact while touch drives; absent = none. */
  touch?: TouchApi;
}

export interface SessionView {
  graphics: GraphicsSystem;
  ctx: RenderContext;
  audio: AudioSystem;
  /** HUD target (null = no HUD). */
  ui: UiSystem | null;
  /** Parent for the F8 debug overlay (null = none). */
  overlayRoot: HTMLElement | null;
}

export interface SessionOptions {
  skipLights?: boolean;
  onProgress?(p: number, stage: string): void;
  /** true: start() drives frames from renderer.setAnimationLoop; false: the caller calls advance(dt). */
  ownLoop: boolean;
  autoPause: boolean;
  /** No sim time advance (deterministic shots); frames still render. */
  freeze?: boolean;
  /** Sim seconds to run synchronously before the first frame (sandbox `t`). */
  fastForwardS?: number | null;
  camera?: CameraId;
  /** Initial view of any kind (launch `cam`, CR-02); non-driving views need CameraRig.setView. */
  view?: ViewId;
  /** Teleport the player to this s at start (launch param `s`). */
  startS?: number | null;
  debugOverlay?: boolean;
  timeScale?: number;
  /** Mark __APEX__.sceneReady after the second rendered frame (main flow); sandbox router does it itself. */
  markSceneReady?: boolean;
  onPauseChange?(paused: boolean): void;
  /** Time Trial: PB / laps / top 10 store for the UI (rules §10). */
  ttStore?: Store<TimeTrialModel>;
  /** CR-18: record a replay (also on with launch `?record=1`). */
  record?: boolean;
  /**
   * Online race glue (design §5): lineup with puppets, puppet writer before each tick, own state after ticks, loop slaved to the
   * server clock, server standings/results. Online the pause is an overlay (the race keeps running with neutral controls),
   * flashback / restart / debug cheats are off.
   */
  online?: OnlineRace;
}

export interface Session {
  readonly sim: SimRunner;
  readonly cfg: SessionConfig;
  readonly playerId: number;
  readonly loop: Loop;
  uiState(): SessionUiState;
  start(): void;
  advance(dtSec: number): void;
  pause(): void;
  resume(): void;
  /** Resolves after the first rendered session frame. */
  firstFrame(): Promise<void>;
  onFinished(cb: () => void): Unsubscribe;
  results(): ResultsModel;
  /** Rules §9: the player retires (status dnf, `retired` event); the caller then shows the projected results. */
  retire(): void;
  hud(): HudModel;
  /** D-028: Time Trial lap restart (no-op in races). */
  restartLap(): void;
  /** CR-01/CR-18: the replay recorded so far (null when not recording). */
  replay(): ReplayData | null;
  dispose(): void;
}

const HUD_DT = 1 / 30;

/** Online pause overlay: the race runs on with the player's car off the pedals and wheel (design §5.4). */
function neutralise(c: DriverControls): void {
  c.throttle = false;
  c.brake = false;
  c.left = false;
  c.right = false;
  c.gearUpPressed = false;
  c.gearDownPressed = false;
  c.drsPressed = false;
  c.ersOvertakeHeld = false;
  c.pitLimiterPressed = false;
  c.analog = false;
  c.steerAxis = 0;
  c.throttleAxis = 0;
  c.brakeAxis = 0;
}
/** Rules §9: results 4 s after the player finishes (TV camera meanwhile). */
const FINISH_TO_RESULTS_S = RESULTS_AFTER_PLAYER_FINISH_S;
/** L1: views compiled during loading (5 driving cams + TV), each in a dry and a rain variant. */
const WARM_VIEWS: readonly ViewId[] = ['chaseFar', 'chaseNear', 'nose', 'tcam', 'cockpit', 'tv'];

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** D-020: speed FOV + camera shake follow settings.graphics.motionEffects and prefers-reduced-motion. */
export function motionEffectsOn(s: Readonly<Settings>): boolean {
  return s.graphics.motionEffects && s.ui.animations !== 'off' && !(s.ui.animations === 'auto' && prefersReducedMotion());
}

export async function createSession(cfg: SessionConfig, services: SessionServices, view: SessionView, opts: SessionOptions): Promise<Session> {
  const { bus, input, settings, i18n, assets, apex, teams } = services;
  const { ctx, graphics, audio } = view;
  let lastStage = '';
  const progress = (p: number, stage: string): void => {
    // Load profiling (P-06): one performance mark per stage, read with performance.getEntriesByType('mark').
    if (stage !== lastStage && typeof performance !== 'undefined' && typeof performance.mark === 'function') performance.mark(`apex:load:${stage}`);
    lastStage = stage;
    opts.onProgress?.(p, stage);
    bus.emit('session:loading', { progress: p, stage });
  };
  const yieldFrame = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  progress(0.05, 'sim');
  const online = opts.online ?? null;
  const sim = createSim(cfg, online ? { lineup: online.lineup, collision: online.collision } : { skipLights: opts.skipLights === true });
  const world = sim.world;
  const playerId = PLAYER_CAR_ID;
  await yieldFrame();

  progress(0.15, 'environment');
  const cond0: ConditionsFrame = conditionsFrame(world.state.conditions, 0, { tod: 'day', rain: 0, wetness: 0, lineWetness: 0, cloud: 0, time: 0 });
  const env = await buildEnvironment({
    track: world.static.track, quality: ctx.quality, conditions: cond0, ctx, assets,
    onProgress: (p) => progress(0.15 + 0.45 * p, 'environment'),
  });
  ctx.scene.add(env.root);
  graphics.setLighting(env.rig, env.envScene);

  progress(0.6, 'cars');
  const driverOf = (driverId: string): { number: number; tcam: 'black' | 'yellow' } => {
    for (const t of teams) for (const d of t.drivers) if (d.id === driverId) return d;
    return { number: 0, tcam: 'black' };
  };
  const specs: CarStaticSpec[] = world.state.cars.map((c) => {
    const d = driverOf(c.driverId);
    return { number: d.number, tcam: d.tcam };
  });
  const carVisuals = createCarVisuals();
  const tt = cfg.mode === 'timeTrial';
  const ghostSpec = tt && cfg.ghost !== 'off' ? { teamId: world.state.cars[playerId]!.teamId, spec: specs[playerId]! } : undefined;
  const visualSpecs = world.state.cars.map((c, i) => ({ id: c.id, teamId: c.teamId, number: specs[i]!.number, tcam: specs[i]!.tcam, isGhost: false }));
  if (ghostSpec) visualSpecs.push({ id: visualSpecs.length, teamId: ghostSpec.teamId, number: ghostSpec.spec.number, tcam: ghostSpec.spec.tcam, isGhost: true });
  // D-056: the safety car's render slot (hidden until it is deployed).
  const scSpec: CarStaticSpec | undefined = cfg.mode === 'race' && cfg.safetyCar !== false ? { number: 0, tcam: 'yellow' } : undefined;
  if (scSpec) visualSpecs.push({ id: visualSpecs.length, teamId: SAFETY_CAR_TEAM, number: scSpec.number, tcam: scSpec.tcam, isGhost: false });
  await carVisuals.init(ctx, visualSpecs);
  const rig = createCameraRig(ctx);
  const s0 = settings.get();
  rig.setMode(opts.camera ?? s0.camera.default);
  rig.setFovOffset(s0.graphics.fovOffset);
  if (opts.view) rig.setView(opts.view);
  // D-020 glue hooks.
  rig.setTrack(world.static.track.query);
  rig.setShake(s0.graphics.cameraShake);
  rig.setMotionEffects(motionEffectsOn(s0));
  // CR-09: `?nopost=1`.
  graphics.setPostEnabled(!services.launch.nopost);
  const latched: LatchedSettings = { steerSensitivity: s0.controls.steerSensitivity, padSpeedSteer: s0.controls.pad.speedSteer };
  const pad = services.pad;
  const touch = services.touch;
  if (rig.mode() === 'cockpit') carVisuals.setCockpitCar(playerId);
  const vfx = createVfx();
  vfx.init(ctx);
  const racingLine = createRacingLineVisual();
  racingLine.init(ctx, world.static.ai.getRacingLine());

  if (opts.startS !== null && opts.startS !== undefined) teleportCar(world, playerId, opts.startS, 0, opts.skipLights ? 60 : 0);
  if (opts.fastForwardS && opts.fastForwardS > 0) {
    const n = Math.round(opts.fastForwardS * SIM_HZ);
    for (let i = 0; i < n; i++) sim.step();
    world.events.drain(() => {});
  }

  const rf = createRenderFrameBuilder(sim, specs, playerId, world.static.ai.getProfile(playerId), ghostSpec, scSpec);
  rf.frame.racingLine.mode = s0.assists.racingLine;
  online?.bind(sim, (car) => rf.snapPrev(car));
  const hud = createHudPresenter(sim, teams, playerId, s0.hud.mode, online
    ? { bus, forecast, t: (k) => i18n.t(k), online }
    : { bus, forecast, t: (k) => i18n.t(k) });
  const timeTrial = tt && opts.ttStore
    ? createTimeTrial({
      world, playerId, store: opts.ttStore,
      setReference: (kind, m, sec) => hud.setReference(kind, m, sec),
      bestLapMarkers: () => hud.bestLapMarkers(),
    }, ghostSpec ? rf.frame.cars[rf.frame.cars.length - 1]! : null)
    : null;
  const mfd = createMfdController({ world, playerId, bus, hud: hud.model, notify: (k, p) => hud.notify(k, p) });

  // L1 warm-up: compile (and render once) every view in a dry and a rain variant so no program is created later.
  progress(0.8, 'compile');
  const startView: ViewId = rig.view();
  const warmCond = { ...rf.build(0, 0, false).conditions };
  const variants = [warmCond.rain > 0.5 ? 0 : 1, warmCond.rain];
  let warmStep = 0;
  for (const rain of variants) {
    const cf: ConditionsFrame = { ...warmCond, rain, wetness: rain > 0 ? 1 : warmCond.wetness, lineWetness: rain > 0 ? 1 : warmCond.lineWetness, cloud: rain > 0 ? 1 : warmCond.cloud };
    env.applyConditions(cf);
    for (const v of WARM_VIEWS) {
      const frame = rf.build(0, 1 / 60, false);
      Object.assign(frame.conditions, cf);
      rig.setView(v);
      carVisuals.setCockpitCar(v === 'cockpit' ? playerId : null);
      rig.update(frame, 1 / 60);
      frame.view = rig.view();
      env.update(ctx.camera, frame, 1 / 60);
      carVisuals.update(frame, ctx.camera);
      vfx.update(frame, ctx.camera, 1 / 60);
      racingLine.update(frame);
      if (graphics.warmup) await graphics.warmup(ctx.scene, ctx.camera);
      else await assets.warmup(ctx.renderer, ctx.scene, ctx.camera);
      graphics.render(frame);
      warmStep++;
      progress(0.8 + (0.2 * warmStep) / (variants.length * WARM_VIEWS.length), 'compile');
      await yieldFrame();
    }
  }
  vfx.clear();
  env.applyConditions(warmCond);
  rig.setView(startView);
  carVisuals.setCockpitCar(startView === 'cockpit' ? playerId : null);
  rf.build(0, 0, false);
  rig.update(rf.frame, 0);
  carVisuals.update(rf.frame, ctx.camera);
  progress(1, 'ready');

  // CR-01 replay recording (`?record=1` / opts.record), from the first session tick.
  const recorder = services.launch.record || opts.record ? createReplayRecorder() : null;
  recorder?.begin(world);

  // ---- runtime state ----
  let uiState: SessionUiState = 'driving';
  let disposed = false;
  let freeCam = false;
  let hudTimer = HUD_DT;
  let frames = 0;
  let finishedAt = -1;
  let finishedNotified = false;
  let finishCbs: readonly (() => void)[] = [];
  let resolveFirst: () => void = () => {};
  const firstFramePromise = new Promise<void>((r) => {
    resolveFirst = r;
  });
  const listener: ListenerPose = { px: 0, py: 0, pz: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0, vx: 0, vy: 0, vz: 0, camera: rig.mode() };

  // F8 debug overlay (dev aid; numbers only, labels through i18n).
  let debugEl: HTMLDivElement | null = null;
  let debugTimer = 0;
  const setDebug = (on: boolean): void => {
    if (on && !debugEl && view.overlayRoot) {
      debugEl = document.createElement('div');
      debugEl.style.cssText = 'position:absolute;left:12px;top:12px;padding:6px 10px;background:rgba(9,11,14,.8);color:#F2F4F7;font:13px/1.4 ui-monospace,Consolas,monospace;white-space:pre;pointer-events:none;z-index:50';
      view.overlayRoot.appendChild(debugEl);
    } else if (!on && debugEl) {
      debugEl.remove();
      debugEl = null;
    }
  };
  setDebug(opts.debugOverlay === true);

  const onSimEvent = (e: SimEvent): void => {
    recorder?.event(world, e);
    bus.emit('sim', e);
    audio.onSimEvent(e);
    vfx.onSimEvent(e);
    rig.onSimEvent(e);
    hud.onSimEvent(e);
    if (e.type === 'pit' && e.car === playerId) mfd.onPitPhase(e.phase);
    timeTrial?.onSimEvent(e);
    online?.onSimEvent(e);
    if (e.type === 'collision' && (e.a === playerId || e.b === playerId)) {
      graphics.onCollision(e.impulse);
      // Gamepad rumble: same log scale as the impact sound (200 → 0, 20 000 → 1).
      const k = Math.max(0.15, Math.min(1, Math.log10(Math.max(1, e.impulse) / 200) / 2));
      pad?.rumble(k, k * 0.6, 120 + 160 * k);
      touch?.haptic(Math.round(20 + 40 * k));
    } else if (e.type === 'kerb' && e.car === playerId) {
      pad?.rumble(0.08, e.sausage ? 0.6 : 0.35, 70);
      touch?.haptic(e.sausage ? 18 : 10);
    }
    else if (e.type === 'gear' && e.car === playerId) pad?.rumble(0, 0.12, 40);
  };

  // Settings and quality glue (D-019, D-020, CR-14).
  const unSettings = settings.subscribe((s) => {
    latched.steerSensitivity = s.controls.steerSensitivity;
    latched.padSpeedSteer = s.controls.pad.speedSteer;
    rig.setShake(s.graphics.cameraShake);
    rig.setMotionEffects(motionEffectsOn(s));
    rig.setFovOffset(s.graphics.fovOffset);
  });
  // Gamepad unplugged while it drove: offline races pause (the pause screen + toast explain); online the car coasts.
  const unPad = bus.on('input:pad', (e) => {
    if (e.kind === 'disconnected' && e.driving && !online && uiState === 'driving') session.pause();
  });
  const unQuality = bus.on('quality:changed', () => {
    carVisuals.setQuality(ctx.quality);
    vfx.setQuality(ctx.quality);
    env.setQuality(ctx.quality);
  });

  // L11: the environment follows the live conditions (10 Hz sim values; applied when they move). The PMREM
  // environment is regenerated only on big cloud / rain swings (it is the expensive part).
  const applied: ConditionsFrame = { ...rf.frame.conditions };
  const lit = { rain: applied.rain, cloud: applied.cloud };
  const syncConditions = (c: ConditionsFrame): void => {
    if (Math.abs(c.rain - applied.rain) < 0.002 && Math.abs(c.wetness - applied.wetness) < 0.002
      && Math.abs(c.lineWetness - applied.lineWetness) < 0.002 && Math.abs(c.cloud - applied.cloud) < 0.002) return;
    Object.assign(applied, c);
    env.applyConditions(c);
    if (Math.abs(c.cloud - lit.cloud) >= 0.1 || Math.abs(c.rain - lit.rain) >= 0.1) {
      lit.rain = c.rain;
      lit.cloud = c.cloud;
      graphics.setLighting(env.rig, env.envScene);
    }
  };

  /** Gamepad rumble for wheelspin / lock-up of the player's car (rate-limited inside rumble()). */
  const padSlipRumble = (): void => {
    const v = world.state.cars[playerId]!.vehicle;
    if (v.speed < 3) return;
    let lock = false;
    let spin = false;
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i]!;
      if (w.locked) lock = true;
      else if (i >= 2 && w.slipRatio > 0.25) spin = true;
    }
    if (lock) pad!.rumble(0.35, 0.2, 60);
    else if (spin) pad!.rumble(0.2, 0.3, 60);
  };

  const renderOnce = (alpha: number, dt: number): void => {
    if (uiState === 'flashback') {
      const dir = input.isHeld('menuLeft') ? -1 : input.isHeld('menuRight') ? 1 : 0;
      flashback.update(dir, dt);
    } else if (uiState === 'driving') {
      loop.timeScale = baseTimeScale * flashback.ramp(dt);
      mfd.update(dt);
    }
    const frame = rf.build(alpha, dt, uiState !== 'driving');
    syncConditions(frame.conditions);
    timeTrial?.frame(alpha);
    if (uiState === 'driving') {
      rig.setLookBack(input.isHeld('lookBack'));
      if (pad) padSlipRumble();
    }
    if (!freeCam) rig.update(frame, dt);
    frame.view = freeCam ? 'free' : rig.view();
    frame.lookBack = uiState === 'driving' && input.isHeld('lookBack');
    env.update(ctx.camera, frame, dt);
    carVisuals.update(frame, ctx.camera);
    vfx.update(frame, ctx.camera, dt);
    racingLine.update(frame);
    audio.update(frame, rig.getListener(listener), dt);
    hudTimer += dt;
    if (hudTimer >= HUD_DT) {
      const m = hud.update(hudTimer * 1000);
      hudTimer = 0;
      view.ui?.updateHud(m);
      // CR-16: the steering-wheel display shows the HUD model in cockpit view only.
      carVisuals.setWheelDisplay(frame.view === 'cockpit' ? m : null);
    }
    if (debugEl) {
      debugTimer += dt;
      if (debugTimer >= 0.25) {
        debugTimer = 0;
        const p = apex.perf.stats(graphics.getPerf());
        const v = world.state.cars[playerId]!.vehicle;
        debugEl.textContent = [
          i18n.t('common.debug.fps', { fps: p.fps.toFixed(0), p95: p.frameMsP95.toFixed(1) }),
          i18n.t('common.debug.sim', { tick: world.state.tick, overrun: loop.simOverrun }),
          i18n.t('common.debug.car', { kmh: (v.speed * 3.6).toFixed(0), gear: v.gear, s: v.s.toFixed(0) }),
        ].join('\n');
      }
    }
    graphics.render(frame);
    frames++;
    if (frames === 2) {
      if (opts.markSceneReady) apex.setSceneReady(true);
      resolveFirst();
    }
  };

  const checkFinish = (): void => {
    if (finishedNotified || cfg.mode !== 'race') return;
    const st = world.state;
    if (finishedAt < 0 && (st.cars[playerId]!.race.finished || st.race.phase === 'finished')) {
      finishedAt = st.time;
      // Rules §9: TV camera after the player finishes (falls back to chase on a rig without views).
      if (!freeCam) setCamera('tv');
    }
    // Online: the results screen waits for the server classification (design §6.3).
    if (online ? online.results() !== null && (finishedAt < 0 || st.time - finishedAt >= FINISH_TO_RESULTS_S) : finishedAt >= 0 && st.time - finishedAt >= FINISH_TO_RESULTS_S) {
      finishedNotified = true;
      bus.emit('session:ended', { reason: 'finished' });
      for (const cb of finishCbs) cb();
    }
  };

  const loop = createLoop(
    {
      pollInput: () => input.pollFrame(),
      // Online the race never stops: a pause is only an overlay (design §5.4).
      isRunning: () => (online ? !disposed && uiState !== 'flashback' : uiState === 'driving') && opts.freeze !== true,
      targetTicks: online ? () => online.targetTicks() : undefined,
      beforeTick: () => {
        rf.savePrev();
        latchPlayerControls(world, input, playerId, latched);
        mfd.latch(world.state.cars[playerId]!.controls);
        timeTrial?.beforeTick();
        if (online) {
          if (uiState === 'paused') neutralise(world.state.cars[playerId]!.controls);
          online.beforeTick();
        }
      },
      tick: () => {
        sim.step();
        recorder?.sample(world);
      },
      afterTicks: () => {
        world.events.drain(onSimEvent);
        online?.afterTicks();
        checkFinish();
      },
      frame: renderOnce,
      onAutoPause: () => {
        if (uiState === 'driving') session.pause();
      },
    },
    { autoPause: opts.autoPause, perf: apex.perf },
  );
  let baseTimeScale = opts.timeScale ?? 1;
  loop.timeScale = baseTimeScale;

  // ---- flashback (rules §11, ui-hud §5) ----
  const flashback = createFlashbackController({
    sim, playerId, bus, hud: hud.model.flashback,
    onRestored(kind) {
      rf.savePrev();
      if (kind === 'apply') {
        vfx.clear();
        hud.reset();
        timeTrial?.onRestored();
        recorder?.truncate(world.state.time);
      }
    },
  });
  const endFlashback = (): void => {
    uiState = 'driving';
    input.setContext('driving');
    audio.setPaused(false);
  };
  // UIT-08: the R press that applies the timeline is also delivered to the driving listener (context is already
  // 'driving' by then); this flag makes that listener swallow exactly that one emission instead of re-opening.
  let swallowFlashbackKey = false;
  const unFlashbackInput = input.onAction((a) => {
    if (disposed || input.context() !== 'flashback' || !flashback.isOpen()) return;
    if (a === 'menuLeft') flashback.scrub(-0.5);
    else if (a === 'menuRight') flashback.scrub(0.5);
    else if (a === 'menuConfirm' || a === 'flashback') {
      flashback.apply();
      endFlashback();
      swallowFlashbackKey = a === 'flashback';
    } else if (a === 'menuBack') {
      flashback.cancel();
      endFlashback();
    }
  });

  const DRIVING: readonly ViewId[] = ['cockpit', 'tcam', 'nose', 'chaseNear', 'chaseFar'];
  const setCamera = (view: ViewId): void => {
    freeCam = false;
    rig.setOverride(null);
    // camera:changed carries a driving CameraId; non-driving views report chaseFar.
    const id: CameraId = DRIVING.includes(view) ? (view as CameraId) : 'chaseFar';
    rig.setView(view);
    carVisuals.setCockpitCar(view === 'cockpit' ? playerId : null);
    bus.emit('camera:changed', { id });
  };

  /** Rules §10 restartLap (Backspace, pause menu D-028): Time Trial only. */
  const restartLap = (): void => {
    if (!timeTrial) return;
    timeTrial.restartLap();
    rf.snapPrev(playerId);
  };

  const unAction = input.onAction((a) => {
    if (disposed) return;
    // UIT-07: P toggles pause. In the pause context it acts exactly like Esc (menuBack: closes a dialog / sub-screen first, then resumes).
    if (a === 'pause' && input.context() === 'menu' && uiState === 'paused') {
      input.press('menuBack');
      input.release('menuBack');
      return;
    }
    if (a === 'flashback' && swallowFlashbackKey) {
      swallowFlashbackKey = false;
      return;
    }
    if (input.context() !== 'driving') return;
    switch (a) {
      case 'pause':
        session.pause();
        break;
      case 'mainMenu':
        // D-056: M opens the pause menu with its main-menu confirmation (online: the race keeps running meanwhile).
        session.pause();
        if (uiState === 'paused') bus.emit('session:quitRequest', {});
        break;
      case 'restartLap':
        restartLap();
        break;
      case 'flashback':
        if (flashback.open()) {
          mfd.close(); // QC2-13: no MFD over the flashback timeline
          uiState = 'flashback';
          input.setContext('flashback');
          audio.setPaused(true);
        } else hud.notify('notify.flashback.none');
        break;
      case 'cameraNext':
        setCamera(rig.next());
        break;
      case 'hudCycle': {
        const m = hud.model.visible === 'full' ? 'minimal' : hud.model.visible === 'minimal' ? 'off' : 'full';
        hud.setVisible(m);
        bus.emit('hud:mode', { mode: m });
        break;
      }
      case 'racingLine': {
        const cur = rf.frame.racingLine.mode;
        const m = cur === 'off' ? 'corners' : cur === 'corners' ? 'full' : 'off';
        rf.frame.racingLine.mode = m;
        bus.emit('racingLine:mode', { mode: m });
        break;
      }
      case 'mfdNext':
      case 'mfd1':
      case 'mfd2':
      case 'mfd3':
      case 'mfd4':
        mfd.onAction(a);
        break;
      case 'debugOverlay':
        setDebug(debugEl === null);
        break;
      default:
        break;
    }
  });

  const telemetry = (carId: number): Telemetry | null => {
    const c = world.state.cars[carId];
    if (!c) return null;
    return structuredClone({
      car: carId, tick: world.state.tick, time: world.state.time, kmh: c.vehicle.speed * 3.6,
      vehicle: c.vehicle, input: c.input, controls: c.controls, race: c.race,
    });
  };

  const raceInfo = (): RaceInfo => {
    const st = world.state;
    return structuredClone({
      phase: st.race.phase, raceMs: st.race.raceMs, laps: cfg.laps, mode: cfg.mode, race: st.race,
      cars: st.cars.map((c) => ({
        id: c.id, driverId: c.driverId, teamId: c.teamId, isPlayer: c.isPlayer, position: c.race.position, lapsCompleted: c.race.lapsCompleted,
        progress: c.race.progress, lastLapMs: c.race.lastLapMs, bestLapMs: c.race.bestLapMs, finished: c.race.finished, status: c.race.status,
      })),
    });
  };

  const refuseOnline = (what: string): boolean => {
    if (online) console.warn(`[__APEX__] ${what}() is off in online races`);
    return online !== null;
  };

  const detachApex = apex.attachSession({
    pause: () => session.pause(),
    resume: () => session.resume(),
    step(ticks) {
      if (refuseOnline('step')) return;
      if (uiState === 'driving' && opts.freeze !== true) {
        console.warn('[__APEX__] step() works only while paused');
        return;
      }
      loop.stepNow(Math.max(0, Math.floor(ticks)));
      renderOnce(0, 0);
    },
    setTimeScale(s) {
      if (refuseOnline('setTimeScale')) return;
      baseTimeScale = Math.max(0, s);
      loop.timeScale = baseTimeScale;
    },
    teleport(car, s, d, kmh) {
      if (refuseOnline('teleport')) return;
      teleportCar(world, car, s, d, kmh);
      rf.snapPrev(car);
    },
    setCamera,
    freeCam(pos, look) {
      freeCam = true;
      carVisuals.setCockpitCar(null);
      ctx.camera.position.set(pos.x, pos.y, pos.z);
      ctx.camera.lookAt(look.x, look.y, look.z);
    },
    setConditions(c) {
      if (refuseOnline('setConditions')) return;
      applyConditionsOverride(world.state.conditions, c);
      syncConditions(conditionsFrame(world.state.conditions, world.state.time, cond0));
    },
    setAutodrive(on) {
      if (refuseOnline('setAutodrive')) return;
      const car = world.state.cars[playerId]!;
      car.control = on ? 'ai' : 'player';
      if (on) world.static.ai.initCar(world, playerId, PERFECT_PROFILE);
    },
    getTelemetry: (car) => telemetry(car ?? playerId),
    getRace: raceInfo,
    hashState: () => sim.hash(),
    rendererPerf: () => graphics.getPerf(),
    getHud: () => hud.model,
  });

  const session: Session = {
    sim,
    cfg,
    playerId,
    loop,
    uiState: () => uiState,
    start() {
      input.setContext('driving');
      audio.setPaused(false);
      if (opts.ownLoop) loop.start(ctx.renderer);
      bus.emit('session:started', { mode: cfg.mode });
    },
    advance(dt) {
      loop.advance(dt);
    },
    pause() {
      if (disposed || uiState !== 'driving') return;
      uiState = 'paused';
      input.setContext('menu');
      if (!online) audio.setPaused(true);
      opts.onPauseChange?.(true);
    },
    resume() {
      if (disposed || uiState !== 'paused') return;
      uiState = 'driving';
      input.setContext('driving');
      audio.setPaused(false);
      opts.onPauseChange?.(false);
    },
    firstFrame: () => firstFramePromise,
    onFinished(cb) {
      finishCbs = [...finishCbs, cb];
      return () => {
        finishCbs = finishCbs.filter((f) => f !== cb);
      };
    },
    results: () => online?.results() ?? buildResults(sim, teams),
    retire() {
      if (disposed) return;
      retireCar(world, playerId);
      world.events.drain(onSimEvent);
    },
    hud: () => hud.model,
    restartLap,
    replay: () => (recorder && recorder.frameCount() > 0 ? recorder.end() : null),
    dispose() {
      if (disposed) return;
      disposed = true;
      loop.dispose();
      unAction();
      unSettings();
      unPad();
      unQuality();
      unFlashbackInput();
      hud.dispose();
      detachApex();
      setDebug(false);
      carVisuals.dispose();
      vfx.dispose();
      racingLine.dispose();
      env.dispose();
      ctx.scene.environment = null;
      ctx.renderer.renderLists.dispose();
      audio.setPaused(true);
      input.setContext('menu');
      finishCbs = [];
    },
  };
  return session;
}
