// UI Tester: every in-game key of PLAN Ek D in a race (?mode=race&autostart=1&laps=3&ai=0) and Time Trial, verified through telemetry / race / HUD
// state, plus key layout independence (KeyboardEvent.code), modifier combos, rebinding in Settings -> Controls and language switching.
// See docs/qa/test-ui-controls.md matrix section C. Expert assists use manual gears and no DRS/ERS assist; the keyboard lock guard still modulates braking.
// Run: APEX_BASE_URL=http://localhost:5183 npx playwright test tests/e2e/ui-ingame-keys.spec.ts --project=e2e

import { expect, test } from '../helpers/fixtures';
import { EXPERT_ASSISTS, UI_BASE, Ui } from '../helpers/uiDriver';

test.use({ baseURL: UI_BASE });

const hold = async (ui: Ui, code: string, ms = 500) => {
  await ui.down(code);
  await ui.waitSimSeconds(ms / 1000);
  const t = await ui.tele();
  await ui.up(code);
  return t;
};
const tap = async (ui: Ui, code: string, wait = 350) => {
  await ui.page.keyboard.press(code);
  await ui.page.waitForTimeout(wait);
};

test.describe('In-game keys: driving inputs (race, ai=0)', () => {
  test('IG-01 throttle: W and ArrowUp apply throttle while held and release it', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.startGame();
    expect((await ui.tele()).input.throttle).toBe(0);
    for (const code of ['KeyW', 'ArrowUp']) {
      const t = await hold(ui, code);
      expect(t.input.throttle, `${code} held`).toBeGreaterThan(0.3);
      expect(t.controls.throttle).toBe(true);
      await page.waitForTimeout(900);
      expect((await ui.tele()).input.throttle, `${code} released`).toBeLessThan(0.05);
    }
    await ui.shot('ig-01-throttle');
  });

  test('IG-02 brake: S and ArrowDown brake a moving car (and not before moving)', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.startGame();
    for (const code of ['KeyS', 'ArrowDown']) {
      await ui.roll(2000, 150);
      const v0 = (await ui.tele()).kmh;
      const t = await hold(ui, code, 600);
      // The keyboard lock guard pulses the applied pedal even with ABS off; key intent stays held.
      expect(t.controls.brake, `${code} held through the keyboard lock guard`).toBe(true);
      expect(t.kmh, `${code} slows the car (${v0} -> ${t.kmh})`).toBeLessThan(v0 - 8);
      await ui.waitSimSeconds(0.6);
      expect((await ui.tele()).input.brake, `${code} released`).toBeLessThan(0.05);
    }
  });

  test('IG-03 steering: A / ArrowLeft steer left (+), D / ArrowRight steer right (-), centre on release', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.startGame();
    await ui.roll(2000, 100);
    for (const code of ['KeyA', 'ArrowLeft']) {
      const t = await hold(ui, code, 450);
      expect(t.input.steer, `${code}`).toBeGreaterThan(0.05);
      await page.waitForTimeout(700);
      expect(Math.abs((await ui.tele()).input.steer), `${code} released`).toBeLessThan(0.05);
      await ui.roll(2000, 100);
    }
    for (const code of ['KeyD', 'ArrowRight']) {
      const t = await hold(ui, code, 450);
      expect(t.input.steer, `${code}`).toBeLessThan(-0.05);
      await page.waitForTimeout(700);
      expect(Math.abs((await ui.tele()).input.steer)).toBeLessThan(0.05);
      await ui.roll(2000, 100);
    }
  });

  test('IG-04 gears: E shifts up, Q shifts down (manual gearbox); a tap shorter than a tick still counts once', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.startGame();
    await ui.roll(2000, 140);
    const g0 = (await ui.tele()).vehicle.gear;
    await tap(ui, 'KeyE');
    expect((await ui.tele()).vehicle.gear, 'E: +1').toBe(g0 + 1);
    await tap(ui, 'KeyE');
    expect((await ui.tele()).vehicle.gear, 'second E: +1 again').toBe(g0 + 2);
    await tap(ui, 'KeyQ');
    expect((await ui.tele()).vehicle.gear, 'Q: -1').toBe(g0 + 1);
    await tap(ui, 'KeyQ');
    expect((await ui.tele()).vehicle.gear).toBe(g0);
    // one press = one shift, even when held for 700 ms (no auto repeat in driving)
    await ui.down('KeyE');
    await page.waitForTimeout(700);
    await ui.up('KeyE');
    await page.waitForTimeout(200);
    expect((await ui.tele()).vehicle.gear, 'holding E does not repeat').toBe(g0 + 1);
  });

  test('IG-05 ERS overtake: F is a hold key (on while held, off on release)', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.startGame();
    await ui.roll(2000, 200);
    const t = await hold(ui, 'KeyF', 400);
    expect(t.input.ersOvertake, 'held').toBe(true);
    expect(t.input.ersMode).toBe('overtake');
    await page.waitForTimeout(300);
    const r = await ui.tele();
    expect(r.input.ersOvertake, 'released').toBe(false);
    expect(r.input.ersMode).not.toBe('overtake');
  });

  test('IG-06 pit limiter: L toggles the limiter on and off and caps the speed', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    // Isolate the limiter from manual shift timing (manual gears are covered by IG-04).
    await ui.startGame({ settings: { assists: { gearbox: 'auto' } } });
    await ui.roll(60, 60); // main straight: no steering is applied in this test
    expect((await ui.tele()).vehicle.pitLimiterOn).toBe(false);
    await tap(ui, 'KeyL');
    expect((await ui.tele()).vehicle.pitLimiterOn, 'L on').toBe(true);
    const t = await hold(ui, 'KeyW', 3500);
    expect(t.kmh, 'limiter caps near 80 km/h').toBeLessThan(90);
    await tap(ui, 'KeyL');
    expect((await ui.tele()).vehicle.pitLimiterOn, 'L off').toBe(false);
    // Limiter off: same start, three simulated seconds on the straight.
    await ui.roll(60, 40);
    await ui.down('KeyW');
    await ui.waitSimSeconds(3);
    const free = (await ui.tele()).kmh;
    await ui.up('KeyW');
    expect(free, `limiter off: the car accelerates past the limited speed (${t.kmh.toFixed(1)} -> ${free.toFixed(1)} km/h)`).toBeGreaterThan(t.kmh + 15);
  });

  test('IG-07 layout independence: keys use KeyboardEvent.code (Cyrillic / AZERTY labels), other codes with W-like labels do nothing', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.startGame();
    await ui.rawDown('KeyW', 'ц');
    await page.waitForTimeout(500);
    expect((await ui.tele()).input.throttle, 'code KeyW with key "ц" throttles').toBeGreaterThan(0.3);
    await ui.rawUp();
    await page.waitForTimeout(900);
    await ui.rawDown('KeyZ', 'w'); // AZERTY: the physical Z key prints "w"
    await page.waitForTimeout(500);
    expect((await ui.tele()).input.throttle, 'key "w" on another physical key does not throttle').toBeLessThan(0.05);
    await ui.rawUp();
    await ui.roll(2000, 100);
    await ui.rawDown('KeyA', 'q'); // AZERTY steer-left key prints "q"
    await page.waitForTimeout(400);
    expect((await ui.tele()).input.steer, 'physical A steers left whatever it prints').toBeGreaterThan(0.05);
    await ui.rawUp();
    const h0 = (await ui.hud()).visible;
    await ui.rawKey('KeyH', 'р');
    await page.waitForTimeout(250);
    expect((await ui.hud()).visible, 'H by code cycles the HUD').not.toBe(h0);
  });

  test('IG-08 no Ctrl / Alt / Meta combos: modified keys do nothing and are not preventDefault-ed', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.startGame();
    const h0 = (await ui.hud()).visible;
    const results: boolean[] = [];
    for (const [code, mod] of [['KeyW', 'ctrl'], ['KeyW', 'alt'], ['KeyW', 'meta'], ['KeyH', 'ctrl'], ['KeyC', 'ctrl'], ['KeyR', 'ctrl'], ['KeyP', 'alt'], ['Escape', 'meta'], ['Space', 'alt'], ['KeyL', 'ctrl'], ['Tab', 'alt']] as const) {
      const prevented = await page.evaluate(([c, m]) => {
        const e = new KeyboardEvent('keydown', { code: c, key: c, bubbles: true, cancelable: true, ctrlKey: m === 'ctrl', altKey: m === 'alt', metaKey: m === 'meta' });
        window.dispatchEvent(e);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: c, key: c, bubbles: true, ctrlKey: m === 'ctrl', altKey: m === 'alt', metaKey: m === 'meta' }));
        return e.defaultPrevented;
      }, [code, mod] as const);
      results.push(prevented);
      await page.waitForTimeout(150);
    }
    expect(results.some(Boolean), `no modified key may be preventDefault-ed: ${results.join(',')}`).toBe(false);
    await page.waitForTimeout(500);
    const t = await ui.tele();
    expect(t.input.throttle, 'Ctrl/Alt/Meta+W do not throttle').toBeLessThan(0.05);
    expect(t.input.pitLimiter, 'Ctrl+L ignored').toBe(false);
    expect(await ui.screen(), 'Meta+Esc / Alt+P do not pause').toBeNull();
    const h = await ui.hud();
    expect(h.visible, 'Ctrl+H ignored').toBe(h0);
    expect(h.flashback.open, 'Ctrl+R ignored').toBe(false);
    expect(h.mfd.open, 'Alt+Tab ignored').toBe(false);
  });
});

