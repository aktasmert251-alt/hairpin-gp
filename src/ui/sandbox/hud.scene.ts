// `?scene=hud`: the real HUD on a typed mock model (Örnek veri) over a placeholder "3D" backdrop with the
// worst-case bright sun patch. Params: freeze=1 (DESIGN example state), scale=0.8..1.25, mode=full|minimal|off,
// lang=tr|en, units=kmh|mph, stress=1 (10 notifications/s), lights=1 (start-light loop), anim=on|off|auto,
// perf=1 (mean updateHud ms overlay), tt=1 (time-trial model), ww=1 (D-040 wrong-way banner), gear=R|N|1..8 (forced gear).

import type { SandboxScene } from '../../contracts/debug';
import type { HudModel } from '../../contracts/hud';
import { loadTrack } from '../../track/index';
import { h } from '../dom';
import { createHud } from '../hud/Hud';
import { createMotionPrefs } from '../motion/gsap';
import { fontsReady, injectStyles } from '../styles/index';
import { createMockHud } from './mockHud';
import { createSandboxI18n } from './mockI18n';

function paintBackdrop(canvas: HTMLCanvasElement): void {
  const w = (canvas.width = window.innerWidth);
  const hh = (canvas.height = window.innerHeight);
  const g = canvas.getContext('2d');
  if (!g) return;
  const sky = g.createLinearGradient(0, 0, 0, hh);
  sky.addColorStop(0, '#2B3646');
  sky.addColorStop(0.34, '#4A586C');
  sky.addColorStop(0.464, '#66717C');
  sky.addColorStop(0.465, '#20252C');
  sky.addColorStop(1, '#14171B');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, hh);
  const sun = g.createRadialGradient(w * 0.79, hh * 0.06, 0, w * 0.79, hh * 0.06, w * 0.2);
  sun.addColorStop(0, 'rgba(255,244,229,.92)');
  sun.addColorStop(1, 'rgba(255,244,229,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, w, hh * 0.5);
  const hz = hh * 0.465;
  g.fillStyle = '#262A30';
  g.beginPath();
  g.moveTo(w * 0.483, hz);
  g.lineTo(w * 0.517, hz);
  g.lineTo(w * 0.93, hh);
  g.lineTo(w * 0.07, hh);
  g.fill();
  g.strokeStyle = 'rgba(242,244,247,.45)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(w * 0.4835, hz);
  g.lineTo(w * 0.08, hh);
  g.moveTo(w * 0.5165, hz);
  g.lineTo(w * 0.92, hh);
  g.stroke();
}

