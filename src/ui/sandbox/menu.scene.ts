// `?scene=menu`: the real createUi() on mock stores (Örnek veri) and the real input manager, keyboard only.
// Params: screen=<ScreenId> (default title), lang=tr|en, anim=auto|on|off, pb=1 (personal best on the info card),
// laps=<n>. A local dispatch emulates the glue: navigate/back/startRace (loading → results)/resume/restart/quit.

import type { SandboxScene } from '../../contracts/debug';
import type { EventMap } from '../../contracts/events';
import type { ScreenId, UiAction } from '../../contracts/ui';
import { createEventBus } from '../../core/eventBus';
import { createInputManager } from '../../core/input/InputManager';
import { createSettingsStore } from '../../core/settings/SettingsStore';
import { TEAMS } from '../../data/teams';
import { loadTrack } from '../../track/index';
import { createUi } from '../createUi';
import { gsap } from '../motion/gsap';
import { fontsReady } from '../styles/index';
import { createMockHud } from './mockHud';
import { createSandboxI18n } from './mockI18n';
import { createMockStores } from './mockStores';

const SCREENS: ScreenId[] = ['title', 'mainMenu', 'ttSetup', 'raceConditions', 'teamSelect', 'raceSettings', 'assists', 'loading', 'pause', 'settings', 'results', 'ttResults', 'credits'];

const scene: SandboxScene = {
  id: 'menu',
  title: 'Menu',
  async create({ uiRoot, params }) {
    const lang = params.get('lang') === 'en' ? 'en' : 'tr';
    const bus = createEventBus<EventMap>();
    const settings = createSettingsStore({ bus, storage: null });
    const anim = params.get('anim');
    if (anim === 'on' || anim === 'off' || anim === 'auto') settings.setPath('ui.animations', anim);
    settings.setPath('lang', lang);
    const i18n = createSandboxI18n(lang);
    const input = createInputManager({ bindings: settings.get().controls.bindings, translate: (k) => i18n.t(k), upper: (s) => i18n.upper(s) });
    input.attach(window);
    void input.loadLayoutMap?.();
    const stores = createMockStores({ pb: params.get('pb') === '1', laps: Number(params.get('laps') ?? '29') || 29 });
    const ui = createUi();
    const track = loadTrack().data;
    const mock = createMockHud(track, { freeze: true, stress: false, lights: false, mode: 'full', timeTrial: false });
    let timer: ReturnType<typeof setInterval> | null = null;
    const stopTimer = (): void => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const fakeLoad = (): void => {
      stopTimer();
      stores.loading.set({ progress: 0 });
      ui.show('loading');
      let p = 0;
      timer = setInterval(() => {
        p = Math.min(1, p + 0.08);
        stores.loading.set({ progress: p });
        if (p >= 1) {
          stopTimer();
          ui.show('results');
        }
      }, 120);
    };
    const toPause = (): void => {
      ui.hideScreens();
      ui.updateHud(mock.model);
      ui.show('pause');
    };
    const dispatch = (a: UiAction): void => {
      switch (a.type) {
        case 'navigate':
          if (a.to === 'pause') toPause();
          else ui.show(a.to);
          break;
        case 'back':
        case 'quitToMenu':
          stopTimer();
          ui.show('mainMenu');
          break;
        case 'startRace':
        case 'startTimeTrial':
        case 'restart':
          fakeLoad();
          break;
        case 'resume':
          ui.hideScreens();
          ui.updateHud(mock.model);
          break;
        case 'retire':
        case 'skipToResults':
          ui.show('results');
          break;
        default:
          break;
      }
    };
    ui.mount(uiRoot, {
      settings, setup: stores.setup, results: stores.results, tt: stores.tt, loading: stores.loading, i18n, bus, dispatch, menuInput: input, teams: TEAMS, keys: input,
    });
    await fontsReady();
    const want = params.get('screen') as ScreenId | null;
    const id = want && SCREENS.includes(want) ? want : 'title';
    if (id === 'pause') toPause();
    else ui.show(id);
    // L-02 probe (sandbox only): live GSAP children, and a screen walk / mid-animation dispose driver.
    (window as unknown as { __uiMotion?: unknown }).__uiMotion = {
      children: () => gsap.globalTimeline.getChildren(true, true, true).length,
      show: (s: ScreenId) => (s === 'pause' ? toPause() : ui.show(s)),
      hide: () => ui.hideScreens(),
      dispose: () => ui.dispose(),
      screens: SCREENS,
    };
    return {
      update() {},
      dispose() {
        stopTimer();
        ui.dispose();
        input.dispose();
        settings.dispose();
      },
    };
  },
};

export default scene;
