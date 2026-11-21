// HUD root (DESIGN §4.2, §5.1): a centred 16:9 frame (W = min(vw, vh·16/9)), `--k = kView × hud.scale`,
// safe insets on kView only. Composes the widgets; `update()` is the 30 Hz entry point and never reads layout.

import type { Lang } from '../../contracts/common';
import type { HudModel } from '../../contracts/hud';
import type { ActionId } from '../../contracts/input';
import type { RaceTrackId, TrackData } from '../../contracts/track';
import { DEFAULT_TRACK } from '../../data/tracks';
import { h } from '../dom';
import type { TFn } from '../format';
import { gsap } from '../motion/gsap';
import { createBanners } from './banners';
import { createBottomLeft } from './bottomLeft';
import type { HudCtx } from './ctx';
import { createLights } from './lights';
import { createProximity } from './proximity';
import { createFlashback, createMfd, createTtPanel, type TtSource } from './panels';
import { createStatus } from './status';
import { createTiming } from './timing';
import { createTower } from './tower';
import { createWheel } from './wheel';
import { createWrongWay } from './wrongWay';
import { createSafetyCar } from './safetyCar';

export interface HudOptions {
  t: TFn;
  has(key: string): boolean;
  lang(): Lang;
  reduced(): boolean;
  key(code: string): string;
  /** Gamepad button for an action while the pad was used last (null = keyboard hints). */
  padButton?(a: ActionId): number | null;
  /** Time Trial data for the TT panel (tt store + setup ghost). */
  tt?(): TtSource | null;
  /** The session's track id (setup store); the minimap follows it. */
  track?(): RaceTrackId;
  /** Mobile (2026-11-21): tapped HUD controls (MFD rows / header) press this action. */
  act?(a: ActionId): void;
}

export interface Hud {
  el: HTMLElement;
  update(m: HudModel): void;
  /** Screens hide the HUD (overlays such as pause keep it). */
  setShown(on: boolean): void;
  setScale(scale: number): void;
  setUnits(u: 'kmh' | 'mph'): void;
  setMinimap(on: boolean): void;
  setTrack(t: TrackData | null): void;
  /** Mobile: touch layout (side gutters for the thumb buttons, centred speedo, tappable MFD). */
  setTouch(on: boolean): void;
  relabel(): void;
  /** Last model seen (pause card, CR-07 helpers). */
  last(): HudModel | null;
  dispose(): void;
}

/** Larger of the left / right safe-area insets (notch side in landscape), read from CSS env() via a probe. */
function safeInset(): number {
  const probe = document.querySelector<HTMLElement>('.apx-safe-probe');
  if (!probe) return 0;
  const cs = getComputedStyle(probe);
  return Math.max(parseFloat(cs.paddingLeft) || 0, parseFloat(cs.paddingRight) || 0);
}

export function createHud(parent: HTMLElement, o: HudOptions): Hud {
  const tweens = new Set<{ kill(): unknown }>();
  let units: 'kmh' | 'mph' = 'kmh';
  const ctx: HudCtx & { has(key: string): boolean } = {
    t: o.t,
    has: o.has,
    lang: o.lang,
    units: () => units,
    k: () => k,
    reduced: o.reduced,
    key: o.key,
    padButton: (a) => o.padButton?.(a) ?? null,
    act: o.act ? (a) => { if (touchOn) o.act!(a); } : undefined,
    track(tw) {
      tweens.add(tw);
      if (tweens.size > 64) for (const x of tweens) if (!(x as unknown as gsap.core.Animation).isActive?.()) tweens.delete(x);
      return tw;
    },
  };
  const el = h('div', 'apx-hud', parent);
  el.dataset.on = '0';
  el.dataset.mode = 'full';
  const tower = createTower(el, ctx);
  const timing = createTiming(el, ctx);
  const lights = createLights(el, ctx);
  const banners = createBanners(el, ctx);
  const wheel = createWheel(el, ctx);
  const status = createStatus(el, ctx);
  const bl = createBottomLeft(el, ctx);
  const ttp = createTtPanel(el, ctx, () => o.tt?.() ?? null);
  const mfd = createMfd(el, ctx);
  const fb = createFlashback(el, ctx);
  const ww = createWrongWay(el, ctx);
  const prox = createProximity(el, ctx);
  const sc = createSafetyCar(el, ctx);
  const widgets = [tower, timing, lights, banners, wheel, status, bl, ttp, mfd, fb, ww, prox, sc];
  let scale = 1;
  let k = 1;
  let touchOn = false;
  let shown = false;
  let mode: HudModel['visible'] | null = null;
  let lastModel: HudModel | null = null;
  let trackRequested = false;
  let trackFor: RaceTrackId | null = null;

  const resize = (): void => {
    const vw = window.innerWidth || 1920;
    const vh = window.innerHeight || 1080;
    // Touch: keep a 64 px gutter (plus the notch inset) on both sides for the thumb button columns.
    const gutter = touchOn ? 64 + safeInset() : 0;
    const W = Math.min(vw - 2 * gutter, (vh * 16) / 9);
    const kView = Math.min(2, W / 1920, vh / 1080);
    k = kView * scale;
    el.style.left = `${(vw - W) / 2}px`;
    el.style.width = `${W}px`;
    el.style.setProperty('--kv', String(kView));
    el.style.setProperty('--k', String(k));
    bl.resize(k);
  };
  resize();
  window.addEventListener('resize', resize);

  const ensureTrack = (): void => {
    const id = o.track?.() ?? DEFAULT_TRACK;
    if (trackRequested && id === trackFor) return;
    trackRequested = true;
    trackFor = id;
    void import('../../game/index')
      .then((mod) => bl.setTrack(mod.loadRaceTrack(id).data))
      .catch((err: unknown) => console.warn('[ui] minimap track unavailable', err));
  };

  return {
    el,
    update(m) {
      lastModel = m;
      if (!shown) return;
      if (m.visible !== mode) {
        mode = m.visible;
        el.dataset.mode = mode;
      }
      mfd.update(m);
      fb.update(m);
      if (mode === 'off') return;
      const now = performance.now();
      ttp.update(m);
      ensureTrack();
      tower.update(m, scale > 1.1, now);
      timing.update(m, now);
      const lightsShown = lights.update(m, now);
      el.dataset.lights = lightsShown ? '1' : '0';
      sc.update(m);
      banners.setLightsShown(lightsShown);
      banners.update(m);
      ww.update(m);
      prox.update(m, now);
      wheel.update(m, now);
      status.update(m);
      if (mode === 'full') bl.update(m, now);
    },
    setShown(on) {
      if (on === shown) return;
      shown = on;
      el.dataset.on = on ? '1' : '0';
    },
    setScale(s) {
      const v = Math.max(0.8, Math.min(1.25, s || 1));
      if (v === scale) return;
      scale = v;
      resize();
    },
    setTouch(on) {
      if (on === touchOn) return;
      touchOn = on;
      el.dataset.touch = on ? '1' : '0';
      resize();
    },
    setUnits(u) {
      units = u;
    },
    setMinimap(on) {
      bl.setMinimap(on);
    },
    setTrack(t) {
      trackRequested = true;
      trackFor = o.track?.() ?? DEFAULT_TRACK;
      bl.setTrack(t);
    },
    relabel() {
      for (const w of widgets) w.relabel();
    },
    last: () => lastModel,
    dispose() {
      window.removeEventListener('resize', resize);
      for (const tw of tweens) tw.kill();
      tweens.clear();
      for (const w of widgets) w.dispose();
      gsap.killTweensOf(el.querySelectorAll('*'));
      el.remove();
    },
  };
}
