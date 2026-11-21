// Main menu (DESIGN §5.2): wordmark top-left, navigation list at y 380 (64 px rows), focused-item description,
// track info card bottom-right (facts + personal best with sectors, or the empty state), key-hint bar.

import type { SectorStatus } from '../../contracts/race';
import type { TrackData } from '../../contracts/track';
import type { RaceTrackId } from '../../contracts/track';
import { DEFAULT_TRACK } from '../../data/tracks';
import { loadRaceTrack } from '../../game/index';
import { storedTimeTrial } from '../../game/index';
import { navItem } from '../controls';
import { h } from '../dom';
import { FEATURES } from '../features';
import * as fmt from '../format';
import { bottomBar, header, langIndicator, ListScreen } from './base';
import type { ScreenCtx } from './ctx';

const trackCache = new Map<RaceTrackId, TrackData>();
/** Static data of a race track (falls back to İstanbul while it is not built). */
export function menuTrack(id: RaceTrackId = DEFAULT_TRACK): TrackData {
  let d = trackCache.get(id);
  if (!d) trackCache.set(id, (d = loadRaceTrack(id).data));
  return d;
}

/** Shoelace sign on (x, z) with z drawn downwards: > 0 = clockwise on screen. */
export function trackDirection(t: TrackData): 'cw' | 'ccw' {
  let a = 0;
  const n = t.count;
  for (let i = 0; i < n; i += 4) {
    const j = (i + 4) % n;
    a += t.x[i]! * t.z[j]! - t.x[j]! * t.z[i]!;
  }
  return a > 0 ? 'cw' : 'ccw';
}

export class MainMenu extends ListScreen {
  private renderHead: () => void;
  private renderLang: () => void;
  private renderBar: () => void;
  private card: HTMLElement;
  private eyebrow: HTMLElement;

  constructor(ctx: ScreenCtx) {
    super('mainMenu', ctx);
    const hd = header(ctx, this.st);
    this.renderHead = hd.render;
    this.renderLang = langIndicator(ctx, hd.right);
    const nav = h('nav', 'm-nav', this.st);
    nav.style.top = '330px';
    this.eyebrow = h('p', 'm-meta', nav);
    this.eyebrow.style.marginBottom = '18px';
    const list = h('div', '', nav);
    const t = ctx.t;
    this.setControls([
      navItem(ctx, list, {
        id: 'main.timeTrial', label: 'menu.main.timeTrial', meta: () => t(`tracks.${ctx.deps.setup.get().trackId}`), desc: 'menu.main.desc.timeTrial',
        disabled: () => !FEATURES.timeTrial, activate: () => ctx.go('ttSetup'),
      }),
      navItem(ctx, list, {
        id: 'main.quickRace', label: 'menu.main.quickRace', meta: () => ctx.upper(t('menu.main.cars', { n: 20 })), desc: 'menu.main.desc.quickRace',
        activate: () => ctx.go('raceConditions'),
      }),
      navItem(ctx, list, { id: 'main.online', label: 'online.title', desc: 'online.description', activate: () => ctx.go('online') }),
      navItem(ctx, list, { id: 'main.settings', label: 'menu.main.settings', desc: 'menu.main.desc.settings', disabled: () => !FEATURES.settings, activate: () => ctx.go('settings') }),
      navItem(ctx, list, { id: 'main.credits', label: 'menu.main.credits', desc: 'menu.main.desc.credits', disabled: () => !FEATURES.credits, activate: () => ctx.go('credits') }),
    ]);
    this.descEl = h('p', 'm-desc m-body', nav);
    this.card = h('aside', 'm-card', this.st);
    this.renderBar = bottomBar(ctx, this.st, ['move', 'select']);
  }

  animated(): HTMLElement[] {
    return [this.st.querySelector('.m-nav')!, this.card];
  }

  protected back(): void {
    // Esc does nothing on the hub.
  }

  private renderCard(): void {
    const ctx = this.ctx;
    const id = ctx.deps.setup.get().trackId;
    const tr = menuTrack(id);
    const c = this.card;
    c.replaceChildren();
    h('p', 'm-meta', c, ctx.t('menu.card.eyebrow'));
    h('h2', 'm-h2', c, ctx.t(`tracks.${id}`));
    const facts = h('p', 'm-meta facts apx-num', c);
    facts.textContent = ctx.upper(ctx.t('menu.card.facts', { km: fmt.km(tr.length, ctx.lang()), n: tr.corners.length, dir: ctx.t(`menu.card.${trackDirection(tr)}`) }));
    // The tt store carries this session's laps (sectors); use it only when it holds the selected track's PB.
    const stored = storedTimeTrial(id);
    const live = ctx.deps.tt.get();
    const tt = live.pbMs === stored.pbMs ? live : stored;
    const pb = h('div', 'pb', c);
    h('span', 'm-meta', pb, ctx.t('menu.card.pb'));
    const v = h('span', 'v apx-num', pb, fmt.lapTime(tt.pbMs));
    if (!(tt.pbMs > 0)) {
      v.classList.add('empty');
      h('p', 'm-body', c, ctx.t('menu.card.noPb')).style.marginTop = '12px';
      return;
    }
    const lap = tt.laps.find((l) => l.ms === tt.pbMs && l.valid);
    const best = [0, 1, 2].map((i) => Math.min(...tt.laps.filter((l) => l.valid && l.sectors[i]! > 0).map((l) => l.sectors[i]!)));
    const secs = h('div', 'm-secs', c);
    for (let i = 0; i < 3; i++) {
      const ms = lap?.sectors[i] ?? 0;
      const st: SectorStatus = !(ms > 0) ? 'none' : ms <= best[i]! ? 'purple' : 'green';
      const s = h('div', '', secs);
      s.dataset.st = st;
      h('div', 'bar', s);
      const meta = h('div', 'meta', s);
      h('span', '', meta, ctx.t('hud.timing.sector', { n: i + 1 }));
      h('span', 'v apx-num', meta, fmt.sectorTime(ms));
    }
  }

  override render(): void {
    super.render();
    this.renderHead();
    this.renderLang();
    this.eyebrow.textContent = this.ctx.t('menu.main.heading');
    this.renderCard();
    this.renderBar();
  }
}
