// Title (DESIGN §5.2, §8.1): static wordmark (cap height 120) at x 96, vertically centred, over the showroom with
// the left ink scrim; the prompt fades in once (400 ms apex.out) and never pulses. Any non-modifier key goes to
// the main menu; the glue unlocks audio on that transition, so a key during the U8 logo intro skips it AND proceeds.

import type { ActionId } from '../../contracts/input';
import type { ScreenId } from '../../contracts/ui';
import { h, wordmark } from '../dom';
import { gsap } from '../motion/gsap';
import { keepDomFocus, stage } from './base';
import type { Screen, ScreenCtx } from './ctx';

/** The intro plays once per page load. */
let introPlayed = false;

const IGNORED = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock', 'Tab', 'ContextMenu']);

export function createTitle(ctx: ScreenCtx): Screen {
  const el = h('section', 'apx-screen');
  el.dataset.screen = 'title';
  el.dataset.active = '0';
  const st = stage(el);
  const wm = wordmark('m-title-wm', ctx.t('menu.brand'));
  st.appendChild(wm);
  const prompt = h('p', 'm-prompt', st);
  prompt.dataset.focusId = 'title.prompt';
  const ver = h('span', 'm-ver m-abs', st);
  ver.style.cssText = 'right:96px;bottom:40px';
  // U8 logo intro (frame-logo-outro, adapted to DESIGN §8.1: the mark is assembled from its 4 segments as whole
  // units, never letter by letter, and never glows itself; the "bloom" is a separate soft light behind it).
  const intro = h('div', 'm-intro', st);
  intro.setAttribute('aria-hidden', 'true');
  intro.hidden = true;
  const glow = h('div', 'm-intro-glow', intro);
  const iwm = wordmark('m-intro-wm', ctx.t('menu.brand'));
  intro.appendChild(iwm);
  const tagline = h('p', 'm-intro-tag', intro);
  let tl: gsap.core.Timeline | null = null;
  const showPrompt = (): void => {
    gsap.killTweensOf(prompt);
    ctx.track(gsap.fromTo(prompt, { opacity: 0 }, { opacity: 1, duration: ctx.reduced() ? 0.12 : 0.4, ease: 'apex.out', delay: ctx.reduced() ? 0 : 0.2 }));
  };
  const endIntro = (): void => {
    tl?.kill();
    tl = null;
    intro.hidden = true;
  };
  const playIntro = (): void => {
    introPlayed = true;
    const q = (s: string): Element[] => [...iwm.querySelectorAll(s)];
    intro.hidden = false;
    gsap.set(prompt, { opacity: 0 });
    // ≤ 2.5 s: The geometric initial, HAIRPIN outlines and the GP block slide in from alternating sides (80–100 ms apart), the apex marker cuts in,
    // the light blooms behind, the tagline rises, then the cover fades to the title.
    tl = ctx.track(gsap.timeline({ defaults: { ease: 'apex.out' }, onComplete: () => { endIntro(); showPrompt(); } }));
    tl.fromTo(q('.hp-l'), { x: -90, opacity: 0 }, { x: 0, opacity: 1, duration: 0.36 }, 0.15)
      .fromTo(q('.hp-w'), { x: 70, opacity: 0 }, { x: 0, opacity: 1, duration: 0.36 }, 0.25)
      .fromTo(q('.hp-b, .hp-g'), { x: 140, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4 }, 0.35)
      .fromTo(q('.hp-m'), { scaleX: 0, transformOrigin: '0% 50%' }, { scaleX: 1, duration: 0.22, ease: 'apex.inOut' }, 0.8)
      .fromTo(glow, { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.5 }, 0.95)
      .to(glow, { opacity: 0.4, duration: 0.5, ease: 'apex.inOut' }, 1.45)
      .fromTo(tagline, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.32 }, 1.15)
      .to(intro, { opacity: 0, duration: 0.3, ease: 'apex.in' }, 2.15);
  };
  let left = false;
  const go = (): void => {
    if (left) return;
    left = true;
    endIntro();
    if (ctx.trailerDue()) {
      ctx.markTrailerShown();
      ctx.playTrailer(() => ctx.go('mainMenu'));
      return;
    }
    ctx.sound('confirm');
    ctx.go('mainMenu');
  };
  keepDomFocus(el);
  el.addEventListener('pointerdown', () => {
    if (ctx.live('title')) go();
  });
  return {
    id: 'title' as ScreenId,
    el,
    backdrop: 'showroom',
    animated: () => [],
    enter() {
      left = false;
      this.render();
      // Once per page load; reduced motion = the static title wordmark only (the screen fades in over 120 ms).
      if (!introPlayed && !ctx.reduced()) playIntro();
      else showPrompt();
    },
    leave() {
      endIntro();
    },
    // Keys arrive through key(); a gamepad has no raw key, so its A / Start (menuConfirm / pause) start here.
    action(a: ActionId) {
      if (a === 'menuConfirm' || a === 'pause') go();
    },
    key(code) {
      if (IGNORED.has(code) || /^F\d+$/.test(code)) return false;
      go();
      return true;
    },
    render() {
      prompt.textContent = ctx.t('menu.title.pressAnyKey');
      ver.textContent = ctx.t('menu.version');
      tagline.textContent = ctx.t('menu.title.tagline');
    },
    dispose() {
      endIntro();
      el.remove();
    },
  };
}
