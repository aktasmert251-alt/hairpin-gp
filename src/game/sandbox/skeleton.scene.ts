// ?scene=skeleton (YÖN): walking skeleton. Placeholder oval, a keyboard-drivable box car (player = car 0),
// 5 AI box cars and the basic HUD text. Extras: &autodrive=1, &ai=<n>, &laps=<n>, &grid=<n>, &lights=1
// (run the start lights instead of a rolling start), &t=<s> + &freeze=1, &cam=<id>, &seed=<n>, &debug=1.

import type { SandboxScene } from '../../contracts/debug';
import type { UiAction } from '../../contracts/ui';
import { createAudioSystem } from '../../audio/index';
import { apexController } from '../../core/debug/apexApi';
import { parseLaunchParams } from '../../core/launchParams';
import { createGraphicsSystem } from '../../graphics/index';
import { createUi } from '../../ui/index';
import { defaultSessionConfig } from '../createSim';
import { createSession, type Session } from '../session';
import { autoPauseFor, createAppServices, createUiDeps, createUiStores, drivingCamFor } from '../services';

const scene: SandboxScene = {
  id: 'skeleton',
  title: 'Walking skeleton',
  async create({ canvas, uiRoot, params }) {
    const launch = parseLaunchParams(params);
    const apex = apexController(launch);
    const services = createAppServices(apex, launch);
    const graphics = createGraphicsSystem();
    const ctx = await graphics.init(canvas, services.quality());
    const onResize = (): void => graphics.resize();
    window.addEventListener('resize', onResize);
    const audio = createAudioSystem();
    audio.init(services.bus, services.settings.get().audio);
    const ui = createUi();
    const stores = createUiStores();
    const aiCount = launch.ai ?? 5;
    const cfg = defaultSessionConfig({
      mode: 'race',
      laps: launch.laps ?? 5,
      aiCount,
      seed: launch.seed ?? 1,
      autodrive: launch.autodrive,
      gridPos: launch.grid ?? aiCount + 1,
      tod: launch.tod ?? 'day',
      weather: launch.weather ?? 'dry',
      assists: { ...services.settings.get().assists },
    });

    let session: Session | null = null;
    const build = async (): Promise<void> => {
      session?.dispose();
      session = await createSession(cfg, services, { graphics, ctx, audio, ui, overlayRoot: uiRoot }, {
        skipLights: !params.has('lights'),
        ownLoop: false,
        autoPause: autoPauseFor(launch),
        freeze: launch.freeze,
        fastForwardS: launch.t,
        camera: drivingCamFor(launch.cam),
        startS: launch.s,
        debugOverlay: launch.debug,
        timeScale: launch.timescale,
        onPauseChange: (paused) => (paused ? ui.show('pause') : ui.hideScreens()),
      });
      ui.hideScreens();
      session.start();
    };

    const dispatch = (a: UiAction): void => {
      if (a.type === 'resume' || a.type === 'back') session?.resume();
      else if (a.type === 'restart') void build();
      else if (a.type === 'quitToMenu') window.location.search = '';
    };
    ui.mount(uiRoot, createUiDeps(services, stores, dispatch));
    await build();

    return {
      update(dt) {
        session?.advance(dt);
      },
      dispose() {
        session?.dispose();
        session = null;
        window.removeEventListener('resize', onResize);
        ui.dispose();
        audio.dispose();
        graphics.dispose();
        services.dispose();
      },
    };
  },
};

export default scene;
