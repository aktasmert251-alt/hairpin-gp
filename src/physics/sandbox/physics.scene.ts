// ?scene=physics (Sürüş): one keyboard-drivable car on a 2D chase map (car-up) with live telemetry: speed, rpm and
// gear, throttle/brake/steer, slip per wheel, g-g diagram, tyre temperatures, ERS/DRS; lil-gui for assists,
// compound and the main physics parameters. Extras: &track=istanbul|oval|straight, &autodrive=1, &t=<s>,
// &freeze=1, &s=<m> (start position). Sandbox only (English labels allowed in sandbox GUIs).

import GUI from 'lil-gui';
import type { SandboxScene } from '../../contracts/debug';
import type { Compound } from '../../contracts/common';
import type { SimRunner } from '../../contracts/sim';
import type { TrackBundle } from '../../contracts/track';
import { SIM_DT } from '../../contracts/sim';
import type { AssistSettings } from '../../contracts/race';
import { createSim, defaultSessionConfig, PERFECT_PROFILE } from '../../game/index';
import { createOvalTrack, createStraightTrack, loadTrack } from '../../track/index';
import { tuning } from '../params';
import { initVehicleState } from '../state';

/** Assist presets of planner-report §5.8 (local copy: sandbox scenes import other owners only through index.ts). */
const ASSIST_PRESETS: Readonly<Record<'beginner' | 'intermediate' | 'expert', AssistSettings>> = {
  beginner: { steering: true, braking: 'high', abs: true, tc: 'full', gearbox: 'auto', racingLine: 'full', pit: true, ers: true, drs: true, kbBrakeLimiter: true },
  intermediate: { steering: true, braking: 'off', abs: true, tc: 'medium', gearbox: 'auto', racingLine: 'corners', pit: true, ers: true, drs: false, kbBrakeLimiter: true },
  expert: { steering: false, braking: 'off', abs: false, tc: 'off', gearbox: 'manual', racingLine: 'off', pit: false, ers: false, drs: false, kbBrakeLimiter: false },
};

/** Arrows / WASD (KeyboardEvent.code) → held driving keys; edges for gears (Q/E) and DRS (F); G = ERS overtake. */
interface Keys { up: boolean; down: boolean; left: boolean; right: boolean; gearUp: number; gearDown: number; drs: number; ers: boolean }
const KEYMAP: Readonly<Record<string, keyof Keys>> = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  KeyE: 'gearUp', KeyQ: 'gearDown', KeyF: 'drs', KeyG: 'ers',
};
import { COLORS, drawCar, drawLine, drawTrack, panel, plot, type Rect, type View2D } from './view2d';

const HIST = 600; // 10 s at 60 Hz

function trackFor(id: string | null): TrackBundle {
  if (id === 'oval') return createOvalTrack();
  if (id === 'straight') return createStraightTrack(6000);
  return loadTrack();
}