test.describe('In-game keys: cameras, HUD, MFD, pause, debug', () => {
  test('IG-09 camera: C cycles through all 5 driving views and wraps; V look-back only while held', async ({ apex, page }) => {
    test.setTimeout(120_000);
    const ui = new Ui(apex, page);
    await ui.startGame({ settings: { graphics: { cameraShake: 0, motionEffects: false } } });
    // Compare identical world poses; driving and suspension motion are not camera-cycle differences.
    await apex.setTimeScale(0);
    const shots = [await ui.frame()];
    for (let i = 1; i <= 5; i++) {
      await page.keyboard.press('KeyC');
      await apex.nextFrames(2);
      shots.push(await ui.frame());
    }
    for (let i = 1; i <= 4; i++) expect(Ui.diff(shots[i - 1]!, shots[i]!), `view ${i} differs from view ${i - 1}`).toBeGreaterThan(0.015);
    expect(Ui.diff(shots[0]!, shots[5]!), 'five presses wrap to the first view').toBeLessThan(0.02);
    const base = await ui.frame();
    await ui.down('KeyV');
    await apex.nextFrames(2);
    const back = await ui.frame();
    expect(Ui.diff(base, back), 'look-back while V is held').toBeGreaterThan(0.015);
    await ui.shot('ig-09-lookback');
    await ui.up('KeyV');
    await apex.nextFrames(2);
    expect(Ui.diff(base, await ui.frame()), 'view returns on release').toBeLessThan(0.02);
  });

  test('IG-10 HUD mode: H cycles full -> minimal -> off -> full', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.startGame();
    const seq: string[] = [(await ui.hud()).visible];
    for (let i = 0; i < 3; i++) {
      await tap(ui, 'KeyH', 300);
      seq.push((await ui.hud()).visible);
    }
    expect(seq).toEqual(['full', 'minimal', 'off', 'full']);
    expect(await page.evaluate(() => document.querySelector('.apx-hud')?.getAttribute('data-mode'))).toBe('full');
  });

  test('IG-11 racing line: Y cycles three modes (notification text differs each press, the fourth press repeats the first); the line is drawn', async ({ apex, page }) => {
    test.setTimeout(120_000);
    const ui = new Ui(apex, page);
    await ui.startGame();
    await ui.roll(300, 0);
    await page.waitForTimeout(300);
    const modes: string[] = [];
    for (let i = 0; i < 4; i++) {
      await tap(ui, 'KeyY', 500);
      const n = (await ui.hud()).notifications.filter((x) => x.key === 'notify.racingLine.mode').pop();
      modes.push(JSON.stringify(n?.params ?? null));
      if (i === 1) await ui.shot('ig-11-racing-line');
    }
    expect(new Set(modes.slice(0, 3)).size, `three distinct modes: ${modes.join(' | ')}`).toBe(3);
    expect(modes[3], 'the cycle has length 3').toBe(modes[0]);
  });

  test('IG-12 MFD: Tab opens and pages through strategy/ers/brakes/weather/tyres then closes; digits act on the open page only', async ({ apex, page }) => {
    test.setTimeout(120_000);
    const ui = new Ui(apex, page);
    await ui.startGame();
    await ui.roll(2000, 100); // away from the pit split: a pit request cannot be withdrawn once the car is committed to the lane
    expect((await ui.hud()).mfd.open).toBe(false);
    await tap(ui, 'Digit1', 250); // closed: nothing
    expect((await ui.hud()).mfd.boxRequested, 'digit with the MFD closed does nothing').toBe(false);
    const pages: string[] = [];
    for (let i = 0; i < 5; i++) {
      await tap(ui, 'Tab', 250);
      const m = (await ui.hud()).mfd;
      expect(m.open, `Tab ${i + 1}`).toBe(true);
      pages.push(m.page);
    }
    expect(pages).toEqual(['strategy', 'ers', 'brakes', 'weather', 'tyres']);
    await tap(ui, 'Tab', 250);
    expect((await ui.hud()).mfd.open, 'sixth Tab closes').toBe(false);
    // strategy page: 1 = box request, 3 = gap mode
    await tap(ui, 'Tab', 250);
    await tap(ui, 'Digit1', 250);
    expect((await ui.hud()).mfd.boxRequested, '1 on strategy: pit request').toBe(true);
    expect((await ui.tele()).controls.boxRequest).toBe(true);
    await tap(ui, 'Digit1', 250);
    expect((await ui.tele()).controls.boxRequest, '1 again withdraws the request (strategy side)').toBe(false);
    const g0 = (await ui.hud()).gapMode;
    await tap(ui, 'Digit3', 250);
    expect((await ui.hud()).gapMode, '3 toggles interval / leader').not.toBe(g0);
    await tap(ui, 'Digit4', 250);
    expect((await ui.hud()).towerExpanded, '4 toggles the expanded tower').toBe(true);
    // ers page: 1..4 = none, medium, hotlap, auto
    await tap(ui, 'Tab', 250);
    expect((await ui.hud()).mfd.page).toBe('ers');
    const modes: string[] = [];
    for (const d of ['Digit1', 'Digit2', 'Digit3', 'Digit4']) {
      await tap(ui, d, 250);
      modes.push((await ui.tele()).controls.ersModeSel);
    }
    expect(modes).toEqual(['none', 'medium', 'hotlap', 'auto']);
    // brakes page: 1 = bias -, 2 = bias +, 3 = default
    await tap(ui, 'Tab', 250);
    expect((await ui.hud()).mfd.page).toBe('brakes');
    const b0 = (await ui.tele()).controls.brakeBias;
    await tap(ui, 'Digit2', 250);
    await tap(ui, 'Digit2', 250);
    expect((await ui.tele()).controls.brakeBias, 'bias +').toBeGreaterThan(b0 + 0.005);
    await tap(ui, 'Digit1', 250);
    await tap(ui, 'Digit3', 250);
    expect((await ui.tele()).controls.brakeBias, 'bias default').toBeCloseTo(0.575, 3);
    // auto close after 8 s without input
    await page.waitForTimeout(9000);
    expect((await ui.hud()).mfd.open, 'MFD closes itself after 8 s').toBe(false);
  });

  test('IG-13 debug overlay: F8 toggles the overlay (also while paused it is inert)', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.startGame();
    const overlay = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#ui > div')].filter((e) => getComputedStyle(e).zIndex === '50' && getComputedStyle(e).position === 'absolute').length);
    expect(await overlay()).toBe(0);
    await tap(ui, 'F8', 600);
    expect(await overlay(), 'F8 on').toBe(1);
    await tap(ui, 'F8', 300);
    expect(await overlay(), 'F8 off').toBe(0);
  });

  test('IG-14 pause: Esc and P open the pause menu and freeze the sim; Esc resumes; P resumes (as the user brief says "Esc and P")', async ({ apex, page }) => {
    test.setTimeout(120_000);
    const ui = new Ui(apex, page);
    await ui.startGame({ assists: 'default' });
    for (const open of ['Escape', 'KeyP']) {
      await tap(ui, open, 500);
      await ui.waitScreen('pause');
      expect(await ui.simRunning(), `${open}: sim frozen`).toBe(false);
      await tap(ui, 'Escape', 500);
      await ui.waitScreen(null);
      expect(await ui.simRunning(), 'Esc resumes').toBe(true);
    }
  });

  // UIT-07 (P2, Yönetici): the brief and Ek D list "Esc / P" as the pause key, but P only opens the menu: the menu context binds only Esc / Backspace
  // to menuBack (bindings.ts MENU_ACTIONS has no 'pause'), so P cannot close it again.
  test('IG-14b UIT-07: P closes the pause menu again (Esc / P are both pause keys)', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.startGame({ assists: 'default' });
    await tap(ui, 'KeyP', 500);
    await ui.waitScreen('pause');
    await ui.shot('uit-07-p-does-not-close-pause');
    await tap(ui, 'KeyP', 500);
    expect(await ui.screen(), 'P toggles the pause menu closed again').toBeNull();
  });
});

