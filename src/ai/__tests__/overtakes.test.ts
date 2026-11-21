// QC2-05 (S5 racecraft gate): 20-car, 10-lap races at d70 (autodrive player) must average ≥ 15 on-track overtakes
// with car-to-car contacts above 5 kN·s kept rare. Lap-1 position changes are reported (still 0: open).
// An overtake = a pair swap with both cars on the main ribbon and out of any pit phase, within half a lap of each
// other (the QC definition); a 4 m hysteresis keeps side-by-side jitter from counting twice.

import { describe, expect, it } from 'vitest';
import type { SessionConfig } from '../../contracts/race';
import type { SimWorld } from '../../contracts/sim';
import { buildLineup, createSim, defaultSessionConfig } from '../../game/createSim';
import { defaultVehicleParams } from '../../physics/params';
import { MODULE_STATUS as TRACK_STATUS, loadTrack } from '../../track/index';

const HZ = 240;
const istanbulReady = TRACK_STATUS !== 'stub' && loadTrack().data.id === 'istanbul';

export interface OvertakeRun { swaps: number; lap1: number; big: number; maxImpulse: number; finished: number }

export function countOvertakes(difficulty: number, seed = 1234, laps = 10): OvertakeRun {
  const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 19, seed, laps, difficulty, autodrive: true }));
  const w = sim.world;
  withTraits(sim.world, sim.world.static.config);
  const cars = w.state.cars;
  const n = cars.length;
  const L = w.static.track.query.length;
  const sign = new Int8Array(n * n);
  const r: OvertakeRun = { swaps: 0, lap1: 0, big: 0, maxImpulse: 0, finished: 0 };
  for (let i = 0; i < (laps * 130 + 60) * HZ && w.state.race.phase !== 'finished'; i++) {
    sim.step();
    w.events.drain((e) => {
      if (e.type === 'collision' && e.b >= 0) {
        if (e.impulse > 5000) r.big++;
        if (e.impulse > r.maxImpulse) r.maxImpulse = e.impulse;
      }
      if (e.type === 'finish') r.finished++;
    });
    if ((i & 3) !== 0) continue;
    const race = w.state.race;
    if (race.phase !== 'running' && race.phase !== 'finishing') continue;
    let leaderLaps = 0;
    for (let a = 0; a < n; a++) if (cars[a]!.race.lapsCompleted > leaderLaps) leaderLaps = cars[a]!.race.lapsCompleted;
    for (let a = 0; a < n; a++) {
      const ca = cars[a]!;
      const outA = ca.pit.phase !== 'none' || ca.vehicle.hint.ribbon !== 'main' || ca.race.finished;
      for (let b = a + 1; b < n; b++) {
        const cb = cars[b]!;
        const k = a * n + b;
        const diff = ca.race.progress - cb.race.progress;
        if (outA || cb.pit.phase !== 'none' || cb.vehicle.hint.ribbon !== 'main' || cb.race.finished || Math.abs(diff) > 0.5 * L) {
          sign[k] = 0;
          continue;
        }
        const sNow = diff > 4 ? 1 : diff < -4 ? -1 : 0;
        if (sNow === 0) continue;
        if (sign[k] !== 0 && sign[k] !== sNow) {
          r.swaps++;
          if (leaderLaps < 1) r.lap1++;
        }
        sign[k] = sNow;
      }
    }
  }
  return r;
}

describe.skipIf(!istanbulReady)('racecraft overtakes (QC2-05, S5)', () => {
  // The count is chaotic per seed (one race: 9–36 for small parameter changes), so the gate is the mean over four
  // race seeds instead of one seed (TEAM-RULES: tests must not flip on tiny changes).
  it('d70, 20 cars × 10 laps, seeds 1234/4321/2345/777: mean ≥ 15 overtakes, contacts > 5 kN·s ≤ 1 per race', () => {
    const rows: string[] = [];
    let swaps = 0;
    let big = 0;
    for (const seed of [1234, 4321, 2345, 777]) {
      const r = countOvertakes(70, seed);
      rows.push(`seed ${seed}: swaps ${r.swaps}, lap 1 ${r.lap1}, contacts > 5 kN·s ${r.big}, max ${(r.maxImpulse / 1000).toFixed(1)} kN·s, finished ${r.finished}`);
      expect(r.finished).toBe(20);
      swaps += r.swaps;
      big += r.big;
    }
    console.log(`overtakes d70:\n${rows.join('\n')}\nmean ${(swaps / 4).toFixed(1)}`);
    expect(swaps / 4).toBeGreaterThanOrEqual(15);
    expect(big).toBeLessThanOrEqual(4);
  }, 1_800_000);
});

/** D-036: team traits in every car's params (idempotent once createSim passes them itself). */
function withTraits(w: SimWorld, cfg: SessionConfig): void {
  buildLineup(cfg).forEach((e, i) => Object.assign(w.static.params[i]!, defaultVehicleParams(e.team.perf, e.team.traits)));
  w.static.ai.onWetnessChanged(0.5);
}
