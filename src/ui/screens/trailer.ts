// Trailer overlay: the 30 s intro video, full-screen with sound, above every screen (z-index over the stage).
// Plays only after a user gesture (the title key / a menu activation). ANY key, click, pointer press or menu action
// skips it. The glue (main.ts) listens to `apex:trailer` to mute the game audio and pause the showroom render.
// Failure (missing file, decode error, autoplay refusal, 8 s without a first frame) skips silently via onDone().

import { mediaVolume } from '../../audio/index';
import { h } from '../dom';
import { gsap } from '../motion/gsap';
import type { ScreenCtx } from './ctx';

export const TRAILER_EVENT = 'apex:trailer';
const GUARD_MS = 250;
const START_TIMEOUT_MS = 8000;

export interface Trailer {
  playing(): boolean;
  /** Starts the trailer; `onDone` runs once when it ended, was skipped or failed. */
  play(onDone: () => void): void;
  dispose(): void;
}

/** The trailer is never auto-played under test automation unless `?trailer=1`, nor for scene / autostart launches. */
export function trailerAllowed(): boolean {
  const q = new URLSearchParams(window.location.search);
  if (q.has('scene') || q.has('autostart')) return false;
  if (q.get('trailer') === '1') return true;
  return !navigator.webdriver;
}

export function createTrailer(host: HTMLElement, ctx: ScreenCtx): Trailer {
  let root: HTMLElement | null = null;
  let video: HTMLVideoElement | null = null;
  let hint: HTMLElement | null = null;
  let cleanup: (() => void) | null = null;
  let active = false;

  const announce = (on: boolean): void => {
    window.dispatchEvent(new CustomEvent(TRAILER_EVENT, { detail: { playing: on } }));
  };

  const play = (onDone: () => void): void => {
    if (active) return;
    active = true;
    const prevFocus = document.activeElement as HTMLElement | null;
    const r = h('div', 'm-trailer', host);
    r.setAttribute('role', 'dialog');
    r.setAttribute('aria-modal', 'true');
    r.setAttribute('aria-label', ctx.t('menu.trailer.label'));
    const v = h('video', 'm-trailer-video', r);
    v.playsInline = true;
    v.preload = 'auto';
    v.disablePictureInPicture = true;
    v.src = `${import.meta.env.BASE_URL}assets/gra/trailer/intro.mp4`;
    // The video's own sound follows Settings > Audio > Master (0 = muted), live while it plays.
    const applyVolume = (): void => { const m = mediaVolume(ctx.deps.settings.get().audio); v.volume = m.volume; v.muted = m.muted; };
    applyVolume();
    const offSettings = ctx.deps.settings.subscribe(applyVolume);
    const hnt = h('p', 'm-trailer-skip', r, ctx.t('menu.trailer.skip'));
    hnt.setAttribute('aria-hidden', 'true');
    root = r;
    video = v;
    hint = hnt;
    announce(true);

    const startedAt = performance.now();
    let finished = false;
    let timer = 0;
    const fade = ctx.reduced() ? 0.1 : 0.4;

    const finish = (): void => {
      if (finished) return;
      finished = true;
      cleanup?.();
      cleanup = null;
      gsap.killTweensOf([r, hnt]);
      v.pause();
      announce(false);
      active = false;
      onDone();
      // Fade the overlay out while the next screen fades in underneath; then drop the element and its media.
      gsap.to(r, {
        opacity: 0, duration: fade, ease: 'apex.in',
        onComplete: () => {
          v.removeAttribute('src');
          v.load();
          r.remove();
          if (root === r) { root = null; video = null; hint = null; }
          if (document.activeElement === document.body || !document.activeElement) prevFocus?.focus?.({ preventScroll: true });
        },
      });
    };

    const guarded = (e: Event): void => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (performance.now() - startedAt >= GUARD_MS) finish();
    };
    const swallow = (e: Event): void => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.code === 'F5' || e.code === 'F11' || e.code === 'F12') return;
      if (e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      guarded(e);
    };
    const offMenu = ctx.deps.menuInput.onAction(() => {
      if (performance.now() - startedAt >= GUARD_MS) finish();
    });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', guarded, true);
    window.addEventListener('click', swallow, true);
    const onEnded = (): void => finish();
    const onError = (): void => finish();
    const onPlaying = (): void => {
      window.clearTimeout(timer);
      gsap.fromTo(v, { opacity: 0 }, { opacity: 1, duration: fade, ease: 'apex.out' });
      gsap.fromTo(hnt, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'apex.out', delay: 1 });
    };
    v.addEventListener('ended', onEnded);
    v.addEventListener('error', onError);
    v.addEventListener('playing', onPlaying, { once: true });
    timer = window.setTimeout(finish, START_TIMEOUT_MS);
    cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', guarded, true);
      window.removeEventListener('click', swallow, true);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('error', onError);
      v.removeEventListener('playing', onPlaying);
      offMenu();
      offSettings();
    };
    gsap.fromTo(r, { opacity: 0 }, { opacity: 1, duration: fade, ease: 'apex.out' });
    gsap.set(v, { opacity: 0 });
    v.play().catch(() => finish());
  };

  return {
    playing: () => active,
    play,
    dispose() {
      if (active) announce(false);
      active = false;
      cleanup?.();
      cleanup = null;
      if (root) gsap.killTweensOf([root, video, hint]);
      if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
      root?.remove();
      root = video = hint = null;
    },
  };
}
