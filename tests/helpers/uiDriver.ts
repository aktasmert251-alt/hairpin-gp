// UI Tester helpers (Arayüz Testçisi): keyboard / mouse drivers, focus invariants, screen navigation and in-game probes for
// tests/e2e/ui-*.spec.ts. Pure helper: reads `window.__APEX__` and the DOM, never touches src. See docs/qa/test-ui-controls.md.
//
// Serving: the ui-* specs target a private preview build on port 5183 (npx vite preview --outDir test-results/ui-dist --port 5183).
// `APEX_BASE_URL` overrides it (then the playwright.config webServer is not started).

import { expect, type Page } from '@playwright/test';
import { ApexClient, urlWith, type UrlParams } from './apexClient';
import { decodePng } from './png';
import { saveScreen } from './screens';

export const UI_BASE = process.env.APEX_BASE_URL ?? 'http://localhost:5183';
export const SHOT_DIR = 'ui-test';
export const SETTINGS_KEY = 'apexgp:v1:settings';
export const VIEWPORT = { width: 1920, height: 1080 };

/** Expert preset (manual gearbox, no steering / brake / ERS / DRS assists, no brake limiter): raw key -> VehicleInput mapping. */
export const EXPERT_ASSISTS = {
  steering: false, braking: 'off', abs: false, tc: 'off', gearbox: 'manual', racingLine: 'off', pit: false, ers: false, drs: false, kbBrakeLimiter: false,
} as const;

export interface TelemetryLite {
  kmh: number; tick: number; time: number;
  input: { throttle: number; brake: number; steer: number; ersOvertake: boolean; pitLimiter: boolean; ersMode: string; brakeBias: number };
  controls: { ersModeSel: string; brakeBias: number; boxRequest: boolean; throttle: boolean; brake: boolean; left: boolean; right: boolean };
  vehicle: { rpm: number; gear: number; s: number; pitLimiterOn: boolean; drs: { open: boolean; flap: number }; speed: number };
  race: { lapValid: boolean; drsZone: number; lapsCompleted: number; lapStartMs: number };
}

/** Writes a partial settings object into localStorage before the first document script (once per tab, so reloads keep UI changes). */
export async function seedSettings(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.addInitScript(([key, p]) => {
    try {
      if (window.sessionStorage.getItem('__uiSeeded')) return;
      window.sessionStorage.setItem('__uiSeeded', '1');
      const cur = JSON.parse(window.localStorage.getItem(key as string) ?? '{}') as Record<string, unknown>;
      const merge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
        for (const [k, v] of Object.entries(b)) {
          a[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge((a[k] ?? {}) as Record<string, unknown>, v as Record<string, unknown>) : v;
        }
        return a;
      };
      window.localStorage.setItem(key as string, JSON.stringify(merge(cur, p as Record<string, unknown>)));
    } catch { /* storage unavailable */ }
  }, [SETTINGS_KEY, patch] as const);
}

export interface FocusInfo {
  id: string | null;
  screen: string | null;
  /** [data-focus-id].is-focus elements in the active screen (tabs excluded unless the tab list is the focus level). */
  marked: number;
  activeIsMarked: boolean;
  visible: boolean;
  /** the focused element draws an outline (e.g. :focus-visible on the credits box). */
  outline: boolean;
  clipped: string;
  rect: { x: number; y: number; w: number; h: number } | null;
}

export class Ui {
  constructor(readonly apex: ApexClient, readonly page: Page) {}

  // ---------------------------------------------------------------- input primitives
  async key(code: string, wait = 200): Promise<void> {
    await this.page.keyboard.press(code);
    if (wait > 0) await this.page.waitForTimeout(wait);
  }
  async keys(codes: string[], wait = 200): Promise<void> {
    for (const c of codes) await this.key(c, wait);
  }
  down(code: string): Promise<void> { return this.page.keyboard.down(code); }
  up(code: string): Promise<void> { return this.page.keyboard.up(code); }

