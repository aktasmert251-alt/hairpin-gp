// Loading (DESIGN §5.2, §6.15): ink background, static track outline (2 px fg at 20 %), session summary top-left,
// tip panel bottom-left (crossfade every 7 s), stage text and a 4 px vermilion progress bar written directly.

import type { ActionId } from '../../contracts/input';
import { h, wordmark } from '../dom';
import * as fmt from '../format';
import { gsap } from '../motion/gsap';
import { stage } from './base';
import type { Screen, ScreenCtx } from './ctx';
import type { RaceTrackId } from '../../contracts/track';
import { menuTrack } from './mainMenu';
import { trackOutline } from './trackOutline';

const TIP_KEYS = ['gears', 'camera', 'pause', 'drs', 'ers', 'flashback', 'mfd', 'limits', 'tyres', 'brake', 'rain', 'hud', 'line', 'pitLimiter'];

function outline(parent: HTMLElement, id: RaceTrackId): SVGSVGElement {
  const svg = trackOutline(menuTrack(id));
  svg.setAttribute('class', 'm-load-track');
  parent.appendChild(svg);
  return svg;
}

export function createLoading(ctx: ScreenCtx): Screen {
  const el = h('section', 'apx-screen');
  el.dataset.screen = 'loading';
  el.dataset.active = '0';
  el.setAttribute('aria-busy', 'true');
  const st = stage(el);
  h('header', 'm-top', st).appendChild(wordmark('m-wm', ctx.t('menu.brand'), true));
  let drawnId: RaceTrackId | null = null;
  let outlineEl: SVGSVGElement | null = null;
  const sum = h('div', 'm-load-sum', st);
  const eyebrow = h('p', 'm-meta', sum);
  const title = h('h1', 'm-h1', sum);
  const tip = h('div', 'm-tip', st);
  const tipL = h('p', 'm-meta', tip);
  const tipT = h('p', 'tip-t', tip);
  const stageTxt = h('p', 'm-meta m-stage-txt apx-num', st);
  stageTxt.setAttribute('role', 'status');
  const bar = h('div', 'm-progress', el);
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-labelledby', 'apx-load-stage');
  stageTxt.id = 'apx-load-stage';
  const fill = h('i', '', bar);
  let tipIx = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let unsub: (() => void) | null = null;
  let lastP = -1;

  const setTip = (animate: boolean): void => {
    const key = `loading.tips.${TIP_KEYS[tipIx % TIP_KEYS.length]}`;
    if (!animate) {
      tipT.textContent = ctx.t(key);
      return;
    }
    const d = ctx.reduced() ? 0.06 : 0.11;
    gsap.killTweensOf(tipT);
    ctx.track(gsap.to(tipT, {
      opacity: 0, duration: d, ease: 'apex.in',
      onComplete: () => {
        tipT.textContent = ctx.t(key);
        ctx.track(gsap.to(tipT, { opacity: 1, duration: d, ease: 'apex.out' }));
      },
    }));
  };

  const progress = (): void => {
    const p = Math.max(0, Math.min(1, ctx.deps.loading.get().progress));
    if (Math.abs(p - lastP) < 0.001) return;
    lastP = p;
    bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    if (p >= 1) el.removeAttribute('aria-busy');
    fill.style.transform = `scaleX(${p.toFixed(3)})`;
    stageTxt.textContent = ctx.upper(ctx.t('loading.stage', { p: fmt.pctOf(p, ctx.lang()) }));
  };

  const render = (): void => {
    const c = ctx.deps.setup.get();
    eyebrow.textContent = ctx.upper(ctx.t('menu.race.summary', {
      mode: ctx.t(`loading.mode.${c.mode}`), laps: c.laps, tod: ctx.t(`menu.race.todValue.${c.tod}`), weather: ctx.t(`menu.race.weatherValue.${c.weather}`),
    }));
    title.textContent = ctx.t(`tracks.${ctx.deps.setup.get().trackId}`);
    tipL.textContent = ctx.t('loading.tip');
    setTip(false);
    lastP = -1;
    progress();
  };

  return {
    id: 'loading',
    el,
    backdrop: 'ink',
    animated: () => [sum, tip],
    enter() {
      el.setAttribute('aria-busy', 'true');
      const tid = ctx.deps.setup.get().trackId;
      if (drawnId !== tid) {
        drawnId = tid;
        outlineEl?.remove();
        outlineEl = outline(st, tid);
      }
      const key = ctx.deps.loading.get().tipKey;
      const k = TIP_KEYS.indexOf(key.replace('loading.tips.', ''));
      tipIx = k >= 0 ? k : 0;
      render();
      unsub = ctx.deps.loading.subscribe(progress);
      timer = setInterval(() => {
        tipIx++;
        setTip(true);
      }, 7000);
    },
    leave() {
      el.removeAttribute('aria-busy');
      unsub?.();
      unsub = null;
      if (timer) clearInterval(timer);
      timer = null;
    },
    action(_a: ActionId) {},
    render,
    dispose() {
      unsub?.();
      if (timer) clearInterval(timer);
      el.remove();
    },
  };
}
