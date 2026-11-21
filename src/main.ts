// APEX GP entry (YÖN): boot -> title -> menu -> loading -> session -> results (§3.6).
// `?scene=<id>` mounts a sandbox scene instead; `?autostart=1` skips the menus.

import type { ScreenId, UiAction } from './contracts/ui';
import type { SessionConfig } from './contracts/race';
import { createAppStateMachine } from './core/appState';
import { installApexApi, probeGpu } from './core/debug/apexApi';
import { parseLaunchParams } from './core/launchParams';
import { bindVolumes, createAudioSystem } from './audio/index';
import { defaultSessionConfig } from './game/createSim';
import { createSession, type Session } from './game/session';
import { encodeReplay } from './game/replay/index';
import type { ReplayData } from './contracts/replay';
import { LOADING_TIPS, autoPauseFor, createAppServices, createUiDeps, createUiStores, drivingCamFor, prepareTeamPresentation } from './game/services';
import { createGraphicsSystem, createShowroom } from './graphics/index';
import type { Showroom } from './contracts/render';
import { createUi } from './ui/index';
import { resolveTrackId } from './game/tracks';
import { storedTimeTrial } from './game/timeTrial';
import { createTrackAccessor } from './game/trackAccessor';
import type { NetLobbyModel, NetServerMsg } from './contracts/net';
import { BUILD_HASH } from './core/buildInfo';
import { createStore } from './core/store';
import { parseCustomTeam, setRaceCustomTeams, type CustomTeam } from './data/customTeams';
import { TEAMS } from './data/teams';
import type { OnlineRace } from './game/net/onlineSession';
import type { NetClient } from './net/index';
import { createFrameGovernor } from './core/platform/governor';
import { createWakeLock, enterLandscapeFullscreen, needsRotate } from './core/platform/screen';

const launch = parseLaunchParams(window.location.search);
const apex = installApexApi(launch);
const gpu = probeGpu();
apex.setGpu(gpu.renderer);
// B-6: track accessor for harnesses (gallery points) in every mode, preview builds included.
// QA-19-04: until the app boots it is the launch track; boot() rebinds it to the session's / menu-selected track.
apex.attachApp({ track: createTrackAccessor(() => resolveTrackId(launch.track)) });

const appEl = document.getElementById('app') as HTMLElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

function nextFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (): void => {
      if (--n <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function showFatal(lines: string[], onEnter?: () => void): void {
  const el = document.createElement('div');
  el.setAttribute('role', 'alert');
  el.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#0A0C0F;color:#F2F4F7;font:20px/1.5 "Segoe UI",system-ui,sans-serif;text-align:center;padding:24px;pointer-events:auto;z-index:100';
  for (const line of lines) {
    const p = document.createElement('p');
    p.style.margin = '0';
    p.textContent = line;
    el.appendChild(p);
  }
  uiRoot.appendChild(el);
  if (onEnter) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') onEnter();
    });
  }
}

function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]! | 0;
}

