// ResultsModel builder (YÖN, CR-12): rules §9 classification (final, or projected for cars still running) with
// 2025 points. A row whose status is still 'running' is a projection (the UI marks it provisional).

import type { TeamDef } from '../contracts/data';
import type { SimRunner } from '../contracts/sim';
import type { ResultsModel } from '../contracts/ui';
import { classify } from '../race/classification';

export function buildResults(sim: SimRunner, teams: readonly TeamDef[]): ResultsModel {
  const st = sim.world.state;
  const cars = st.cars;
  const nameOf = (driverId: string): string => {
    for (const t of teams) for (const d of t.drivers) if (d.id === driverId) return d.name;
    return driverId;
  };
  const rows = classify(sim.world).map((c) => {
    const car = cars[c.car]!;
    const r = car.race;
    return {
      pos: c.pos,
      car: car.id,
      name: nameOf(car.driverId),
      teamId: car.teamId,
      totalMs: c.totalMs,
      gapMs: c.gapMs,
      lapsDown: c.lapsDown,
      bestLapMs: r.bestLapMs,
      stops: r.pitStops,
      penaltySec: r.penaltySec,
      points: c.points,
      status: r.status,
    };
  });
  return { rows, fastestCar: st.race.fastest.car };
}
