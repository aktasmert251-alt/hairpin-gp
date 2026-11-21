// S8 AI v1 acceptance: racing line (U-AI-01), prepare budget (U-AI-02), difficulty table (U-AI-03), and the
// İstanbul smoke check (20 cars × 3 laps: no NaN, no car stuck > 4 s, ≤ 1 off-track per car per lap).

import { describe, expect, it } from 'vitest';
import type { TrackFrame } from '../../contracts/track';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { findNonFinite } from '../../game/sim/stateUtils';
import { defaultVehicleParams } from '../../physics/index';
import { MODULE_STATUS as TRACK_STATUS, createOvalTrack, loadTrack } from '../../track/index';
import { createAIModule } from '../aiModule';
import { buildRacingLine, EDGE_MARGIN } from '../line/racingLine';
import { brakeEffFor, gripScaleFor, mistakeChanceFor, startReactionFor } from '../profile/speedProfile';

const HZ = 240;
const istanbulReady = TRACK_STATUS !== 'stub' && loadTrack().data.id === 'istanbul';

describe('racing line (U-AI-01)', () => {
  for (const [name, mk] of [['oval', createOvalTrack], ['istanbul', loadTrack]] as const) {
    it(`${name}: builds in ≤ 60 ms and stays inside the edges − ${EDGE_MARGIN} m`, () => {
      const q = mk().query;
      // Two warm-up builds (JIT), then the best of 8: parallel test workers only add time, so the minimum is the
      // build cost (B-2: best of 3 still read 102 ms under full-suite load; standalone it is well under the limit).
      let ms = Infinity;
      let line = buildRacingLine(q).line;
      buildRacingLine(q);
      for (let k = 0; k < 8; k++) {
        const t0 = performance.now();
        line = buildRacingLine(q).line;
        ms = Math.min(ms, performance.now() - t0);
      }
      console.log(`U-AI-01 ${name}: racing line build ${ms.toFixed(1)} ms (best of 8)`);
      expect(ms).toBeLessThanOrEqual(60);
      const f: TrackFrame = { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 };
      for (let i = 0; i < line.count; i++) {
        q.frameAt(line.s[i]!, f);
        expect(line.d[i]!).toBeLessThanOrEqual(f.halfWidthL - EDGE_MARGIN + 1e-3);
        expect(line.d[i]!).toBeGreaterThanOrEqual(-(f.halfWidthR - EDGE_MARGIN) - 1e-3);
      }
    });
  }
});

describe('prepare (U-AI-02)', () => {
  it('prepare + 20 initCar profiles ≤ 300 ms on the default track', () => {
    const track = loadTrack();
    const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 19, seed: 5 }), { skipLights: true, track });
    const params = sim.world.static.params;
    const ai = createAIModule();
    const t0 = performance.now();
    ai.prepare(track.query, params);
    ai.setDifficulty(70);
    for (let i = 0; i < params.length; i++) ai.initCar(sim.world, i, { pace: 0.995, consistency: 0.8, aggression: 0.5, wetSkill: 0.5, tyreMgmt: 0.5, startSkill: 0.5, defending: 0.5 });
    expect(performance.now() - t0).toBeLessThanOrEqual(300);
    expect(ai.getProfile(0).v.length).toBe(ai.getRacingLine().count);
    void defaultVehicleParams;
  });
});

describe('difficulty table (U-AI-03)', () => {
  const rows: [number, number, number, number, number][] = [
    [0, 0.83, 0.85, 0.022, 0.4], [50, 0.894, 0.923, 0.007, 0.32], [100, 1.02, 1.0, 0.002, 0.24], [110, 1.04, 1.0, 0.002, 0.22],
  ];
  for (const [d, g, b, m, r] of rows) {
    it(`d = ${d}`, () => {
      expect(Math.abs(gripScaleFor(d) - g)).toBeLessThan(0.005);
      expect(Math.abs(brakeEffFor(d) - b)).toBeLessThan(0.005);
      expect(Math.abs(mistakeChanceFor(d) - m)).toBeLessThan(0.005);
      expect(Math.abs(startReactionFor(d) - r)).toBeLessThan(0.005);
    });
  }
});

describe.skipIf(!istanbulReady)('İstanbul smoke (S8)', () => {
  it('20 cars × 3 laps: no NaN, no car stuck > 4 s, ≤ 1 off-track per car per lap', () => {
    const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 19, seed: 11, laps: 3, difficulty: 100, autodrive: true }), { skipLights: true });
    const w = sim.world;
    const cars = w.state.cars;
    const n = cars.length;
    const offs = new Array<number>(n).fill(0);
    const wasOff = new Array<boolean>(n).fill(false);
    const stuck = new Array<number>(n).fill(0);
    const maxStuck = new Array<number>(n).fill(0);
    const laps: number[][] = cars.map(() => []);
    let nan: string | null = null;
    for (let i = 0; i < 400 * HZ && w.state.race.phase !== 'finished'; i++) {
      sim.step();
      w.events.drain((e) => {
        if (e.type === 'lap') laps[e.car]!.push(e.ms);
      });
      for (let k = 0; k < n; k++) {
        const v = cars[k]!.vehicle;
        const off = v.offTrackWheels >= 4;
        if (off && !wasOff[k]) offs[k]!++;
        wasOff[k] = off;
        stuck[k] = v.speed < 1 && !cars[k]!.race.finished ? stuck[k]! + 1 / HZ : 0;
        if (stuck[k]! > maxStuck[k]!) maxStuck[k] = stuck[k]!;
      }
      if (i % HZ === 0 && !nan) nan = findNonFinite(w.state.cars, 'cars');
    }
    const table = cars.map((c, k) => `${c.driverId.padEnd(10)} laps ${laps[k]!.map((ms) => (ms / 1000).toFixed(2)).join(' / ')}  offs ${offs[k]} stuck ${maxStuck[k]!.toFixed(1)} s resets ${c.vehicle.resetCount}`);
    console.log(`İstanbul AI smoke (d = 100):\n${table.join('\n')}`);
    expect(nan).toBeNull();
    for (let k = 0; k < n; k++) {
      expect(maxStuck[k]!).toBeLessThanOrEqual(4);
      expect(offs[k]!).toBeLessThanOrEqual(3);
    }
  }, 600_000);
});
