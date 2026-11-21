import type { SandboxScene } from '../../contracts/debug';
import type { EventMap } from '../../contracts/events';
import type { ScreenId, UiAction } from '../../contracts/ui';
import { createEventBus } from '../../core/eventBus';
import { createInputManager } from '../../core/input/InputManager';
import { createSettingsStore } from '../../core/settings/SettingsStore';
import { TEAMS } from '../../data/teams';
import { loadTrack } from '../../track/index';
import { createUi } from '../createUi';
import { h } from '../dom';
import { fontsReady } from '../styles/index';
import { createMockHud } from './mockHud';
import { createSandboxI18n } from './mockI18n';
import { createMockNet } from './mockNet';
import { createMockStores } from './mockStores';

export function onlineScene(id: 'online' | 'lobby'): SandboxScene {
  return {
    id, title: 'Online UI',
    async create({ uiRoot, params }) {
      const lang = params.get('lang') === 'en' ? 'en' : 'tr';
      const bus = createEventBus<EventMap>();
      const settings = createSettingsStore({ bus, storage: null });
      settings.setPath('lang', lang);
      const anim = params.get('anim');
      if (anim === 'off' || anim === 'on' || anim === 'auto') settings.setPath('ui.animations', anim);
      const i18n = createSandboxI18n(lang);
      const input = createInputManager({ translate: i18n.t, upper: i18n.upper });
      input.attach(window);
      const stores = createMockStores({ pb: false, laps: 5 });
      const mock = createMockNet(params.get('freeze') === '1', Number(params.get('players') ?? 3));
      if (id === 'lobby') mock.open('Deniz', params.get('owner') !== '0');
      if (params.get('visibility') === 'private' && mock.store.get().room) {
        const room = mock.store.get().room!;
        mock.store.set({ room: { ...room, settings: { ...room.settings, visibility: 'private' } } });
      }
      if (params.has('notice')) mock.store.set({ notice: params.get('notice') });
      if (params.has('kicked')) mock.store.set({ status: 'error', kicked: {
        reason: params.get('kicked') === 'banned' ? 'banned' : 'kicked', until: params.has('until') ? Number(params.get('until')) : null,
      } });
      if (params.get('countdown') === '1') mock.countdown();
      const ui = createUi();
      const hud = createMockHud(loadTrack().data, { freeze: true, stress: false, lights: false, mode: 'full', timeTrial: false });
      hud.model.net = { rttMs: 38 };
      hud.model.tower[1]!.net = 'stale';
      hud.model.tower[1]!.penaltySec = 5;
      hud.model.tower[2]!.net = 'dc';
      hud.model.tower[3]!.net = 'ok';
      const actions: UiAction[] = [];
      const dispatch = (action: UiAction): void => {
        actions.push(action);
        if (mock.handle(action)) {
          if (action.type === 'onlineCreate' || action.type === 'onlineJoin' || action.type === 'onlineQuickJoin') ui.show('lobby');
          else if (action.type === 'onlineLeave') ui.show('online');
          return;
        }
        if (action.type === 'navigate') ui.show(action.to);
        else if (action.type === 'back' || action.type === 'quitToMenu') ui.show('mainMenu');
        else if (action.type === 'resume') ui.hideScreens();
      };
      ui.mount(uiRoot, { ...stores, settings, i18n, bus, dispatch, menuInput: input, keys: input, teams: TEAMS,
        ...(params.get('provider') === 'none' ? {} : { net: mock.store }) });
      await fontsReady();
      ui.show(id);
      const sample = h('p', 'm-net-sample', uiRoot.querySelector('.apx-screens')!, i18n.t('online.sample'));
      // Sandbox-only controls let e2e tests emulate another client's server snapshots.
      const probe = { model: () => mock.store.get(), actions: () => actions, remoteReady: mock.remoteReady,
        countdown: mock.countdown, show: (screen: ScreenId) => {
          if (screen === 'pause') { const room = mock.store.get().room; if (room) mock.store.set({ room: { ...room, phase: 'racing' } }); ui.hideScreens(); ui.updateHud(hud.model); }
          if (screen === 'results') { const room = mock.store.get().room; if (room) mock.store.set({ room: { ...room, phase: 'results' } }); }
          phase = mock.store.get().room?.phase;
          ui.show(screen);
        },
        patch: mock.store.set,
        dispose: () => ui.dispose(),
      };
      (window as unknown as { __onlineUi?: typeof probe }).__onlineUi = probe;
      let phase = mock.store.get().room?.phase;
      return {
        update(dt) {
          mock.update(dt);
          const next = mock.store.get().room?.phase;
          if (next === 'racing' && phase !== 'racing') { ui.hideScreens(); ui.updateHud(hud.model); }
          phase = next;
          sample.classList.toggle('is-race', ui.screen() === null || ui.screen() === 'pause');
        },
        dispose() {
          delete (window as unknown as { __onlineUi?: typeof probe }).__onlineUi;
          sample.remove(); ui.dispose(); input.dispose(); settings.dispose();
        },
      };
    },
  };
}
