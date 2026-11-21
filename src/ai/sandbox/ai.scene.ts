// ?scene=ai (Sürüş): 20 AI cars (the player car on autodrive) on a full-track 2D map, racing line coloured by
// speed-profile zone (green throttle, amber lift, red brake), team-coloured cars, live standings and lap times.
// Extras: &track=istanbul|lombardia|bosphorus|oval, &ai=<n>, &difficulty=<0-110>, &fuel=<kg>, &t=<s>, &freeze=1, &zoom=<1-6> (follows the leader).
// Calibration panel (S2-S1, S-SM-04/05/08/09): field best / median lap, the player's (autodrive = d 100 'perfect')
// sector split of its best lap, T8 peak lateral g and back-straight peak speed on flying laps.

import GUI from 'lil-gui';
import type { SandboxScene } from '../../contracts/debug';
import { SIM_DT } from '../../contracts/sim';
import { teamById } from '../../data/teams';
import { isRaceTrackId } from '../../data/tracks';
import { createSim, defaultSessionConfig } from '../../game/index';
import { COLORS, drawCar, drawLine, drawTrack, fitView, type View2D } from '../../physics/sandbox/view2d';
import { createOvalTrack, loadTrack } from '../../track/index';

const scene: SandboxScene = {
  id: 'ai',
  title: 'AI drivers',
  async create({ canvas, uiRoot, params }) {
    const trackId = params.get('track') ?? 'istanbul';
    const raceId = isRaceTrackId(trackId) ? trackId : 'istanbul';
    const track = trackId === 'oval' ? createOvalTrack() : loadTrack(raceId);
    const state = {
      difficulty: Number(params.get('difficulty') ?? 100),
      timeScale: 1,
      zoom: Number(params.get('zoom') ?? 1),
      labels: true,
    };
    const cfg = defaultSessionConfig({ mode: 'race', laps: 50, aiCount: Number(params.get('ai') ?? 19), seed: Number(params.get('seed') ?? 7), difficulty: state.difficulty, autodrive: true, trackId: raceId });
    const sim = createSim(cfg, { track, skipLights: params.get('lights') !== '1' });
    const world = sim.world;
    const cars = world.state.cars;
    // &fuel=<kg>: the calibration condition is 10 kg (race fuel for 50 laps would be 89 kg).
    const fuel = Number(params.get('fuel') ?? NaN);
    if (fuel >= 0) {
      for (const c of cars) {
        c.vehicle.fuelKg = fuel;
        c.vehicle.massKg = world.static.params[c.id]!.massDryKg + fuel;
      }
    }
    const lastLap = new Float64Array(cars.length);
    const bestLap = new Float64Array(cars.length);
    const curSec = [0, 0, 0];
    const bestSplit = [0, 0, 0];
    const cal = { t8: 0, bs: 0 };
    const player = cars.findIndex((c) => c.isPlayer);

    const gui = new GUI({ title: 'AI', container: uiRoot });
    gui.domElement.style.cssText += ';position:absolute;right:8px;bottom:36px;top:auto;z-index:10';
    gui.add(state, 'difficulty', 0, 110, 1).onFinishChange((d: number) => world.static.ai.setDifficulty(d));
    gui.add(state, 'timeScale', 0.1, 4, 0.1).name('time scale');
    gui.add(state, 'zoom', 1, 8, 0.5).name('zoom (follow leader)');
    gui.add(state, 'labels');

    const stepSim = (): void => {
      sim.step();
      world.events.drain((e) => {
        if (e.type === 'sector' && e.car === player) curSec[e.sector] = e.ms;
        if (e.type === 'lap') {
          lastLap[e.car] = e.ms;
          if (bestLap[e.car] === 0 || e.ms < bestLap[e.car]!) {
            bestLap[e.car] = e.ms;
            if (e.car === player) for (let k = 0; k < 3; k++) bestSplit[k] = (100 * curSec[k]!) / e.ms;
          }
        }
      });
      if (player >= 0 && cars[player]!.race.lapsCompleted >= 1) {
        const v = cars[player]!.vehicle;
        if (v.s > 2192 && v.s < 2750) cal.t8 = Math.max(cal.t8, Math.abs(v.ayLat) / 9.81);
        if (v.s > 4300 && v.s < 4560) cal.bs = Math.max(cal.bs, v.speed * 3.6);
      }
    };
    const tParam = Number(params.get('t') ?? 0);
    for (let i = 0; i < Math.round(tParam / SIM_DT); i++) stepSim();
    const freeze = params.get('freeze') === '1';

    const g = canvas.getContext('2d')!;
    const line = world.static.ai.getRacingLine();
    let acc = 0;
    const fmt = (ms: number): string => (ms > 0 ? `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}` : '-:--.---');

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
      const PANEL = 400;
      const mapW = w - PANEL;
      const view: View2D = fitView(track.data, mapW, h, 40);
      if (state.zoom > 1) {
        const lead = cars[world.state.race.order[0] ?? 0]!.vehicle;
        view.cx = lead.x;
        view.cz = lead.z;
        view.scale *= state.zoom;
      }
      g.save();
      g.beginPath();
      g.rect(0, 0, mapW, h);
      g.clip();
      drawTrack(g, track.data, view, 0, track.data.count, 2, true);
      drawLine(g, line, world.static.ai.getProfile(1 % cars.length), view, 0, line.count, 2.5);
      const carScale = Math.max(1, 3 / view.scale);
      for (let i = cars.length - 1; i >= 0; i--) {
        const c = cars[i]!;
        const v = c.vehicle;
        const team = teamById(c.teamId);
        drawCar(g, view, v.x, v.z, v.yaw, v.steerAngle, team?.colors.primary ?? '#ffffff', null, carScale);
        if (state.labels) {
          const dx = v.x - view.cx, dz = v.z - view.cz;
          const sx = view.ox + view.scale * (dx * -view.uz + dz * view.ux);
          const sy = view.oy - view.scale * (dx * view.ux + dz * view.uz);
          g.fillStyle = COLORS.text;
          g.font = '600 11px "Segoe UI", system-ui, sans-serif';
          g.fillText(`${c.race.position}`, sx + 7, sy - 6);
        }
      }
      g.restore();

      // Standings.
      const px = mapW + 10;
      g.fillStyle = COLORS.panel;
      g.fillRect(mapW, 0, PANEL, h);
      g.fillStyle = COLORS.text;
      g.font = '700 16px "Segoe UI", system-ui, sans-serif';
      g.fillText(`AI v2 · ${trackId} · d=${state.difficulty} · t ${world.state.time.toFixed(1)} s`, px, 28);
      g.font = '12px ui-monospace, Consolas, monospace';
      g.fillStyle = COLORS.dim;
      g.fillText('P  driver      lap  last       best     km/h mode', px, 52);
      const order = world.state.race.order;
      for (let k = 0; k < order.length; k++) {
        const c = cars[order[k]!]!;
        const team = teamById(c.teamId);
        const y = 72 + k * 18;
        g.fillStyle = team?.colors.primary ?? '#fff';
        g.fillRect(px, y - 10, 4, 12);
        g.fillStyle = c.isPlayer ? '#FFC23D' : COLORS.text;
        const row = `${String(k + 1).padStart(2)} ${c.driverId.slice(0, 9).padEnd(9)} ${String(c.race.lapsCompleted).padStart(3)}  ${fmt(lastLap[c.id]!)} ${fmt(bestLap[c.id]!)} ${(c.vehicle.speed * 3.6).toFixed(0).padStart(3)} ${c.ai.mode.slice(0, 5)}`;
        g.fillText(row, px + 8, y);
      }
      // Calibration panel.
      const bests: number[] = [];
      for (let i = 0; i < cars.length; i++) if (bestLap[i]! > 0) bests.push(bestLap[i]!);
      bests.sort((a, b) => a - b);
      let y = 72 + order.length * 18 + 18;
      g.fillStyle = COLORS.text;
      g.font = '700 13px "Segoe UI", system-ui, sans-serif';
      g.fillText('Calibration (target d=100: 1:24.0–1:27.0)', px, y);
      g.font = '12px ui-monospace, Consolas, monospace';
      const rows = [
        `field best ${fmt(bests[0] ?? 0)}  median ${fmt(bests[bests.length >> 1] ?? 0)}  (${bests.length} cars)`,
        player >= 0 ? `player best ${fmt(bestLap[player]!)}  split ${bestSplit.map((x) => x.toFixed(1)).join(' / ')} %` : 'no player car',
        `T8 peak ${cal.t8.toFixed(2)} g (4.5–5.5)  back straight ${cal.bs.toFixed(0)} km/h (320–335)`,
      ];
      for (const r of rows) {
        y += 18;
        g.fillText(r, px, y);
      }
      g.fillStyle = COLORS.dim;
      g.fillText('line: green throttle · amber lift · red brake', px, h - 16);
    };

    return {
      update(dt) {
        if (!freeze) {
          acc += Math.min(0.1, dt) * state.timeScale;
          let n = 0;
          while (acc >= SIM_DT && n < 48) {
            stepSim();
            acc -= SIM_DT;
            n++;
          }
          if (n === 48) acc = 0;
        }
        draw();
      },
      dispose() {
        gui.destroy();
      },
    };
  },
};

export default scene;
