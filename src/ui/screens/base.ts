// Shared screen scaffolding: the 1920 × 1080 stage, header (wordmark + language/version or the race stepper),
// bottom key-hint bar, footer description, and a list-screen base with the focus model and pointer support.

import type { ActionId } from '../../contracts/input';
import type { ScreenId } from '../../contracts/ui';
import type { Ctl } from '../controls';
import { h, icon, wordmark } from '../dom';
import { FocusList } from '../focus/focus';
import { padChip } from '../padGlyph';
import type { Backdrop, Screen, ScreenCtx } from './ctx';

export type Hint = 'move' | 'change' | 'select' | 'back';

export function keyChip(parent: HTMLElement, content: string | { icon: string }): HTMLElement {
  const k = h('span', 'apx-kc', parent);
  if (typeof content === 'string') k.textContent = content;
  else k.appendChild(icon(content.icon));
  return k;
}

/** Bottom bar with key hints (key chips use KeyBindingsApi labels where an action exists). */
export function bottomBar(ctx: ScreenCtx, parent: HTMLElement, hints: Hint[]): () => void {
  const bar = h('footer', 'm-bar', parent);
  const left = h('div', 'm-hints', bar);
  const ver = h('span', 'm-ver', bar);
  return () => {
    left.replaceChildren();
    const keys = ctx.deps.keys;
    const lbl = (code: string): string => ctx.upper(keys.label(code));
    // Gamepad glyphs while the pad is the device used last (D-pad, A select, B back).
    const pad = ctx.deps.pad?.lastDevice() === 'gamepad';
    for (const hn of hints) {
      const s = h('span', '', left);
      s.dataset.hint = hn;
      if (pad) {
        const btns = hn === 'move' ? [12, 13] : hn === 'change' ? [14, 15] : hn === 'select' ? [0] : [1];
        for (const b of btns) padChip(s, b);
      } else if (hn === 'move') {
        keyChip(s, { icon: 'arrow-up' });
        keyChip(s, { icon: 'arrow-down' });
      } else if (hn === 'change') {
        keyChip(s, { icon: 'arrow-left' });
        keyChip(s, { icon: 'arrow-right' });
      } else if (hn === 'select') keyChip(s, lbl('Enter'));
      else keyChip(s, lbl('Escape'));
      h('span', '', s, ctx.t(`menu.hint.${hn}`));
    }
    ver.textContent = ctx.t('menu.version');
  };
}

/** Header: wordmark left; right = language indicator + version, or a custom node. */
export function header(ctx: ScreenCtx, parent: HTMLElement): { right: HTMLElement; render(): void } {
  const top = h('header', 'm-top', parent);
  const wm = wordmark('m-wm', ctx.t('menu.brand'));
  top.appendChild(wm);
  const right = h('div', 'm-lang', top);
  return {
    right,
    render() {
      wm.setAttribute('aria-label', ctx.t('menu.brand'));
    },
  };
}

export function langIndicator(ctx: ScreenCtx, parent: HTMLElement): () => void {
  const tr = h('span', '', parent, 'TR');
  tr.lang = 'tr';
  const en = h('span', '', parent, 'EN');
  en.lang = 'en';
  return () => {
    const l = ctx.lang();
    tr.classList.toggle('on', l === 'tr');
    en.classList.toggle('on', l === 'en');
  };
}

export function stage(root: HTMLElement): HTMLElement {
  return h('div', 'm-stage', root);
}

/**
 * The press never moves native DOM focus on its own (empty space, the dim, disabled items): the FocusList is the only
 * authority and focuses the hit item itself. Without this the browser sends focus to <body> or to a disabled button.
 */
