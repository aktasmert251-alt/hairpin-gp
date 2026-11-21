// Shared context handed to every HUD widget.

import type { Lang } from '../../contracts/common';
import type { ActionId } from '../../contracts/input';
import type { TFn } from '../format';

export interface HudCtx {
  t: TFn;
  lang(): Lang;
  units(): 'kmh' | 'mph';
  /** Current HUD unit in px (k = kView × hud.scale; 1u = k px). */
  k(): number;
  /** Effective reduced motion (DESIGN §7.5). */
  reduced(): boolean;
  /** Upper-cased key-cap label for a KeyboardEvent.code (KeyBindingsApi.label). */
  key(code: string): string;
  /** Gamepad (2026-10-27): the pad button bound to `a` while the pad is the device used last, else null (key hints). */
  padButton(a: ActionId): number | null;
  /** Mobile (2026-11-21): a tapped HUD control (MFD rows) presses this action; absent / no-op without touch. */
  act?(a: ActionId): void;
  /** Tracks GSAP tweens/timelines so dispose() can kill them. */
  track<T extends { kill(): unknown }>(tw: T): T;
}

export interface HudWidget {
  /** Re-writes static labels after a language change. */
  relabel(): void;
  dispose(): void;
}
