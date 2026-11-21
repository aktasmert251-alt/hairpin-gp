// Default key bindings (PLAN Ek D, combined layout) and per-context action sets. KeyboardEvent.code only;
// never Ctrl, Alt or Meta (Ctrl+W closes the tab and cannot be blocked).

import type { ActionId, InputContext } from '../../contracts/input';

export const ACTION_IDS: readonly ActionId[] = [
  'throttle', 'brake', 'steerLeft', 'steerRight', 'gearUp', 'gearDown', 'drs', 'ersOvertake', 'pitLimiter', 'cameraNext', 'lookBack',
  'flashback', 'pause', 'mfdNext', 'mfd1', 'mfd2', 'mfd3', 'mfd4', 'racingLine', 'hudCycle', 'restartLap', 'debugOverlay',
  'menuUp', 'menuDown', 'menuLeft', 'menuRight', 'menuConfirm', 'menuBack', 'mainMenu', 'menuTabPrev', 'menuTabNext',
];

export const ACTION_INDEX: Readonly<Record<ActionId, number>> = Object.fromEntries(
  ACTION_IDS.map((a, i) => [a, i]),
) as Record<ActionId, number>;

export const DEFAULT_BINDINGS: Readonly<Record<ActionId, readonly string[]>> = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  steerLeft: ['KeyA', 'ArrowLeft'],
  steerRight: ['KeyD', 'ArrowRight'],
  gearUp: ['KeyE'],
  gearDown: ['KeyQ'],
  drs: ['Space'],
  ersOvertake: ['KeyF'],
  pitLimiter: ['KeyL'],
  cameraNext: ['KeyC'],
  lookBack: ['KeyV'],
  flashback: ['KeyR'],
  pause: ['Escape', 'KeyP'],
  mfdNext: ['Tab'],
  mfd1: ['Digit1'],
  mfd2: ['Digit2'],
  mfd3: ['Digit3'],
  mfd4: ['Digit4'],
  racingLine: ['KeyY'],
  hudCycle: ['KeyH'],
  restartLap: ['Backspace'],
  debugOverlay: ['F8'],
  menuUp: ['ArrowUp', 'KeyW'],
  menuDown: ['ArrowDown', 'KeyS'],
  menuLeft: ['ArrowLeft', 'KeyA'],
  menuRight: ['ArrowRight', 'KeyD'],
  menuConfirm: ['Enter', 'Space', 'NumpadEnter'],
  menuBack: ['Escape', 'Backspace'],
  // D-056: M (unbound before) opens the main-menu confirmation during a race.
  mainMenu: ['KeyM'],
  // Gamepad LB / RB only (menu tab lists).
  menuTabPrev: [],
  menuTabNext: [],
};

/** Fresh mutable copy of the defaults. */
export function defaultBindings(): Record<ActionId, string[]> {
  const out = {} as Record<ActionId, string[]>;
  for (const a of ACTION_IDS) out[a] = [...DEFAULT_BINDINGS[a]];
  return out;
}

const ARROW_CODES: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const LETTER_DRIVE_CODES: ReadonlySet<string> = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
const DRIVE_AXES: ReadonlySet<ActionId> = new Set<ActionId>(['throttle', 'brake', 'steerLeft', 'steerRight']);

/** Drops the codes a layout excludes (`wasd`: arrows, `arrows`: W/A/S/D) from the four driving axes; other actions are untouched. */
export function filterBindingsForLayout(b: Readonly<Record<ActionId, readonly string[]>>, layout: 'combined' | 'wasd' | 'arrows'): Record<ActionId, string[]> {
  const out = {} as Record<ActionId, string[]>;
  for (const a of ACTION_IDS) out[a] = [...b[a]];
  if (layout === 'combined') return out;
  const drop = layout === 'wasd' ? ARROW_CODES : LETTER_DRIVE_CODES;
  for (const a of DRIVE_AXES) out[a] = out[a].filter((c) => !drop.has(c));
  return out;
}

/** Bindings for a layout: `combined` = defaults; `wasd` drops arrow codes from driving actions; `arrows` drops W/A/S/D. */
export function bindingsForLayout(layout: 'combined' | 'wasd' | 'arrows'): Record<ActionId, string[]> {
  return filterBindingsForLayout(defaultBindings(), layout);
}

