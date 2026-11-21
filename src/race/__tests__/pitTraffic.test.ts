import { describe, expect, it } from 'vitest';
import type { RaceTrackId } from '../../contracts/track';
import type { SimCarState, SimWorld } from '../../contracts/sim';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { teleportCar } from '../../game/sim/teleport';

const HZ = 240;

/** Signed clearance of the complete car body from either edge of the final exit road. */
function exitClearance(w: SimWorld, car: SimCarState): number {
  const pit = w.static.track.data.pit;
  const v = car.vehicle;
  if (car.pit.phase !== 'exit' || v.hint.ribbon !== 'pit' || v.hint.sp <= pit.length - 150) return Infinity;
  const i = Math.min(pit.count - 1, Math.round(v.hint.sp * (pit.count - 1) / pit.length));
  const p = w.static.params[car.id]!;
  const extent = 0.5 * p.bodyLength * Math.abs(Math.cos(v.yaw) * pit.tz[i]! + Math.sin(v.yaw) * pit.tx[i]!) +
    0.5 * p.bodyWidth * Math.abs(-Math.sin(v.yaw) * pit.tz[i]! + Math.cos(v.yaw) * pit.tx[i]!);
  return pit.halfWidth[i]! - Math.abs(v.d) - extent;
}

describe('simultaneous pit stops with physical traffic', () => {
  for (const trackId of ['istanbul', 'lombardia', 'bosphorus', 'ardennes'] as RaceTrackId[]) {
    it(`${trackId}: player assist retains control through release and returns it after the exit`, () => {
      const sim = createSim(defaultSessionConfig({ trackId, aiCount: 0, seed: 3, laps: 3, safetyCar: false }), { skipLights: true });
      const w = sim.world;
      const car = w.state.cars[0]!;
      const pit = w.static.track.data.pit;
      teleportCar(w, 0, pit.mainSAtSplit - 320, 0, 80);
      car.controls.boxRequest = true;
      let serviced = false;
      let releases = 0;
      let resets = 0;
      let minExitClearance = Infinity;
      let exitSample = '';
      for (let tick = 0; tick < 100 * HZ && car.race.pitStops === 0; tick++) {
        sim.step();
        w.events.drain((e) => {
          if (e.type === 'carReset') resets++;
          if (e.type === 'pit' && e.phase === 'stationary') serviced = true;
          if (e.type === 'pit' && e.phase === 'boxOut') releases++;
        });
        if (serviced && car.pit.phase !== 'none') expect(car.control).toBe('pitAuto');
        const v = car.vehicle;
        const clearance = exitClearance(w, car);
        if (clearance < minExitClearance) {
          minExitClearance = clearance;
          exitSample = `sp${v.hint.sp.toFixed(1)} d${v.d.toFixed(2)} speed${v.speed.toFixed(1)}`;
        }
      }
      expect(serviced).toBe(true);
      expect(releases).toBe(1);
      expect(car.race.pitStops).toBe(1);
      expect(car.control).toBe('player');
      expect(resets).toBe(0);
      console.log(JSON.stringify({ playerExit: trackId, minExitClearance, exitSample }));
      expect(minExitClearance).toBeGreaterThanOrEqual(0);
    }, 120_000);

    it(`${trackId}: twenty cars complete a same-lap stop without lane contacts or deadlock`, () => {
      const sim = createSim(defaultSessionConfig({ trackId, aiCount: 19, seed: 5, laps: 4,
        difficulty: 70, autodrive: true, safetyCar: false }), { skipLights: true });
      const w = sim.world;
      const cars = w.state.cars;
      cars.forEach((c) => { c.ai.plannedStopLaps = [1]; });
      const entered = cars.map(() => -1);
      const laneTime = cars.map(() => 0);
      const stopped = cars.map(() => 0);
      const beforePhase = cars.map((c) => c.pit.phase);
      const stuck = new Set<number>();
      const queueWaits = new Set<number>();
      const rawWaits = new Set<number>();
      const exitLineCars = new Set<number>();
      let minExitClearance = Infinity;
      const stoppedSamples: string[] = [];
      let contacts = 0;
      let resets = 0;
      let walls = 0;
      let contactTicks = 0;
      let unsafeReleases = 0;
      let playerApproach = false;
      let playerExited = false;
      const contactSamples: string[] = [];
      for (let tick = 0; tick < 240 * HZ && !cars.every((c) => c.race.pitStops > 0); tick++) {
        const player = cars[0]!;
        const toSplit = w.static.track.query.deltaS(player.vehicle.s, w.static.track.data.pit.mainSAtSplit);
        // Autodrive brings the player to the approach; a real player request and pit assist own the complete visit.
        if (!playerApproach && player.pit.phase === 'requested' && toSplit > 300 && toSplit < 310) {
          player.control = 'player';
          player.controls.boxRequest = true;
          playerApproach = true;
        }
        for (const c of cars) beforePhase[c.id] = c.pit.phase;
        sim.step();
        if (playerApproach && !playerExited && player.race.pitStops > 0) {
          expect(player.control).toBe('player');
          playerExited = true;
          player.controls.boxRequest = false;
          player.control = 'ai'; // Continue the race so a parked test driver cannot obstruct later exits.
        }
        w.events.drain((e) => {
          if (e.type === 'pit' && e.phase === 'boxOut') {
            const car = cars[e.car]!;
            const box = w.static.track.data.pit.boxes.find((b) => b.teamId === car.teamId)!.sp;
            if (cars.some((o) => o !== car && o.vehicle.hint.ribbon === 'pit' &&
              Math.abs(o.vehicle.d - w.static.track.data.pit.fastLaneD) < 2.6 &&
              o.vehicle.hint.sp >= box - Math.max(25, 2 * o.vehicle.speed) && o.vehicle.hint.sp <= box + 8)) unsafeReleases++;
          }
          if (e.type === 'collision' && cars[e.a]!.vehicle.hint.ribbon === 'pit') {
            if (e.b >= 0) {
              contacts++;
              if (contactSamples.length < 8) contactSamples.push([e.a, e.b].map((id) => {
                const c = cars[id]!;
                return `${id}:${c.pit.phase}:sp${c.vehicle.hint.sp.toFixed(1)}:d${c.vehicle.d.toFixed(1)}:v${c.vehicle.speed.toFixed(1)}:box${c.pit.boxSp}`;
              }).join(' / '));
            }
            else walls++;
          }
          if (e.type === 'carReset' && beforePhase[e.car] !== 'none') resets++;
        });
        for (const c of cars) {
          if (c.vehicle.hint.ribbon !== 'pit') continue;
          if (c.vehicle.carImpulse > 0) contactTicks++;
          const clearance = exitClearance(w, c);
          minExitClearance = Math.min(minExitClearance, clearance);
          if (clearance < 0) exitLineCars.add(c.id);
          if (entered[c.id]! < 0) entered[c.id] = w.state.time;
          laneTime[c.id] = w.state.time - entered[c.id]!;
          const inBox = Math.abs(c.vehicle.hint.sp - c.pit.boxSp) < 3 &&
            (c.pit.phase === 'stationary' || c.pit.phase === 'release');
          stopped[c.id] = !inBox && c.vehicle.speed < 1 ? stopped[c.id]! + 1 / HZ : 0;
          if (stopped[c.id]! > 3) {
            // A double-stacked teammate deliberately waits behind its occupied garage. Report that raw wait as
            // well, but distinguish it from a stranded departure; every queued car must still complete its stop.
            const queued = c.pit.phase === 'boxIn' && cars.some((o) => o !== c && o.teamId === c.teamId &&
              (o.pit.phase === 'stationary' || o.pit.phase === 'release' || o.pit.phase === 'boxOut'));
            if (queued) queueWaits.add(c.id);
            else stuck.add(c.id);
            if (!rawWaits.has(c.id)) stoppedSamples.push(`${c.id}:${c.pit.phase}:sp${c.vehicle.hint.sp.toFixed(1)}:d${c.vehicle.d.toFixed(1)}:target${c.pit.boxSp}`);
            rawWaits.add(c.id);
          }
        }
      }
      const complete = cars.filter((c) => c.race.pitStops > 0).length;
      console.log(JSON.stringify({ trackId, complete, contacts, contactTicks, unsafeReleases, walls, resets, stuck: [...stuck], queueWaits: [...queueWaits],
        exitLineCars: [...exitLineCars], minExitClearance,
        contactSamples,
        stoppedSamples,
        maxLaneS: Math.max(...laneTime).toFixed(2),
        pending: cars.filter((c) => !c.race.pitStops).map((c) =>
          `${c.id}:${c.pit.phase}:${c.vehicle.hint.sp.toFixed(1)}:${c.vehicle.d.toFixed(1)}:${c.vehicle.speed.toFixed(1)}:box${c.pit.boxSp}`) }));
      expect(complete).toBe(20);
      expect(playerExited).toBe(true);
      expect(contacts).toBe(0);
      expect(contactTicks).toBe(0);
      expect(unsafeReleases).toBe(0);
      expect(exitLineCars.size).toBe(0);
      expect(stuck.size).toBe(0);
      expect(resets).toBe(0);
    }, 600_000);
  }
});
