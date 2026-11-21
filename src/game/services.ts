// App services shared by main.ts and sandbox scenes: bus, settings, i18n, input, assets, quality, UI deps.

import type { CameraId, QualityId } from '../contracts/common';
import type { LaunchParams } from '../contracts/debug';
import type { NetLobbyModel } from '../contracts/net';
import type { EventMap } from '../contracts/events';
import type { SessionConfig } from '../contracts/race';
import type { QualityPreset, ViewId } from '../contracts/render';
import type { RaceTrackId } from '../contracts/track';
import type { ResultsModel, Store, TimeTrialModel, UiAction, UiDeps } from '../contracts/ui';
import { createAssetLoader, type AssetLoaderImpl } from '../core/assets/AssetLoader';
import type { ApexController } from '../core/debug/apexApi';
import { createEventBus, type EventBusImpl } from '../core/eventBus';
import { createI18n, type I18nImpl } from '../core/i18n/index';
import { createGamepadInput, type GamepadInput } from '../core/input/gamepad';
import { createTouchInput, type TouchInput } from '../core/input/touch';
import { detectDevice } from '../core/platform/device';
import { createInputManager, type InputManager } from '../core/input/InputManager';
import { bindingsForLayout, filterBindingsForLayout } from '../core/input/bindings';
import { createSettingsStore, type SettingsStoreImpl } from '../core/settings/SettingsStore';
import { createStore } from '../core/store';
import { sessionTeamChoices, setActiveCustomTeam } from '../data/customTeams';
import { QUALITY_PRESETS, mobilePreset } from '../graphics/index';
import { defaultSessionConfig } from './createSim';
import type { SessionServices } from './session';
import { storedTimeTrial } from './timeTrial';

export interface AppServices extends SessionServices {
  bus: EventBusImpl<EventMap>;
  settings: SettingsStoreImpl;
  i18n: I18nImpl;
  input: InputManager;
  /** Gamepad (2026-10-27): polled every animation frame. */
  pad: GamepadInput;
  /** Mobile (2026-11-21): touch controls, polled right after the pad. */
  touch: TouchInput;
  assets: AssetLoaderImpl;
  apex: ApexController;
  launch: LaunchParams;
  /** Quality for this run: `?quality=` wins (not saved), else the settings preset. */
  quality(): QualityPreset;
  /** The preset object for an id on this device (mobile: the phone-sized branch of the same preset). */
  presetFor(id: QualityId): QualityPreset;
  dispose(): void;
}

