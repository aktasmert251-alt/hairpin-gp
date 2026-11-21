import { expect, it } from 'vitest';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { teleportCar } from '../../game/sim/teleport';
import { newContext } from '../context';
import { buildPitGeometry, pitDrive, type PitDriveOut } from '../pit/pitDriver';

it('pit-exit queue yields to approaching track traffic and moves once it has passed', () => {
  const sim = createSim(defaultSessionConfig({ trackId: 'ardennes', aiCount: 1, safetyCar: false }), { skipLights: true });
  const w = sim.world;
  const q = w.static.track.query;
  const pit = q.data.pit;
  const car = w.state.cars[0]!;
  const other = w.state.cars[1]!;
  const ctx = newContext();
  ctx.track = q;
  ctx.pit = buildPitGeometry(q, ctx.frame);
  car.pit.phase = 'exit';
  car.vehicle.hint.ribbon = 'pit';
  car.vehicle.hint.sp = pit.length - 12;
  car.vehicle.speed = 0;
  const out: PitDriveOut = { active: false, tx: 0, tz: 0, vT: 0, limiter: false, hold: false, mainD: 0, blend: 0 };
  teleportCar(w, 1, pit.mainSAtMerge - 40, 0, 108);
  pitDrive(ctx, w.state.cars, car, 8, out);
  expect(out.hold).toBe(true);
  expect(out.vT).toBe(0);
  teleportCar(w, 1, pit.mainSAtMerge + 40, 0, 108);
  pitDrive(ctx, w.state.cars, car, 8, out);
  expect(out.hold).toBe(false);
  expect(out.vT).toBeGreaterThan(0);
});

it('Ardennes main-track traffic stays outside the final pit-exit ribbon', () => {
  const sim = createSim(defaultSessionConfig({ trackId: 'ardennes', aiCount: 19, autodrive: true,
    safetyCar: false, seed: 5, laps: 3 }), { skipLights: true });
  const w = sim.world;
  const q = w.static.track.query;
  const pit = q.data.pit;
  w.state.cars.forEach((c, i) => {
    // Paired traffic holds the right-hand column toward the pit side through the end of the blend line.
    const d = i % 2 === 0 ? -4.7 : -1.5;
    teleportCar(w, c.id, pit.mainSAtMerge - 100 - Math.floor(i / 2) * 20 + (i % 2), d, 100);
    const line = w.static.ai.getRacingLine();
    const index = Math.floor(c.vehicle.s / line.ds) % line.count;
    c.ai.laneOffset = d - line.d[index]!;
    c.ai.laneTarget = c.ai.laneOffset;
    c.ai.mode = 'race';
    c.ai.plannedStopLaps = [];
  });
  const ds = pit.length / (pit.count - 1);
  let crossings = 0;
  let passes = 0;
  const crossed = new Set<number>();
  for (let tick = 0; tick < 20 * 240; tick++) {
    sim.step();
    w.events.drain(() => {});
    for (const car of w.state.cars) {
      const v = car.vehicle;
      if (q.deltaS(pit.mainSAtMerge, v.s) > 0) crossed.add(car.id);
      // Test against the actual final ribbon geometry, rather than the controller's target or main-ribbon hint:
      // ground queries deliberately refuse to switch main-track cars onto the exit ribbon.
      for (let i = Math.max(0, pit.count - 1 - Math.ceil(40 / ds)); i < pit.count - 1; i++) {
        const dx = v.x - pit.x[i]!;
        const dz = v.z - pit.z[i]!;
        const along = dx * pit.tx[i]! + dz * pit.tz[i]!;
        if (along < 0 || along >= ds) continue;
        const lateral = dx * pit.tz[i]! - dz * pit.tx[i]!;
        if (Math.abs(lateral) < pit.halfWidth[i]! + 0.8) crossings++;
      }
    }
  }
  passes = crossed.size;
  console.log(JSON.stringify({ exitTrack: 'ardennes', crossings, passes }));
  expect(passes).toBe(20);
  expect(crossings).toBe(0);
}, 120_000);
