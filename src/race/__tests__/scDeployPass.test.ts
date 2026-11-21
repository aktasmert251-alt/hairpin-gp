// noteScPass: a pass completed within SC_DEPLOY_PASS_MS of the SC deployment by a car that was already alongside at the
// deployment is not penalised; a pass by a car that was behind, or a later pass, still is.
import { describe, expect, it } from 'vitest';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { crx } from '../extra';
import { SC_DEPLOY_OVERLAP_M, SC_DEPLOY_PASS_MS } from '../rules';
import { noteScPass } from '../safetyCar';

function setup(gapAtDeployM: number, msSinceDeploy: number) {
  const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 1, seed: 5, laps: 5 }), { skipLights: true });
  const st = sim.world.state;
  for (const c of st.cars) {
    c.vehicle.speed = 40;
    c.vehicle.hint.ribbon = 'main';
    c.pit.phase = 'none';
  }
  st.race.sc.phase = 'deployed';
  st.race.sc.sinceMs = 10_000;
  st.race.raceMs = 10_000 + msSinceDeploy;
  crx(st.cars[0]!.race).scDeployProg = 1000 - gapAtDeployM;
  crx(st.cars[1]!.race).scDeployProg = 1000;
  return sim.world;
}

describe('SC deployment overlap pass', () => {
  it('alongside at deployment, pass done within 2 s: no penalty', () => {
    const w = setup(SC_DEPLOY_OVERLAP_M * 0.5, SC_DEPLOY_PASS_MS - 100);
    const before = w.state.cars[0]!.race.penaltySec;
    noteScPass(w, 0, 1);
    expect(w.state.cars[0]!.race.penaltySec).toBe(before);
  });

  it('behind at deployment, or the pass comes later: +5 s', () => {
    const a = setup(SC_DEPLOY_OVERLAP_M * 3, 500);
    const a0 = a.state.cars[0]!.race.penaltySec;
    noteScPass(a, 0, 1);
    const b = setup(SC_DEPLOY_OVERLAP_M * 0.5, SC_DEPLOY_PASS_MS + 500);
    const b0 = b.state.cars[0]!.race.penaltySec;
    noteScPass(b, 0, 1);
    expect(a.state.cars[0]!.race.penaltySec - a0 + (b.state.cars[0]!.race.penaltySec - b0)).toBe(10);
  });
});