  /** Dispatches a raw keydown/keyup pair with an arbitrary `key` (layout) but a fixed `code`, bypassing Playwright's US layout. */
  async rawKey(code: string, key: string, holdMs = 0, opts: { ctrl?: boolean; alt?: boolean; meta?: boolean } = {}): Promise<void> {
    await this.page.evaluate(([c, k, o]) => {
      const init = { code: c, key: k, bubbles: true, cancelable: true, ctrlKey: !!(o as { ctrl?: boolean }).ctrl, altKey: !!(o as { alt?: boolean }).alt, metaKey: !!(o as { meta?: boolean }).meta };
      window.dispatchEvent(new KeyboardEvent('keydown', init));
      (window as unknown as { __rawUp?: () => void }).__rawUp = () => window.dispatchEvent(new KeyboardEvent('keyup', init));
    }, [code, key, opts] as const);
    if (holdMs > 0) await this.page.waitForTimeout(holdMs);
    if (holdMs >= 0) await this.rawUp();
  }
  async rawDown(code: string, key: string, opts: { ctrl?: boolean; alt?: boolean; meta?: boolean } = {}): Promise<void> {
    await this.rawKey(code, key, -1, opts);
  }
  async rawUp(): Promise<void> {
    await this.page.evaluate(() => (window as unknown as { __rawUp?: () => void }).__rawUp?.());
  }

  // ---------------------------------------------------------------- reads
  screen(): Promise<string | null> { return this.apex.uiScreen(); }
  focusId(): Promise<string | null> { return this.apex.focusId(); }

  async waitScreen(id: string | null, timeout = 10_000): Promise<void> {
    await expect.poll(() => this.screen(), { timeout, message: `ui.screen() should become ${id}` }).toBe(id);
  }
  async waitFocus(id: string, timeout = 5_000): Promise<void> {
    await expect.poll(() => this.focusId(), { timeout, message: `ui.focusId() should become ${id}` }).toBe(id);
  }

  /** Focus model snapshot of the visible screen: DOM focus, the single `.is-focus` marker and whether it is actually visible. */
  focusInfo(): Promise<FocusInfo> {
    return this.page.evaluate((vp) => {
      const api = (window as unknown as { __APEX__: { ui: { screen(): string | null; focusId(): string | null } } }).__APEX__;
      const active = document.activeElement as HTMLElement | null;
      const host = active?.closest<HTMLElement>('[data-focus-id]') ?? null;
      const screenEl = document.querySelector<HTMLElement>(`.apx-screen[data-screen="${api.ui.screen()}"]`);
      const visibleOnly = (el: HTMLElement): boolean => !el.closest('[hidden]') && el.getClientRects().length > 0;
      const all = screenEl ? [...screenEl.querySelectorAll<HTMLElement>('[data-focus-id].is-focus')].filter(visibleOnly) : [];
      const hostIsTab = !!host?.classList.contains('m-tab');
      const marked = all.filter((e) => hostIsTab || !e.classList.contains('m-tab')).length;
      let visible = false;
      let outline = false;
      let clipped = '';
      let rect: FocusInfo['rect'] = null;
      if (host) {
        const r = host.getBoundingClientRect();
        rect = { x: r.x, y: r.y, w: r.width, h: r.height };
        const cs = getComputedStyle(host);
        outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
        visible = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.right > 0 && r.bottom > 0 && r.left < vp.width && r.top < vp.height;
        if (visible && (r.left < -1 || r.top < -1 || r.right > vp.width + 1 || r.bottom > vp.height + 1)) { visible = false; clipped = 'viewport'; }
        for (let p = host.parentElement; visible && p && p !== document.body; p = p.parentElement) {
          const pcs = getComputedStyle(p);
          if (pcs.overflow === 'hidden' || pcs.overflowY === 'hidden' || pcs.overflow === 'clip') {
            const pr = p.getBoundingClientRect();
            if (r.bottom > pr.bottom + 1 || r.top < pr.top - 1) { visible = false; clipped = `clipped by ${p.className || p.tagName}`; }
          }
        }
        for (let p: HTMLElement | null = host; visible && p; p = p.parentElement) {
          if (p.hidden || getComputedStyle(p).visibility === 'hidden') { visible = false; clipped = 'hidden ancestor'; }
        }
      }
      return { id: api.ui.focusId(), screen: api.ui.screen(), marked, activeIsMarked: !!host?.classList.contains('is-focus'), visible, outline, clipped, rect };
    }, VIEWPORT);
  }

