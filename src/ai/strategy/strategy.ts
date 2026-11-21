// AI pit strategy (planner-report §6.8, pit-weather §3). Sim layer, allocation-free per call (the per-car plan arrays
// are created once in initStrategy).
//
// Output is what the PitProcedure reads: `car.ai.plannedStopLaps[0]` = the lap at whose end the car boxes
// (wantsBox: plan[0] === lapsCompleted + 1) and `car.ai.nextCompound`. The strategy's own memory is an extra
// plain-data field on AIState (`sx`, like the physics `aux`), created in initCar so snapshots / flashback carry it.
//
// - Dry, N ≥ 15: template (seeded) M→H 50 %, S→H 25 %, H→M 15 %, S→M→S 10 %; stop lap
//   min(0.85·life/wearScale, 0.45·N) ± 2 (two stops: N/3 and 2N/3 ± 1, capped by life). The start compound comes from
//   the session (createSim); a template whose next compound equals it takes the other dry compound instead.
// - Dry, 10 ≤ N < 15: one stop at round(0.5·N) ± 1 on the other dry compound. N < 10: no plan.
// - Every lap: worst wear ≥ 0.72 (≥ 0.85 for N < 10), or the wear trend reaching 0.85 before the planned lap → box
//   this lap; undercut (car ahead ≤ 1.5 s pitted last lap, own stop within 4 laps) with probability 0.4·aggression.
// - Weather on lineWetness, thresholds shifted ±0.04 per driver (wetSkill): slicks → Inters at ≥ 0.18 for 20 s (or
//   heavy rain ≥ 0.7 at ≥ 60 % within 5 min and ≥ 0.10; Wets if rain ≥ 0.7 and W ≥ 0.6); Inters → Wets at ≥ 0.68;
//   Wets → Inters at ≤ 0.55; Inters → slicks at ≤ 0.10 for 30 s with no rain ≥ 0.2 forecast (M if ≥ 12 laps left).

import type { Compound } from '../../contracts/common';
import type { ForecastEntry } from '../../contracts/conditions';
import type { AIState } from '../../contracts/ai';
import type { SimCarState, SimWorld } from '../../contracts/sim';
import { nextRandom } from '../../core/rng';
import { forecast } from '../../race/index';

/** Laps to wear 0.7 at wearScale 1 and d = 100 (S2-S4 calibration). */
const LIFE: Record<Compound, number> = { soft: 18, medium: 28, hard: 38, inter: 30, wet: 30 };

export interface StrategyX {
  /** Last lap count evaluated (−1 before the first). */
  lap: number;
  /** Seconds the line wetness has been above the slick → inter / below the inter → slick threshold. */
  wetT: number;
  dryT: number;
  /** Compound after each planned stop (parallel to plannedStopLaps). */
  comp: Compound[];
  /** Worst tyre wear at the previous lap end. */
  wearPrev: number;
  /** pitStops seen at the previous lap end, and the lap of this car's last stop (−1: none). */
  stops: number;
  lastStopLap: number;
  /** Driver threshold shift (±0.04). */
  shift: number;
}

type AIStateX = AIState & { sx?: StrategyX };

export function strategyOf(ai: AIState): StrategyX | undefined {
  return (ai as AIStateX).sx;
}

const fc: ForecastEntry[] = [
  { inMin: 0, rain: 0, probability: 0 }, { inMin: 0, rain: 0, probability: 0 },
  { inMin: 0, rain: 0, probability: 0 }, { inMin: 0, rain: 0, probability: 0 },
];

function rnd(ai: AIState): number {
  return nextRandom(ai as unknown as Record<'rng', number>, 'rng');
}

function otherDry(c: Compound): Compound {
  return c === 'hard' ? 'medium' : 'hard';
}

function isDry(c: Compound): boolean {
  return c === 'soft' || c === 'medium' || c === 'hard';
}

