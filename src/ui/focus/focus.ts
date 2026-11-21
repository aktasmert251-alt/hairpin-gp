// Focus model (DESIGN §7.6, ui-hud §6): one focused element per screen, always visible (white row / outline +
// vermilion apex notch). Lists never wrap; Home/End jump to the ends; disabled items are skipped. Every focusable
// element carries a stable `data-focus-id` (CR-17 reads it). Focus moves are instant; only the notch animates
// (scaleY .4 → 1, 140 ms apex.out) and a new input interrupts it.

import { gsap } from '../motion/gsap';

export interface Focusable {
  el: HTMLElement;
  disabled?(): boolean;
  activate?(): void;
  left?(): boolean | void;
  right?(): boolean | void;
  onFocus?(): void;
}

export interface FocusOptions {
  reduced(): boolean;
  /** Called after every focus change (sound, descriptions). */
  changed?(item: Focusable, index: number): void;
  /** 2D grid: number of columns (arrows move by rows/cols). */
  cols?: number;
}

export class FocusList {
  items: Focusable[] = [];
  index = -1;
  constructor(private readonly o: FocusOptions) {}

  setItems(items: Focusable[]): void {
    for (const it of this.items) it.el.classList.remove('is-focus');
    this.items = items;
    for (const it of items) {
      it.el.tabIndex = -1;
      it.el.setAttribute('aria-disabled', it.disabled?.() ? 'true' : 'false');
    }
    this.index = -1;
  }

  current(): Focusable | null {
    return this.items[this.index] ?? null;
  }

  private ok(i: number): boolean {
    const it = this.items[i];
    return !!it && !it.disabled?.();
  }

  refreshDisabled(): void {
    for (const it of this.items) it.el.setAttribute('aria-disabled', it.disabled?.() ? 'true' : 'false');
  }

  /** Focuses item i (or the nearest enabled one after it). Returns false when nothing changed. */
  set(i: number, animate = true): boolean {
    let j = Math.max(0, Math.min(this.items.length - 1, i));
    if (!this.ok(j)) {
      let k = j;
      while (k < this.items.length && !this.ok(k)) k++;
      if (k >= this.items.length) {
        k = j;
        while (k >= 0 && !this.ok(k)) k--;
      }
      if (k < 0) return false;
      j = k;
    }
    if (j === this.index) {
      this.items[j]!.el.classList.add('is-focus');
      this.items[j]!.el.setAttribute('aria-current', 'true');
      return false;
    }
    const prev = this.items[this.index];
    prev?.el.classList.remove('is-focus');
    prev?.el.removeAttribute('aria-current');
    this.index = j;
    const it = this.items[j]!;
    it.el.classList.add('is-focus');
    it.el.setAttribute('aria-current', 'true'); // ui-hud §9: menus are lists of buttons with aria-current
    if (document.activeElement !== it.el) it.el.focus({ preventScroll: true });
    // Scroll only the owning list, preserving the scaled stage and its fixed header/footer.
    for (let p = it.el.parentElement; p; p = p.parentElement) {
      if (!/(auto|scroll)/.test(getComputedStyle(p).overflowY) || p.scrollHeight <= p.clientHeight) continue;
      const row = it.el.getBoundingClientRect(), box = p.getBoundingClientRect();
      const scale = box.height / p.clientHeight;
      if (row.top < box.top + 3) p.scrollTop -= (box.top + 3 - row.top) / scale;
      else if (row.bottom > box.bottom - 3) p.scrollTop += (row.bottom - box.bottom + 3) / scale;
      break;
    }
    const notch = it.el.querySelector<HTMLElement>(':scope > .notch');
    if (notch) {
      gsap.killTweensOf(notch);
      if (animate && !this.o.reduced()) gsap.fromTo(notch, { scaleY: 0.4 }, { scaleY: 1, duration: 0.14, ease: 'apex.out', clearProps: 'transform' });
      else gsap.set(notch, { clearProps: 'transform' });
    }
    it.onFocus?.();
    this.o.changed?.(it, j);
    return true;
  }

  /** Moves by `d` steps without wrapping, skipping disabled items. */
  move(d: number): boolean {
    let j = this.index + d;
    while (j >= 0 && j < this.items.length && !this.ok(j)) j += Math.sign(d);
    if (j < 0 || j >= this.items.length) return false;
    return this.set(j);
  }

  /** Grid moves (cols set): dx/dy in cells, no wrap. */
  moveGrid(dx: number, dy: number): boolean {
    const cols = this.o.cols ?? 1;
    const r = Math.floor(this.index / cols);
    const c = this.index % cols;
    const nr = r + dy;
    const nc = c + dx;
    if (nc < 0 || nc >= cols || nr < 0) return false;
    const j = nr * cols + nc;
    if (j >= this.items.length || !this.ok(j)) return false;
    return this.set(j);
  }

  home(): boolean {
    return this.set(0);
  }

  end(): boolean {
    let j = this.items.length - 1;
    while (j >= 0 && !this.ok(j)) j--;
    return j >= 0 ? this.set(j) : false;
  }

  blur(): void {
    for (const it of this.items) {
      it.el.classList.remove('is-focus');
      it.el.removeAttribute('aria-current');
    }
    this.index = -1;
  }

  /** Kills any running notch tween (screen disposal). */
  dispose(): void {
    for (const it of this.items) {
      const notch = it.el.querySelector<HTMLElement>(':scope > .notch');
      if (notch) gsap.killTweensOf(notch);
    }
  }
}
