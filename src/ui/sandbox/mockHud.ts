// Typed mock HudModel for `?scene=hud` (Örnek veri). `createMockHud(track).frame(tMs)` mutates one long-lived model
// like the real presenter does: frozen = the DESIGN example state; animated = speeds, laps, sectors, re-orders,
// notifications (stress = 10 per second), optional start-light loop.

import type { Compound, Quad } from '../../contracts/common';
import type { HudModel, TowerRow } from '../../contracts/hud';
import type { TrackData } from '../../contracts/track';
import { TEAMS } from '../../data/teams';

const GRID: [string, string, Compound][] = [
  ['NRB', 'aurora', 'medium'], ['ASH', 'vortex', 'medium'], ['MOR', 'solaris', 'soft'], ['AYD', 'anka', 'medium'], ['GRA', 'kestrel', 'hard'],
  ['ORT', 'meridian', 'medium'], ['VIR', 'aurora', 'medium'], ['MEN', 'vortex', 'hard'], ['ARS', 'anka', 'medium'], ['LAM', 'solaris', 'soft'],
  ['HAL', 'titan', 'hard'], ['DUV', 'zephyr', 'medium'], ['MRT', 'kestrel', 'soft'], ['FIS', 'meridian', 'hard'], ['WHI', 'ironclad', 'medium'],
  ['PET', 'titan', 'hard'], ['RUI', 'zephyr', 'medium'], ['MRE', 'nova', 'soft'], ['CLE', 'ironclad', 'hard'], ['PAR', 'nova', 'medium'],
];
const GAPS = [0, 1204, 611, 874, 2316, 402, 1958, 3117, 733, 1540, 2071, 995, 0, 4380, 1121, 689, 2844, 1307, 0, 0];
const PLAYER = 3;

type Note = HudModel['notifications'][number];
const NOTES: Omit<Note, 'id'>[] = [
  { key: 'notify.lap.fastest', params: { code: 'GRA', time: 85_612 }, level: 'good', ms: 3000, priority: 1 },
  { key: 'notify.lap.personalBest', params: { time: 85_890, delta: -214 }, level: 'good', ms: 3000, priority: 1 },
  { key: 'notify.limits.warning', params: { n: 2, corner: 9 }, level: 'warn', ms: 4500, priority: 2 },
  { key: 'notify.start.jumpStart', params: { s: 5 }, level: 'penalty', ms: 4500, priority: 3 },
  { key: 'notify.flag.yellow', params: { n: 3 }, level: 'warn', ms: 3000, priority: 2 },
  { key: 'notify.flag.blue', params: { code: 'NRB' }, level: 'warn', ms: 3000, priority: 2 },
  { key: 'notify.drs.enabled', params: {}, level: 'info', ms: 2500, priority: 0 },
  { key: 'notify.weather.rainSoon', params: { min: 5, p: 70 }, level: 'info', ms: 4500, priority: 1 },
  { key: 'notify.weather.intersNow', params: {}, level: 'warn', ms: 4500, priority: 2 },
];

function colour(teamId: string): string {
  const t = TEAMS.find((x) => x.id === teamId);
  return t ? t.colors.ui ?? t.colors.primary : '#F2F4F7';
}

export interface MockHud {
  model: HudModel;
  /** Advances the mock to wall time `tMs` (ms since start). */
  frame(tMs: number): void;
}

export interface MockOptions { freeze: boolean; stress: boolean; lights: boolean; mode: HudModel['visible']; timeTrial: boolean; prox?: boolean }

