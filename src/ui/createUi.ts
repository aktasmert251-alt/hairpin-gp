// Real UiSystem (Grafik-UI): HUD + every screen, keyboard-only navigation, TR/EN through I18n, motion per DESIGN §7.
// Screens sit on a 1920 × 1080 stage scaled by kView; the HUD has its own frame and scale (hud.scale).
// `dispose()` removes every DOM node, listener, subscription and GSAP tween this module created.

import type { Unsubscribe } from '../contracts/common';
import type { HudModel } from '../contracts/hud';
import type { ActionId } from '../contracts/input';
import type { Settings } from '../contracts/settings';
import type { ScreenId, UiDeps, UiSystem } from '../contracts/ui';
import { h } from './dom';
import { createHud, type Hud } from './hud/Hud';
import { createFpsCounter, type FpsCounter } from './hud/fps';
import { createMotionPrefs, gsap, type MotionPrefs } from './motion/gsap';
import type { Screen, ScreenCtx, SoundKind } from './screens/ctx';
import { createLoading } from './screens/loading';
import { MainMenu } from './screens/mainMenu';
import { Pause } from './screens/pause';
import { createCredits } from './screens/credits';
import { SettingsScreen } from './screens/settings';
import { TtResults, TtSetup } from './screens/timeTrial';
import { Assists, RaceConditions, RaceSettings, TeamSelect } from './screens/raceSetup';
import { Results } from './screens/results';
import { createTitle } from './screens/title';
import { createTrailer, trailerAllowed, type Trailer } from './screens/trailer';
import { fontsReady, injectStyles, preloadFonts } from './styles/index';
import { createTouchOverlay, type TouchOverlay } from './touch/overlay';
import { createMobileChrome, type MobileChrome } from './touch/mobileUi';

const INPUT_GUARD_MS = 120;

interface HasI18n {
  has?(key: string): boolean;
  upper?(s: string): string;
}