const MENU_ACTIONS: readonly ActionId[] = ['menuUp', 'menuDown', 'menuLeft', 'menuRight', 'menuConfirm', 'menuBack', 'debugOverlay', 'pause', 'menuTabPrev', 'menuTabNext'];

export const CONTEXT_ACTIONS: Readonly<Record<Exclude<InputContext, 'rebind'>, readonly ActionId[]>> = {
  driving: [
    'throttle', 'brake', 'steerLeft', 'steerRight', 'gearUp', 'gearDown', 'drs', 'ersOvertake', 'pitLimiter', 'cameraNext', 'lookBack',
    'flashback', 'pause', 'mfdNext', 'mfd1', 'mfd2', 'mfd3', 'mfd4', 'racingLine', 'hudCycle', 'restartLap', 'debugOverlay', 'mainMenu',
  ],
  menu: MENU_ACTIONS,
  flashback: [...MENU_ACTIONS, 'flashback'],
};

/** Actions that auto-repeat while held in menu-like contexts. */
export const REPEATABLE_ACTIONS: ReadonlySet<ActionId> = new Set<ActionId>(['menuUp', 'menuDown', 'menuLeft', 'menuRight']);

/** Never bindable. */
export const MODIFIER_CODES: ReadonlySet<string> = new Set([
  'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'ContextMenu', 'Fn', 'FnLock',
]);

/** Reserved for the browser / rebind cancel. */
export const RESERVED_CODES: ReadonlySet<string> = new Set(['Escape', 'F5', 'F11', 'F12']);

export function sharesContext(a: ActionId, b: ActionId): boolean {
  for (const ctx of ['driving', 'menu', 'flashback'] as const) {
    const list = CONTEXT_ACTIONS[ctx];
    if (list.includes(a) && list.includes(b)) return true;
  }
  return false;
}

// ---- Gamepad (2026-10-27), W3C standard mapping button indices ----

export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, GUIDE: 16,
} as const;
export const PAD_BUTTONS = 17;

/**
 * Default pad bindings. throttle / brake read the bound buttons' analog value (RT / LT); steering is the left stick X axis
 * (steerLeft/steerRight stay empty). Menu actions are fixed (A confirm, B back, D-pad / left stick, LB / RB tabs, Start).
 */
export const DEFAULT_PAD_BINDINGS: Readonly<Record<ActionId, readonly number[]>> = {
  throttle: [PAD.RT], brake: [PAD.LT], steerLeft: [], steerRight: [],
  gearUp: [PAD.RB], gearDown: [PAD.LB], drs: [PAD.A], ersOvertake: [PAD.B], pitLimiter: [PAD.LS], cameraNext: [PAD.Y], lookBack: [PAD.VIEW],
  flashback: [PAD.RS], pause: [PAD.START], mfdNext: [PAD.RIGHT], mfd1: [PAD.X], mfd2: [PAD.UP], mfd3: [PAD.DOWN], mfd4: [PAD.LEFT],
  racingLine: [], hudCycle: [], restartLap: [], debugOverlay: [],
  menuUp: [PAD.UP], menuDown: [PAD.DOWN], menuLeft: [PAD.LEFT], menuRight: [PAD.RIGHT], menuConfirm: [PAD.A], menuBack: [PAD.B],
  mainMenu: [], menuTabPrev: [PAD.LB], menuTabNext: [PAD.RB],
};

export function defaultPadBindings(): Record<ActionId, number[]> {
  const out = {} as Record<ActionId, number[]>;
  for (const a of ACTION_IDS) out[a] = [...DEFAULT_PAD_BINDINGS[a]];
  return out;
}

/** Valid, de-duplicated pad bindings (missing actions get their defaults, the guide button is never bound). */
export function sanitizePadBindings(raw: unknown): Record<ActionId, number[]> {
  const src = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = {} as Record<ActionId, number[]>;
  for (const a of ACTION_IDS) {
    const v = src[a];
    if (!Array.isArray(v)) {
      out[a] = [...DEFAULT_PAD_BINDINGS[a]];
      continue;
    }
    const list: number[] = [];
    for (const b of v) if (Number.isInteger(b) && b >= 0 && b < PAD_BUTTONS && b !== PAD.GUIDE && !list.includes(b)) list.push(b);
    out[a] = list;
  }
  return out;
}