function setPlan(ai: AIState, x: StrategyX, lap: number, c: Compound): void {
  ai.plannedStopLaps.length = 0;
  x.comp.length = 0;
  ai.plannedStopLaps.push(lap);
  x.comp.push(c);
  ai.nextCompound = c;
}

/** Called from AIModule.initCar (setup time, may allocate). */
export function initStrategy(world: SimWorld, car: SimCarState, wetSkill: number): void {
  const ai = car.ai as AIStateX;
  const x: StrategyX = { lap: -1, wetT: 0, dryT: 0, comp: [], wearPrev: 0, stops: car.race.pitStops, lastStopLap: -1, shift: 0.04 * (1 - 2 * wetSkill) };
  ai.sx = x;
  ai.plannedStopLaps.length = 0;
  const cfg = world.static.config;
  const start = car.vehicle.compound;
  ai.nextCompound = start;
  if (cfg.mode !== 'race' || !isDry(start) || world.state.conditions.preset !== 'dry') return;
  const N = cfg.laps;
  const ws = cfg.wearScale > 0 ? cfg.wearScale : 1;
  if (N >= 15) {
    const r = rnd(ai);
    // Template tails after the start compound.
    const twoStop = r >= 0.9;
    const first: Compound = r < 0.5 ? 'hard' : r < 0.75 ? 'hard' : r < 0.9 ? 'medium' : 'medium';
    if (twoStop) {
      const cap = Math.max(2, Math.round((0.85 * LIFE[start]) / ws));
      const s1 = Math.min(cap, Math.round(N / 3 + (rnd(ai) * 2 - 1)));
      const s2 = Math.min(s1 + Math.max(2, Math.round((0.85 * LIFE.medium) / ws)), Math.round((2 * N) / 3 + (rnd(ai) * 2 - 1)));
      ai.plannedStopLaps.push(Math.max(2, s1), Math.max(s1 + 2, Math.min(N - 2, s2)));
      x.comp.push('medium', start === 'soft' ? 'soft' : 'soft');
    } else {
      const lap = Math.round(Math.min((0.85 * LIFE[start]) / ws, 0.45 * N) + (rnd(ai) * 4 - 2));
      ai.plannedStopLaps.push(Math.max(2, Math.min(N - 2, lap)));
      x.comp.push(first === start ? otherDry(start) : first);
    }
  } else if (N >= 10) {
    const lap = Math.round(0.5 * N + (rnd(ai) * 2 - 1));
    ai.plannedStopLaps.push(lap);
    x.comp.push(otherDry(start));
  }
  if (x.comp.length > 0) ai.nextCompound = x.comp[0]!;
}

function weatherCall(world: SimWorld, car: SimCarState, x: StrategyX, lapsLeft: number): Compound | null {
  const c = world.state.conditions;
  const lw = c.lineWetness;
  const comp = car.vehicle.compound;
  const sh = x.shift;
  if (isDry(comp)) {
    let heavySoon = false;
    if (lw >= 0.1 + sh) {
      const n = forecast(c, world.static.config.seed, world.state.race.raceMs / 1000, fc);
      for (let i = 0; i < n; i++) if (fc[i]!.inMin <= 5 && fc[i]!.rain >= 0.7 && fc[i]!.probability >= 0.6) heavySoon = true;
    }
    if (x.wetT >= 20 || heavySoon) return c.rain >= 0.7 && c.wetness >= 0.6 ? 'wet' : 'inter';
    return null;
  }
  if (comp === 'inter') {
    if (lw >= 0.68 + sh) return 'wet';
    if (x.dryT >= 30) {
      const n = forecast(c, world.static.config.seed, world.state.race.raceMs / 1000, fc);
      for (let i = 0; i < n; i++) if (fc[i]!.rain >= 0.2) return null;
      return lapsLeft >= 12 ? 'medium' : 'soft';
    }
    return null;
  }
  return lw <= 0.55 + sh ? 'inter' : null;
}

