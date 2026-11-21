// ?scene=weather (YÖN, L9 / H-COND): the ConditionsSystem run headless over a whole session and plotted: rain, cloud,
// surface wetness, racing-line wetness (20 cars of traffic), the +10 min forecast and the weather messages.
// Params: &weather (default variable), &seed (7), &laps (10), &tod, &lang.

import type { ForecastEntry } from '../../contracts/conditions';
import type { SandboxScene } from '../../contracts/debug';
import type { SimEvent, SimWorld } from '../../contracts/sim';
import { createI18n } from '../../core/i18n/index';
import { parseLaunchParams } from '../../core/launchParams';
import { conditionsFrame, createConditionsSystem, initConditions } from '../conditions';
import { forecast } from '../forecast';

const STEP_S = 0.1;
const COLORS = ['#4DA3FF', '#8A929E', '#2EC4B6', '#5BD16A', '#F5C518'];

const scene: SandboxScene = {
  id: 'weather',
  title: 'Weather (ConditionsSystem v2)',
  async create({ canvas, uiRoot, params }) {
    const launch = parseLaunchParams(params);
    const i18n = createI18n({ lang: launch.lang ?? 'tr' });
    const preset = launch.weather ?? 'variable';
    const seed = launch.seed ?? 7;
    const laps = launch.laps ?? 10;
    const durationS = laps * 95 * 1.3;
    const c = initConditions({ tod: launch.tod ?? 'day', weather: preset, seed }, durationS);
    // A 20-car field on the main ribbon at ~60 m/s gives the reference pass rate (§4.4).
    const cars = Array.from({ length: 20 }, () => ({ race: { status: 'running' }, vehicle: { hint: { ribbon: 'main' }, speed: 60 } }));
    const msgs: { t: number; msg: string }[] = [];
    const world = {
      state: { time: 0, cars, conditions: c },
      static: { track: { query: { length: 5333 } }, ai: { onWetnessChanged() {} } },
      events: { push: (e: SimEvent) => { if (e.type === 'weather') msgs.push({ t: world.state.time, msg: e.msg }); }, drain() {} },
    } as unknown as SimWorld;
    const sys = createConditionsSystem();
    const frame = { tod: c.tod, rain: 0, wetness: 0, lineWetness: 0, cloud: 0, time: 0 };
    const fc: ForecastEntry[] = Array.from({ length: 4 }, () => ({ inMin: 0, rain: 0, probability: 0 }));
    const series: number[][] = [[], [], [], [], []];
    const n = Math.ceil(durationS / STEP_S);
    for (let i = 0; i <= n; i++) {
      world.state.time = i * STEP_S;
      sys.step(world, STEP_S);
      if (i % 10 === 0) {
        conditionsFrame(c, world.state.time, frame);
        series[0]!.push(frame.rain);
        series[1]!.push(frame.cloud);
        series[2]!.push(frame.wetness);
        series[3]!.push(frame.lineWetness);
        const k = forecast(c, seed, world.state.time, fc);
        series[4]!.push(k > 1 ? fc[1]!.rain : NaN);
      }
    }

    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;gap:10px;padding:16px;background:#0A0C0F;color:#F2F4F7;font:14px/1.4 ui-monospace,Consolas,monospace';
    const header = document.createElement('div');
    header.textContent = i18n.t('common.weatherScene.header', {
      preset, seed, laps, min: Math.round(durationS / 60), air: c.airC.toFixed(1), track: c.trackC.toFixed(1),
    });
    const legend = document.createElement('div');
    i18n.t('common.weatherScene.legend').split('|').forEach((label, i) => {
      const s = document.createElement('span');
      s.textContent = `■ ${label}   `;
      s.style.color = COLORS[i]!;
      legend.appendChild(s);
    });
    canvas.style.cssText = 'flex:1;min-height:0;width:100%;background:#111418;border-radius:4px';
    root.append(header, legend, canvas);
    uiRoot.appendChild(root);

    const draw = (): void => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const g = canvas.getContext('2d')!;
      const L = 60, R = 20, T = 20, B = 40;
      const X = (t: number): number => L + ((w - L - R) * t) / durationS;
      const Y = (v: number): number => h - B - (h - T - B) * v;
      g.clearRect(0, 0, w, h);
      g.strokeStyle = '#2A3038';
      g.fillStyle = '#AEB6C2';
      g.font = '12px ui-monospace,Consolas,monospace';
      g.lineWidth = 1;
      for (let v = 0; v <= 1.0001; v += 0.25) {
        g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(w - R, Y(v)); g.stroke();
        g.fillText(v.toFixed(2), 14, Y(v) + 4);
      }
      for (let m = 0; m * 60 <= durationS; m += 5) {
        g.beginPath(); g.moveTo(X(m * 60), T); g.lineTo(X(m * 60), h - B); g.stroke();
        g.fillText(i18n.t('common.weatherScene.time', { min: m }), X(m * 60) - 14, h - B + 18);
      }
      series.forEach((s, k) => {
        g.strokeStyle = COLORS[k]!;
        g.lineWidth = k === 4 ? 1.5 : 2.5;
        g.setLineDash(k === 4 ? [5, 4] : []);
        g.beginPath();
        let pen = false;
        s.forEach((v, i) => {
          if (Number.isNaN(v)) { pen = false; return; }
          if (!pen) g.moveTo(X(i), Y(v)); else g.lineTo(X(i), Y(v));
          pen = true;
        });
        g.stroke();
      });
      g.setLineDash([]);
      msgs.forEach((m, i) => {
        g.strokeStyle = '#FF6B6B';
        g.beginPath(); g.moveTo(X(m.t), T); g.lineTo(X(m.t), h - B); g.stroke();
        g.fillStyle = '#FF9B9B';
        g.fillText(m.msg, X(m.t) + 4, T + 14 + (i % 4) * 16);
      });
    };
    draw();
    return {
      update() {
        draw();
      },
      dispose() {
        root.remove();
      },
    };
  },
};

export default scene;