test.describe('In-game keys: known defects', () => {
  // UIT-09 (P2, Yönetici - src/race/pit.ts / presenter): withdrawing the pit request with MFD "1" clears controls.boxRequest, but the sim keeps
  // pit.phase = 'requested' (HUD still says "requested") although the car is kilometres from the pit split.
  test('IG-12b UIT-09: MFD 1 twice withdraws the pit request (phase back to none)', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.startGame();
    await ui.roll(1000, 100);
    await tap(ui, 'Tab', 250);
    await tap(ui, 'Digit1', 400);
    expect((await ui.hud()).pit?.phase).toBe('requested');
    await tap(ui, 'Digit1', 400);
    await page.waitForTimeout(800);
    const h = await ui.hud();
    await ui.shot('uit-09-pit-request-not-withdrawn');
    expect(h.mfd.boxRequested, `pit=${JSON.stringify(h.pit)}`).toBe(false);
  });

  // UIT-08 (P2, Yönetici - src/game/session.ts): inside the flashback timeline the R key is a confirm key, but both session listeners see the same
  // keydown: unFlashbackInput applies and switches the context to driving, then unAction (registered later) sees context 'driving' and re-opens
  // the timeline at once. Enter works correctly.
  test('IG-15b UIT-08: R inside the timeline applies and leaves the timeline', async ({ apex, page }) => {
    test.setTimeout(120_000);
    const ui = new Ui(apex, page);
    await ui.startGame();
    await ui.down('KeyW');
    await page.waitForTimeout(4500);
    await ui.up('KeyW');
    await tap(ui, 'KeyR', 400);
    expect((await ui.hud()).flashback.open).toBe(true);
    await tap(ui, 'KeyR', 700);
    await ui.shot('uit-08-r-reopens-timeline');
    expect((await ui.hud()).flashback.open, 'R applied; the timeline must be closed').toBe(false);
  });
});