export function createMockHud(track: TrackData | null, o: MockOptions): MockHud {
  const n = GRID.length;
  const tower: TowerRow[] = GRID.map(([code, team, cmp], i) => ({
    car: i, pos: i + 1, code, teamColor: colour(team), gapMs: GAPS[i]!, lapsDown: i === 18 ? 1 : 0, compound: cmp,
    inPit: i === 12, penaltySec: i === 9 ? 5 : 0, isPlayer: i === PLAYER, fastest: i === 4, drs: i === 2 || i === 3,
    status: i === 19 ? 'dnf' : 'running',
  }));
  const quad = <T>(a: T, b: T, c: T, d: T): Quad<T> => [a, b, c, d];
  const model: HudModel = {
    visible: o.mode, mode: o.timeTrial ? 'timeTrial' : 'race',
    lap: { current: 12, total: o.timeTrial ? null : 29 }, position: o.timeTrial ? null : { pos: 4, of: 20 },
    timing: {
      curLapMs: 65_318, lastLapMs: 86_104, bestLapMs: 85_890, deltaMs: -214, invalid: false,
      sectors: [{ ms: 28_412, status: 'green' }, { ms: 30_987, status: 'purple' }, { ms: 0, status: 'none' }], curSector: 2, deltaRef: 'best',
    },
    tower, towerExpanded: true, gapMode: 'interval',
    car: {
      kmh: 287, gear: 7, rpm: 11_400, rpmMax: 12_500, shiftLeds: 11, shiftNow: false, limiter: false, pitLimiter: false, throttle: 1, brake: 0, drs: 'available',
      ers: { soc: 0.62, mode: 'medium', lapUsed: 0.41, overtake: false }, brakeBias: 57.5,
      tyre: { compound: 'medium', ageLaps: 9, wear: quad(0.18, 0.21, 0.14, 0.16), tempC: quad(98, 127, 101, 83), state: quad<'cold' | 'ok' | 'hot'>('ok', 'hot', 'ok', 'cold') },
    },
    minimap: { x: new Float32Array(n), z: new Float32Array(n), teamColor: tower.map((r) => r.teamColor), player: PLAYER, inPit: new Uint8Array(n) },
    startLights: { visible: false, lit: 0, out: false },
    flags: { yellow: [false, false, false], blue: false, chequered: false, blackWhite: false },
    notifications: [{ id: 1, ...NOTES[0]! }],
    penalty: { toServeSec: 0, trackLimitWarnings: 0 },
    pit: null,
    mfd: { open: false, page: 'strategy', nextCompound: 'hard', boxRequested: false, forecast: [], ersAuto: true, pitLossS: 21.4, rejoinPos: 9 },
    weather: { rain: 0, wetness: 0, airC: 24, trackC: 38 },
    flashback: { open: false, offsetSec: 0, maxSec: 15, left: 3 },
    wrongWay: false,
  };
  model.minimap.inPit[12] = 1;
  // Car s positions along the lap (m): leader ahead, the field strung out, player at index 3.
  const sOf = new Float32Array(n);
  const L = track?.length ?? 5000;
  for (let i = 0; i < n; i++) sOf[i] = (L * 0.62 - i * 95 + L) % L;
  const place = (): void => {
    if (!track) return;
    for (let i = 0; i < n; i++) {
      if (model.minimap.inPit[i] && track.pit.count > 0) {
        const j = Math.floor(track.pit.count * 0.5);
        model.minimap.x[i] = track.pit.x[j]!;
        model.minimap.z[i] = track.pit.z[j]!;
        continue;
      }
      const k = Math.floor(sOf[i]!) % track.count;
      model.minimap.x[i] = track.x[k]!;
      model.minimap.z[i] = track.z[k]!;
    }
  };
  place();
  if (o.freeze) return { model, frame() {} };

  let nextId = 2;
  const born = new Map<number, number>([[1, 0]]);
  let nextNote = 3000;
  let nextSwap = 2500;
  let noteIx = 1;
  let lapStart = -65_318;
  const SEC = [28_400, 30_900, 26_500];
  return {
    model,
    frame(t) {
      // Car: a speed/gear/rpm sweep with the shift LED rule (ui-hud §2).
      const ph = (t % 6000) / 6000;
      const kmh = 120 + 200 * Math.sin(ph * Math.PI);
      const c = model.car;
      c.kmh = kmh;
      c.gear = Math.max(1, Math.min(8, Math.floor(kmh / 40)));
      c.rpm = 10_000 + ((kmh % 40) / 40) * 2400;
      c.shiftLeds = Math.round(15 * Math.max(0, Math.min(1, (c.rpm - 10_000) / 1800)));
      c.shiftNow = c.rpm >= 11_800;
      c.ers.soc = 0.5 + 0.3 * Math.sin(t / 2700);
      c.ers.lapUsed = (t % 20000) / 20000;
      c.drs = ph > 0.3 && ph < 0.6 ? 'open' : 'available';
      // Timing: a ~85 s lap with sector completions.
      let lapMs = t - lapStart;
      if (lapMs > 85_800) {
        lapStart = t;
        lapMs = 0;
        model.lap.current++;
        model.timing.lastLapMs = 85_800 + (t % 700);
      }
      const tm = model.timing;
      tm.curLapMs = lapMs;
      const cs = lapMs < SEC[0]! ? 0 : lapMs < SEC[0]! + SEC[1]! ? 1 : 2;
      if (cs !== tm.curSector) {
        tm.curSector = cs as 0 | 1 | 2;
        if (cs === 0) for (const s of tm.sectors) { s.ms = 0; s.status = 'none'; }
        else {
          const done = tm.sectors[cs - 1]!;
          done.ms = SEC[cs - 1]! + ((t * 7) % 400) - 200;
          done.status = (['green', 'purple', 'yellow'] as const)[(t / 1000) % 3 | 0]!;
        }
      }
      tm.deltaMs = Math.sin(t / 3100) * 380;
      // Minimap: everyone moves ~55 m/s.
      for (let i = 0; i < n; i++) if (!model.minimap.inPit[i]) sOf[i] = (sOf[i]! + 0.9) % L;
      place();
      if (o.prox && track) {
        // D-051 #2 proximity demo: car 4 alongside on the left (sliding from ~1.5 lengths behind to level), car 5 half a
        // length behind on the right, car 2 closing from directly behind (28 m → 7 m), on a 6 s loop.
        const mm = model.minimap;
        const k = Math.floor(sOf[PLAYER]!) % track.count, k2 = (k + 2) % track.count;
        let tx = track.x[k2]! - track.x[k]!, tz = track.z[k2]! - track.z[k]!;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        const lx = tz, lz = -tx; // left = up × forward
        const put = (i: number, f: number, l: number): void => {
          mm.inPit[i] = 0;
          mm.x[i] = mm.x[PLAYER]! + tx * f + lx * l;
          mm.z[i] = mm.z[PLAYER]! + tz * f + lz * l;
        };
        const ph = (t % 6000) / 6000;
        put(4, -9 + 10 * Math.min(1, ph * 2), 2.6);
        put(5, -3, -2.8);
        put(2, -28 + 21 * ph, 0.2);
      }
      // Re-order: swap two neighbours every 2.5 s (Flip), never the leader / dnf rows.
      if (t >= nextSwap) {
        nextSwap = t + 2500;
        const sorted = [...tower].sort((a, b) => a.pos - b.pos);
        const i = 1 + Math.floor(((t / 2500) * 7) % 8);
        const a = sorted[i]!, b = sorted[i + 1]!;
        const p = a.pos;
        a.pos = b.pos;
        b.pos = p;
        const me = tower.find((r) => r.isPlayer)!;
        if (model.position) model.position.pos = me.pos;
      }
      // Notifications (D-002: entries expire after `ms`; same key reuses the id).
      model.notifications = model.notifications.filter((x) => t < (born.get(x.id) ?? 0) + x.ms);
      if (t >= nextNote) {
        nextNote = t + (o.stress ? 100 : 3000);
        const tpl = NOTES[noteIx++ % NOTES.length]!;
        const existing = model.notifications.find((x) => x.key === tpl.key);
        if (existing) born.set(existing.id, t);
        else {
          const id = nextId++;
          born.set(id, t);
          model.notifications.push({ id, ...tpl, params: { ...tpl.params } });
        }
      }
      // Start lights loop (8 s): 5 lights 1 s apart, out after a hold, then hidden.
      if (o.lights) {
        const lt = t % 8000;
        const sl = model.startLights;
        sl.visible = lt < 6500;
        sl.lit = Math.min(5, Math.floor(lt / 1000));
        sl.out = lt >= 5600;
      }
    },
  };
}
