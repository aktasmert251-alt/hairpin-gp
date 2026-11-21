// Line variety (user request): every AI driver picks one of five line options per corner, drawn from the race seed,
// car, lap and corner, weighted by its profile. (a) the same seed replays identically; (b) another seed gives the
// same driver a different line at T4 on lap 1; (c) over 20 race seeds one driver uses ≥ 3 options at every corner,
// none above 70 %; (d) the field's lateral spread around the racing line is well above the old single line (0.20 m).

import { describe, expect, it } from 'vitest';
import { buildLineup, createSim, defaultSessionConfig } from '../../game/createSim';
import { MODULE_STATUS as TRACK_STATUS, loadTrack } from '../../track/index';
import { LINE_OPTIONS, pickOption, varietySeed, type VarietyDriver } from '../line/variety';

const HZ = 240;
const istanbulReady = TRACK_STATUS !== 'stub' && loadTrack().data.id === 'istanbul';
const DRIVER = 'norberg';

function carOf(seed: number, driverId: string): number {
  return buildLineup(defaultSessionConfig({ mode: 'race', aiCount: 19, seed })).findIndex((e) => e.driver.id === driverId);
}

/** Lap-1 trace of one driver: d at every corner entry / apex / exit, plus the field's offsets from lap 2 on. */
function run(seed: number, laps: number): { trace: number[]; t4: number[]; dev: number[][] } {
  const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 19, seed, laps, difficulty: 70, autodrive: true }));
  const w = sim.world;
  const q = w.static.track.query;
  const corners = w.static.track.data.corners;
  const line = w.static.ai.getRacingLine();
  const cars = w.state.cars;
  const me = carOf(seed, DRIVER);
  const marks = corners.flatMap((c) => [c.entryS, c.apexS, c.exitS]);
  const trace: number[] = [];
  const dev: number[][] = marks.map(() => []);
  const lastS = new Float64Array(cars.length);
  const t4 = [NaN, NaN, NaN];
  for (let i = 0; i < (laps * 130 + 60) * HZ && w.state.race.phase !== 'finished'; i++) {
    sim.step();
    w.events.drain(() => {});
    for (let k = 1; k < cars.length; k++) {
      const c = cars[k]!;
      const v = c.vehicle;
      if (v.hint.ribbon === 'main' && c.pit.phase === 'none') {
        for (let m = 0; m < marks.length; m++) {
          const sm = marks[m]!;
          if (!(q.deltaS(lastS[k]!, sm) > 0 && q.deltaS(v.s, sm) <= 0)) continue;
          const off = v.d - line.d[Math.round(sm / line.ds) % line.count]!;
          if (k === me && c.race.lapsCompleted === 0) {
            trace.push(off);
            if (m >= 9 && m <= 11) t4[m - 9] = off; // T4 entry / apex / exit
          }
          if (c.race.lapsCompleted >= 1) dev[m]!.push(off);
        }
      }
      lastS[k] = v.s;
    }
  }
  return { trace, t4, dev };
}

const std = (a: number[]): number => {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
};

describe('line variety', () => {
  it('(c) over 20 race seeds one driver uses ≥ 3 line options per corner, none > 70 %', () => {
    const corners = istanbulReady ? loadTrack().data.corners.length : 14;
    const rows: string[] = [];
    const prof = buildLineup(defaultSessionConfig({ mode: 'race', aiCount: 19, seed: 1 })).find((e) => e.driver.id === DRIVER)?.driver.ai
      ?? { consistency: 0.9, aggression: 0.68, tyreMgmt: 0.78 };
    for (let c = 0; c < corners; c++) {
      const hist = [0, 0, 0, 0, 0];
      for (let seed = 1; seed <= 20; seed++) {
        const vd: VarietyDriver = { seed: varietySeed(seed, Math.max(1, carOf(seed, DRIVER))), bias: 0, consistency: prof.consistency, aggression: prof.aggression, tyreMgmt: prof.tyreMgmt, sigmaV: 0 };
        hist[pickOption(vd, 0, c, 0, 0)]!++;
      }
      rows.push(`T${c + 1}: ${hist.map((h, i) => `${LINE_OPTIONS[i]} ${h}`).join(' ')}`);
      expect(hist.filter((h) => h > 0).length).toBeGreaterThanOrEqual(3);
      expect(Math.max(...hist)).toBeLessThanOrEqual(14);
    }
    console.log(`line options of ${DRIVER}, lap 1, seeds 1–20:\n${rows.join('\n')}`);
  });

  it.skipIf(!istanbulReady)('(a) same seed identical, (b) new seed → new T4 line, (d) field spread', () => {
    const a1 = run(1234, 2);
    const a2 = run(1234, 2);
    const b = run(4321, 2);
    expect(a2.trace).toEqual(a1.trace);
    const spread = a1.dev.map(std);
    const mean = spread.reduce((x, y) => x + y, 0) / spread.length;
    console.log(`T4 entry/apex/exit lap 1 (${DRIVER}), d − line: seed 1234 ${a1.t4.map((x) => x.toFixed(2)).join(' / ')} m, seed 4321 ${b.t4.map((x) => x.toFixed(2)).join(' / ')} m\n`
      + `field σ(d − line) lap 2, entry/apex/exit per corner: ${spread.map((x) => x.toFixed(2)).join(' ')}; mean ${mean.toFixed(2)} m`);
    expect(Math.max(...a1.t4.map((x, i) => Math.abs(x - b.t4[i]!)))).toBeGreaterThan(0.3);
    expect(mean).toBeGreaterThan(0.4);
  }, 600_000);
});