export function createUi(): UiSystem & { screen(): ScreenId | null } {
  let deps: UiDeps | null = null;
  let host: HTMLElement | null = null;
  let layer: HTMLElement | null = null;
  let bgInk: HTMLElement | null = null;
  let bgShow: HTMLElement | null = null;
  let scrim: HTMLElement | null = null;
  let hud: Hud | null = null;
  let touchUi: TouchOverlay | null = null;
  let chrome: MobileChrome | null = null;
  let fps: FpsCounter | null = null;
  let prefs: MotionPrefs | null = null;
  let releaseStyles: (() => void) | null = null;
  const screens = new Map<ScreenId, Screen>();
  const unsubs: Unsubscribe[] = [];
  const tweens = new Set<{ kill(): unknown }>();
  let current: Screen | null = null;
  let prevId: ScreenId | null = null;
  let shownAt = 0;
  let hudWanted = false;
  let trailer: Trailer | null = null;
  let trailerShown = false;
  let disposed = false;
  let screenCtx: ScreenCtx | null = null;
  let showRequest = 0;
  const lazyScreens = new Map<ScreenId, Promise<Screen>>();

  const track = <T extends { kill(): unknown }>(tw: T): T => {
    tweens.add(tw);
    if (tweens.size > 96) for (const x of tweens) if (!(x as unknown as gsap.core.Animation).isActive()) tweens.delete(x);
    return tw;
  };

  const reduced = (): boolean => prefs?.reduced() ?? false;

  const layout = (): void => {
    if (!layer) return;
    const vw = window.innerWidth || 1920;
    const vh = window.innerHeight || 1080;
    // Phone (touch UI, short landscape viewport): the stage fills the width and the screens scroll vertically (touch.css);
    // everywhere else the whole 1920 × 1080 stage fits as before.
    const phone = host?.dataset.phone === '1';
    const kv = phone ? Math.min(2, vw / 1920) : Math.min(2, vw / 1920, vh / 1080);
    layer.style.setProperty('--mkv', String(kv));
    layer.style.setProperty('--m-text-min', `${(phone ? 13 : 12) / kv}px`);
    layer.style.setProperty('--mx', `${(vw - 1920 * kv) / 2}px`);
    layer.style.setProperty('--my', `${phone ? 0 : (vh - 1080 * kv) / 2}px`);
  };

  const applyBackdrop = (s: Screen | null): void => {
    const b = s?.backdrop ?? 'none';
    if (bgInk) bgInk.hidden = b !== 'ink';
    if (bgShow) bgShow.hidden = b !== 'showroom';
    if (scrim) {
      scrim.hidden = b !== 'showroom';
      scrim.classList.toggle('wide', !!s?.wideScrim);
    }
  };

  const exitScreen = (s: Screen): void => {
    // A fading screen may sit later in DOM order than the destination. Remove it from hit testing immediately,
    // while keeping the visual exit animation; otherwise its full-screen section swallows fresh clicks.
    s.el.inert = true;
    s.leave();
    const done = (): void => {
      if (current !== s) s.el.dataset.active = '0';
      gsap.set(s.el, { clearProps: 'opacity' });
      for (const e of s.animated()) gsap.set(e, { clearProps: 'transform,opacity' });
    };
    gsap.killTweensOf(s.el);
    if (reduced()) {
      track(gsap.to(s.el, { opacity: 0, duration: 0.1, ease: 'none', onComplete: done }));
      return;
    }
    track(gsap.to(s.el, { opacity: 0, duration: 0.14, ease: 'apex.in', onComplete: done }));
    const els = s.animated();
    if (els.length) track(gsap.to(els, { x: -12, duration: 0.14, ease: 'apex.in' }));
  };

  const enterScreen = (s: Screen): void => {
    gsap.killTweensOf(s.el);
    s.el.dataset.active = '1';
    if (reduced()) {
      track(gsap.fromTo(s.el, { opacity: 0 }, { opacity: 1, duration: 0.12, ease: 'none', clearProps: 'opacity' }));
      return;
    }
    gsap.set(s.el, { opacity: 1 });
    const els = s.animated();
    if (els.length) track(gsap.fromTo(els, { x: -24, opacity: 0 }, { x: 0, opacity: 1, duration: 0.22, ease: 'apex.out', clearProps: 'transform,opacity' }));
    const items = s.stagger?.() ?? [];
    if (items.length) track(gsap.fromTo(items.slice(0, 8), { opacity: 0 }, { opacity: 1, duration: 0.22, ease: 'apex.out', stagger: 0.024, clearProps: 'opacity' }));
  };

  // ---- touch (mobile, 2026-11-21) ----
  let screenUp = true;
  /** Overlay visible only while racing with no screen on top, touch driving and the phone in landscape. */
  const syncTouch = (screenVisible: boolean): void => {
    screenUp = screenVisible;
    const t = deps?.touch;
    if (!t) return;
    chrome?.sync();
    layout();
    hud?.setTouch(t.uiTouch());
    touchUi?.setShown(!screenVisible && hudWanted && t.drives() && !(chrome?.portrait() ?? false));
  };
  /** PIT: open the MFD strategy page (race) and toggle the box request (row 1). */
  const pitRequest = (): void => {
    const t = deps?.touch;
    const m = hud?.last();
    if (!t || !m || m.mode === 'timeTrial') return;
    const tap = (a: ActionId): void => {
      t.press(a);
      t.release(a);
    };
    if (!(m.mfd.open && m.mfd.page === 'strategy')) {
      for (let i = 0; i < 6 && m.mfd.open; i++) tap('mfdNext');
      tap('mfdNext');
    }
    if (m.mfd.open && m.mfd.page === 'strategy') tap('mfd1');
  };
  const mountTouch = (d: UiDeps, root: HTMLElement): void => {
    const t = d.touch!;
    h('div', 'apx-safe-probe', root).setAttribute('aria-hidden', 'true');
    touchUi = createTouchOverlay(root, t, d.i18n.t, { pitRequest });
    chrome = createMobileChrome(root, {
      t: d.i18n.t, touchUi: () => t.uiTouch(),
      back: () => {
        if (current && current.id !== 'title' && current.id !== 'loading') current.action('menuBack');
      },
    });
    const applyTouch = (s: Readonly<Settings>): void => {
      touchUi?.apply(s.controls.touch, d.setup.get().assists?.gearbox === 'manual');
      syncTouch(screenUp);
    };
    applyTouch(d.settings.get());
    unsubs.push(d.settings.subscribe(applyTouch));
    unsubs.push(d.setup.subscribe(() => applyTouch(d.settings.get())));
    unsubs.push(d.bus.on('lang:changed', () => {
      touchUi?.relabel();
      chrome?.relabel();
    }));
    const onResize = (): void => syncTouch(screenUp);
    window.addEventListener('resize', onResize);
    unsubs.push(() => window.removeEventListener('resize', onResize));
  };

  const ui: UiSystem & { screen(): ScreenId | null } = {
    mount(root, d) {
      deps = d;
      preloadFonts();
      releaseStyles = injectStyles();
      const ext = d.i18n as unknown as HasI18n;
      const has = (k: string): boolean => (ext.has ? ext.has(k) : d.i18n.t(k) !== k);
      const upper = (s: string): string => (ext.upper ? ext.upper(s) : s.toLocaleUpperCase(d.i18n.lang() === 'tr' ? 'tr-TR' : 'en-US'));
      prefs = createMotionPrefs(d.settings.get().ui.animations);
      host = h('div', 'apx-ui', root);
      host.dataset.fonts = 'loading';
      host.lang = d.i18n.lang();
      host.classList.toggle('is-reduced', prefs.reduced());
      unsubs.push(prefs.onChange((r) => host?.classList.toggle('is-reduced', r)));
      void fontsReady().then(() => {
        if (host) delete host.dataset.fonts;
      });

      hud = createHud(host, {
        t: d.i18n.t, has, lang: () => d.i18n.lang(), reduced, key: (c) => upper(d.keys.label(c)),
        padButton: (a) => (d.pad?.lastDevice() === 'gamepad' ? d.pad.bindings()[a]?.[0] ?? null : null),
        track: () => d.setup.get().trackId,
        act: (a) => {
          d.touch?.press(a);
          d.touch?.release(a);
        },
        tt: () => {
          const tt = d.tt.get();
          return { pbMs: tt.pbMs, laps: tt.laps, ghost: d.setup.get().ghost };
        },
      });
      const s0 = d.settings.get();
      hud.setScale(s0.hud.scale);
      hud.setUnits(s0.hud.units);
      hud.setMinimap(s0.hud.minimap);
      fps = createFpsCounter(host);
      fps.setOn(s0.graphics.showFps);
      if (d.touch) mountTouch(d, host);

      layer = h('div', 'apx-screens', host);
      bgInk = h('div', 'm-bg', layer);
      bgShow = h('div', 'm-show', layer);
      bgShow.setAttribute('aria-hidden', 'true');
      h('div', 'light', bgShow);
      h('div', 'floor', bgShow);
      h('div', 'turn', bgShow);
      h('b', '', h('div', 'car', bgShow));
      scrim = h('div', 'm-scrim', layer);
      applyBackdrop(null);
      layout();
      window.addEventListener('resize', layout);

      const ctx: ScreenCtx = {
        deps: d,
        t: d.i18n.t,
        has,
        lang: () => d.i18n.lang(),
        upper,
        reduced,
        sound: (kind: SoundKind) => d.bus.emit('ui:sound', { kind }),
        dispatch: (a) => d.dispatch(a),
        go: (id) => d.dispatch({ type: 'navigate', to: id }),
        track,
        hudLast: () => hud?.last() ?? null,
        prev: () => prevId,
        playTrailer: (onDone) => {
          if (!trailer || trailer.playing()) return;
          trailer.play(onDone ?? (() => {}));
        },
        trailerDue: () => !trailerShown && d.settings.get().ui.trailer && trailerAllowed(),
        markTrailerShown: () => { trailerShown = true; },
        // Native pointer events already belong to their originating screen. Fresh presses must work during
        // entrance too; a time gate silently discards a user's first click after navigation.
        live: (id) => current?.id === id,
      };
      trailer = createTrailer(host, ctx);
      screenCtx = ctx;
      const list: Screen[] = [
        createTitle(ctx), new MainMenu(ctx), new RaceConditions(ctx), new TeamSelect(ctx), new RaceSettings(ctx), new Assists(ctx),
        createLoading(ctx), new Pause(ctx), new Results(ctx),
        new TtSetup(ctx), new SettingsScreen(ctx), new TtResults(ctx), createCredits(ctx),
      ];
      for (const s of list) {
        screens.set(s.id, s);
        layer.appendChild(s.el);
      }

      const teamColour = (id: string): void => {
        const t = d.teams.find((x) => x.id === id);
        if (t && bgShow) bgShow.style.setProperty('--team', t.colors.ui ?? t.colors.primary);
      };
      teamColour(d.setup.get().playerTeamId);
      unsubs.push(d.bus.on('ui:focusTeam', (e) => teamColour(e.teamId)));

      // A fresh physical key may arrive during an entrance animation. A time gate drops that key (notably rapid
      // Escape / Backspace). Instead, keep each native event on the screen where it started; a single event must
      // never act again after navigation or pause opens. Repeats stay with the screen of the original keydown.
      const heldScreens = new Map<string, Screen | null>();
      let keyEvent: KeyboardEvent | null = null;
      let keyScreen: Screen | null = null;
      const captureKey = (e: KeyboardEvent): void => {
        if (!e.repeat) heldScreens.set(e.code, current);
        keyEvent = e;
        keyScreen = heldScreens.get(e.code) ?? null;
      };
      const releaseKey = (e: KeyboardEvent): void => { heldScreens.delete(e.code); };
      const releaseKeys = (): void => { heldScreens.clear(); };
      window.addEventListener('keydown', captureKey, true);
      window.addEventListener('keyup', releaseKey, true);
      window.addEventListener('blur', releaseKeys);
      unsubs.push(() => {
        window.removeEventListener('keydown', captureKey, true);
        window.removeEventListener('keyup', releaseKey, true);
        window.removeEventListener('blur', releaseKeys);
        heldScreens.clear();
      });
      const keyboardLive = (): boolean => keyEvent && keyEvent.eventPhase !== Event.NONE
        ? current === keyScreen : performance.now() - shownAt >= INPUT_GUARD_MS;
      const onAction = (a: ActionId): void => {
        if (!current || !keyboardLive()) return;
        current.action(a);
      };
      unsubs.push(d.menuInput.onAction(onAction));
      const onKey = (e: KeyboardEvent): void => {
        if (!current || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
        if (!keyboardLive()) return;
        if (current.key?.(e.code)) e.preventDefault();
      };
      window.addEventListener('keydown', onKey);
      unsubs.push(() => window.removeEventListener('keydown', onKey));

      // Gamepad: hints follow the device used last; hot-plug and "enable it in settings" toasts.
      unsubs.push(d.bus.on('input:device', () => {
        hud?.relabel();
        current?.render();
      }));
      const toast = h('div', 'apx-toast', host);
      toast.dataset.on = '0';
      toast.setAttribute('role', 'status');
      let toastTimer: ReturnType<typeof setTimeout> | null = null;
      const showToast = (text: string): void => {
        toast.textContent = text;
        toast.dataset.on = '1';
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => (toast.dataset.on = '0'), 3500);
      };
      unsubs.push(() => {
        if (toastTimer) clearTimeout(toastTimer);
      });
      unsubs.push(d.bus.on('input:pad', (e) => {
        const kb = d.settings.get().controls.device === 'keyboard';
        if (e.kind === 'inactive' || (e.kind === 'connected' && kb)) showToast(d.i18n.t('menu.pad.inactive'));
        else if (e.kind === 'connected') showToast(d.i18n.t('menu.pad.connected', { name: e.name }));
        // The session pauses an offline race on the same event (subscribed after the UI): check once it has run.
        else queueMicrotask(() => showToast(d.i18n.t(e.driving && current?.id === 'pause' ? 'menu.pad.disconnectedPaused' : 'menu.pad.disconnected')));
      }));
      unsubs.push(d.bus.on('lang:changed', (e) => {
        if (host) host.lang = e.lang;
        hud?.relabel();
        current?.render();
      }));
      let last = s0;
      unsubs.push(d.settings.subscribe((s) => {
        if (s.hud.scale !== last.hud.scale) hud?.setScale(s.hud.scale);
        if (s.hud.units !== last.hud.units) hud?.setUnits(s.hud.units);
        if (s.hud.minimap !== last.hud.minimap) hud?.setMinimap(s.hud.minimap);
        if (s.graphics.showFps !== last.graphics.showFps) fps?.setOn(s.graphics.showFps);
        if (s.ui.animations !== last.ui.animations) prefs?.setMode(s.ui.animations);
        last = s;
      }));
    },

    show(id) {
      const request = ++showRequest;
      chrome?.setScreen(id);
      if (!screens.has(id) && (id === 'online' || id === 'lobby')) {
        let loading = lazyScreens.get(id);
        if (!loading) {
          // Online code is loaded only when visited; offline menu startup stays unchanged.
          if (!screenCtx) return;
          const ctx = screenCtx;
          loading = id === 'online' ? import('./screens/online').then((m) => new m.Online(ctx))
            : import('./screens/lobby').then((m) => new m.Lobby(ctx));
          lazyScreens.set(id, loading);
        }
        void loading.then((screen) => {
          if (disposed) { screen.dispose(); return; }
          if (!screens.has(id)) { screens.set(id, screen); layer?.appendChild(screen.el); }
          if (showRequest === request) ui.show(id);
        });
        return;
      }
      const next = screens.get(id);
      if (!next || disposed) return;
      shownAt = performance.now();
      if (!next.overlay) hudWanted = false;
      hud?.setShown(hudWanted);
      syncTouch(true);
      if (current === next) {
        next.el.inert = false;
        next.enter(prevId);
        return;
      }
      const old = current;
      prevId = old?.id ?? null;
      current = next;
      if (old) exitScreen(old);
      applyBackdrop(next.overlay ? null : next);
      // Visible before enter() so DOM focus lands on the first item.
      next.el.inert = false;
      next.el.dataset.active = '1';
      next.enter(prevId);
      enterScreen(next);
    },

    hideScreens() {
      showRequest++;
      if (current) {
        prevId = current.id;
        exitScreen(current);
      }
      current = null;
      applyBackdrop(null);
      hudWanted = true;
      hud?.setShown(true);
      chrome?.setScreen(null);
      syncTouch(false);
    },

    updateHud(m: HudModel) {
      hud?.update(m);
      touchUi?.update(m);
    },

    screen() {
      return current?.id ?? null;
    },

    dispose() {
      disposed = true;
      showRequest++;
      for (const u of unsubs.splice(0)) u();
      window.removeEventListener('resize', layout);
      for (const tw of tweens) tw.kill();
      tweens.clear();
      for (const s of screens.values()) {
        gsap.killTweensOf(s.el);
        // Untracked micro tweens (focus notch, stepper value) live on descendants.
        gsap.killTweensOf(s.el.querySelectorAll('*'));
        s.dispose();
      }
      screens.clear();
      trailer?.dispose();
      trailer = null;
      lazyScreens.clear();
      touchUi?.dispose();
      touchUi = null;
      chrome?.dispose();
      chrome = null;
      hud?.dispose();
      hud = null;
      fps?.dispose();
      fps = null;
      prefs?.dispose();
      prefs = null;
      host?.remove();
      host = null;
      layer = null;
      releaseStyles?.();
      releaseStyles = null;
      current = null;
      screenCtx = null;
      deps = null;
    },
  };
  void deps;
  return ui;
}
