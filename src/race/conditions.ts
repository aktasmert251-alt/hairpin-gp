// ConditionsSystem v2 (pit-weather §4, YÖN), ticked at 10 Hz: timeline rain, wetness build-up and drying, racing-line
// drying from traffic, temperatures, weather messages (`weather` events) and the AI wetness hook.
// Private state lives in `cx` on the ConditionsState (plain data: snapshots, flashback and hashing include it).

import type { TimeOfDay, WeatherPreset } from '../contracts/common';
import type { ConditionsFrame, ConditionsState, ForecastEntry } from '../contracts/conditions';
import type { SessionConfig } from '../contracts/race';
import type { SimEvent, SimSystem, SimWorld } from '../contracts/sim';
import { rngOut, rngStep } from '../core/rng';
import { forecast } from './forecast';
import { BASE_CLOUD, cloudAt, generateWeatherTimeline, rainAt } from './weather';

const DT = 0.1;
/** §4.5 base air / track °C per time of day (each + U(−2, 2) from the seed). */
const TEMPS: Readonly<Record<TimeOfDay, { airC: number; trackC: number }>> = {
  day: { airC: 24, trackC: 38 },
  sunset: { airC: 21, trackC: 29 },
  night: { airC: 18, trackC: 22 },
};
/** passRate of a 20-car field (§4.4). */
const PASS_REF = 0.224;
const MSG_GAP_S = 60;
type Msg = Exclude<Extract<SimEvent, { type: 'weather' }>['msg'], 'none'>;
const MSGS: readonly Msg[] = ['rainSoon', 'rainStarted', 'drying', 'intersNow', 'wetsNow', 'slicksNow'];

export interface ConditionsExtra {
  seed: number;
  durationS: number;
  baseAir: number;
  baseTrack: number;
  /** Hysteresis latches (0/1). */
  rainOn: number;
  interOn: number;
  wetsOn: number;
  /** Lw has been ≥ 0.15 since the last slicksNow. */
  slickArmed: number;
  /** Seconds with rain < 0.05, and whether this dry spell already said drying / rainSoon. */
  dryT: number;
  dryingSaid: number;
  rainSoonSaid: number;
  prevW: number;
  /** Last sim time each message was sent (MSGS order). */
  lastMsgT: number[];
}

export type ConditionsStateX = ConditionsState & { cx: ConditionsExtra };

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** §4.4 equilibrium wetness for a rain intensity. */
export function wetnessForRain(rain: number): number {
  return Math.min(1, 1.1 * rain);
}

function initialWetness(preset: WeatherPreset, rain0: number): number {
  return preset === 'dry' ? 0 : preset === 'light' ? 0.35 : preset === 'heavy' ? 0.85 : wetnessForRain(rain0);
}

export function cxOf(c: ConditionsState): ConditionsExtra {
  const x = c as ConditionsStateX;
  return x.cx ?? (x.cx = newExtra(1, 3600, c.tod, c.rain, c.lineWetness));
}

function newExtra(seed: number, durationS: number, tod: TimeOfDay, rain: number, lw: number): ConditionsExtra {
  const s1 = rngStep((seed ^ 0x7e3d) | 0);
  const s2 = rngStep(s1);
  return {
    seed, durationS,
    baseAir: TEMPS[tod].airC + (rngOut(s1) * 4 - 2),
    baseTrack: TEMPS[tod].trackC + (rngOut(s2) * 4 - 2),
    rainOn: rain >= 0.1 ? 1 : 0, interOn: lw >= 0.12 ? 1 : 0, wetsOn: lw >= 0.62 ? 1 : 0, slickArmed: lw >= 0.15 ? 1 : 0,
    dryT: 0, dryingSaid: 0, rainSoonSaid: 0, prevW: 0, lastMsgT: MSGS.map(() => -1e9),
  };
}

