// InputManager (§3.11): KeyboardEvent.code -> ActionId per context, per-tick edge latching into DriverControls,
// preventDefault on game keys, rebinding API and layout-aware key labels.

import type { Unsubscribe } from '../../contracts/common';
import type { ActionId, InputContext, KeyBindingsApi, MenuInputSource, RebindResult } from '../../contracts/input';
import type { DriverControls } from '../../contracts/vehicle';
import {
  ACTION_IDS, ACTION_INDEX, CONTEXT_ACTIONS, DEFAULT_BINDINGS, MODIFIER_CODES, REPEATABLE_ACTIONS, RESERVED_CODES, defaultBindings, sharesContext,
} from './bindings';

/** The subset of KeyboardEvent the manager needs (lets tests run without a DOM). */
export interface KeyEventLike {
  code: string;
  repeat: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
  target?: EventTarget | null;
  preventDefault(): void;
}

export interface InputManagerOptions {
  bindings?: Readonly<Record<ActionId, readonly string[]>>;
  /** Persistence hook, called after every binding change made through this manager. */
  onBindingsChanged?(b: Record<ActionId, string[]>): void;
  /** i18n lookup for named key labels (keys `common.keys.<code>`); return the key itself when missing. */
  translate?(key: string): string;
  /** Locale-aware upper-casing for single-character labels (tr-TR: i -> İ). */
  upper?(s: string): string;
  /** ms clock for synthetic press timers. */
  now?(): number;
  /** Bindings `resetBindings()` restores (default: combined layout); the app passes the current layout's defaults. */
  resetDefaults?(): Record<ActionId, string[]>;
}

export interface InputManager extends MenuInputSource, KeyBindingsApi {
  context(): InputContext;
  setContext(c: Exclude<InputContext, 'rebind'>): void;
  attach(target: Window): void;
  detach(): void;
  handleKeyDown(e: KeyEventLike): void;
  handleKeyUp(e: KeyEventLike): void;
  /** Clears held keys and pending edges (window blur). */
  releaseAll(): void;
  /** Once per frame: expires timed synthetic presses. */
  pollFrame(): void;
  /** Once per sim tick: writes DriverControls and consumes the driving edges. All false outside the driving context. */
  latch(out: DriverControls): void;
  isHeld(a: ActionId): boolean;
  /** Synthetic input (`__APEX__.input`): press = key down (+ edge); with ms > 0 it auto-releases. */
  press(a: ActionId, ms?: number): void;
  release(a: ActionId): void;
  /** Replaces all bindings without calling onBindingsChanged (e.g. settings loaded/changed elsewhere). */
  applyBindings(b: Readonly<Record<ActionId, readonly string[]>>): void;
  /** Gamepad (2026-10-27): a pad button bound to `a` went down (held + edge + listeners), as a key would. */
  padPress(a: ActionId): void;
  padRelease(a: ActionId): void;
  /** Menu auto-repeat from a held pad button: listeners only. */
  padRepeat(a: ActionId): void;
  /** Analog driving values for the next latches (already shaped); `on` false = the keyboard booleans drive. */
  setAnalog(on: boolean, steer: number, throttle: number, brake: number): void;
  /** Loads navigator.keyboard.getLayoutMap() when available (Chrome). */
  loadLayoutMap(): Promise<void>;
  dispose(): void;
}

type ActionCb = (a: ActionId) => void;
type DrivingContext = Exclude<InputContext, 'rebind'>;

const N = ACTION_IDS.length;
const I_THROTTLE = ACTION_INDEX.throttle;
const I_BRAKE = ACTION_INDEX.brake;
const I_LEFT = ACTION_INDEX.steerLeft;
const I_RIGHT = ACTION_INDEX.steerRight;
const I_GEARUP = ACTION_INDEX.gearUp;
const I_GEARDOWN = ACTION_INDEX.gearDown;
const I_DRS = ACTION_INDEX.drs;
const I_ERS = ACTION_INDEX.ersOvertake;
const I_PITLIM = ACTION_INDEX.pitLimiter;

const ARROWS: Readonly<Record<string, string>> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
const NAMED_KEYS: ReadonlySet<string> = new Set([
  'Space', 'Enter', 'NumpadEnter', 'Escape', 'Backspace', 'Tab', 'ShiftLeft', 'ShiftRight', 'CapsLock', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
]);