async function boot(): Promise<void> {
  const services = createAppServices(apex, launch);
  const { bus, settings, i18n } = services;
  const app = createAppStateMachine(bus);
  apex.attachApp({ state: () => app.current() });

  if (!gpu.webgl2) {
    showFatal([i18n.t('errors.noWebgl2')]);
    apex.setReady(true);
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  appEl.appendChild(canvas);
  const graphics = createGraphicsSystem();
  const ctx = await graphics.init(canvas, services.quality());
  services.assets.setMaxAnisotropy(ctx.renderer.capabilities.getMaxAnisotropy());
  window.addEventListener('resize', () => graphics.resize());

  const audio = createAudioSystem();
  let trailerOn = false;
  // Settings > Audio drive the mix live (menus, races and the pause screen alike); master 0 silences every bus.
  const volumes = bindVolumes(settings, audio, () => trailerOn || !!launch.mute);
  audio.init(bus, volumes.current());
  const applyVolumes = volumes.apply;
  // QC2-08: unlock on the first user gesture in any app state (autostart sessions included), not only on the title.
  const unlockAudio = (): void => {
    window.removeEventListener('keydown', unlockAudio, true);
    window.removeEventListener('pointerdown', unlockAudio, true);
    window.removeEventListener('touchend', unlockAudio, true);
    void audio.unlock();
  };
  window.addEventListener('keydown', unlockAudio, true);
  window.addEventListener('pointerdown', unlockAudio, true);
  // iOS Safari unlocks the AudioContext only inside touchend / click, not pointerdown.
  window.addEventListener('touchend', unlockAudio, true);

  // ---- mobile (2026-11-21) ----
  // Wake lock while racing (and while hosting a browser room on a phone); fullscreen + landscape lock on the first tap of
  // a touch UI; portrait pauses an offline race behind the rotate overlay; a frame-time governor on mobile devices that
  // steps the quality down one preset when the 5 s average stays under 30 fps (runtime only, `?governor=0` turns it off).
  const device = services.touch.profile();
  const wake = createWakeLock();
  let p2pHosting = false;
  const syncWake = (): void => wake.set(session !== null || p2pHosting);
  const governor = createFrameGovernor({ windowS: 5, minFps: 30 });
  const governorOn = device.mobile && new URLSearchParams(window.location.search).get('governor') !== '0' && !launch.quality;
  let govLast = -1;
  const govTick = (t: number): void => {
    requestAnimationFrame(govTick);
    const dt = govLast < 0 ? 0 : t - govLast;
    govLast = t;
    if (!session || session.uiState() !== 'driving') return;
    const next = governor.frame(dt, ctx.quality.id);
    if (!next) return;
    graphics.setQuality(services.presetFor(next));
    bus.emit('quality:changed', { id: next });
    bus.emit('notify', { key: 'notify.quality.lowered', params: { q: i18n.t(`settings.g.presetValue.${next}`).toLocaleUpperCase(i18n.lang() === 'tr' ? 'tr-TR' : 'en-US') }, level: 'info', ms: 4000 });
    console.info(`[apex] governor: quality lowered to ${next}`);
  };
  if (governorOn) requestAnimationFrame(govTick);
  const onFirstTap = (): void => {
    if (!services.touch.uiTouch()) return;
    window.removeEventListener('pointerup', onFirstTap, true);
    void enterLandscapeFullscreen();
  };
  window.addEventListener('pointerup', onFirstTap, true);
  window.addEventListener('resize', () => {
    if (session && !onlineRace && session.uiState() === 'driving' && needsRotate(window.innerWidth, window.innerHeight, services.touch.uiTouch())) session.pause();
  });

  // CR-15 showroom: the 3D menu backdrop, live whenever no session owns the renderer (title, menus, results).
  let room: Showroom | null = null;
  let roomReady: Promise<void> = Promise.resolve();
  let roomTeam = 'anka';
  let roomLoop: ((t: number) => void) | null = null;
  const markShowroom = (live: boolean): void => {
    const layer = uiRoot.querySelector<HTMLElement>('.apx-ui');
    if (layer) layer.dataset.showroom = live ? 'live' : '';
  };
  const startShowroom = (): void => {
    if (room) return;
    const r = createShowroom();
    room = r;
    roomReady = r.init(ctx).then(() => {
      if (room !== r) return;
      r.setTeam(roomTeam);
      r.resize();
      markShowroom(true);
      let last = -1;
      roomLoop = (t: number) => {
        const dt = last < 0 ? 0 : (t - last) / 1000;
        last = t;
        r.render(dt);
      };
      if (!trailerOn) ctx.renderer.setAnimationLoop(roomLoop);
    }).catch((err: unknown) => console.error('[apex] showroom failed', err));
  };
  const stopShowroom = async (): Promise<void> => {
    const r = room;
    if (!r) return;
    room = null;
    roomLoop = null;
    ctx.renderer.setAnimationLoop(null);
    markShowroom(false);
    await roomReady;
    r.dispose();
  };
  // UI trailer overlay: game audio muted and the showroom render paused while the video plays.
  window.addEventListener('apex:trailer', (e) => {
    trailerOn = !!(e as CustomEvent<{ playing: boolean }>).detail?.playing;
    applyVolumes();
    if (roomLoop) ctx.renderer.setAnimationLoop(trailerOn ? null : roomLoop);
  });
  bus.on('ui:focusTeam', ({ teamId }) => {
    roomTeam = teamId;
    room?.setTeam(teamId);
  });
  window.addEventListener('resize', () => room?.resize());

  const launchTrack = resolveTrackId(launch.track);
  const stores = createUiStores(launchTrack);
  // QA-19-04: the running session's track, else the track selected in the menus (setup store).
  apex.attachApp({ track: createTrackAccessor(() => session?.cfg.trackId ?? resolveTrackId(stores.setup.get().trackId)) });
  roomTeam = stores.setup.get().playerTeamId;
  const ui = createUi();
  let session: Session | null = null;
  let lastCfg: SessionConfig | null = null;
  let screen: ScreenId | null = null;
  let starting = false;
  /** CR-18: replay of the last ended session (the running one is read live). */
  let lastReplay: ReplayData | null = null;
  // Multiplayer P3: the lobby store exists from boot (UiDeps.net); the client module is imported on first use.
  const netLobby = createStore<NetLobbyModel>({ status: 'offline', error: null, myId: null, room: null, t0ServerMs: null, rttMs: 0 });
  let netMod: typeof import('./net/index') | null = null;
  let net: NetClient | null = null;
  let netKey = '';
  let onlineRace: OnlineRace | null = null;
  // D-050: kicked / banned (message or close code 4001 / 4003): tell the UI, end the online race, back to the online screen.
  let wasKicked = false;
  netLobby.subscribe((m) => {
    const k = m.kicked ?? null;
    if (k && !wasKicked) {
      bus.emit('net:kicked', { reason: k.reason, until: k.until });
      if (onlineRace) endSession('quit');
      restoreMenuSetup();
      app.go('menu');
      show('online');
    }
    wasKicked = k !== null;
  });

  const show = (id: ScreenId): void => {
    screen = id;
    ui.show(id);
    apex.setSceneReady(false);
    // The loading screen is transitional: the session marks sceneReady after its first frame.
    if (id === 'loading') return;
    void nextFrames(2).then(() => {
      if (screen === id) apex.setSceneReady(true);
    });
  };

  const endSession = (reason: 'finished' | 'quit' | 'restart'): void => {
    if (!session) return;
    lastReplay = session.replay() ?? lastReplay;
    session.dispose();
    session = null;
    syncWake();
    onlineRace?.dispose();
    onlineRace = null;
    if (reason !== 'restart') startShowroom();
    if (reason !== 'finished') bus.emit('session:ended', { reason });
  };

  /** Rules §8: the two-compound rule applies to dry / variable races of ≥ 10 laps. */
  const withRuleFlags = (c: SessionConfig): SessionConfig => ({
    ...c,
    mandatoryStop: c.mode === 'race' && (c.weather === 'dry' || c.weather === 'variable') && c.laps >= 10,
  });

  /** Menu path: the choices the UI wrote into the setup store win over defaults (launch params only seed/autodrive). */
  const menuConfigFor = (mode: SessionConfig['mode']): SessionConfig => {
    const base = sessionConfigFor(mode);
    const u = stores.setup.get();
    return withRuleFlags({
      ...base,
      tod: u.tod, weather: mode === 'timeTrial' && u.weather === 'variable' ? 'dry' : u.weather,
      laps: u.laps, playerTeamId: u.playerTeamId, playerDriverIdx: u.playerDriverIdx,
      aiCount: mode === 'timeTrial' ? 0 : u.aiCount, difficulty: u.difficulty, gridPos: u.gridPos, startCompound: u.startCompound,
      flashbacks: u.flashbacks, assists: { ...u.assists }, ghost: u.ghost, wearScale: u.wearScale, trackId: u.trackId,
      safetyCar: u.safetyCar !== false, // D-056 race-settings toggle (default on)
    });
  };

  const sessionConfigFor = (mode: SessionConfig['mode']): SessionConfig => {
    const s = settings.get();
    const aiCount = mode === 'timeTrial' ? 0 : launch.ai ?? 19;
    const seed = launch.seed ?? randomSeed();
    if (launch.seed === null) console.info(`[apex] session seed ${seed}`);
    return defaultSessionConfig({
      mode,
      laps: launch.laps ?? 3,
      aiCount,
      difficulty: launch.difficulty ?? s.gameplay.difficulty,
      tod: launch.tod ?? 'day',
      weather: launch.weather ?? 'dry',
      seed,
      // D-062: custom teams are online only, so a launch URL may name a standard team only.
      playerTeamId: launch.team && TEAMS.some((t) => t.id === launch.team) ? launch.team : 'anka',
      gridPos: launch.grid ?? Math.max(1, Math.ceil((aiCount + 1) / 2)),
      startCompound: launch.tyre ?? 'auto',
      flashbacks: s.gameplay.flashbacks,
      assists: { ...s.assists },
      autodrive: launch.autodrive,
      trackId: launchTrack,
    });
  };

  const showResults = (): void => {
    if (!session) return;
    stores.results.set(session.results());
    endSession('finished');
    app.go('results');
    show('results');
  };

  /** `online`: an online race (multiplayer P3); its config comes from the server and is not written to the setup store. */
  /** The setup fields the loading screen / HUD / results show for a session (online: the room's race, not the menu choice). */
  const pickShown = (c: Readonly<SessionConfig>): Pick<SessionConfig, 'mode' | 'trackId' | 'laps' | 'tod' | 'weather'> => ({
    mode: c.mode, trackId: c.trackId, laps: c.laps, tod: c.tod, weather: c.weather,
  });
  let menuSetup: Pick<SessionConfig, 'mode' | 'trackId' | 'laps' | 'tod' | 'weather'> | null = null;
  const restoreMenuSetup = (): void => {
    if (menuSetup) stores.setup.set(menuSetup);
    menuSetup = null;
  };

  const startSession = async (requested: SessionConfig, skipLights: boolean, online?: OnlineRace): Promise<void> => {
    if (starting) {
      online?.dispose();
      return;
    }
    starting = true;
    // L-T1: a track the module cannot build yet falls back to İstanbul here, so config, results and PB keys agree.
    const cfg: SessionConfig = { ...requested, trackId: resolveTrackId(requested.trackId) };
    try {
      endSession('restart');
      if (onlineRace !== online) onlineRace?.dispose();
      onlineRace = online ?? null;
      await stopShowroom();
      if (!online) {
        restoreMenuSetup();
        lastCfg = cfg;
        stores.setup.set(cfg);
      } else {
        // Loading screen, HUD minimap and results read the session's track / laps / conditions from the setup store
        // (wrong-track bug online). Show the room's race there and give the menu choices back when leaving online.
        menuSetup ??= pickShown(stores.setup.get());
        stores.setup.set(pickShown(cfg));
      }
      // The TT store was seeded for the launch track; re-seed it for the session's track (PB banner, HUD TT panel).
      stores.tt.set(storedTimeTrial(cfg.trackId));
      app.go('loading');
      stores.loading.set({ progress: 0, tipKey: LOADING_TIPS[Math.abs(cfg.seed) % LOADING_TIPS.length]! });
      show('loading');
      prepareTeamPresentation(online ? null : cfg.playerTeamId);
      const s = await createSession(cfg, services, { graphics, ctx, audio, ui, overlayRoot: uiRoot }, {
        skipLights,
        ownLoop: true,
        autoPause: online ? false : autoPauseFor(launch),
        online,
        camera: drivingCamFor(launch.cam),
        view: launch.cam ?? undefined,
        startS: launch.s,
        debugOverlay: launch.debug,
        timeScale: launch.timescale,
        markSceneReady: true,
        ttStore: stores.tt,
        onProgress: (p) => stores.loading.set({ progress: p }),
        onPauseChange: (paused) => {
          if (paused) {
            screen = 'pause';
            ui.show('pause');
          } else {
            screen = null;
            ui.hideScreens();
          }
        },
      });
      session = s;
      governor.reset();
      syncWake();
      s.onFinished(showResults);
      app.go('session');
      apex.setSceneReady(false);
      s.start();
      // Online: tell the server only now (fully built), so T0 = all loaded + 3 s is not spent compiling.
      online?.sendLoaded();
      // The loading screen stays (and ui.screen() says 'loading') until the first session frame is on screen.
      await s.firstFrame();
      if (session === s && screen === 'loading') {
        screen = null;
        ui.hideScreens();
      }
    } catch (err) {
      console.error('[apex] session failed to start', err);
      endSession('quit');
      startShowroom();
      app.go('menu');
      show('mainMenu');
    } finally {
      starting = false;
    }
  };

  // D-064 host-in-browser rooms: race toasts for host-tab visibility; a guest whose host left goes back to the online screen.
  let p2pWatched = false;
  const watchP2P = (mod: typeof import('./net/index')): void => {
    if (p2pWatched) return;
    p2pWatched = true;
    let prev = mod.p2p().store.get();
    mod.p2p().store.subscribe((m) => {
      const was = prev;
      prev = m;
      // Mobile: a phone hosting the room keeps its screen on (a sleeping host stops the room).
      p2pHosting = m.role === 'host';
      syncWake();
      if (m.role === 'guest' && m.hostPaused !== was.hostPaused && session) {
        bus.emit('notify', { key: m.hostPaused ? 'notify.p2p.hostPaused' : 'notify.p2p.hostResumed', level: m.hostPaused ? 'warn' : 'info', ms: 4000 });
      }
      if (m.role === 'host' && m.hiddenWarn && !was.hiddenWarn && session) {
        bus.emit('notify', { key: 'notify.p2p.hostWasHidden', level: 'warn', ms: 6000 });
      }
      if (m.role === 'guest' && m.hostLeft && !was.hostLeft) {
        setRaceCustomTeams(null);
        restoreMenuSetup();
        net?.close(true);
        if (onlineRace) endSession('quit');
        app.go('menu');
        show('online');
      }
    });
  };

  // ---- online (multiplayer P3): the netClient and the race glue are loaded on first use, offline players never fetch them ----
  const ensureNet = async (name: string, server?: string): Promise<NetClient> => {
    const mod = (netMod ??= await import('./net/index'));
    const url = mod.defaultServerUrl(server ?? launch.server, window.location);
    // D-064: `p2p:host` / `p2p:guest` = a host-in-browser room over WebRTC instead of a server URL.
    const peer = mod.isP2PUrl(url);
    const key = `${url}|${name}`;
    const st = netLobby.get().status;
    if (net && netKey === key && st !== 'offline' && st !== 'error') return net;
    net?.close();
    if (mod.isP2PUrl(netKey.split('|')[0]) && netKey.split('|')[0] !== url) mod.p2p().end();
    if (url === mod.P2P_HOST_URL) mod.p2p().startHost(() => netLobby.get().room?.code ?? null);
    if (peer) watchP2P(mod);
    const n = mod.createNetClient({ url, name, build: BUILD_HASH, lobby: netLobby }, peer ? { socket: (u) => mod.p2p().socket(u) } : {});
    net = n;
    netKey = key;
    n.onMessage((m) => onNetMessage(n, m));
    n.onStatus((state, rttMs) => bus.emit('net:status', { state, rttMs }));
    n.connect();
    return n;
  };

  /** Leaves the room (retiring from a running race); D-056: `to` = the screen afterwards (main menu for the main-menu exit). */
  const leaveOnline = (to: ScreenId = 'online'): void => {
    setRaceCustomTeams(null);
    restoreMenuSetup();
    if (onlineRace) net?.send({ type: 'retire' });
    net?.close();
    // D-064: a host leaving ends the browser-hosted room for everyone (guests get "host left"); a guest closes its link.
    if (netMod && netMod.p2p().store.get().role !== 'none') netMod.p2p().end();
    if (onlineRace) endSession('quit');
    app.go('menu');
    show(to);
  };

  const startOnlineRace = async (n: NetClient, load: Extract<NetServerMsg, { type: 'load' }>): Promise<void> => {
    // A resumed socket gets the same `load` again: the running race simply continues (its clock never stopped).
    if (onlineRace?.raceId === load.raceId) return;
    const myId = netLobby.get().myId;
    if (myId === null) return;
    const mod = await import('./game/net/onlineSession');
    const u = stores.setup.get();
    // D-062: the race's custom teams (name / livery over their base car).
    setRaceCustomTeams((load.teams ?? []).map((t) => parseCustomTeam(t)).filter((t): t is CustomTeam => t !== null));
    const race = mod.createOnlineRace(n, load, myId, { local: { assists: { ...u.assists }, startCompound: u.startCompound }, autodrive: launch.autodrive });
    await startSession(race.cfg, false, race);
  };

  /** Launch-param online flow (`?name=` [+ `server`, `room`]): auto-ready; with `autostart` the owner starts once ≥ 2 players are ready. */
  const autoOnline = launch.name !== null;
  let lastRoomCode: string | null = null;
  let readySent = false;
  let startSent = false;
  const onNetMessage = (n: NetClient, m: NetServerMsg): void => {
    switch (m.type) {
      case 'error':
        bus.emit('net:error', { code: m.code });
        break;
      case 'notice':
        bus.emit('net:notice', { text: m.text });
        // D-050: in a race the notice also appears as a HUD toast (the lobby shows NetLobbyModel.notice).
        if (m.text && session) bus.emit('notify', { key: 'notify.net.notice', params: { text: m.text }, level: 'info', ms: 0 });
        break;
      case 'load':
        void startOnlineRace(n, m);
        break;
      case 'room': {
        if (m.code !== lastRoomCode) {
          lastRoomCode = m.code;
          console.info(`[apex] online room ${m.code}`);
          if (!session && !starting) {
            app.go('menu');
            show('lobby');
          }
        }
        if (m.phase !== 'lobby') {
          readySent = false;
          startSent = false;
          break;
        }
        if (!autoOnline) break;
        const me = m.players.find((p) => p.id === netLobby.get().myId);
        if (me && !me.ready && !readySent) {
          readySent = true;
          n.send({ type: 'setReady', ready: true });
        }
        if (launch.autostart && m.ownerId === me?.id && !startSent && m.players.length >= 2 && m.players.every((p) => p.ready)) {
          startSent = true;
          n.send({ type: 'start' });
        }
        break;
      }
      default:
        break;
    }
  };

  const onlineAction = (f: (n: NetClient) => void): void => {
    if (net) f(net);
  };

  const dispatch = (a: UiAction): void => {
    if (a.type === 'onlineListRooms' && (screen !== 'online' || netLobby.get().kicked || netLobby.get().room)) return;
    if (a.type === 'onlineCreate' || a.type === 'onlineJoin' || a.type === 'onlineQuickJoin') lastRoomCode = null;
    // Browsing can establish an identity before joining. A changed name/server must not resume the old identity.
    if ((a.type === 'onlineListRooms' || a.type === 'onlineQuickJoin' || a.type === 'onlineCreate' || a.type === 'onlineJoin')
      && net && netMod && netKey !== `${netMod.defaultServerUrl(a.server ?? launch.server, window.location)}|${a.name}`) net.close(true);
    switch (a.type) {
      case 'onlineListRooms':
        void ensureNet(a.name, a.server).then((n) => {
          if (screen === 'online' && !netLobby.get().kicked && !netLobby.get().room) n.listRooms?.();
        });
        return;
      case 'onlineQuickJoin':
        void ensureNet(a.name, a.server).then((n) => n.quickJoin?.());
        return;
      case 'onlineCreate':
        void ensureNet(a.name, a.server).then((n) => n.send({ type: 'create', settings: a.settings }));
        return;
      case 'onlineJoin':
        void ensureNet(a.name, a.server).then((n) => n.send({ type: 'join', code: a.code }));
        return;
      case 'onlineLeave':
        leaveOnline();
        return;
      case 'onlineReady':
        onlineAction((n) => n.send({ type: 'setReady', ready: a.ready }));
        return;
      case 'onlineSetCar':
        onlineAction((n) => n.send({ type: 'setCar', teamId: a.teamId, driverIdx: a.driverIdx }));
        return;
      case 'onlineSettings':
        onlineAction((n) => n.send({ type: 'setSettings', settings: a.settings }));
        return;
      case 'onlineStart':
        onlineAction((n) => n.send({ type: 'start' }));
        return;
      case 'onlineSetTeam':
        onlineAction((n) => n.send({ type: 'setTeam', team: a.team }));
        return;
      case 'onlineBackToLobby':
        onlineAction((n) => n.send({ type: 'backToLobby' }));
        app.go('menu');
        show('lobby');
        return;
      default:
        break;
    }
    // Online race: no restart, and retire / quit leave the room (design §5.4, P3 rules).
    if (onlineRace && (a.type === 'restart' || a.type === 'restartLap' || a.type === 'skipToResults')) return;
    if (onlineRace && a.type === 'retire') {
      leaveOnline();
      return;
    }
    // D-056 main-menu exit while online (in the race or on its results): retire, leave the room, main menu.
    if (a.type === 'quitToMenu' && (onlineRace || netLobby.get().room)) {
      leaveOnline('mainMenu');
      return;
    }
    switch (a.type) {
      case 'navigate':
        if (app.current() === 'title' && a.to === 'mainMenu') {
          void audio.unlock(); // also reached without a DOM gesture (gamepad, __APEX__.input); unlock() is idempotent
          app.go('menu');
        }
        if (a.to === 'title') app.go('title');
        show(a.to);
        break;
      case 'back':
        if (session && session.uiState() === 'paused') session.resume();
        else show('mainMenu');
        break;
      case 'startRace':
        void startSession(menuConfigFor('race'), launch.skipLights);
        break;
      case 'startTimeTrial':
        void startSession(menuConfigFor('timeTrial'), true);
        break;
      case 'resume':
        session?.resume();
        break;
      case 'restartLap':
        session?.resume();
        session?.restartLap();
        break;
      case 'restart':
        if (lastCfg) void startSession(lastCfg, launch.skipLights || lastCfg.mode === 'timeTrial');
        break;
      case 'quitToMenu': {
        // D-056 / QA-19-03: "Main menu" means the main menu, Time Trial included (its summary is "End session", the retire slot).
        endSession('quit');
        app.go('menu');
        show('mainMenu');
        break;
      }
      case 'retire':
        // Time Trial: the retire slot is "End session" → the TT summary (QA-19-03).
        if (session?.cfg.mode === 'timeTrial') {
          endSession('quit');
          app.go('results');
          show('ttResults');
          break;
        }
        session?.retire();
        showResults();
        break;
      case 'skipToResults':
        showResults();
        break;
      case 'toggleFullscreen':
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.();
        break;
    }
  };

  ui.mount(uiRoot, createUiDeps(services, stores, dispatch, {
    net: netLobby,
    serverNow: () => (net ? net.serverNow() : performance.now()),
  }));

  settings.subscribe((s) => {
    if (launch.quality) return;
    const id = s.graphics.preset === 'custom' ? 'high' : s.graphics.preset;
    if (ctx.quality.id !== id) {
      graphics.setQuality(services.presetFor(id));
      bus.emit('quality:changed', { id });
    }
  });

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    session?.pause();
    showFatal([i18n.t('errors.contextLost'), i18n.t('errors.reload')], () => window.location.reload());
  });

  apex.attachApp({
    // CR-17 / CR-07
    screen: () => ui.screen(),
    audio: () => ({ unlocked: audio.isUnlocked(), voices: audio.voices() }),
    startSession: async (cfg) => {
      const { skipLights, ...rest } = cfg ?? {};
      const base = sessionConfigFor(rest.mode ?? 'race');
      await startSession({ ...base, ...rest }, skipLights ?? launch.skipLights);
    },
    lastReplay: () => {
      const d = session?.replay() ?? lastReplay;
      return d ? encodeReplay(d) : null;
    },
    setQuality: (id) => {
      graphics.setQuality(services.presetFor(id));
      bus.emit('quality:changed', { id });
    },
    net: () => net?.stats() ?? null,
  });

  if (autoOnline) {
    // `?name=N[&server=…][&room=CODE]`: join that room, or create one from the launch params (track/laps/ai/…).
    startShowroom();
    app.go('menu');
    show('online');
    apex.setReady(true);
    const n = await ensureNet(launch.name!);
    if (launch.room) n.send({ type: 'join', code: launch.room });
    else {
      const laps = launch.laps === 3 || launch.laps === 5 || launch.laps === 10 ? launch.laps : 1;
      n.send({
        type: 'create',
        settings: {
          trackId: launchTrack, laps, tod: launch.tod ?? 'day', weather: launch.weather ?? 'dry', aiCount: launch.ai ?? 0,
          difficulty: launch.difficulty ?? settings.get().gameplay.difficulty,
        },
      });
    }
  } else if (launch.autostart) {
    apex.setReady(true);
    await startSession(withRuleFlags(sessionConfigFor(launch.mode === 'tt' ? 'timeTrial' : 'race')), launch.skipLights || launch.mode === 'tt');
  } else {
    startShowroom();
    app.go('title');
    show('title');
    apex.setReady(true);
  }
}

if (launch.scene) {
  void import('./sandbox/router').then((m) => m.mountSandbox(launch.scene!, { appEl, uiRoot, apex, launch }));
} else {
  boot().catch((err: unknown) => console.error('[apex] boot failed', err));
}
