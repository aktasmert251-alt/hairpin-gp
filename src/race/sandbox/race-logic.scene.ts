// ?scene=race-logic (YÖN): headless 20-car race (all AI, player on autodrive) shown as dots on a 2D map plus a timing
// table and an event log. Checks the RaceDirector without rendering 3D. Params: &seed, &laps, &ai, &t=<s> (fast-forward),
// &timescale, &freeze=1, &lang, &skipLights=1, &weather, &pitLap=<n> (every car plans a stop on in-lap n, L10).

import type { SandboxScene } from '../../contracts/debug';
import type { SimEvent } from '../../contracts/sim';
import { SIM_HZ } from '../../contracts/sim';
import { createI18n } from '../../core/i18n/index';
import { parseLaunchParams } from '../../core/launchParams';
import { TEAMS } from '../../data/teams';
import { PERFECT_PROFILE, PLAYER_CAR_ID, createSim, defaultSessionConfig } from '../../game/createSim';
import { crx } from '../extra';

const MAX_TICKS_PER_FRAME = 240 * 8;

function fmt(ms: number): string {
  if (!(ms > 0)) return '—';
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

function eventText(e: SimEvent): string {
  const { type, ...rest } = e;
  return `${type} ${JSON.stringify(rest)}`;
}

const scene: SandboxScene = {
  id: 'race-logic',
  title: 'Race logic (RaceDirector)',
  async create({ canvas, uiRoot, params }) {
    const launch = parseLaunchParams(params);
    const i18n = createI18n({ lang: launch.lang ?? 'tr' });
    const aiCount = launch.ai ?? 19;
    const cfg = defaultSessionConfig({
      mode: 'race', laps: launch.laps ?? 3, aiCount, seed: launch.seed ?? 1, gridPos: launch.grid ?? 10,
      weather: launch.weather ?? 'dry', autodrive: true,
    });
    const sim = createSim(cfg, { skipLights: launch.skipLights });
    const world = sim.world;
    const player = world.state.cars[PLAYER_CAR_ID]!;
    player.control = 'ai';
    world.static.ai.initCar(world, PLAYER_CAR_ID, PERFECT_PROFILE);
    const pitLap = Number(params.get('pitLap') ?? 0);
    if (pitLap > 0) {
      for (const c of world.state.cars) {
        c.ai.plannedStopLaps = [pitLap];
        c.ai.nextCompound = 'hard';
      }
    }
    const log: string[] = [];
    const drain = (): void => {
      world.events.drain((e) => {
        if (e.type === 'gear' || e.type === 'kerb' || e.type === 'position' || e.type === 'sector') return;
        log.unshift(`${(world.state.time).toFixed(2)}  ${eventText(e)}`);
        if (log.length > 14) log.length = 14;
      });
    };
    if (launch.t) {
      const n = Math.round(launch.t * SIM_HZ);
      for (let i = 0; i < n; i++) {
        sim.step();
        if (i % 240 === 0) drain();
      }
      drain();
    }

    // ---- layout ----
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;display:grid;grid-template-columns:1fr 760px;gap:16px;padding:16px;background:#0A0C0F;color:#F2F4F7;font:13px/1.35 ui-monospace,Consolas,monospace;pointer-events:auto';
    const left = document.createElement('div');
    left.style.cssText = 'display:flex;flex-direction:column;gap:8px;min-width:0';
    const header = document.createElement('div');
    header.style.cssText = 'font-size:15px';
    canvas.style.cssText = 'width:100%;flex:1;min-height:0;background:#111418;border-radius:4px';
    const logEl = document.createElement('pre');
    logEl.style.cssText = 'margin:0;height:230px;overflow:hidden;color:#AEB6C2';
    left.append(header, canvas, logEl);
    const table = document.createElement('table');
    table.style.cssText = 'border-collapse:collapse;width:100%;align-self:start';
    const head = document.createElement('tr');
    for (const c of i18n.t('common.raceLogic.cols').split('|')) {
      const th = document.createElement('th');
      th.textContent = c;
      th.style.cssText = 'text-align:left;padding:3px 6px;border-bottom:1px solid #2A3038;color:#AEB6C2';
      head.appendChild(th);
    }
    table.appendChild(head);
    const cells: HTMLTableCellElement[][] = [];
    for (let i = 0; i < world.state.cars.length; i++) {
      const tr = document.createElement('tr');
      const row: HTMLTableCellElement[] = [];
      for (let k = 0; k < 13; k++) {
        const td = document.createElement('td');
        td.style.cssText = 'padding:2px 6px;white-space:nowrap';
        tr.appendChild(td);
        row.push(td);
      }
      table.appendChild(tr);
      cells.push(row);
    }
    root.append(left, table);
    uiRoot.appendChild(root);

    // ---- map ----
    const data = world.static.track.data;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < data.count; i++) {
      minX = Math.min(minX, data.x[i]!); maxX = Math.max(maxX, data.x[i]!);
      minZ = Math.min(minZ, data.z[i]!); maxZ = Math.max(maxZ, data.z[i]!);
    }
    const g = canvas.getContext('2d')!;
    const teamOf = new Map(TEAMS.map((t) => [t.id, t]));
    const driverOf = new Map(TEAMS.flatMap((t) => t.drivers.map((d) => [d.id, d] as const)));
    const draw = (): void => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const k = Math.min((w - 40) / (maxX - minX), (h - 40) / (maxZ - minZ));
      const ox = (w - (maxX - minX) * k) / 2, oz = (h - (maxZ - minZ) * k) / 2;
      const X = (x: number): number => ox + (x - minX) * k;
      const Z = (z: number): number => oz + (z - minZ) * k;
      g.clearRect(0, 0, w, h);
      g.lineWidth = 6;
      const race = world.state.race;
      for (let sec = 0; sec < 3; sec++) {
        g.strokeStyle = race.yellow[sec] ? '#F5C518' : '#3A424D';
        g.beginPath();
        let started = false;
        for (let i = 0; i < data.count; i += 4) {
          if (world.static.track.query.sectorAt(i) !== sec) continue;
          if (!started) g.moveTo(X(data.x[i]!), Z(data.z[i]!));
          else g.lineTo(X(data.x[i]!), Z(data.z[i]!));
          started = true;
        }
        g.stroke();
      }
      for (const c of world.state.cars) {
        const t = teamOf.get(c.teamId);
        g.fillStyle = t ? t.colors.ui ?? t.colors.primary : '#fff';
        g.beginPath();
        g.arc(X(c.vehicle.x), Z(c.vehicle.z), c.isPlayer ? 7 : 5, 0, Math.PI * 2);
        g.fill();
        if (c.isPlayer) {
          g.strokeStyle = '#fff';
          g.lineWidth = 2;
          g.stroke();
        }
      }
    };

    const refresh = (): void => {
      const st = world.state;
      const race = st.race;
      const t = race.phase === 'grid' || race.phase === 'lights' ? 0 : race.raceMs - race.lightsOutAtMs;
      header.textContent = i18n.t('common.raceLogic.header', {
        phase: race.phase, time: fmt(t), lit: race.lightsLit, out: race.lightsLit === 0 && t > 0 ? i18n.t('common.raceLogic.out') : '',
        yellow: race.yellow.map((y) => (y ? 'Y' : '·')).join(''), drs: i18n.t(race.drsEnabled ? 'common.raceLogic.on' : 'common.raceLogic.off'),
      });
      race.order.forEach((id, i) => {
        const c = st.cars[id]!;
        const r = c.race;
        const d = driverOf.get(c.driverId);
        const row = cells[i]!;
        const vals = [
          String(i + 1), String(d?.number ?? id), d?.code ?? c.driverId, String(r.lapsCompleted),
          i === 0 ? '—' : r.lapsDown > 0 ? `+${r.lapsDown}L` : `+${(r.gapToLeaderMs / 1000).toFixed(3)}`,
          fmt(r.lastLapMs), fmt(r.bestLapMs), r.penaltySec > 0 ? `${r.penaltySec}/${r.penaltyToServeSec}` : '', String(r.trackLimitCount || ''),
          // L12: flag (B = blue, Y = yellow in the car's sector), pit phase, stops + current compound.
          r.status, crx(r).blueOn ? 'B' : race.yellow[world.static.track.query.sectorAt(c.vehicle.s)] ? 'Y' : '',
          c.pit.phase === 'none' ? '' : c.pit.phase, `${r.pitStops} ${c.vehicle.compound[0]!.toUpperCase()}`,
        ];
        for (let k = 0; k < vals.length; k++) if (row[k]!.textContent !== vals[k]) row[k]!.textContent = vals[k]!;
        row[0]!.parentElement!.style.background = c.isPlayer ? '#1E242C' : race.fastest.car === id ? '#24182E' : '';
      });
      logEl.textContent = `${i18n.t('common.raceLogic.events')}\n${log.join('\n')}`;
      draw();
    };
    refresh();

    let acc = 0;
    return {
      update(dt: number) {
        if (!launch.freeze && world.state.race.phase !== 'finished') {
          acc += Math.min(0.25, dt) * launch.timescale;
          let n = 0;
          while (acc >= 1 / SIM_HZ && n < MAX_TICKS_PER_FRAME) {
            sim.step();
            acc -= 1 / SIM_HZ;
            n++;
          }
          drain();
        }
        refresh();
      },
      dispose() {
        root.remove();
      },
    };
  },
};

export default scene;