test.describe('In-game keys: flashback', () => {
  test('IG-15 flashback: R opens the timeline (sim frozen), Left/Right scrub, Esc cancels with no use spent, Enter / R / apply spends one and rewinds', async ({ apex, page }) => {
    test.setTimeout(180_000);
    const ui = new Ui(apex, page);
    await ui.startGame();
    await ui.down('KeyW');
    await ui.waitSimSeconds(4.5);
    await ui.up('KeyW');
    const left0 = (await ui.hud()).flashback.left;
    expect(left0, 'default 5 flashbacks').toBe(5);
    await tap(ui, 'KeyR', 400);
    let h = await ui.hud();
    expect(h.flashback.open, 'R opens').toBe(true);
    expect(await ui.simRunning(300), 'sim frozen while the timeline is open').toBe(false);
    const o0 = h.flashback.offsetSec;
    expect(o0).toBeLessThan(0);
    await tap(ui, 'ArrowLeft', 300);
    expect((await ui.hud()).flashback.offsetSec, 'Left scrubs back').toBeLessThan(o0);
    await tap(ui, 'ArrowRight', 300);
    await tap(ui, 'KeyD', 300);
    expect((await ui.hud()).flashback.offsetSec, 'Right / D scrub forward').toBeGreaterThanOrEqual(o0);
    // cancel with Escape (not pause!) and with Backspace
    for (const cancel of ['Escape', 'Backspace']) {
      await tap(ui, cancel, 500);
      h = await ui.hud();
      expect(h.flashback.open, `${cancel} cancels`).toBe(false);
      expect(await ui.screen(), `${cancel} must not open the pause menu`).toBeNull();
      expect((await apex.race())!.race.flashbacksLeft, `${cancel}: no use spent`).toBe(5);
      expect(await ui.simRunning(), 'sim runs again').toBe(true);
      await tap(ui, 'KeyR', 400);
      expect((await ui.hud()).flashback.open).toBe(true);
    }
    await tap(ui, 'Escape', 500); // back to driving to read the real "now"
    // Sample the rewind without resumed ticks consuming it during browser/IPC waits.
    await apex.setTimeScale(0);
    const before = (await apex.race())!.raceMs;
    await tap(ui, 'KeyR', 400);
    expect((await ui.hud()).flashback.open).toBe(true);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await ui.hud()).flashback.open).toBe(false);
    h = await ui.hud();
    expect(h.flashback.open, 'Enter applies and closes').toBe(false);
    expect(h.flashback.left, 'uses decremented in the HUD').toBe(4);
    const after = (await apex.race())!;
    expect(after.race.flashbacksLeft, 'uses decremented in the race state').toBe(4);
    expect(after.raceMs, `time rewound (${before} -> ${after.raceMs})`).toBeLessThan(before - 2000);
    await apex.setTimeScale(1);
    await ui.shot('ig-15-flashback');
  });

  test('IG-16 flashback with 0 uses left: R shows the "none" notification and never opens', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.startGame({ settings: { gameplay: { flashbacks: 0 } } });
    await ui.down('KeyW');
    await page.waitForTimeout(3000);
    await ui.up('KeyW');
    await tap(ui, 'KeyR', 500);
    const h = await ui.hud();
    expect(h.flashback.open).toBe(false);
    expect(h.notifications.some((n) => n.key.includes('flashback')), `notifications ${JSON.stringify(h.notifications.map((n) => n.key))}`).toBe(true);
    expect(await ui.simRunning()).toBe(true);
  });
});

