// Contract: app-wide typed event bus. Implemented by: Yönetici (src/core/eventBus.ts).

import type { CameraId, Lang, QualityId, Unsubscribe } from './common';
import type { NetErrorCode, NetKickReason, NetStats } from './net';
import type { SessionMode } from './race';
import type { SimEvent } from './sim';

/** Addition: app state machine ids (§3.6). */
export type AppStateId = 'boot' | 'title' | 'menu' | 'loading' | 'session' | 'results' | 'sandbox';

/** Synchronous typed bus. Handlers run in subscription order; (un)subscribing during emit is safe. */
export interface EventBus<M> {
  on<K extends keyof M>(type: K, cb: (payload: M[K]) => void): Unsubscribe;
  off<K extends keyof M>(type: K, cb: (payload: M[K]) => void): void;
  once<K extends keyof M>(type: K, cb: (payload: M[K]) => void): Unsubscribe;
  emit<K extends keyof M>(type: K, payload: M[K]): void;
}

export interface EventMap {
  'app:state': { from: string; to: string };
  'settings:changed': { path: string };
  'lang:changed': { lang: Lang };
  'session:loading': { progress: number; stage: string };
  'session:started': { mode: SessionMode };
  'session:ended': { reason: 'finished' | 'quit' | 'restart' };
  /** D-056: the in-race main-menu shortcut: the session paused; the pause screen opens its quit confirmation. */
  'session:quitRequest': Record<string, never>;
  'sim': SimEvent;
  'camera:changed': { id: CameraId };
  'hud:mode': { mode: 'full' | 'minimal' | 'off' };
  'racingLine:mode': { mode: 'off' | 'corners' | 'full' };
  'mfd:changed': { open: boolean; page: string };
  'flashback:open': { left: number };
  'flashback:applied': { toTime: number; left: number };
  'flashback:cancel': Record<string, never>;
  'notify': { key: string; params?: Record<string, string | number>; level: 'info' | 'warn' | 'penalty' | 'good'; ms: number };
  'audio:unlocked': Record<string, never>;
  'quality:changed': { id: QualityId };
  /** CR-11: UI feedback sounds (UI → audio). */
  'ui:sound': { kind: 'move' | 'confirm' | 'back' | 'error' | 'toggle' | 'open' | 'close' };
  /** CR-15: team tile focused in the menu (drives the showroom livery). */
  'ui:focusTeam': { teamId: string };
  /** CR-NET-5 */
  'net:status': { state: NetStats['state']; rttMs: number };
  'net:error': { code: NetErrorCode };
  /** D-050: admin notice changed ('' = cleared). */
  'net:notice': { text: string };
  /** D-050: the admin kicked / banned this player (the socket is closed, no reconnect). */
  'net:kicked': { reason: NetKickReason; until: number | null };
  /** Gamepad (2026-10-27): the device the player used last (on-screen hints follow it). */
  'input:device': { device: 'keyboard' | 'gamepad' };
  /** Gamepad hot-plug and hints. 'inactive' = a pad is used while settings.controls.device is 'keyboard'; driving = it was driving. */
  'input:pad': { kind: 'connected' | 'disconnected' | 'inactive'; name: string; driving: boolean };
}
