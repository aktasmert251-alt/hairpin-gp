import type { RaceTrackId } from '../../contracts/track';
import { storedTimeTrial } from '../../game/index';
import { h } from '../dom';
import * as fmt from '../format';
import { gsap } from '../motion/gsap';
import type { ScreenCtx } from './ctx';
import { menuTrack, trackDirection } from './mainMenu';
import { trackOutline } from './trackOutline';

/** Two layers crossfade; the latest selection and its text are updated synchronously, even under rapid input. */
export class TrackPreview {
  readonly el: HTMLElement;
  private current: HTMLElement | null = null;
  private id: RaceTrackId | null = null;
  private lang = '';

  constructor(private ctx: ScreenCtx, parent: HTMLElement) {
    this.el = h('aside', 'm-track-preview', parent);
    this.el.setAttribute('aria-live', 'polite');
    this.el.setAttribute('aria-atomic', 'true');
  }

  render(animate = true): void {
    const ctx = this.ctx, id = ctx.deps.setup.get().trackId;
    if (this.id === id && this.lang === ctx.lang() && animate) return;
    const previous = this.current;
    this.stop();
    this.id = id;
    this.lang = ctx.lang();
    const layer = h('div', 'm-track-detail', this.el);
    layer.dataset.trackId = id;
    const tr = menuTrack(id);
    h('p', 'm-meta', layer, ctx.t('menu.card.eyebrow'));
    h('h2', 'm-h2', layer, ctx.t(`tracks.${id}`));
    h('p', 'm-meta facts apx-num', layer, ctx.t('menu.card.facts', {
      km: fmt.km(tr.length, ctx.lang()), n: tr.corners.length, dir: ctx.t(`menu.card.${trackDirection(tr)}`),
    }));
    layer.appendChild(trackOutline(tr, true));
    const legend = h('div', 'm-track-legend m-meta', layer);
    for (const key of ['s1', 's2', 's3', 'finish', 'pit']) h('span', key, legend, ctx.t(`menu.trackPreview.${key}`));
    const pb = h('div', 'pb', layer);
    const pbMs = storedTimeTrial(id).pbMs;
    h('span', 'm-meta', pb, ctx.t('menu.card.pb'));
    h('strong', 'apx-num', pb, fmt.lapTime(pbMs));
    if (!(pbMs > 0)) h('p', 'm-body', layer, ctx.t('menu.card.noPb'));
    this.current = layer;
    if (previous && animate) {
      previous.setAttribute('aria-hidden', 'true');
      const duration = ctx.reduced() ? 0.12 : 0.22;
      ctx.track(gsap.to(previous, { opacity: 0, duration, ease: 'none', onComplete: () => previous.remove() }));
      ctx.track(gsap.fromTo(layer, { opacity: 0 }, { opacity: 1, duration, ease: 'none', clearProps: 'opacity' }));
    } else previous?.remove();
  }

  stop(): void {
    for (const layer of Array.from(this.el.children)) {
      gsap.killTweensOf(layer);
      if (layer !== this.current) layer.remove();
    }
    if (this.current) gsap.set(this.current, { clearProps: 'opacity' });
  }

  dispose(): void { this.stop(); this.el.remove(); }
}