const scene: SandboxScene = {
  id: 'hud',
  title: 'HUD',
  async create({ canvas, uiRoot, params }) {
    const releaseStyles = injectStyles();
    await fontsReady();
    paintBackdrop(canvas);
    const lang = params.get('lang') === 'en' ? 'en' : 'tr';
    const i18n = createSandboxI18n(lang);
    const anim = params.get('anim');
    const prefs = createMotionPrefs(anim === 'on' || anim === 'off' ? anim : 'auto');
    const host = h('div', 'apx-ui', uiRoot);
    host.lang = lang;
    host.classList.toggle('is-reduced', prefs.reduced());
    const KEYS: Record<string, string> = { Tab: 'TAB', Enter: 'ENTER', Escape: 'ESC' };
    const hud = createHud(host, {
      t: i18n.t, has: i18n.has, lang: () => lang, reduced: prefs.reduced, key: (c) => KEYS[c] ?? c,
      tt: () => ({ pbMs: 85_612, laps: [{ n: 5, ms: 86_118, valid: false }, { n: 6, ms: 85_612, valid: true }, { n: 7, ms: 85_944, valid: true }], ghost: 'pb' }),
    });
    const scale = Number(params.get('scale') ?? '1');
    hud.setScale(Number.isFinite(scale) ? scale : 1);
    hud.setUnits(params.get('units') === 'mph' ? 'mph' : 'kmh');
    hud.setMinimap(true);
    const track = loadTrack().data;
    hud.setTrack(track);
    const modeP = params.get('mode');
    const mode: HudModel['visible'] = modeP === 'minimal' || modeP === 'off' ? modeP : 'full';
    const freeze = params.get('freeze') === '1';
    const mockOpts = { freeze, stress: params.get('stress') === '1', lights: params.get('lights') === '1', mode, timeTrial: params.get('tt') === '1', prox: params.get('prox') === '1' };
    const mock = createMockHud(track, mockOpts);
    // U6 probe: toggles the 10 notifications/s stress in place (interleaved A/B frame-rate runs).
    (window as unknown as { __hudStress?: (on: boolean) => void }).__hudStress = (on) => {
      mockOpts.stress = on;
    };
    if (params.get('collapsed') === '1') mock.model.towerExpanded = false;
    const mfdPage = params.get('mfd') as HudModel['mfd']['page'] | null;
    if (mfdPage) {
      Object.assign(mock.model.mfd, { open: true, page: mfdPage, boxRequested: true });
      mock.model.mfd.forecast = [{ inMin: 5, rain: 0.2, probability: 0.7 }, { inMin: 10, rain: 0.35, probability: 0.6 }, { inMin: 15, rain: 0.1, probability: 0.4 }, { inMin: 30, rain: 0, probability: 0.2 }];
    }
    if (params.get('fb') === '1') mock.model.flashback = { open: true, offsetSec: -4.6, maxSec: 15, left: 2 };
    // U7 states: pit=requested|lane|speeding|service, pen=1 (5 s to serve, 2 strikes) / pen=3 (3rd strike),
    // flag=blue|bw|chq, wx=heavy.
    const pit = params.get('pit');
    if (pit) {
      const lane = pit !== 'requested';
      mock.model.pit = {
        phase: pit === 'service' ? 'stationary' : pit === 'requested' ? 'requested' : 'limiter', inLane: lane, limitKmh: 80,
        speeding: pit === 'speeding', boxDistM: pit === 'service' ? 0 : pit === 'requested' ? 1240 : 186, serviceLeftS: pit === 'service' ? 2.4 : 0,
      };
      mock.model.car.pitLimiter = lane && pit !== 'service';
      if (lane) Object.assign(mock.model.car, { kmh: pit === 'speeding' ? 84 : pit === 'service' ? 0 : 80, gear: pit === 'service' ? 0 : 3, shiftLeds: 0 });
    }
    const pen = params.get('pen');
    if (pen) mock.model.penalty = { toServeSec: pen === '3' ? 0 : 5, trackLimitWarnings: pen === '3' ? 3 : 2 };
    const flag = params.get('flag');
    if (flag === 'blue') mock.model.flags.blue = true;
    if (flag === 'bw') mock.model.flags.blackWhite = true;
    if (flag === 'chq') mock.model.flags.chequered = true;
    if (flag) {
      const key = flag === 'blue' ? 'notify.flag.blue' : flag === 'bw' ? 'notify.limits.blackWhite' : 'notify.flag.chequered';
      mock.model.notifications = [{ id: 7, key, params: flag === 'blue' ? { code: 'NRB' } : {}, level: flag === 'chq' ? 'info' : 'warn', ms: 4500, priority: 2 }];
    }
    if (params.get('ww') === '1') mock.model.wrongWay = true;
    const sc = params.get('sc');
    if (sc === 'deployed' || sc === 'ending') mock.model.flags.safetyCar = sc;
    const gearP = params.get('gear');
    const gearV = gearP === 'R' ? -1 : gearP === 'N' ? 0 : gearP ? Number(gearP) : NaN;
    if (params.get('wx') === 'heavy') mock.model.weather = { rain: 0.85, wetness: 0.72, airC: 17, trackC: 19 };
    hud.setShown(true);
    const tag = h('div', 'h-sample', host);
    tag.textContent = i18n.upper(i18n.t('hud.sampleScene', { w: window.innerWidth, h: window.innerHeight, s: scale.toFixed(2).replace('.', lang === 'tr' ? ',' : '.') }));
    const perfOn = params.get('perf') === '1';
    const perfEl = perfOn ? h('div', '', host) : null;
    if (perfEl) perfEl.style.cssText = 'position:absolute;right:8px;top:50%;font:12px/1.4 monospace;color:#B4BCC7;background:rgba(9,11,14,.88);padding:6px 8px;z-index:90';
    let acc = 0;
    let t = 0;
    let sum = 0;
    let count = 0;
    let max = 0;
    const step = (): void => {
      mock.frame(t);
      if (freeze && mockOpts.lights) Object.assign(mock.model.startLights, { visible: true, lit: 5, out: false });
      if (Number.isFinite(gearV)) mock.model.car.gear = gearV;
      const t0 = performance.now();
      hud.update(mock.model);
      const dt = performance.now() - t0;
      sum += dt;
      count++;
      if (dt > max) max = dt;
      if (perfEl && count % 30 === 0) perfEl.textContent = `updateHud mean ${(sum / count).toFixed(3)} ms · max ${max.toFixed(2)} ms · n ${count}`;
    };
    step();
    (window as unknown as { __hudSafetyCar?: (state: 'none' | 'deployed' | 'ending') => void }).__hudSafetyCar = (state) => {
      mock.model.flags.safetyCar = state;
      hud.update(mock.model);
    };
    (window as unknown as { __hudPerf?: () => { mean: number; max: number; n: number } }).__hudPerf = () => ({ mean: sum / Math.max(1, count), max, n: count });
    // U6 probe: one car gains 5 places (P9 → P4, six rows move) → main-thread ms of the update that starts the Flip.
    (window as unknown as { __hudFlipBench?: () => number }).__hudFlipBench = () => {
      const rows = [...mock.model.tower].sort((a, b) => a.pos - b.pos);
      const mover = rows[8]!;
      for (let i = 3; i < 8; i++) rows[i]!.pos++;
      mover.pos = 4;
      const t0 = performance.now();
      hud.update(mock.model);
      return performance.now() - t0;
    };
    return {
      update(dt) {
        if (freeze) return;
        acc += dt;
        t += dt * 1000;
        if (acc >= 1 / 30) {
          acc %= 1 / 30;
          step();
        }
      },
      dispose() {
        delete (window as unknown as { __hudSafetyCar?: unknown }).__hudSafetyCar;
        hud.dispose();
        prefs.dispose();
        host.remove();
        releaseStyles();
      },
    };
  },
};

export default scene;