function isEditableTarget(t: EventTarget | null | undefined): boolean {
  if (!t || typeof (t as HTMLElement).tagName !== 'string') return false;
  const el = t as HTMLElement;
  const tag = el.tagName;
  return el.isContentEditable === true || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function createInputManager(opts: InputManagerOptions = {}): InputManager {
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const translate = opts.translate ?? ((k: string) => k);
  const upper = opts.upper ?? ((s: string) => s.toUpperCase());

  let bindings: Record<ActionId, string[]> = defaultBindings();
  const codeMaps: Record<DrivingContext, Map<string, ActionId[]>> = { driving: new Map(), menu: new Map(), flashback: new Map() };
  let ctx: InputContext = 'menu';
  let rebind: { action: ActionId; slot: number; cb: (r: RebindResult) => void; prev: DrivingContext } | null = null;

  const heldCodes = new Set<string>();
  const pending = new Uint16Array(N);
  const synthHeld = new Uint8Array(N);
  const synthReleaseAt = new Float64Array(N);
  const padHeld = new Uint8Array(N);
  const analog = { on: false, steer: 0, throttle: 0, brake: 0 };
  let listeners: readonly ActionCb[] = [];
  let layoutMap: { get(code: string): string | undefined } | null = null;
  let attached: Window | null = null;

  const rebuildMaps = (): void => {
    for (const c of ['driving', 'menu', 'flashback'] as const) {
      const m = codeMaps[c];
      m.clear();
      for (const a of CONTEXT_ACTIONS[c]) {
        for (const code of bindings[a]) {
          const list = m.get(code);
          // 'pause' exists in the menu contexts only so P can close the pause menu; a code that is already menuBack (Esc) must not also emit it.
          if (a === 'pause' && c !== 'driving' && list?.includes('menuBack')) continue;
          if (list) {
            if (!list.includes(a)) list.push(a);
          } else m.set(code, [a]);
        }
      }
    }
  };

  const sanitize = (b: Readonly<Record<ActionId, readonly string[]>>): Record<ActionId, string[]> => {
    const out = {} as Record<ActionId, string[]>;
    for (const a of ACTION_IDS) {
      const src = b[a];
      const list: string[] = [];
      if (Array.isArray(src)) {
        for (const code of src) if (typeof code === 'string' && code.length > 0 && !MODIFIER_CODES.has(code) && !list.includes(code)) list.push(code);
      } else list.push(...DEFAULT_BINDINGS[a]);
      out[a] = list;
    }
    return out;
  };

  const emit = (a: ActionId): void => {
    const ls = listeners;
    for (let i = 0; i < ls.length; i++) {
      try {
        ls[i]!(a);
      } catch (err) {
        console.error('[input] action listener threw', err);
      }
    }
  };

  const heldByKeys = (a: ActionId): boolean => {
    const codes = bindings[a];
    for (let i = 0; i < codes.length; i++) if (heldCodes.has(codes[i]!)) return true;
    return false;
  };

  const persist = (): void => {
    opts.onBindingsChanged?.(sanitize(bindings));
  };

  const finishRebind = (r: RebindResult): void => {
    const req = rebind;
    if (!req) return;
    rebind = null;
    ctx = req.prev;
    req.cb(r);
  };

  const onKeyDown = (e: KeyboardEvent): void => mgr.handleKeyDown(e);
  const onKeyUp = (e: KeyboardEvent): void => mgr.handleKeyUp(e);
  const onBlur = (): void => mgr.releaseAll();

  const mgr: InputManager = {
    context: () => ctx,
    setContext(c) {
      if (rebind) {
        rebind.prev = c;
        return;
      }
      if (c === ctx) return;
      ctx = c;
      pending.fill(0);
    },
    attach(target) {
      if (attached) mgr.detach();
      attached = target;
      target.addEventListener('keydown', onKeyDown);
      target.addEventListener('keyup', onKeyUp);
      target.addEventListener('blur', onBlur);
    },
    detach() {
      if (!attached) return;
      attached.removeEventListener('keydown', onKeyDown);
      attached.removeEventListener('keyup', onKeyUp);
      attached.removeEventListener('blur', onBlur);
      attached = null;
    },
    handleKeyDown(e) {
      if (e.isComposing) return;
      if (rebind) {
        e.preventDefault();
        if (e.repeat) return;
        const { action, slot } = rebind;
        if (e.code === 'Escape') finishRebind({ ok: false, action, reason: 'cancelled' });
        else if (e.ctrlKey || e.altKey || e.metaKey || MODIFIER_CODES.has(e.code)) finishRebind({ ok: false, action, reason: 'modifier' });
        else finishRebind(mgr.setBinding(action, slot, e.code));
        return;
      }
      // Never handle modifier combinations: browser shortcuts keep working and nothing is bound to them.
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (ctx !== 'driving' && isEditableTarget(e.target)) return;
      // A key can arrive as auto-repeat without its first keydown having been seen (held across a window blur, which
      // clears the held set, or pressed while another key's event was being handled): it still counts as held, and its
      // first event counts as a fresh press (2026-10-23, "brake not registered while steering").
      const fresh = !heldCodes.has(e.code);
      heldCodes.add(e.code);
      const actions = codeMaps[ctx as DrivingContext].get(e.code);
      if (!actions) return;
      e.preventDefault();
      for (let i = 0; i < actions.length; i++) {
        const a = actions[i]!;
        if (e.repeat && !fresh) {
          if (ctx !== 'driving' && REPEATABLE_ACTIONS.has(a)) emit(a);
          continue;
        }
        const idx = ACTION_INDEX[a];
        if (pending[idx]! < 0xffff) pending[idx]!++;
        emit(a);
      }
    },
    handleKeyUp(e) {
      heldCodes.delete(e.code);
      if (rebind) {
        e.preventDefault();
        return;
      }
      if (ctx !== 'rebind' && codeMaps[ctx].has(e.code)) e.preventDefault();
    },
    releaseAll() {
      heldCodes.clear();
      pending.fill(0);
    },
    pollFrame() {
      const t = now();
      for (let i = 0; i < N; i++) {
        const at = synthReleaseAt[i]!;
        if (at > 0 && t >= at) {
          synthReleaseAt[i] = 0;
          synthHeld[i] = 0;
        }
      }
    },
    latch(out) {
      if (ctx !== 'driving') {
        out.throttle = false; out.brake = false; out.left = false; out.right = false;
        out.gearUpPressed = false; out.gearDownPressed = false; out.drsPressed = false; out.ersOvertakeHeld = false; out.pitLimiterPressed = false;
        out.analog = false; out.steerAxis = 0; out.throttleAxis = 0; out.brakeAxis = 0;
        return;
      }
      out.throttle = mgr.isHeld('throttle') || pending[I_THROTTLE]! > 0;
      out.brake = mgr.isHeld('brake') || pending[I_BRAKE]! > 0;
      out.left = mgr.isHeld('steerLeft') || pending[I_LEFT]! > 0;
      out.right = mgr.isHeld('steerRight') || pending[I_RIGHT]! > 0;
      out.ersOvertakeHeld = mgr.isHeld('ersOvertake') || pending[I_ERS]! > 0;
      out.gearUpPressed = pending[I_GEARUP]! > 0;
      out.gearDownPressed = pending[I_GEARDOWN]! > 0;
      out.drsPressed = pending[I_DRS]! > 0;
      out.pitLimiterPressed = pending[I_PITLIM]! > 0;
      out.analog = analog.on;
      out.steerAxis = analog.on ? analog.steer : 0;
      out.throttleAxis = analog.on ? analog.throttle : 0;
      out.brakeAxis = analog.on ? analog.brake : 0;
      // Levels: a tap shorter than a tick still counts once. Edges: consume one press per tick.
      pending[I_THROTTLE] = 0;
      pending[I_BRAKE] = 0;
      pending[I_LEFT] = 0;
      pending[I_RIGHT] = 0;
      pending[I_ERS] = 0;
      if (pending[I_GEARUP]! > 0) pending[I_GEARUP]!--;
      if (pending[I_GEARDOWN]! > 0) pending[I_GEARDOWN]!--;
      if (pending[I_DRS]! > 0) pending[I_DRS]!--;
      if (pending[I_PITLIM]! > 0) pending[I_PITLIM]!--;
    },
    isHeld(a) {
      const i = ACTION_INDEX[a];
      return synthHeld[i] === 1 || padHeld[i]! > 0 || heldByKeys(a);
    },
    press(a, ms) {
      const idx = ACTION_INDEX[a];
      synthHeld[idx] = 1;
      synthReleaseAt[idx] = ms !== undefined && ms > 0 ? now() + ms : 0;
      if (pending[idx]! < 0xffff) pending[idx]!++;
      emit(a);
    },
    release(a) {
      const idx = ACTION_INDEX[a];
      synthHeld[idx] = 0;
      synthReleaseAt[idx] = 0;
    },
    padPress(a) {
      if (ctx === 'rebind') return;
      const idx = ACTION_INDEX[a];
      if (padHeld[idx]! < 255) padHeld[idx]!++;
      if (pending[idx]! < 0xffff) pending[idx]!++;
      emit(a);
    },
    padRelease(a) {
      const idx = ACTION_INDEX[a];
      if (padHeld[idx]! > 0) padHeld[idx]!--;
    },
    padRepeat(a) {
      if (ctx !== 'rebind') emit(a);
    },
    setAnalog(on, steer, throttle, brake) {
      analog.on = on;
      analog.steer = on ? steer : 0;
      analog.throttle = on ? throttle : 0;
      analog.brake = on ? brake : 0;
    },
    onAction(cb): Unsubscribe {
      listeners = [...listeners, cb];
      return () => {
        listeners = listeners.filter((l) => l !== cb);
      };
    },
    // ---- KeyBindingsApi ----
    bindings: () => bindings,
    label(code) {
      if (ARROWS[code]) return ARROWS[code]!;
      if (NAMED_KEYS.has(code)) {
        const k = `common.keys.${code}`;
        const tr = translate(k);
        return tr === k ? code : tr;
      }
      const fromLayout = layoutMap?.get(code);
      if (fromLayout && fromLayout.length === 1 && fromLayout.trim().length === 1) return upper(fromLayout);
      if (code.startsWith('Key') && code.length === 4) return upper(code.slice(3).toLowerCase());
      if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
      if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
      return code;
    },
    labelsFor(a) {
      return bindings[a].map((c) => mgr.label(c));
    },
    startRebind(action, slot, cb) {
      if (rebind) finishRebind({ ok: false, action: rebind.action, reason: 'cancelled' });
      const prev: DrivingContext = ctx === 'rebind' ? 'menu' : ctx;
      rebind = { action, slot, cb, prev };
      ctx = 'rebind';
      heldCodes.clear();
      pending.fill(0);
    },
    cancelRebind() {
      if (rebind) finishRebind({ ok: false, action: rebind.action, reason: 'cancelled' });
    },
    setBinding(action, slot, code) {
      if (MODIFIER_CODES.has(code)) return { ok: false, action, reason: 'modifier' };
      if (RESERVED_CODES.has(code)) return { ok: false, action, reason: 'reserved' };
      let replaced: ActionId | null = null;
      for (const other of ACTION_IDS) {
        if (other === action || !sharesContext(action, other)) continue;
        const list = bindings[other];
        const i = list.indexOf(code);
        if (i >= 0) {
          list.splice(i, 1);
          if (replaced === null) replaced = other;
        }
      }
      const own = bindings[action].filter((c) => c !== code);
      const s = Math.max(0, Math.min(slot, own.length));
      if (s < own.length) own[s] = code;
      else own.push(code);
      bindings[action] = own;
      rebuildMaps();
      persist();
      return { ok: true, action, code, slot: s, replaced };
    },
    resetBindings() {
      bindings = opts.resetDefaults?.() ?? defaultBindings();
      rebuildMaps();
      persist();
    },
    applyBindings(b) {
      bindings = sanitize(b);
      rebuildMaps();
    },
    async loadLayoutMap() {
      const kb = (typeof navigator !== 'undefined' ? (navigator as Navigator & { keyboard?: { getLayoutMap?(): Promise<{ get(code: string): string | undefined }> } }).keyboard : undefined);
      if (!kb?.getLayoutMap) return;
      try {
        layoutMap = await kb.getLayoutMap();
      } catch {
        layoutMap = null;
      }
    },
    dispose() {
      mgr.detach();
      listeners = [];
      rebind = null;
      heldCodes.clear();
    },
  };

  if (opts.bindings) bindings = sanitize(opts.bindings);
  rebuildMaps();
  return mgr;
}