/** Per AI tick (dt s) for a car in a race; cheap except on lap change. */
export function stepStrategy(world: SimWorld, car: SimCarState, aggression: number, dt: number): void {
  const x = strategyOf(car.ai);
  const cfg = world.static.config;
  if (!x || cfg.mode !== 'race' || car.race.finished) return;
  const ai = car.ai;
  const c = world.state.conditions;
  const sh = x.shift;
  const lw = c.lineWetness;
  x.wetT = lw >= 0.18 + sh ? x.wetT + dt : 0;
  x.dryT = lw <= 0.1 + sh ? x.dryT + dt : 0;
  const lap = car.race.lapsCompleted;
  const left = cfg.laps - lap;
  const free = car.pit.phase === 'none' || car.pit.phase === 'requested';

  // Weather: box at the end of this lap (not on the last lap).
  const call = left >= 2 && free ? weatherCall(world, car, x, left) : null;
  if (call !== null) {
    if (ai.plannedStopLaps[0] !== lap + 1 || ai.nextCompound !== call) setPlan(ai, x, lap + 1, call);
    return;
  }
  if (lap === x.lap) return;
  x.lap = lap;

  // Lap end: drop stops already made (or missed), remember our own stop.
  if (car.race.pitStops !== x.stops) {
    x.stops = car.race.pitStops;
    x.lastStopLap = lap;
  }
  while (ai.plannedStopLaps.length > 0 && ai.plannedStopLaps[0]! < lap + 1) {
    ai.plannedStopLaps.shift();
    x.comp.shift();
  }
  if (x.comp.length > 0) ai.nextCompound = x.comp[0]!;
  if (!free || left < 2) return;
  const t = car.vehicle.tyres;
  const worst = Math.max(t[0].wear, t[1].wear, t[2].wear, t[3].wear);
  const rate = worst - x.wearPrev;
  x.wearPrev = worst;
  const planLap = ai.plannedStopLaps.length > 0 ? ai.plannedStopLaps[0]! : cfg.laps;
  const fresh = (): Compound => {
    if (!isDry(car.vehicle.compound)) return ai.nextCompound;
    if (x.comp.length > 0) return x.comp[0]!;
    // Unplanned stop: hardest compound that lasts the remaining laps, never the current one if the rule is open.
    const ws = cfg.wearScale > 0 ? cfg.wearScale : 1;
    let pick: Compound = left * ws <= 0.85 * LIFE.soft ? 'soft' : left * ws <= 0.85 * LIFE.medium ? 'medium' : 'hard';
    const used = car.race.compoundsUsedMask;
    const dryUsed = (used & 1 ? 1 : 0) + (used & 2 ? 1 : 0) + (used & 4 ? 1 : 0);
    if (dryUsed < 2 && pick === car.vehicle.compound) pick = otherDry(pick);
    return pick;
  };
  const limit = cfg.laps < 10 ? 0.85 : 0.72;
  if (planLap !== lap + 1 && (worst >= limit || (rate > 0 && worst + rate * (planLap - lap - 1) >= 0.85))) {
    setPlan(ai, x, lap + 1, fresh());
    return;
  }
  // Undercut (§6.8): the car directly ahead, within 1.5 s, pitted on the lap just finished.
  if (planLap - lap <= 4 && planLap !== lap + 1) {
    const cars = world.state.cars;
    for (let i = 0; i < cars.length; i++) {
      const o = cars[i]!;
      if (o.race.position !== car.race.position - 1) continue;
      const ox = strategyOf(o.ai);
      if (ox && ox.lastStopLap === lap && car.race.intervalMs <= 1500 && rnd(ai) < 0.4 * aggression) {
        const nc = fresh();
        ai.plannedStopLaps[0] = lap + 1;
        if (x.comp.length > 0) x.comp[0] = nc;
        else x.comp.push(nc);
        ai.nextCompound = nc;
      }
      break;
    }
  }
}