  /** Invariant of ui-hud §6 / DESIGN §7.6: exactly one focused element, it carries the marker, and it is visible on screen. */
  async expectFocus(id: string, why = ''): Promise<void> {
    const f = await this.focusInfo();
    const msg = `${why} focus=${f.id} screen=${f.screen} marked=${f.marked} visible=${f.visible} ${f.clipped}`;
    expect(f.id, msg).toBe(id);
    expect(f.marked, `at most one focus marker: ${msg}`).toBeLessThanOrEqual(1);
    expect(f.activeIsMarked || f.outline, `DOM focus is drawn (.is-focus or outline): ${msg}`).toBe(true);
    if (!f.outline) expect(f.marked, `exactly one focus marker: ${msg}`).toBe(1);
    expect(f.visible, `focused element visible: ${msg}`).toBe(true);
  }

  /** data-focus-id of the (single) visible `.is-focus` marker of the active screen (what the user sees highlighted), independent of DOM focus. */
  markedId(): Promise<string | null> {
    return this.page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.apx-screen[data-active="1"] [data-focus-id].is-focus')].filter((e) => !e.classList.contains('m-tab') && !e.closest('[hidden]'));
      return el.length === 1 ? el[0]!.dataset.focusId! : el.length === 0 ? null : `MULTIPLE:${el.map((e) => e.dataset.focusId).join(',')}`;
    });
  }

  /** textContent of a control (rows: label + value). */
  text(id: string): Promise<string> {
    return this.page.evaluate((i) => document.querySelector<HTMLElement>(`.apx-screen[data-active="1"] [data-focus-id="${i}"]`)?.textContent ?? '', id);
  }
  /** Value shown by a stepper row. */
  stepValue(id: string): Promise<string> {
    return this.page.evaluate((i) => document.querySelector<HTMLElement>(`[data-focus-id="${i}"] .c-step .val`)?.textContent ?? '', id);
  }
  /** Index of the lit option tick of a stepper row, and the number of options. */
  stepIndex(id: string): Promise<{ index: number; count: number }> {
    return this.page.evaluate((i) => {
      const ix = [...(document.querySelector(`[data-focus-id="${i}"] .c-step .ix`)?.children ?? [])];
      return { index: ix.findIndex((e) => e.classList.contains('on')), count: ix.length };
    }, id);
  }
  toggleValue(id: string): Promise<boolean> {
    return this.page.evaluate((i) => document.querySelector(`[data-focus-id="${i}"]`)?.getAttribute('aria-checked') === 'true', id);
  }
  sliderValue(id: string): Promise<number> {
    return this.page.evaluate((i) => Number(document.querySelector(`[data-focus-id="${i}"]`)?.getAttribute('aria-valuenow')), id);
  }
  /** Chip labels of a key-binding row. */
  bindChips(action: string): Promise<string[]> {
    return this.page.evaluate((a) => [...document.querySelectorAll(`[data-focus-id="set.c.bind.${a}"] .apx-kc`)].map((e) => (e.textContent ?? '').trim()), action);
  }

  async stored(): Promise<any> {
    await this.page.waitForTimeout(800); // SettingsStore debounce is 500 ms
    const raw = await this.page.evaluate((k) => localStorage.getItem(k), SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  async shot(name: string): Promise<string> {
    return (await saveScreen(this.page, SHOT_DIR, name, { requireNotBlank: false })).relPath;
  }

  // ---------------------------------------------------------------- navigation (keyboard)
  /** Boot to the title, wait for the intro to be skippable, Space -> main menu. */
  async toMainMenu(params: UrlParams = {}): Promise<void> {
    await this.apex.open(urlWith({ ...params }), 'sceneReady');
    await this.page.waitForTimeout(400);
    await this.key('Space');
    await this.apex.waitForState('menu', 15_000);
    await this.waitScreen('mainMenu');
    await this.page.waitForTimeout(250);
  }

  /** Arrow keys (Down then Up) until `ui.focusId()` equals `id`. */
  async focusViaKeys(id: string, max = 40): Promise<void> {
    for (const step of ['ArrowDown', 'ArrowUp']) {
      let prev = '';
      for (let i = 0; i < max; i++) {
        const f = (await this.focusId()) ?? '';
        if (f === id) return;
        if (f === prev) break;
        prev = f;
        await this.key(step, 120);
      }
    }
    expect(await this.focusId(), `could not focus ${id}`).toBe(id);
  }

  /** Goes main menu -> target through the keyboard only. */
  async goTo(target: 'ttSetup' | 'raceConditions' | 'teamSelect' | 'raceSettings' | 'assists' | 'settings' | 'credits'): Promise<void> {
    const entry = { ttSetup: 'main.timeTrial', raceConditions: 'main.quickRace', teamSelect: 'main.quickRace', raceSettings: 'main.quickRace', assists: 'main.quickRace', settings: 'main.settings', credits: 'main.credits' }[target];
    await this.focusViaKeys(entry);
    await this.key('Enter', 400);
    const chain = ['raceConditions', 'teamSelect', 'raceSettings', 'assists'];
    const first = { ttSetup: 'ttSetup', settings: 'settings', credits: 'credits' }[target as string] ?? 'raceConditions';
    await this.waitScreen(first);
    if (chain.includes(target)) {
      for (let i = chain.indexOf(first); i < chain.indexOf(target); i++) {
        const cta = `${chain[i]}.cta`;
        await this.focusViaKeys(cta);
        await this.key('Enter', 400);
        await this.waitScreen(chain[i + 1]!);
      }
    }
    await this.page.waitForTimeout(250);
  }

  /** From the main menu: Settings, then the tab (keyboard). Leaves focus at the tabs level on that tab. */
  async openSettingsTab(tab: 'graphics' | 'audio' | 'controls' | 'assists' | 'hud' | 'language' | 'interface'): Promise<void> {
    await this.goTo('settings');
    await this.focusViaKeys(`settings.tab.${tab}`);
  }

  // ---------------------------------------------------------------- mouse
  /** Viewport centre (or a fractional point) of the control `id` on the visible screen. */
  async box(id: string, sel = ''): Promise<{ x: number; y: number; w: number; h: number }> {
    const b = await this.page.evaluate(([i, s]) => {
      const root = document.querySelector(`.apx-screen[data-active="1"] [data-focus-id="${i}"]`) ?? document.querySelector(`[data-focus-id="${i}"]`);
      const el = (s ? root?.querySelector(s as string) : root) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, [id, sel] as const);
    if (!b) throw new Error(`no element for ${id} ${sel}`);
    return b;
  }
  async hover(id: string, sel = '', fx = 0.5, steps = 4): Promise<void> {
    const b = await this.box(id, sel);
    await this.page.mouse.move(b.x + b.w * fx, b.y + b.h / 2, { steps });
    await this.page.waitForTimeout(150);
  }
  async click(id: string, sel = '', fx = 0.5, wait = 300): Promise<void> {
    const b = await this.box(id, sel);
    await this.page.mouse.move(b.x + b.w * fx, b.y + b.h / 2, { steps: 3 });
    await this.page.mouse.down();
    await this.page.mouse.up();
    if (wait > 0) await this.page.waitForTimeout(wait);
  }
  async clickHint(kind: 'back' | 'move' | 'change' | 'select' = 'back', wait = 400): Promise<void> {
    const b = await this.page.evaluate((k) => {
      const el = document.querySelector<HTMLElement>(`.apx-screen[data-active="1"] [data-hint="${k}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, kind);
    if (!b) throw new Error(`no hint ${kind}`);
    await this.page.mouse.click(b.x, b.y);
    await this.page.waitForTimeout(wait);
  }

  // ---------------------------------------------------------------- in-game probes
  /** Opens `?mode=race|tt&autostart=1&laps=3&ai=0` and waits for the running phase. Extra settings are seeded first. */
  async startGame(o: { mode?: 'race' | 'tt'; settings?: Record<string, unknown>; params?: UrlParams; assists?: 'expert' | 'default'; ai?: number } = {}): Promise<void> {
    const settings: Record<string, unknown> = { ...(o.settings ?? {}) };
    if (o.assists !== 'default') settings.assists = { ...EXPERT_ASSISTS, ...((o.settings?.assists as object) ?? {}) };
    await seedSettings(this.page, settings);
    await this.apex.goto({ mode: o.mode ?? 'race', autostart: 1, laps: 3, ai: o.ai ?? 0, skipLights: 1, seed: 7, nopost: 1, ...(o.params ?? {}) });
    await this.apex.whenReady('ready');
    await this.apex.waitForState('session', 90_000);
    await this.apex.waitForPhase('running', 60_000);
    await this.page.waitForFunction(() => (window as unknown as { __APEX__: { ui: { screen(): string | null } } }).__APEX__.ui.screen() === null, undefined, { timeout: 30_000 });
    await this.page.waitForTimeout(600);
  }

  /** Track length in m (null outside a session / before the track is loaded). */
  trackLength(): Promise<number> {
    return this.page.evaluate(() => (window as unknown as { __APEX__: { track(): { length: number } | null } }).__APEX__.track()?.length ?? 0);
  }
  async tele(): Promise<TelemetryLite> {
    const t = (await this.apex.telemetry()) as unknown as TelemetryLite | null;
    if (!t) throw new Error('no telemetry (no session)');
    return t;
  }
  async hud() { return (await this.apex.getHud())!; }
  /** Wait for simulation progress rather than assuming wall time equals sim time under GPU load. */
  async waitSimSeconds(seconds: number): Promise<void> {
    const deadline = (await this.tele()).time + seconds;
    await this.page.waitForFunction((t) => (window.__APEX__.getTelemetry()?.time ?? -1) >= t, deadline, { timeout: 10_000 });
  }
  /** Sim ticks elapse (the sim is running) -> true; frozen (paused / flashback) -> false. */
  async simRunning(ms = 400): Promise<boolean> {
    const a = (await this.tele()).tick;
    await this.page.waitForTimeout(ms);
    return (await this.tele()).tick > a;
  }
  /** Puts the player on the track at `s` m moving at `kmh`. */
  async roll(s: number, kmh: number): Promise<void> {
    await this.apex.teleport(0, s, 0, kmh);
    await this.page.waitForTimeout(150);
  }

  /** Mean fraction of central-screen pixels that differ between two frames (view / line changes) in 0..1. */
  async frame(): Promise<{ w: number; h: number; px: Uint8Array }> {
    await this.apex.nextFrames(3);
    const png = await this.page.screenshot({ type: 'png', clip: { x: 360, y: 120, width: 1200, height: 560 } });
    const d = decodePng(png);
    return { w: d.width, h: d.height, px: d.rgba };
  }
  static diff(a: { px: Uint8Array }, b: { px: Uint8Array }): number {
    let n = 0;
    const len = Math.min(a.px.length, b.px.length);
    for (let i = 0; i < len; i += 4) {
      const d = Math.abs(a.px[i]! - b.px[i]!) + Math.abs(a.px[i + 1]! - b.px[i + 1]!) + Math.abs(a.px[i + 2]! - b.px[i + 2]!);
      if (d > 48) n++;
    }
    return n / (len / 4);
  }
}
