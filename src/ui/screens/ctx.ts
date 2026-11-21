// Screen contract inside src/ui and the context every screen receives.

import type { Lang } from '../../contracts/common';
import type { EventMap } from '../../contracts/events';
import type { HudModel } from '../../contracts/hud';
import type { ActionId } from '../../contracts/input';
import type { ScreenId, UiAction, UiDeps } from '../../contracts/ui';
import type { TFn } from '../format';

export type SoundKind = EventMap['ui:sound']['kind'];

export interface ScreenCtx {
  deps: UiDeps;
  t: TFn;
  has(key: string): boolean;
  lang(): Lang;
  upper(s: string): string;
  reduced(): boolean;
  sound(kind: SoundKind): void;
  dispatch(a: UiAction): void;
  /** Navigates through the glue (`dispatch({ type: 'navigate' })`). */
  go(id: ScreenId): void;
  track<T extends { kill(): unknown }>(tw: T): T;
  hudLast(): HudModel | null;
  /** The screen shown before the current one (settings → back target). */
  prev(): ScreenId | null;
  /** True when `id` is the current screen. Exiting screens are inert immediately, including during their fade. */
  live(id: ScreenId): boolean;
  /** Plays the intro trailer over the UI; `onDone` runs when it ended, was skipped or failed. */
  playTrailer(onDone?: () => void): void;
  /** True when the title may start the trailer now (setting on, not under automation, once per page load). */
  trailerDue(): boolean;
  markTrailerShown(): void;
}

export type Backdrop = 'showroom' | 'ink' | 'none';

export interface Screen {
  id: ScreenId;
  el: HTMLElement;
  backdrop: Backdrop;
  /** Wide scrim (setup screens) instead of the left 45 % scrim. */
  wideScrim?: boolean;
  overlay?: boolean;
  /** Elements that slide in on enter (DESIGN §7.3 screen enter). */
  animated(): HTMLElement[];
  /** List items that stagger in (≤ 8). */
  stagger?(): HTMLElement[];
  enter(from: ScreenId | null): void;
  leave(): void;
  action(a: ActionId): void;
  /** Raw keys not covered by MenuInputSource (Home/End, any key on title). Returns true when handled. */
  key?(code: string): boolean;
  render(): void;
  dispose(): void;
}