const scene: SandboxScene = {
  id: 'physics',
  title: 'Physics bench',
  async create({ canvas, uiRoot, params }) {
    const trackId = params.get('track') ?? 'istanbul';
    const track = trackFor(trackId);
    const closed = trackId !== 'straight';
    const state = {
      preset: 'intermediate' as 'beginner' | 'intermediate' | 'expert',
      compound: (params.get('tyre') as Compound | null) ?? 'medium',
      autodrive: params.get('autodrive') === '1',
      timeScale: 1,
    };
    const assists = { ...ASSIST_PRESETS.intermediate };
    let sim: SimRunner = null as unknown as SimRunner;
    const keys: Keys = { up: false, down: false, left: false, right: false, gearUp: 0, gearDown: 0, drs: 0, ers: false };
    const onKeyChange = (e: KeyboardEvent): void => {
      const k = KEYMAP[e.code];
      if (!k || e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      const down = e.type === 'keydown';
      if (k === 'gearUp' || k === 'gearDown' || k === 'drs') {
        if (down && !e.repeat) keys[k]++;
      } else keys[k] = down;
    };
    window.addEventListener('keydown', onKeyChange);
    window.addEventListener('keyup', onKeyChange);
    const onBlur = (): void => {
      keys.up = keys.down = keys.left = keys.right = keys.ers = false;
    };
    window.addEventListener('blur', onBlur);

    const hist = {
      speed: new Float32Array(HIST), rpm: new Float32Array(HIST), gear: new Float32Array(HIST),
      thr: new Float32Array(HIST), brk: new Float32Array(HIST), steer: new Float32Array(HIST),
      s0: new Float32Array(HIST), s1: new Float32Array(HIST), s2: new Float32Array(HIST), s3: new Float32Array(HIST),
      ax: new Float32Array(HIST), ay: new Float32Array(HIST),
    };
    let head = 0;
    let count = 0;
    let lastLap = 0;
    let bestLap = 0;

    const build = (): void => {
      const cfg = defaultSessionConfig({ mode: 'timeTrial', aiCount: 0, startCompound: state.compound, assists: { ...assists }, autodrive: state.autodrive });
      sim = createSim(cfg, { track, skipLights: true });
      const startS = params.has('s') ? Number(params.get('s')) : trackId === 'straight' ? 50 : null;
      if (startS !== null && Number.isFinite(startS)) {
        const c0 = sim.world.state.cars[0]!;
        const fuel = c0.vehicle.fuelKg;
        Object.assign(c0.vehicle, initVehicleState(sim.world.static.params[0]!, track, { s: track.query.wrapS(startS), d: 0 }, c0.vehicle.compound));
        c0.vehicle.fuelKg = fuel;
        c0.vehicle.massKg = sim.world.static.params[0]!.massDryKg + fuel;
        c0.vehicle.lapWraps = 0;
      }
      head = 0;
      count = 0;
      lastLap = 0;
      bestLap = 0;
    };
    build();
    const car = () => sim.world.state.cars[0]!;
    const setAutodrive = (on: boolean): void => {
      const c = car();
      c.control = on ? 'ai' : 'player';
      if (on) sim.world.static.ai.initCar(sim.world, 0, PERFECT_PROFILE);
    };

    // ---- lil-gui ----
    const gui = new GUI({ title: 'Physics', container: uiRoot });
    gui.domElement.style.cssText += ';position:absolute;right:8px;top:8px;z-index:10';
    gui.add(state, 'preset', ['beginner', 'intermediate', 'expert']).name('assist preset').onChange((v: keyof typeof ASSIST_PRESETS) => {
      Object.assign(assists, ASSIST_PRESETS[v]);
      Object.assign(sim.world.static.config.assists, assists);
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    });
    const fa = gui.addFolder('Assists');
    const applyAssists = (): void => {
      Object.assign(sim.world.static.config.assists, assists);
    };
    fa.add(assists, 'steering').onChange(applyAssists);
    fa.add(assists, 'abs').onChange(applyAssists);
    fa.add(assists, 'tc', ['off', 'medium', 'full']).onChange(applyAssists);
    fa.add(assists, 'braking', ['off', 'low', 'medium', 'high']).onChange(applyAssists);
    fa.add(assists, 'gearbox', ['auto', 'manual']).onChange(applyAssists);
    fa.add(assists, 'kbBrakeLimiter').name('kb brake limiter').onChange(applyAssists);
    fa.add(assists, 'drs').onChange(applyAssists);
    const fc = gui.addFolder('Car');
    fc.add(state, 'compound', ['soft', 'medium', 'hard', 'inter', 'wet']).onChange(() => build());
    fc.add(state, 'autodrive').onChange((v: boolean) => setAutodrive(v));
    fc.add(state, 'timeScale', 0.1, 2, 0.05).name('time scale');
    const p = sim.world.static.params[0]!;
    const tun = tuning(p);
    const fp = gui.addFolder('Params (live)');
    fp.add(p, 'ClA', 3, 6, 0.05);
    fp.add(p, 'CdA', 1, 2, 0.01);
    fp.add(p, 'aeroFrontShare', 0.35, 0.5, 0.005);
    fp.add(p, 'lltdFront', 0.4, 0.65, 0.01);
    fp.add(p, 'brakeTorqueTotal', 8000, 18000, 100);
    fp.add(p, 'brakeBiasDefault', 0.5, 0.7, 0.005).name('brake bias');
    fp.add(tun, 'rearAlphaFactor', 0.7, 1.1, 0.01).name('rear α factor');
    fp.close();
    gui.add({ reset: () => build() }, 'reset').name('reset car (R)');
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'KeyR') build();
    };
    window.addEventListener('keydown', onKey);
    if (state.autodrive) setAutodrive(true);

    // Fast-forward (&t) and freeze.
    const tParam = Number(params.get('t') ?? 0);
    const freeze = params.get('freeze') === '1';
    const record = (): void => {
      const c = car();
      const v = c.vehicle;
      const pr = sim.world.static.params[0]!;
      const comp = pr.compounds[v.compound];
      hist.speed[head] = v.speed * 3.6;
      hist.rpm[head] = v.rpm;
      hist.gear[head] = 4000 + v.gear * 1000;
      hist.thr[head] = c.input.throttle;
      hist.brk[head] = c.input.brake;
      hist.steer[head] = c.input.steer;
      const sl = [hist.s0, hist.s1, hist.s2, hist.s3];
      for (let k = 0; k < 4; k++) {
        const w = v.wheels[k]!;
        const sx = w.slipRatio / comp.slipRatioPeak;
        const sy = Math.tan(w.slipAngle) / Math.tan(comp.slipAnglePeak * (k >= 2 ? tuning(pr).rearAlphaFactor : 1));
        sl[k]![head] = Math.sqrt(sx * sx + sy * sy);
      }
      hist.ax[head] = v.axLong / 9.81;
      hist.ay[head] = v.ayLat / 9.81;
      head = (head + 1) % HIST;
      if (count < HIST) count++;
    };
    const stepSim = (): void => {
      const ctl = car().controls;
      ctl.throttle = keys.up;
      ctl.brake = keys.down;
      ctl.left = keys.left;
      ctl.right = keys.right;
      ctl.ersOvertakeHeld = keys.ers;
      ctl.gearUpPressed = keys.gearUp > 0;
      ctl.gearDownPressed = keys.gearDown > 0;
      ctl.drsPressed = keys.drs > 0;
      if (keys.gearUp > 0) keys.gearUp--;
      if (keys.gearDown > 0) keys.gearDown--;
      if (keys.drs > 0) keys.drs--;
      sim.step();
      sim.world.events.drain((e) => {
        if (e.type === 'lap' && e.car === 0) {
          lastLap = e.ms;
          if (e.valid !== false && (bestLap === 0 || e.ms < bestLap)) bestLap = e.ms;
        }
      });
      if (sim.world.state.tick % 4 === 0) record();
    };
    for (let i = 0; i < Math.round(tParam / SIM_DT); i++) stepSim();

    const g = canvas.getContext('2d')!;
    let acc = 0;

    const draw = (): void => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(window.innerWidth * dpr);
      const H = Math.round(window.innerHeight * dpr);
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = W / dpr;
      const h = H / dpr;
      g.fillStyle = COLORS.bg;
      g.fillRect(0, 0, w, h);
      const c = car();
      const v = c.vehicle;
      const data = track.data;
      const mapW = Math.round(w * 0.56);
      // Chase map: car-up, zoom out with speed.
      const scale = Math.max(2.2, 7.5 - v.speed * 0.06);
      const fx = Math.cos(v.yaw), fz = -Math.sin(v.yaw);
      const view: View2D = { cx: v.x + fx * 25, cz: v.z + fz * 25, ux: fx, uz: fz, scale, ox: mapW / 2, oy: h * 0.62 };
      g.save();
      g.beginPath();
      g.rect(0, 0, mapW, h);
      g.clip();
      const reach = Math.ceil(Math.max(mapW, h) / scale) + 40;
      const si = Math.floor(v.s);
      drawTrack(g, data, view, si - reach, si + reach, 2, closed);
      const line = sim.world.static.ai.getRacingLine();
      const prof = sim.world.static.ai.getProfile(0);
      const j = Math.floor(v.s / line.ds);
      const jr = Math.ceil(reach / line.ds);
      drawLine(g, line, prof, view, j - jr, j + jr, 2);
      const sl = [hist.s0[(head - 1 + HIST) % HIST]!, hist.s1[(head - 1 + HIST) % HIST]!, hist.s2[(head - 1 + HIST) % HIST]!, hist.s3[(head - 1 + HIST) % HIST]!];
      drawCar(g, view, v.x, v.z, v.yaw, v.steerAngle, '#FF4B1F', sl);
      // Velocity vector.
      g.strokeStyle = COLORS.speed;
      g.lineWidth = 2;
      g.beginPath();
      const tip = 0.5;
      const sx0 = view.ox + view.scale * ((v.x - view.cx) * -view.uz + (v.z - view.cz) * view.ux);
      const sy0 = view.oy - view.scale * ((v.x - view.cx) * view.ux + (v.z - view.cz) * view.uz);
      g.moveTo(sx0, sy0);
      const ex = v.x + v.vx * tip, ez = v.z + v.vz * tip;
      g.lineTo(view.ox + view.scale * ((ex - view.cx) * -view.uz + (ez - view.cz) * view.ux), view.oy - view.scale * ((ex - view.cx) * view.ux + (ez - view.cz) * view.uz));
      g.stroke();
      g.restore();

      // HUD numbers.
      g.fillStyle = COLORS.text;
      g.font = '700 44px "Segoe UI", system-ui, sans-serif';
      g.fillText(`${(v.speed * 3.6).toFixed(0)}`, 18, 56);
      g.font = '600 15px "Segoe UI", system-ui, sans-serif';
      g.fillStyle = COLORS.dim;
      g.fillText('km/h', 20, 76);
      g.fillStyle = COLORS.text;
      g.font = '700 30px "Segoe UI", system-ui, sans-serif';
      g.fillText(`G${v.gear}`, 120, 52);
      g.font = '600 14px ui-monospace, Consolas, monospace';
      const fmt = (ms: number): string => (ms > 0 ? `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}` : '-:--.---');
      const lines = [
        `rpm ${v.rpm.toFixed(0)}  ${v.limiterHit ? 'LIMITER' : ''}`,
        `ERS ${(v.ers.socJ / 1e6).toFixed(2)} MJ  ${v.ers.deployKw > 0 ? '+DEPLOY' : v.ers.harvestKw > 0 ? '-HARVEST' : ''}  DRS ${v.drs.open ? 'OPEN' : '-'}`,
        `tyre ${v.compound}  core ${v.tyres.map((t) => t.coreC.toFixed(0)).join('/')}  grip ${v.tyres.map((t) => t.gripMul.toFixed(2)).join('/')}`,
        `lap ${fmt(lastLap)}  best ${fmt(bestLap)}  s ${v.s.toFixed(0)} m  d ${v.d.toFixed(1)} m`,
        `assists: steer ${assists.steering ? 'on' : 'off'} abs ${assists.abs ? 'on' : 'off'} tc ${assists.tc} brk ${assists.braking} ${assists.gearbox}`,
        `${c.control === 'player' ? 'keys: arrows/WASD drive · Q/E gears · F DRS · G ERS overtake · R reset' : 'AUTODRIVE (perfect AI)'}   ${trackId}`,
      ];
      lines.forEach((t, i) => g.fillText(t, 18, h - 110 + i * 18));

      // Telemetry panels.
      const px = mapW + 8;
      const pw = w - px - 8;
      const ph = (h - 8 * 6) / 5;
      const r = (k: number): Rect => ({ x: px, y: 8 + k * (ph + 8), w: pw, h: ph });
      panel(g, r(0), 'speed km/h (0–350)');
      plot(g, r(0), [hist.speed], [COLORS.speed], head, count, 0, 350);
      panel(g, r(1), 'rpm 4000–13000 · gear (grey, 1 step = 1 gear)');
      plot(g, r(1), [hist.rpm, hist.gear], [COLORS.rpm, COLORS.dim], head, count, 4000, 13000);
      panel(g, r(2), 'throttle · brake · steer (−1…1)');
      plot(g, r(2), [hist.thr, hist.brk, hist.steer], [COLORS.thr, COLORS.brk, COLORS.steer], head, count, -1, 1);
      panel(g, r(3), 'slip σ per wheel (1 = peak) FL FR RL RR');
      plot(g, r(3), [hist.s0, hist.s1, hist.s2, hist.s3], ['#4FC3F7', '#B388FF', '#FFC23D', '#FF5A4E'], head, count, 0, 2);
      // g-g diagram.
      const gg = r(4);
      panel(g, gg, 'g-g (lat × long), circles 2 g / 4 g');
      const cx = gg.x + gg.w / 2, cy = gg.y + gg.h / 2 + 8;
      const rad = Math.min(gg.w, gg.h - 24) / 2 - 4;
      g.strokeStyle = COLORS.grid;
      g.lineWidth = 1;
      for (const k of [2, 4, 6]) {
        g.beginPath();
        g.arc(cx, cy, (rad * k) / 6, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = '#4FC3F7';
      for (let k = 0; k < count; k++) {
        const i = (head - count + k + HIST) % HIST;
        g.globalAlpha = 0.15 + (0.85 * k) / count;
        g.fillRect(cx - (hist.ay[i]! / 6) * rad - 1, cy - (hist.ax[i]! / 6) * rad - 1, 2.5, 2.5);
      }
      g.globalAlpha = 1;
    };

    return {
      update(dt) {
        if (!freeze) {
          acc += Math.min(0.1, dt) * state.timeScale;
          let n = 0;
          while (acc >= SIM_DT && n < 12) {
            stepSim();
            acc -= SIM_DT;
            n++;
          }
          if (n === 12) acc = 0;
        }
        draw();
      },
      dispose() {
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keydown', onKeyChange);
        window.removeEventListener('keyup', onKeyChange);
        window.removeEventListener('blur', onBlur);
        gui.destroy();
      },
    };
  },
};

export default scene;