export function keepDomFocus(el: HTMLElement): void {
  el.addEventListener('mousedown', (e) => {
    if (!(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) e.preventDefault();
  });
}

/** Last pointer position seen by any screen (shared, so a screen shown under a resting cursor does not count it as a move). */
const lastPointer = { x: NaN, y: NaN };

/** List screen base: owns a FocusList over `ctls`, routes menu actions, hover/click, Home/End. */
export abstract class ListScreen implements Screen {
  readonly el: HTMLElement;
  readonly st: HTMLElement;
  backdrop: Backdrop = 'showroom';
  wideScrim = false;
  overlay = false;
  protected ctls: Ctl[] = [];
  protected focus: FocusList;
  protected restoreIndex = 0;
  protected descEl: HTMLElement | null = null;

  constructor(readonly id: ScreenId, protected readonly ctx: ScreenCtx, cols?: number) {
    this.el = h('section', 'apx-screen');
    this.el.dataset.screen = id;
    this.el.dataset.active = '0';
    this.st = stage(this.el);
    this.focus = new FocusList({
      reduced: ctx.reduced,
      cols,
      changed: (it) => {
        this.updateDesc();
        void it;
      },
    });
    // Pointer: hover focuses (the one focus model, no separate hover highlight), click acts. Only the shown screen
    // listens (ctx.live), so nothing reaches the game; no preventDefault.
    // Hover follows real pointer movement only: Chrome also sends pointerover (and same-position moves) when content
    // moves under a resting cursor (a focused tile dropping back, the settings column scrolling), which would take
    // focus back from the keyboard.
    this.el.addEventListener('pointermove', (e) => {
      if (!this.ownsPointer(e)) return;
      if (e.clientX === lastPointer.x && e.clientY === lastPointer.y) return;
      lastPointer.x = e.clientX;
      lastPointer.y = e.clientY;
      if (ctx.live(id)) this.pointerOver(e.target as Element);
    });
    keepDomFocus(this.el);
    this.el.addEventListener('pointerdown', (e) => {
      if (this.ownsPointer(e) && ctx.live(id) && e.button === 0) this.pointerDown(e);
    });
    this.el.addEventListener('click', (e) => {
      // detail 0 = the click a browser synthesises for Enter/Space on a focused button; the menu input already acted.
      if (!this.ownsPointer(e) || !ctx.live(id) || e.button !== 0 || e.detail === 0) return;
      const t = e.target as Element;
      if (t.closest('[data-hint="back"]')) this.action('menuBack');
      else this.pointerClick(t);
    });
  }

  /** Embedded editors own their events, including their back hint. The enclosing setup must not act again. */
  private ownsPointer(e: Event): boolean {
    return e.target instanceof Element && e.target.closest('.apx-screen') === this.el;
  }

  /** The list and index of the focusable under `target` (subclasses with several lists override). */
  protected pointerHit(target: Element): { list: FocusList; i: number } | null {
    const el = target.closest<HTMLElement>('[data-focus-id]');
    const i = el ? this.focus.items.findIndex((x) => x.el === el) : -1;
    return i >= 0 ? { list: this.focus, i } : null;
  }

  /** Focuses the hit item like an arrow key would (disabled items are not focused by hover). */
  protected pointerFocus(list: FocusList, i: number): void {
    if (i === list.index || list.items[i]!.disabled?.()) return;
    if (list.set(i)) this.ctx.sound('move');
  }

  protected pointerOver(target: Element): void {
    const hit = this.pointerHit(target);
    if (hit) this.pointerFocus(hit.list, hit.i);
  }

  protected pointerDown(e: PointerEvent): void {
    const hit = this.pointerHit(e.target as Element);
    if (!hit) return;
    this.pointerFocus(hit.list, hit.i);
    (hit.list.items[hit.i] as Ctl).press?.(e);
  }

  /** Click = the control's pointer action (chevron, segment) or, by default, Enter. */
  protected pointerClick(target: Element): void {
    const hit = this.pointerHit(target);
    if (!hit) return;
    this.pointerFocus(hit.list, hit.i);
    // Field activate() means Enter/next for keyboard navigation. A pointer click must retain native editing focus.
    if (target.closest('input, textarea, select')) return;
    const c = hit.list.items[hit.i] as Ctl;
    if (c.click) c.click(target);
    else c.activate?.();
  }

  abstract animated(): HTMLElement[];
  stagger(): HTMLElement[] {
    return this.ctls.slice(0, 8).map((c) => c.el);
  }

  protected setControls(ctls: Ctl[]): void {
    this.ctls = ctls;
    this.focus.setItems(ctls);
  }

  protected updateDesc(): void {
    if (!this.descEl) return;
    this.descEl.setAttribute('aria-live', 'polite');
    const c = this.focus.current() as Ctl | null;
    this.descEl.textContent = c?.desc ? this.ctx.t(c.desc) : '';
  }

  enter(_from: ScreenId | null): void {
    this.render();
    this.focus.refreshDisabled();
    this.focus.blur();
    this.focus.set(this.restoreIndex, false);
    this.updateDesc();
  }

  leave(): void {
    if (this.focus.index >= 0) this.restoreIndex = this.focus.index;
  }

  /** Esc / Backspace. */
  protected abstract back(): void;

  action(a: ActionId): void {
    const f = this.focus;
    const cur = f.current();
    switch (a) {
      case 'menuUp':
        if (f.move(-1)) this.ctx.sound('move');
        break;
      case 'menuDown':
        if (f.move(1)) this.ctx.sound('move');
        break;
      case 'menuLeft':
        cur?.left?.();
        break;
      case 'menuRight':
        cur?.right?.();
        break;
      case 'menuConfirm':
        cur?.activate?.();
        break;
      case 'menuBack':
        this.back();
        break;
      default:
        break;
    }
  }

  key(code: string): boolean {
    if (code === 'Home') return this.focus.home() || true;
    if (code === 'End') return this.focus.end() || true;
    return false;
  }

  render(): void {
    for (const c of this.ctls) c.render();
    this.updateDesc();
  }

  dispose(): void {
    this.focus.dispose();
    this.el.remove();
  }
}
