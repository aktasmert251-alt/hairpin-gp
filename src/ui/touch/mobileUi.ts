// Touch UI chrome (mobile, 2026-11-21): `data-touch` on the UI root (touch-sized menus, see touch.css), the portrait
// "rotate the device" overlay, and a virtual back button for menu screens (phones have no Esc key).

import { needsRotate } from '../../core/index';
import { h, icon } from '../dom';
import type { TFn } from '../format';

export interface MobileChrome {
  /** Re-reads touch mode + orientation (resize, settings change). */
  sync(): void;
  /** The visible menu screen (null = racing / none): the back button shows for screens that have a back. */
  setScreen(id: string | null): void;
  /** True while the portrait overlay covers the game. */
  portrait(): boolean;
  relabel(): void;
  dispose(): void;
}

/** Screens without a back step (title waits for a tap, loading has nothing to go back to, main menu is the root). */
const NO_BACK: ReadonlySet<string> = new Set(['title', 'loading', 'mainMenu']);

/** Phone layout = touch UI on a short viewport (landscape phones); tablets keep the desktop stage with touch sizing. */
export function phoneLayout(touchUi: boolean, w: number, h: number): boolean {
  return touchUi && Math.min(w, h) < 600;
}

export function createMobileChrome(host: HTMLElement, o: { t: TFn; touchUi(): boolean; back(): void }): MobileChrome {
  const rotate = h('div', 'apx-rotate', host);
  rotate.setAttribute('role', 'alert');
  const phone = h('div', 'r-phone', rotate);
  phone.appendChild(icon('arrow-right'));
  const title = h('div', 'r-title', rotate);
  const detail = h('div', 'r-detail', rotate);
  const back = h('button', 'apx-back', host);
  back.type = 'button';
  back.appendChild(icon('arrow-left'));
  let screen: string | null = null;
  let isPortrait = false;

  const relabel = (): void => {
    title.textContent = o.t('touch.rotate.title');
    detail.textContent = o.t('touch.rotate.detail');
    back.setAttribute('aria-label', o.t('touch.back'));
  };
  const sync = (): void => {
    const touchUi = o.touchUi();
    const w = window.innerWidth;
    const ht = window.innerHeight;
    host.dataset.touch = touchUi ? '1' : '0';
    host.dataset.phone = phoneLayout(touchUi, w, ht) ? '1' : '0';
    isPortrait = needsRotate(w, ht, touchUi);
    rotate.dataset.on = isPortrait ? '1' : '0';
    back.dataset.on = touchUi && screen !== null && !NO_BACK.has(screen) ? '1' : '0';
  };
  const onBack = (e: Event): void => {
    e.preventDefault();
    o.back();
  };
  back.addEventListener('click', onBack);
  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', sync);
  relabel();
  sync();
  return {
    sync,
    setScreen(id) {
      screen = id;
      sync();
    },
    portrait: () => isPortrait,
    relabel,
    dispose() {
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
      back.removeEventListener('click', onBack);
      rotate.remove();
      back.remove();
    },
  };
}
