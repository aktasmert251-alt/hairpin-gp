// Contract: UI screens, stores and i18n service. Implemented by: Grafik-UI (src/ui/**); I18n by Yönetici (src/core/i18n).

import type { Lang, Unsubscribe } from './common';
import type { TeamDef } from './data';
import type { EventBus, EventMap } from './events';
import type { HudModel } from './hud';
import type { GamepadApi, KeyBindingsApi, MenuInputSource, TouchApi } from './input';
import type { NetCustomTeam, NetLobbyModel, NetRoomSettings } from './net';
import type { CarRaceState, SessionConfig } from './race';
import type { SettingsStore } from './settings';

export type ScreenId = 'title' | 'mainMenu' | 'ttSetup' | 'raceConditions' | 'teamSelect' | 'raceSettings' | 'assists' | 'loading' | 'pause' | 'settings' | 'results' | 'ttResults' | 'credits'
  /** CR-NET-3 */
  | 'online' | 'lobby' | 'contact';

export type UiAction = { type: 'navigate'; to: ScreenId } | { type: 'back' } | { type: 'startTimeTrial' } | { type: 'startRace' } | { type: 'resume' }
  /** D-055: completion carries only a display state, never a server error body. */
  | { type: 'contactSend'; payload: { type: 'bug' | 'suggestion' | 'complaint' | 'other'; message: string; nickname?: string; roomCode?: string; website: string }; complete(result: 'sent' | 'unreachable' | 'rate' | 'invalid'): void }
  | { type: 'restart' } | { type: 'quitToMenu' } | { type: 'retire' } | { type: 'skipToResults' } | { type: 'toggleFullscreen' }
  /** D-028: pause → TURU YENİDEN BAŞLAT (Time Trial). */
  | { type: 'restartLap' }
  /** CR-NET-3: online flow (main.ts forwards them to the netClient). */
  | { type: 'onlineCreate'; name: string; settings: NetRoomSettings; server?: string } | { type: 'onlineJoin'; name: string; code: string; server?: string }
  /** D-052: directory requests use the same nickname/server identity as create/join. */
  | { type: 'onlineListRooms'; name: string; server?: string } | { type: 'onlineQuickJoin'; name: string; server?: string }
  | { type: 'onlineLeave' } | { type: 'onlineReady'; ready: boolean } | { type: 'onlineSetCar'; teamId: string; driverIdx: 0 | 1 }
  | { type: 'onlineSettings'; settings: NetRoomSettings } | { type: 'onlineStart' }
  /** P3 (Codex P4 CR): online results → back to the room lobby (server `backToLobby`). */
  | { type: 'onlineBackToLobby' }
  /** D-062: create / edit (null = drop) my custom team in the online lobby. */
  | { type: 'onlineSetTeam'; team: NetCustomTeam | null };

export interface Store<T> { get(): Readonly<T>; set(patch: Partial<T>): void; subscribe(cb: (v: Readonly<T>) => void): Unsubscribe }

export interface UiDeps {
  settings: SettingsStore; setup: Store<SessionConfig>; results: Store<ResultsModel>; tt: Store<TimeTrialModel>;
  loading: Store<{ progress: number; tipKey: string }>; i18n: I18n; bus: EventBus<EventMap>; dispatch(a: UiAction): void; menuInput: MenuInputSource; teams: readonly TeamDef[];
  /** Deviation from §4 (addition): key labels + rebinding for the controls screen. */
  keys: KeyBindingsApi;
  /** Gamepad (2026-10-27): pad bindings, live values and the last-used device (absent in UI mocks = keyboard only). */
  pad?: GamepadApi;
  /** Mobile (2026-11-21): touch controls + device profile (absent in UI mocks = no touch UI). */
  touch?: TouchApi;
  /** CR-NET-3: lobby state (optional until the UI mocks provide it). */
  net?: Store<NetLobbyModel>;
  /** P3 (Codex P4 CR): synchronised server time in ms (compare with NetLobbyModel.t0ServerMs for the 3-2-1); absent offline. */
  netServerNow?(): number;
}

export interface UiSystem {
  mount(root: HTMLElement, deps: UiDeps): void; show(id: ScreenId): void; hideScreens(): void; updateHud(m: HudModel): void; dispose(): void;
  /** CR-17: the visible screen, null while racing without an overlay. */
  screen(): ScreenId | null;
}

export interface ResultsModel {
  rows: { pos: number; car: number; name: string; teamId: string; totalMs: number; gapMs: number; lapsDown: number; bestLapMs: number; stops: number; penaltySec: number; points: number;
    /** CR-12 */
    status: CarRaceState['status'] }[];
  fastestCar: number;
}

export interface TimeTrialModel { laps: { n: number; ms: number; valid: boolean; sectors: [number, number, number] }[]; pbMs: number; top10: { ms: number; date: string; teamId: string }[] }

export interface I18n {
  lang(): Lang;
  setLang(l: Lang): void;
  /** `{name}` substitution; key format `<namespace>.<path>`; falls back to TR, then to the key. */
  t(key: string, params?: Record<string, string | number>): string;
}
