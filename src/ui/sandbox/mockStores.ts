// Mock UI stores for `?scene=menu` (Örnek veri): setup, results (20 rows), time-trial history, loading.

import type { ResultsModel, Store, TimeTrialModel } from '../../contracts/ui';
import type { SessionConfig } from '../../contracts/race';
import { createStore } from '../../core/store';
import { TEAMS } from '../../data/teams';
import { defaultSessionConfig } from '../../game/createSim';

export interface MockStores {
  setup: Store<SessionConfig>;
  results: Store<ResultsModel>;
  tt: Store<TimeTrialModel>;
  loading: Store<{ progress: number; tipKey: string }>;
}

const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

export function mockResults(laps: number): ResultsModel {
  const drivers = TEAMS.flatMap((t) => t.drivers.map((d, i) => ({ t, d, i })));
  // A plausible finishing order (the player, Anka #1, finishes P4).
  const order = [2, 4, 6, 0, 8, 3, 10, 5, 12, 7, 14, 9, 16, 11, 18, 13, 1, 15, 17, 19];
  const winner = laps * 85_900 + 3_734_512 - 29 * 85_900;
  const rows: ResultsModel['rows'] = order.map((k, p) => {
    const { t, d } = drivers[k % drivers.length]!;
    const dnf = p === 19;
    const lapsDown = p >= 17 && !dnf ? 1 : 0;
    return {
      pos: p + 1, car: k, name: d.name, teamId: t.id, totalMs: winner + p * 2_870, gapMs: p * 2_870 + (p * 413) % 900, lapsDown,
      bestLapMs: 85_612 + ((p * 271) % 1400), stops: p === 19 ? 0 : 1 + (p % 4 === 3 ? 1 : 0), penaltySec: p === 9 ? 5 : 0, points: POINTS[p] ?? 0,
      status: dnf ? 'dnf' : 'finished',
    };
  });
  return { rows, fastestCar: order[0]! };
}

export function mockTimeTrial(withPb: boolean): TimeTrialModel {
  if (!withPb) return { laps: [], pbMs: 0, top10: [] };
  return {
    laps: [
      { n: 1, ms: 87_402, valid: true, sectors: [29_011, 31_377, 27_014] },
      { n: 2, ms: 85_612, valid: true, sectors: [28_204, 30_871, 26_537] },
      { n: 3, ms: 86_118, valid: false, sectors: [28_100, 31_002, 27_016] },
    ],
    pbMs: 85_612,
    top10: [{ ms: 85_612, date: '2026-10-08', teamId: 'anka' }],
  };
}

export function createMockStores(o: { pb: boolean; laps: number }): MockStores {
  return {
    setup: createStore(defaultSessionConfig({ mode: 'race', laps: o.laps, aiCount: 19 })),
    results: createStore(mockResults(o.laps)),
    tt: createStore(mockTimeTrial(o.pb)),
    loading: createStore({ progress: 0.62, tipKey: 'loading.tips.drs' }),
  };
}