/** `durationS`: race laps × 95 s × 1.3, Time Trial 3,600 s (§4.2). */
export function initConditions(cfg: Pick<SessionConfig, 'tod' | 'weather' | 'seed'>, durationS = 3600): ConditionsState {
  const timeline = generateWeatherTimeline(cfg.weather, cfg.seed, durationS);
  const rain = rainAt(timeline, 0);
  const w = initialWetness(cfg.weather, rain);
  const cx = newExtra(cfg.seed, durationS, cfg.tod, rain, w);
  cx.prevW = w;
  const airC = cx.baseAir - 3 * rain;
  const c: ConditionsStateX = {
    tod: cfg.tod, preset: cfg.weather, rain, wetness: w, lineWetness: w,
    airC, trackC: rain >= 0.1 ? airC - 2 : cx.baseTrack, timeline, nextTickT: 0, cx,
  };
  return c;
}

/** §4.4 evaporation factor. */
export function evaporation(cloud: number, trackC: number): number {
  return (0.6 + 0.4 * (1 - cloud)) * clamp(1 + (trackC - 20) / 40, 0.5, 1.75);
}

/** One 0.1 s wetness step (§4.4); exported for the checkpoint tests. */
export function stepWetness(c: ConditionsState, cloud: number, passRate: number, dt: number): void {
  const rain = c.rain;
  const evap = evaporation(cloud, c.trackC);
  const target = wetnessForRain(rain);
  let w = c.wetness;
  if (rain >= 0.02 && w < target) w += ((target - w) / (60 + 120 * (1 - rain))) * dt;
  else w = Math.max(0, w - (evap / 600) * dt);
  c.wetness = w;
  if (rain >= 0.05) c.lineWetness = clamp(w - (0.05 * passRate) / PASS_REF, 0, w);
  else c.lineWetness = clamp(c.lineWetness - (evap / 600 + 0.015 * passRate) * dt, 0, w);
}

const forecastScratch: ForecastEntry[] = [{ inMin: 0, rain: 0, probability: 0 }, { inMin: 0, rain: 0, probability: 0 }];

function say(world: SimWorld, x: ConditionsExtra, msg: Msg): void {
  const i = MSGS.indexOf(msg);
  const t = world.state.time;
  if (t - x.lastMsgT[i]! < MSG_GAP_S) return;
  x.lastMsgT[i] = t;
  world.events.push({ type: 'weather', rain: world.state.conditions.rain, msg });
}

function messages(world: SimWorld, c: ConditionsState, x: ConditionsExtra): void {
  const rain = c.rain;
  const lw = c.lineWetness;
  // rainStarted: rain crosses 0.10 upward (±0.02 hysteresis).
  if (x.rainOn === 0 && rain >= 0.1) {
    x.rainOn = 1;
    say(world, x, 'rainStarted');
  } else if (x.rainOn === 1 && rain < 0.08) x.rainOn = 0;
  // Dry spell bookkeeping: drying after 60 s dry with W > 0.15 and falling; rainSoon once per spell.
  if (rain < 0.05) x.dryT += DT;
  else {
    x.dryT = 0;
    if (rain >= 0.1) x.dryingSaid = 0;
  }
  // rainSoon: once per spell; 2 = the spell came, re-armed after 120 s dry.
  if (rain >= 0.05 && x.rainSoonSaid === 1) x.rainSoonSaid = 2;
  if (x.rainSoonSaid === 2 && x.dryT >= 120) x.rainSoonSaid = 0;
  if (x.dryingSaid === 0 && x.dryT >= 60 && c.wetness > 0.15 && c.wetness < x.prevW) {
    x.dryingSaid = 1;
    say(world, x, 'drying');
  }
  if (x.rainSoonSaid === 0 && rain < 0.05) {
    const n = forecast(c, x.seed, world.state.time, forecastScratch);
    for (let i = 0; i < n; i++) {
      const f = forecastScratch[i]!;
      if (f.inMin <= 5 && f.rain >= 0.2 && f.probability >= 0.6) {
        x.rainSoonSaid = 1;
        say(world, x, 'rainSoon');
      }
    }
  }
  // Line-wetness crossovers.
  if (x.interOn === 0 && lw >= 0.12) {
    x.interOn = 1;
    say(world, x, 'intersNow');
  } else if (x.interOn === 1 && lw < 0.1) x.interOn = 0;
  if (x.wetsOn === 0 && lw >= 0.62) {
    x.wetsOn = 1;
    say(world, x, 'wetsNow');
  } else if (x.wetsOn === 1 && lw < 0.6) x.wetsOn = 0;
  if (lw >= 0.15) x.slickArmed = 1;
  if (x.slickArmed === 1 && lw < 0.1) {
    x.slickArmed = 0;
    say(world, x, 'slicksNow');
  }
}