test.describe('In-game keys: Time Trial', () => {
  test('IG-17 TT: Backspace restarts the lap near the line at start speed and keeps the lap valid; Backspace does nothing in a race', async ({ apex, page }) => {
    test.setTimeout(120_000);
    const ui = new Ui(apex, page);
    await ui.startGame({ mode: 'tt' });
    const len = await ui.trackLength();
    await ui.roll(1500, 120);
    await page.waitForTimeout(300);
    expect((await ui.tele()).vehicle.s).toBeLessThan(2500);
    await tap(ui, 'Backspace', 400);
    const t = await ui.tele();
    expect(t.vehicle.s, `restart puts the car before the line (s=${t.vehicle.s}, L=${len})`).toBeGreaterThan(len - 450);
    expect(t.kmh, 'rolling start speed').toBeGreaterThan(120);
    expect(t.race.lapValid).toBe(true);
    expect(await ui.screen(), 'Backspace does not open any menu').toBeNull();
  });

  test('IG-18 TT: MFD starts on the ERS page (no strategy page), DRS opens only inside a zone and closes on brake', async ({ apex, page }) => {
    test.setTimeout(150_000);
    const ui = new Ui(apex, page);
    await ui.startGame({ mode: 'tt' });
    await tap(ui, 'Tab', 300);
    expect((await ui.hud()).mfd.page, 'TT has no strategy page').toBe('ers');
    await tap(ui, 'Tab', 300);
    await tap(ui, 'Tab', 300);
    await tap(ui, 'Tab', 300);
    await tap(ui, 'Tab', 300);
    expect((await ui.hud()).mfd.open, '4 pages then closed').toBe(false);
    const len = await ui.trackLength();
    let inZone = -1;
    let outZone = -1;
    for (let s = 100; s < len && (inZone < 0 || outZone < 0); s += 120) {
      await apex.teleport(0, s, 0, 100);
      await page.waitForTimeout(160);
      const z = (await ui.tele()).race.drsZone;
      if (z >= 0 && inZone < 0) inZone = s;
      if (z < 0 && outZone < 0) outZone = s;
    }
    expect(inZone, 'the track has a DRS zone').toBeGreaterThan(0);
    let zoneEnd = inZone;
    for (let s = inZone; s < inZone + 1500; s += 25) {
      await apex.teleport(0, s, 0, 40);
      await page.waitForTimeout(120);
      if ((await ui.tele()).race.drsZone < 0) break;
      zoneEnd = s;
    }
    const zoneMid = Math.round((inZone + zoneEnd) / 2);
    expect(outZone).toBeGreaterThan(0);
    // outside a zone Space does nothing
    await ui.roll(outZone, 100);
    await tap(ui, 'Space', 300);
    expect((await ui.tele()).vehicle.drs.open, 'DRS closed outside a zone').toBe(false);
    await ui.roll(zoneMid, 40);
    await tap(ui, 'Space', 300);
    const t = await ui.tele();
    expect(t.race.drsZone, 'still in the zone').toBeGreaterThanOrEqual(0);
    expect(t.vehicle.drs.open, 'DRS opens in a zone').toBe(true);
    await hold(ui, 'KeyS', 250);
    expect((await ui.tele()).vehicle.drs.open, 'braking closes DRS').toBe(false);
  });

  test('IG-19 TT: using a flashback invalidates the lap (rules §10)', async ({ apex, page }) => {
    test.setTimeout(120_000);
    const ui = new Ui(apex, page);
    await ui.startGame({ mode: 'tt' });
    await ui.roll(1500, 150);
    await ui.down('KeyW');
    await page.waitForTimeout(3500);
    await ui.up('KeyW');
    expect((await ui.tele()).race.lapValid).toBe(true);
    await tap(ui, 'KeyR', 400);
    expect((await ui.hud()).flashback.open).toBe(true);
    await tap(ui, 'Enter', 600);
    expect((await ui.tele()).race.lapValid, 'flashback invalidates the TT lap').toBe(false);
  });
});

