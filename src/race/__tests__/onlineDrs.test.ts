// Regression (online DRS never available): a local car ≤ 1 s behind a REMOTE puppet at the DRS detection line must get DRS.
// The puppet's detection-line times were never recorded (the director's remote branch returned before the DRS code).
import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../contracts/sim';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { createRaceDirector } from '../director';

describe('online DRS behind a puppet', () => {
  // Online every other car is a 'remote' puppet: another human or a server-simulated AI car (D-043) - both count.
  it.each([['another human', true], ['a server AI car', false]] as const)('the local car within 1 s of %s at the detection line becomes DRS-eligible', (_who, human) => {
    const cfg = defaultSessionConfig({ mode: 'race', laps: 5, seed: 3, trackId: 'istanbul', aiCount: 1 });
    const sim = createSim(cfg, {
      skipLights: true,
      lineup: [
        { teamId: 'anka', driverIdx: 0, gridSlot: 1, control: 'player', human: true },
        { teamId: 'nova', driverIdx: 0, gridSlot: 0, control: 'remote', human },
      ],
    });
    const w = sim.world;
    const st = w.state;
    const L = w.static.track.query.length;
    const zone = w.static.track.data.drsZones[0]!;
    st.race.drsEnabled = true;
    const director = createRaceDirector();
    const v = 70; // m/s
    // Car 1 (remote) 35 m (0.5 s) ahead of car 0; both pass the detection line.
    const start = zone.detectS - 200;
    let eligible = false;
    for (let k = 0; k < 240 * 6; k++) {
      st.tick++;
      st.time = st.tick * SIM_DT;
      const d0 = start + v * st.time;
      for (const [car, s] of [[0, d0], [1, d0 + 35]] as const) {
        const ve = st.cars[car]!.vehicle;
        const p = ((s % L) + L) % L;
        ve.lapWraps = Math.floor(s / L) + 1; // already on lap 1 (progress > 0)
        ve.s = p;
        ve.speed = v;
        ve.hint.ribbon = 'main';
        ve.d = 0;
      }
      director.step(w, SIM_DT);
      w.events.drain((e) => {
        if (e.type === 'drsAvailable' && e.car === 0) eligible = true;
      });
    }
    expect(eligible).toBe(true);
  });
});
