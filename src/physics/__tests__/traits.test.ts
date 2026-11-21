// D-036 team car character: each team's traits (on top of perf) must show up where the car is fast. One perfect
// (d = 100) AI car per team laps İstanbul alone (Medium, 10 kg fuel, wearScale 1); the table prints sector times,
// trap speed (back straight), T8 minimum speed and tyre wear per lap. Neutral traits must equal the default params.

import { describe, expect, it } from 'vitest';
import type { TeamDef } from '../../contracts/data';
import { TEAMS } from '../../data/teams';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { MODULE_STATUS as TRACK_STATUS, loadTrack } from '../../track/index';
import { defaultVehicleParams } from '../params';

const HZ = 240;
const istanbulReady = TRACK_STATUS !== 'stub' && loadTrack().data.id === 'istanbul';

interface TeamRun { best: number; sectors: number[]; trap: number; t8Min: number; t8G: number; wearPerLap: number }

function runTeam(team: TeamDef | null): TeamRun {
  const sim = createSim(defaultSessionConfig({ mode: 'timeTrial', aiCount: 0, autodrive: true, startCompound: 'medium', seed: 7, wearScale: 1 }), { skipLights: true });
  const w = sim.world;
  // Time Trial builds neutral params; swap in the team car and make the AI rebuild its profile from them.
  Object.assign(w.static.params[0]!, team ? defaultVehicleParams(team.perf, team.traits) : defaultVehicleParams(0));
  w.static.ai.onWetnessChanged(0.5);
  const v = w.state.cars[0]!.vehicle;
  const r: TeamRun = { best: Infinity, sectors: [0, 0, 0], trap: 0, t8Min: Infinity, t8G: 0, wearPerLap: 0 };
  const sec = [0, 0, 0];
  let laps = 0;
  let wear1 = 0;
  for (let i = 0; i < 400 * HZ && laps < 3; i++) {
    sim.step();
    w.events.drain((e) => {
      if (e.type === 'sector' && e.car === 0) sec[e.sector] = e.ms / 1000;
      if (e.type === 'lap' && e.car === 0) {
        laps++;
        if (laps === 1) wear1 = v.tyres.reduce((a, t) => a + t.wear, 0) / 4;
        if (laps >= 2 && e.ms / 1000 < r.best) {
          r.best = e.ms / 1000;
          r.sectors = [sec[0]!, sec[1]!, e.ms / 1000 - sec[0]! - sec[1]!];
        }
      }
    });
    if (laps >= 1) {
      if (v.s > 4300 && v.s < 4560) r.trap = Math.max(r.trap, v.speed * 3.6);
      if (v.s > 2192 && v.s < 2750) {
        r.t8Min = Math.min(r.t8Min, v.speed * 3.6);
        r.t8G = Math.max(r.t8G, Math.abs(v.ayLat) / 9.81);
      }
    }
  }
  r.wearPerLap = (v.tyres.reduce((a, t) => a + t.wear, 0) / 4 - wear1) / 2;
  return r;
}

describe('team traits (D-036)', () => {
  it('neutral traits leave the default parameters unchanged', () => {
    const zero = { power: 0, lowDrag: 0, downforce: 0, mechGrip: 0, tyreCare: 0, ers: 0 };
    expect(defaultVehicleParams(0.01, zero)).toEqual(defaultVehicleParams(0.01));
  });

  it.skipIf(!istanbulReady)('every team is fast where its traits say (d = 100, alone)', () => {
    const rows: string[] = ['team      perf   best    S1     S2     S3    trap   T8min  T8g   wear/lap'];
    const res = new Map<string, TeamRun>();
    for (const t of [null, ...TEAMS]) {
      const r = runTeam(t);
      const id = t ? t.id : 'neutral';
      res.set(id, r);
      rows.push(`${id.padEnd(9)} ${(t ? t.perf : 0).toFixed(3).padStart(6)} ${r.best.toFixed(2)}  ${r.sectors.map((x) => x.toFixed(2)).join('  ')}  ${r.trap.toFixed(1)}  ${r.t8Min.toFixed(1)}  ${r.t8G.toFixed(2)}  ${(r.wearPerLap * 1000).toFixed(2)}e-3`);
    }
    console.log(rows.join('\n'));
    const teams = TEAMS.map((t) => ({ id: t.id, r: res.get(t.id)! }));
    const byTrap = [...teams].sort((a, b) => b.r.trap - a.r.trap).map((x) => x.id);
    const byT8 = [...teams].sort((a, b) => b.r.t8G - a.r.t8G).map((x) => x.id);
    const byWear = [...teams].sort((a, b) => a.r.wearPerLap - b.r.wearPerLap).map((x) => x.id);
    const bests = teams.map((x) => x.r.best);
    const spread = Math.max(...bests) - Math.min(...bests);
    console.log(`trap order ${byTrap.join(' ')}\nT8 peak-g order ${byT8.join(' ')}\nwear order ${byWear.join(' ')}\nbest-lap spread ${spread.toFixed(2)} s`);
    expect(byTrap.slice(0, 2).sort()).toEqual(['meridian', 'vortex']);
    expect(byT8[0]).toBe('aurora');
    expect(byWear[0]).toBe('ironclad');
    expect(spread).toBeGreaterThanOrEqual(0.8);
    expect(spread).toBeLessThanOrEqual(1.8);
  }, 600_000);
});
