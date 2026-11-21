// Contract: HUD view model (raw numbers; formatting happens in src/ui/format.ts). Produced by: Yönetici (HudPresenter); rendered by: Grafik-UI.

import type { Compound, Quad } from './common';
import type { ForecastEntry } from './conditions';
import type { CarRaceState, PitPhase, SectorStatus, SessionMode } from './race';
import type { ErsMode } from './vehicle';

export interface TowerRow {
  car: number; pos: number; code: string; teamColor: string;
  gapMs: number; lapsDown: number; compound: Compound; inPit: boolean; penaltySec: number; isPlayer: boolean; fastest: boolean; drs: boolean;
  status: CarRaceState['status'];
  /** CR-NET-5: online car link state (absent offline). */
  net?: 'ok' | 'stale' | 'dc';
  /** P3 (Codex P4 CR): the car's player ping in ms (online only, absent offline; NaN for AI cars). */
  rttMs?: number;
}

export interface HudModel {
  visible: 'full' | 'minimal' | 'off'; mode: SessionMode;
  lap: { current: number; total: number | null }; position: { pos: number; of: number } | null;
  timing: {
    curLapMs: number; lastLapMs: number; bestLapMs: number; deltaMs: number | null; invalid: boolean;
    sectors: [{ ms: number; status: SectorStatus }, { ms: number; status: SectorStatus }, { ms: number; status: SectorStatus }];
    curSector: 0 | 1 | 2;
    /** CR-05: what `deltaMs` is measured against (null = no reference yet). */
    deltaRef: 'pb' | 'best' | 'rival' | null;
  };
  tower: TowerRow[]; towerExpanded: boolean; gapMode: 'interval' | 'leader';
  car: {
    kmh: number; gear: number; rpm: number; rpmMax: number;
    /** 0..15 */
    shiftLeds: number;
    shiftNow: boolean; limiter: boolean; pitLimiter: boolean;
    throttle: number; brake: number; drs: 'off' | 'unavailable' | 'available' | 'open' | 'disabled';
    ers: { soc: number; mode: ErsMode; lapUsed: number; overtake: boolean };
    brakeBias: number;
    tyre: { compound: Compound; ageLaps: number; wear: Quad<number>; tempC: Quad<number>; state: Quad<'cold' | 'ok' | 'hot'> };
  };
  minimap: { x: Float32Array; z: Float32Array; teamColor: string[]; player: number; inPit: Uint8Array };
  startLights: { visible: boolean; lit: number; out: boolean };
  flags: { yellow: [boolean, boolean, boolean]; blue: boolean; chequered: boolean; blackWhite: boolean;
    /** D-056: safety car board ('none' / absent = no SC). */
    safetyCar?: 'none' | 'deployed' | 'ending' };
  /**
   * CR-05 / D-002: an entry lives for `ms`; a repeated `key` reuses its `id` and restarts the timer (the UI coalesces).
   * `priority` 0 = low … 3 = critical (ui-hud §3.2); higher priorities evict lower ones when the list is full.
   */
  notifications: { id: number; key: string; params: Record<string, string | number>; level: 'info' | 'warn' | 'penalty' | 'good'; ms: number; priority: 0 | 1 | 2 | 3 }[];
  /** CR-05: player penalty state (seconds still to serve at the next stop; track-limit strikes this race). */
  penalty: { toServeSec: number; trackLimitWarnings: number };
  /** CR-05: player pit state; null when the player car is on track and no stop is requested. */
  pit: { phase: PitPhase; inLane: boolean; limitKmh: number; speeding: boolean; boxDistM: number; serviceLeftS: number } | null;
  mfd: {
    open: boolean; page: 'strategy' | 'ers' | 'brakes' | 'weather' | 'tyres'; nextCompound: Compound; boxRequested: boolean; forecast: ForecastEntry[];
    /** CR-05: ERS assist decides the mode. */
    ersAuto: boolean;
    /** CR-05: estimated time lost by a stop now (s). */
    pitLossS: number;
    /** CR-05: projected position after a stop now (null = unknown, e.g. Time Trial). */
    rejoinPos: number | null;
  };
  weather: { rain: number; wetness: number; airC: number; trackC: number };
  flashback: { open: boolean; offsetSec: number; maxSec: number; left: number };
  /** D-040: the player car is going the wrong way (centred banner while true). */
  wrongWay: boolean;
  /** CR-NET-5: online link (null/absent offline; optional until the UI mocks provide it). */
  net?: { rttMs: number } | null;
}