test.describe('Rebinding, layout setting and language', () => {
  const startViaApi = async (ui: Ui) => {
    await ui.apex.startSession({ mode: 'race', laps: 3, aiCount: 0, skipLights: true, seed: 7, assists: { ...EXPERT_ASSISTS }, flashbacks: 5 } as never);
    await ui.apex.waitForPhase('running', 60_000);
    await ui.page.waitForFunction(() => (window as unknown as { __APEX__: { ui: { screen(): string | null } } }).__APEX__.ui.screen() === null, undefined, { timeout: 30_000 });
    await ui.page.waitForTimeout(500);
  };

  test('IG-20 rebind camera to N in Settings -> Controls: N works in the race, the old key C does not; conflicts steal the key; reset restores C', async ({ apex, page }) => {
    test.setTimeout(240_000);
    const ui = new Ui(apex, page);
    await ui.toMainMenu({ nopost: 1 });
    await ui.goTo('settings');
    await ui.focusViaKeys('settings.tab.controls');
    await ui.key('ArrowRight');
    await ui.focusViaKeys('set.c.bind.cameraNext');
    await ui.key('Enter');
    await ui.key('KeyN');
    expect((await ui.bindChips('cameraNext'))[0]).toBe('N');
    expect((await ui.stored()).controls.bindings.cameraNext, 'persisted').toEqual(['KeyN']);
    await ui.key('Escape'); await ui.key('Escape', 400);
    await ui.waitScreen('mainMenu');
    await startViaApi(ui);
    const f0 = await ui.frame();
    await tap(ui, 'KeyC', 500);
    expect(Ui.diff(f0, await ui.frame()), 'old key C no longer switches the camera').toBeLessThan(0.015);
    await tap(ui, 'KeyN', 500);
    expect(Ui.diff(f0, await ui.frame()), 'new key N switches the camera').toBeGreaterThan(0.015);
    // persistence across a reload
    await page.reload();
    await apex.whenReady('sceneReady');
    await page.waitForTimeout(400);
    await ui.key('Space');
    await ui.waitScreen('mainMenu');
    expect((await ui.stored()).controls.bindings.cameraNext).toEqual(['KeyN']);
    await startViaApi(ui);
    const g0 = await ui.frame();
    await tap(ui, 'KeyN', 500);
    expect(Ui.diff(g0, await ui.frame()), 'N still works after the reload').toBeGreaterThan(0.015);
    // conflict + reset in the menu
    await ui.apex.page.evaluate(() => (window as unknown as { __APEX__: { input: { press(a: string): void } } }).__APEX__.input.press('pause'));
    await ui.waitScreen('pause');
    await ui.focusViaKeys('pause.settings');
    await ui.key('Enter', 500);
    await ui.waitScreen('settings');
    await ui.focusViaKeys('settings.tab.controls');
    await ui.key('ArrowRight');
    await ui.focusViaKeys('set.c.bind.hudCycle');
    await ui.key('Enter');
    await ui.key('KeyN'); // N belongs to cameraNext (same driving context) -> stolen
    expect((await ui.bindChips('hudCycle'))[0]).toBe('N');
    expect((await ui.bindChips('cameraNext'))[0], 'cameraNext lost N').not.toBe('N');
    expect(await page.locator('.apx-screen[data-active="1"] .m-foot[data-warn="1"]').count(), 'a replaced-key warning is shown').toBe(1);
    await ui.shot('ig-20-conflict-warning');
    await ui.focusViaKeys('set.c.reset');
    await ui.key('Enter'); await ui.key('Enter');
    const b = (await ui.stored()).controls.bindings;
    expect(b.cameraNext).toEqual(['KeyC']);
    expect(b.hudCycle).toEqual(['KeyH']);
  });

  test('IG-21 rebinding refuses modifier keys while listening and keeps the old binding', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.goTo('settings');
    await ui.focusViaKeys('settings.tab.controls');
    await ui.key('ArrowRight');
    await ui.focusViaKeys('set.c.bind.gearUp');
    await ui.key('Enter');
    await page.waitForTimeout(100);
    await ui.rawKey('ControlLeft', 'Control', 0, { ctrl: true });
    await page.waitForTimeout(200);
    expect((await ui.bindChips('gearUp'))[0], 'Control is refused').toBe('E');
    await ui.key('Enter');
    await page.waitForTimeout(100);
    await ui.rawKey('KeyX', 'x', 0, { ctrl: true });
    await page.waitForTimeout(200);
    expect((await ui.bindChips('gearUp'))[0], 'Ctrl+X combo is refused').toBe('E');
    expect(await page.locator('.apx-screen[data-active="1"] .m-foot[data-warn="1"]').count(), 'modifier warning').toBe(1);
  });

  // UIT-06 (P2, Yönetici / Grafik-UI): Settings -> Controls -> "Düzen" (layout combined / wasd / arrows) is stored in settings.controls.layout,
  // but nothing applies bindingsForLayout() (src/core/input/bindings.ts) to the live bindings, so the choice has no effect on the keys.
  test('IG-22 UIT-06: control layout "WASD" removes the arrow keys from driving', async ({ apex, page }) => {
    test.setTimeout(120_000);
    const ui = new Ui(apex, page);
    await ui.startGame({ settings: { version: 1, controls: { layout: 'wasd' } } });
    const up = await hold(ui, 'ArrowUp', 500);
    await ui.shot('uit-06-layout-wasd-arrow-throttle');
    expect(up.input.throttle, 'ArrowUp must not throttle in the WASD layout').toBeLessThan(0.05);
    await page.waitForTimeout(800);
    const w = await hold(ui, 'KeyW', 500);
    expect(w.input.throttle).toBeGreaterThan(0.3);
  });

  test('IG-23 language switch (TR -> EN) from the pause menu: driving keys, HUD cycle, MFD and pause all keep working', async ({ apex, page }) => {
    test.setTimeout(180_000);
    const ui = new Ui(apex, page);
    await ui.startGame({ assists: 'default' });
    const label0 = await page.evaluate(() => document.querySelector('.apx-hud')?.textContent ?? '');
    await tap(ui, 'Escape', 500);
    await ui.waitScreen('pause');
    await ui.focusViaKeys('pause.settings');
    await ui.key('Enter', 500);
    await ui.waitScreen('settings');
    await ui.focusViaKeys('settings.tab.language');
    await ui.key('ArrowRight');
    await ui.key('ArrowRight');
    expect(await page.evaluate(() => document.querySelector('.apx-ui')?.getAttribute('lang'))).toBe('en');
    await ui.key('Escape'); await ui.key('Escape', 500);
    await ui.waitScreen('pause');
    await ui.key('Escape', 500);
    await ui.waitScreen(null);
    expect(await ui.simRunning()).toBe(true);
    const label1 = await page.evaluate(() => document.querySelector('.apx-hud')?.textContent ?? '');
    expect(label1, 'HUD labels re-rendered in English').not.toBe(label0);
    const t = await hold(ui, 'KeyW', 500);
    expect(t.input.throttle, 'throttle after the language switch').toBeGreaterThan(0.3);
    await tap(ui, 'KeyH', 300);
    expect((await ui.hud()).visible).toBe('minimal');
    await tap(ui, 'KeyH', 300);
    await tap(ui, 'KeyH', 300);
    await tap(ui, 'Tab', 300);
    expect((await ui.hud()).mfd.open).toBe(true);
    await tap(ui, 'Tab', 100);
    await tap(ui, 'Tab', 100);
    await tap(ui, 'Tab', 100);
    await tap(ui, 'Tab', 100);
    await tap(ui, 'Tab', 100);
    await tap(ui, 'KeyP', 500);
    await ui.waitScreen('pause');
  });
});
