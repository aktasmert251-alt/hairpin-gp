// MFD + PlayerStrategy (YÖN glue; ui-hud §4, CR-03). Tab cycles the pages, 1–4 act on the open page, 8 s without MFD
// input closes it. Choices live in a glue-side PlayerStrategy and reach the sim through DriverControls, latched every
// tick (deterministic for replays and flashback).

import type { Compound } from '../contracts/common';
import type { EventBus, EventMap } from '../contracts/events';
import type { HudModel } from '../contracts/hud';
import type { ActionId } from '../contracts/input';
import type { SimWorld } from '../contracts/sim';
import type { DriverControls, ErsMode } from '../contracts/vehicle';
import { suggestCompound } from './hud/presenter';

export interface PlayerStrategy { ersModeSel: ErsMode | 'auto'; brakeBias: number; boxRequest: boolean; nextCompound: Compound }

type Page = HudModel['mfd']['page'];
const RACE_PAGES: readonly Page[] = ['strategy', 'ers', 'brakes', 'weather', 'tyres'];
const TT_PAGES: readonly Page[] = ['ers', 'brakes', 'weather', 'tyres'];
const COMPOUNDS: readonly Compound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];
export const MFD_AUTO_CLOSE_S = 8;
export const BIAS_MIN = 0.5;
export const BIAS_MAX = 0.7;
export const BIAS_STEP = 0.005;
export const BIAS_DEFAULT = 0.575;

const DRY_BIT: Readonly<Record<'soft' | 'medium' | 'hard', number>> = { soft: 1, medium: 2, hard: 4 };

export interface MfdDeps {
  world: SimWorld;
  playerId: number;
  bus: EventBus<EventMap>;
  /** The presenter's model (mfd.open/page, gapMode, towerExpanded are written here). */
  hud: HudModel;
  notify(key: string, params?: Record<string, string | number>): void;
}

export interface MfdController {
  readonly strategy: PlayerStrategy;
  /** Handles mfdNext / mfd1…mfd4 (driving context). Returns true when consumed. */
  onAction(a: ActionId): boolean;
  /** Wall-clock dt in s (auto close). */
  update(dtWall: number): void;
  /** Copies the strategy into the player's DriverControls (every tick, before the sim step). */
  latch(out: DriverControls): void;
  /** The glue clears the box request when the player's stop reaches `exit` (pit-weather §2.6). */
  onPitPhase(phase: string): void;
  close(): void;
}

/** ui-hud §4 suggestion incl. the two-compound rule (suggest the other dry compound when only one was used). */
export function suggestedNextCompound(world: SimWorld, playerId: number): Compound {
  const cfg = world.static.config;
  const r = world.state.cars[playerId]!.race;
  const lapsLeft = cfg.mode === 'race' ? cfg.laps - r.lapsCompleted : 99;
  let open: Compound | null = null;
  if (cfg.mandatoryStop) {
    const dry = r.compoundsUsedMask & 7;
    if (dry !== 0 && (dry & (dry - 1)) === 0) {
      const base = suggestCompound(0, lapsLeft, null);
      open = (dry & DRY_BIT[base as 'soft' | 'medium' | 'hard']) === 0 ? base : dry === DRY_BIT.hard ? 'medium' : 'hard';
    }
  }
  return suggestCompound(world.state.conditions.wetness, lapsLeft, open);
}

export function createMfdController(d: MfdDeps): MfdController {
  const { world, playerId, bus, hud } = d;
  const cfg = world.static.config;
  const me = world.state.cars[playerId]!;
  const pages = cfg.mode === 'timeTrial' ? TT_PAGES : RACE_PAGES;
  const strategy: PlayerStrategy = {
    ersModeSel: cfg.assists.ers ? 'auto' : 'medium',
    brakeBias: me.controls.brakeBias || BIAS_DEFAULT,
    boxRequest: false,
    nextCompound: me.controls.nextCompound,
  };
  let idle = 0;

  const changed = (): void => bus.emit('mfd:changed', { open: hud.mfd.open, page: hud.mfd.page });
  const touch = (): void => {
    idle = 0;
    bus.emit('ui:sound', { kind: 'toggle' });
  };

  const option = (k: 1 | 2 | 3 | 4): void => {
    switch (hud.mfd.page) {
      case 'strategy':
        if (k === 1) {
          strategy.boxRequest = !strategy.boxRequest;
          if (strategy.boxRequest) {
            strategy.nextCompound = suggestedNextCompound(world, playerId);
            d.notify('notify.pit.requested', { compound: strategy.nextCompound });
            if (me.race.penaltyToServeSec > 0) d.notify('notify.penalty.pending', { s: me.race.penaltyToServeSec });
          } else d.notify('notify.pit.cancelled', {});
        } else if (k === 2) strategy.nextCompound = COMPOUNDS[(COMPOUNDS.indexOf(strategy.nextCompound) + 1) % COMPOUNDS.length]!;
        else if (k === 3) hud.gapMode = hud.gapMode === 'interval' ? 'leader' : 'interval';
        else hud.towerExpanded = !hud.towerExpanded;
        break;
      case 'ers':
        strategy.ersModeSel = k === 1 ? 'none' : k === 2 ? 'medium' : k === 3 ? 'hotlap' : 'auto';
        break;
      case 'brakes': {
        const b = k === 1 ? strategy.brakeBias - BIAS_STEP : k === 2 ? strategy.brakeBias + BIAS_STEP : k === 3 ? BIAS_DEFAULT : strategy.brakeBias;
        strategy.brakeBias = Math.round(Math.min(BIAS_MAX, Math.max(BIAS_MIN, b)) * 1000) / 1000;
        break;
      }
      default:
        return;
    }
    touch();
  };

  const close = (): void => {
    if (!hud.mfd.open) return;
    hud.mfd.open = false;
    changed();
  };

  return {
    strategy,
    onAction(a) {
      if (a === 'mfdNext') {
        idle = 0;
        if (!hud.mfd.open) {
          hud.mfd.open = true;
          hud.mfd.page = pages[0]!;
        } else {
          const i = pages.indexOf(hud.mfd.page);
          if (i < 0 || i === pages.length - 1) hud.mfd.open = false;
          else hud.mfd.page = pages[i + 1]!;
        }
        bus.emit('ui:sound', { kind: hud.mfd.open ? 'open' : 'close' });
        changed();
        return true;
      }
      if (!hud.mfd.open) return false;
      if (a === 'mfd1') option(1);
      else if (a === 'mfd2') option(2);
      else if (a === 'mfd3') option(3);
      else if (a === 'mfd4') option(4);
      else return false;
      return true;
    },
    update(dt) {
      if (!hud.mfd.open) return;
      idle += dt;
      if (idle >= MFD_AUTO_CLOSE_S) close();
    },
    latch(out) {
      out.ersModeSel = strategy.ersModeSel;
      out.brakeBias = strategy.brakeBias;
      out.boxRequest = strategy.boxRequest;
      out.nextCompound = strategy.nextCompound;
    },
    onPitPhase(phase) {
      if (phase === 'exit') strategy.boxRequest = false;
    },
    close,
  };
}