export function createConditionsSystem(): SimSystem {
  return {
    name: 'conditions',
    step(world) {
      const st = world.state;
      const c = st.conditions;
      if (st.time < c.nextTickT) return;
      c.nextTickT += DT;
      const x = cxOf(c);
      const t = st.time;
      c.rain = rainAt(c.timeline, t);
      const cloud = cloudAt(c.timeline, c.preset, t);
      // Temperatures (§4.5).
      c.airC += (x.baseAir - 3 * c.rain - c.airC) * (DT / 300);
      c.trackC += c.rain >= 0.1 ? (c.airC - 2 - c.trackC) * (DT / 300) : (x.baseTrack - c.trackC) * (DT / 600);
      // Traffic on the racing line.
      let speedSum = 0;
      for (let i = 0; i < st.cars.length; i++) {
        const car = st.cars[i]!;
        if (car.race.status === 'running' && car.vehicle.hint.ribbon === 'main') speedSum += car.vehicle.speed;
      }
      const passRate = speedSum / world.static.track.query.length;
      x.prevW = c.wetness;
      stepWetness(c, cloud, passRate, DT);
      messages(world, c, x);
      world.static.ai.onWetnessChanged(c.wetness);
    },
  };
}

/**
 * Debug override (`__APEX__.setConditions`, scene GUIs; glue writer between ticks). `weather` regenerates the
 * preset timeline, `rain` pins a constant timeline, `wetness` sets the surface (and line) directly.
 */
export function applyConditionsOverride(
  c: ConditionsState,
  o: Partial<{ tod: TimeOfDay; weather: ConditionsState['preset']; rain: number; wetness: number }>,
): void {
  const x = cxOf(c);
  if (o.tod) {
    const fresh = newExtra(x.seed, x.durationS, o.tod, c.rain, c.lineWetness);
    c.tod = o.tod;
    x.baseAir = fresh.baseAir;
    x.baseTrack = fresh.baseTrack;
    c.airC = x.baseAir - 3 * c.rain;
    c.trackC = c.rain >= 0.1 ? c.airC - 2 : x.baseTrack;
  }
  if (o.weather) {
    c.preset = o.weather;
    c.timeline = generateWeatherTimeline(o.weather, x.seed, x.durationS);
    if (o.rain === undefined) c.rain = rainAt(c.timeline, 0);
    if (o.wetness === undefined) c.wetness = c.lineWetness = initialWetness(o.weather, c.rain);
  }
  if (o.rain !== undefined) {
    c.rain = clamp(o.rain, 0, 1);
    c.timeline = [{ t: 0, rain: c.rain }];
    if (o.wetness === undefined) c.wetness = c.lineWetness = wetnessForRain(c.rain);
  }
  if (o.wetness !== undefined) c.wetness = c.lineWetness = clamp(o.wetness, 0, 1);
  // No banner storm after a jump: latch the crossovers to the new state.
  x.rainOn = c.rain >= 0.1 ? 1 : 0;
  x.interOn = c.lineWetness >= 0.12 ? 1 : 0;
  x.wetsOn = c.lineWetness >= 0.62 ? 1 : 0;
  x.slickArmed = c.lineWetness >= 0.15 ? 1 : 0;
}

/** Presentation view of the conditions (allocation-free when `out` is reused); `time` = sim time. */
export function conditionsFrame(c: ConditionsState, time: number, out: ConditionsFrame): ConditionsFrame {
  out.tod = c.tod;
  out.rain = c.rain;
  out.wetness = c.wetness;
  out.lineWetness = c.lineWetness;
  out.cloud = c.timeline.length > 0 ? cloudAt(c.timeline, c.preset, time) : BASE_CLOUD[c.preset];
  out.time = time;
  return out;
}