export function createAppServices(apex: ApexController, launch: LaunchParams): AppServices {
  const bus = createEventBus<EventMap>();
  const settings = createSettingsStore({ bus });
  // `?lang=` overrides the saved language for this run only.
  const i18n = createI18n({ lang: launch.lang ?? settings.get().lang, bus });
  const input = createInputManager({
    // Layout rule: on load the stored bindings are filtered by the saved layout (user rebinds kept).
    bindings: filterBindingsForLayout(settings.get().controls.bindings, settings.get().controls.layout),
    resetDefaults: () => bindingsForLayout(settings.get().controls.layout),
    onBindingsChanged: (b) => settings.setPath('controls.bindings', b),
    translate: (k) => i18n.t(k),
    upper: (s) => i18n.upper(s),
  });
  // Layout rule: changing "Düzen" resets controls.bindings to that layout's defaults (driving-axis rebinds are
  // lost, user rebinds made afterwards are kept as-is until the layout changes again).
  let layout = settings.get().controls.layout;
  const unsubSettings = settings.subscribe((s) => {
    if (s.controls.layout !== layout) {
      layout = s.controls.layout;
      settings.setPath('controls.bindings', bindingsForLayout(layout));
      return; // the nested change re-enters this listener and applies the new bindings
    }
    input.applyBindings(s.controls.bindings);
  });
  input.attach(window);
  void input.loadLayoutMap();
  const pad = createGamepadInput({
    input, bus, controls: () => settings.get().controls, setBindings: (b) => settings.setPath('controls.pad.bindings', b),
  });
  const device = detectDevice();
  const touch = createTouchInput({
    input, profile: device, controls: () => settings.get().controls,
    setTiltCenter: (deg) => settings.setPath('controls.touch.tiltCenter', deg),
  });
  const unPadDevice = bus.on('input:device', (e) => {
    if (e.device === 'gamepad') touch.noteOther();
  });
  const onKeyUse = (): void => {
    pad.noteKeyboard();
    touch.noteOther();
  };
  window.addEventListener('keydown', onKeyUse, true);
  let padRaf = 0;
  const padTick = (): void => {
    pad.poll();
    touch.poll();
    padRaf = requestAnimationFrame(padTick);
  };
  padRaf = requestAnimationFrame(padTick);
  const assets = createAssetLoader();
  const detachApp = apex.attachApp({ press: (a, ms) => input.press(a, ms), release: (a) => input.release(a) });
  const onResize = (): void => settings.applyViewport(window.innerHeight);
  window.addEventListener('resize', onResize);

  return {
    bus, settings, i18n, input, pad, touch, assets, apex, launch,
    get teams() { return sessionTeamChoices(); },
    quality() {
      const preset = settings.get().graphics.preset;
      const id: QualityId = launch.quality ?? (preset === 'custom' ? 'high' : preset);
      return this.presetFor(id);
    },
    presetFor(id) {
      return device.mobile ? mobilePreset(QUALITY_PRESETS[id]) : QUALITY_PRESETS[id];
    },
    dispose() {
      window.removeEventListener('resize', onResize);
      detachApp();
      unsubSettings();
      cancelAnimationFrame(padRaf);
      window.removeEventListener('keydown', onKeyUse, true);
      pad.dispose();
      unPadDevice();
      touch.dispose();
      input.dispose();
      assets.dispose();
      settings.dispose();
      bus.clear();
    },
  };
}

export interface UiStores {
  setup: Store<SessionConfig>;
  results: Store<ResultsModel>;
  tt: Store<TimeTrialModel>;
  loading: Store<{ progress: number; tipKey: string }>;
}

export const LOADING_TIPS = ['loading.tips.gears', 'loading.tips.camera', 'loading.tips.pause'] as const;

/** `trackId`: the launch track (`?track=`, already resolved); seeds the setup store and the info-card PB. */
export function createUiStores(trackId: RaceTrackId = 'istanbul'): UiStores {
  return {
    setup: createStore(defaultSessionConfig({ trackId })),
    results: createStore<ResultsModel>({ rows: [], fastestCar: -1 }),
    tt: createStore<TimeTrialModel>(storedTimeTrial(trackId)),
    loading: createStore({ progress: 0, tipKey: LOADING_TIPS[0] as string }),
  };
}

/** `online` (multiplayer P3): the lobby store the netClient drives and the synchronised server clock. */
export function createUiDeps(
  s: AppServices, stores: UiStores, dispatch: (a: UiAction) => void, online?: { net: Store<NetLobbyModel>; serverNow(): number },
): UiDeps {
  const deps: UiDeps = {
    settings: s.settings, setup: stores.setup, results: stores.results, tt: stores.tt, loading: stores.loading,
    i18n: s.i18n, bus: s.bus, dispatch, menuInput: s.input, teams: s.teams, keys: s.input, pad: s.pad, touch: s.touch,
  };
  if (online) {
    deps.net = online.net;
    deps.netServerNow = online.serverNow;
  }
  return deps;
}

const DRIVING_CAMS: readonly ViewId[] = ['cockpit', 'tcam', 'nose', 'chaseNear', 'chaseFar'];

/** Called at the session boundary; online sessions keep the stock roster. */
export const prepareTeamPresentation = setActiveCustomTeam;

/** Driving camera for a launch `cam` (CR-02 ViewId); other views go through CameraRig.setView when available. */
export function drivingCamFor(view: ViewId | null): CameraId | undefined {
  return view !== null && DRIVING_CAMS.includes(view) ? (view as CameraId) : undefined;
}

/** Visibility auto-pause: on unless driven by automation (navigator.webdriver), `?autopause=` overrides. */
export function autoPauseFor(launch: LaunchParams): boolean {
  return launch.autopause ?? !(typeof navigator !== 'undefined' && navigator.webdriver === true);
}
