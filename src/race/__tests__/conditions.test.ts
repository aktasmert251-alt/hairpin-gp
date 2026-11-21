// ConditionsSystem v2 + forecast (pit-weather §4–§5): U-RC-03 timeline, U-RC-04 wetness checkpoints, I-06 forecast,
// weather messages.

import { describe, expect, it } from 'vitest';
import type { ConditionsState, ForecastEntry } from '../../contracts/conditions';
import type { SimEvent, SimWorld } from '../../contracts/sim';
import { createConditionsSystem, cxOf, evaporation, initConditions, stepWetness } from '../conditions';
import { forecast } from '../forecast';
import { generateWeatherTimeline, rainAt } from '../weather';

const RACE_S = 29 * 95 * 1.3;

/** Conditions-only world: the system needs time, cars, the track length and the AI hook. */
function condWorld(c: ConditionsState): { world: SimWorld; events: SimEvent[] } {
  const events: SimEvent[] = [];
  const world = {
    state: { time: 0, cars: [], conditions: c },
    static: { track: { query: { length: 5333 } }, ai: { onWetnessChanged() {} } },
    events: { push: (e: SimEvent) => events.push(e), drain() {} },
  } as unknown as SimWorld;
  return { world, events };
}

describe('weather timeline (U-RC-03)', () => {
  it('is deterministic, sorted and bounded for every preset', () => {
    for (const p of ['dry', 'light', 'heavy', 'variable'] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const a = generateWeatherTimeline(p, seed, RACE_S);
        expect(generateWeatherTimeline(p, seed, RACE_S)).toEqual(a);
        for (let i = 0; i < a.length; i++) {
          expect(a[i]!.rain).toBeGreaterThanOrEqual(0);
          expect(a[i]!.rain).toBeLessThanOrEqual(1);
          if (i > 0) expect(a[i]!.t, `${p} seed ${seed} key ${i}`).toBeGreaterThanOrEqual(a[i - 1]!.t);
        }
        if (p === 'light') expect(a.every((k) => k.rain >= 0.22 - 1e-9 && k.rain <= 0.38 + 1e-9)).toBe(true);
        if (p === 'heavy') expect(a.every((k) => k.rain >= 0.77 - 1e-9 && k.rain <= 0.93 + 1e-9)).toBe(true);
      }
    }
  });

  it('variable: seeds 1–20 each have a rain spell (≥ 0.4) starting before 60 % and a dry stretch', () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const dur of [3 * 95 * 1.3, 10 * 95 * 1.3, RACE_S]) {
        const tl = generateWeatherTimeline('variable', seed, dur);
        let wetEarly = false;
        let dry = false;
        for (let t = 0; t <= dur; t += 5) {
          const r = rainAt(tl, t);
          if (r >= 0.4 && t < 0.6 * dur + 120) wetEarly = true;
          if (r === 0) dry = true;
        }
        expect(wetEarly, `seed ${seed} dur ${dur}`).toBe(true);
        expect(dry, `seed ${seed} dur ${dur}`).toBe(true);
      }
    }
  });
});

describe('wetness (U-RC-04 checkpoints, ±5 %)', () => {
  it('rain 0.9 from W = 0: 0.626 at 72 s, 0.909 at 180 s', () => {
    const c = initConditions({ tod: 'day', weather: 'dry', seed: 1 });
    c.rain = 0.9;
    let w72 = 0;
    for (let i = 1; i <= 1800; i++) {
      stepWetness(c, 1, 0, 0.1);
      if (i === 720) w72 = c.wetness;
    }
    expect(w72).toBeGreaterThan(0.626 * 0.95);
    expect(w72).toBeLessThan(0.626 * 1.05);
    expect(c.wetness).toBeGreaterThan(0.909 * 0.95);
    expect(c.wetness).toBeLessThan(0.909 * 1.05);
  });

  it('drying from W = 0.5, cloud 0.3, track 30 °C: off-line ≈ 273 s, line with 20 cars ≈ 96 s', () => {
    expect(evaporation(0.3, 30)).toBeCloseTo(1.1, 6);
    const c = initConditions({ tod: 'day', weather: 'dry', seed: 1 });
    c.rain = 0;
    c.trackC = 30;
    c.wetness = c.lineWetness = 0.5;
    let lineDry = -1;
    let offDry = -1;
    for (let i = 1; i <= 4000 && offDry < 0; i++) {
      stepWetness(c, 0.3, 0.224, 0.1);
      if (lineDry < 0 && c.lineWetness <= 0) lineDry = i / 10;
      if (offDry < 0 && c.wetness <= 0) offDry = i / 10;
    }
    expect(lineDry).toBeGreaterThan(96 * 0.95);
    expect(lineDry).toBeLessThan(96 * 1.05);
    expect(offDry).toBeGreaterThan(273 * 0.95);
    expect(offDry).toBeLessThan(273 * 1.05);
  });
});

describe('forecast (I-06)', () => {
  const entries = (): ForecastEntry[] => Array.from({ length: 4 }, () => ({ inMin: 0, rain: 0, probability: 0 }));

  it('is pure and deterministic: same inputs → same numbers, rounded', () => {
    const c = initConditions({ tod: 'day', weather: 'variable', seed: 7 }, RACE_S);
    const a = entries(), b = entries();
    for (let t = 0; t < RACE_S; t += 37) {
      const n = forecast(c, 7, t, a);
      expect(forecast(structuredClone(c), 7, t, b)).toBe(n);
      expect(b.slice(0, n)).toEqual(a.slice(0, n));
      expect(n).toBeGreaterThanOrEqual(2);
      for (const e of a.slice(0, n)) {
        expect(Math.abs(e.rain * 20 - Math.round(e.rain * 20))).toBeLessThan(1e-9);
        expect(e.probability).toBeGreaterThanOrEqual(0.05);
        expect(e.probability).toBeLessThanOrEqual(0.95);
      }
    }
  });

  it('tracks the timeline: a heavy spell ahead shows high rain and probability', () => {
    const c = initConditions({ tod: 'day', weather: 'dry', seed: 3 }, 3600);
    c.timeline = [{ t: 0, rain: 0 }, { t: 550, rain: 0 }, { t: 610, rain: 0.8 }];
    const out = entries();
    const n = forecast(c, 3, 0, out);
    expect(n).toBe(4);
    expect(out[0]!.rain).toBeLessThan(0.15); // +5 min: dry
    expect(out[1]!.rain).toBeGreaterThan(0.6); // +10 min: the spell
    expect(out[1]!.probability).toBeGreaterThanOrEqual(0.9);
    // near the end of a short session only two horizons remain
    const short = initConditions({ tod: 'day', weather: 'dry', seed: 3 }, 600);
    expect(forecast(short, 3, 500, out)).toBe(2);
  });
});

describe('ConditionsSystem messages (§4.6)', () => {
  it('rainSoon → rainStarted → intersNow → wetsNow → drying → slicksNow, each once', () => {
    const c = initConditions({ tod: 'day', weather: 'dry', seed: 5 }, 3600);
    c.timeline = [{ t: 0, rain: 0 }, { t: 400, rain: 0 }, { t: 460, rain: 0.9 }, { t: 1200, rain: 0.9 }, { t: 1260, rain: 0 }];
    const { world, events } = condWorld(c);
    const sys = createConditionsSystem();
    for (let i = 0; i < 3600 * 10; i++) {
      world.state.time = i / 10;
      sys.step(world, 1 / 240);
    }
    const msgs = events.map((e) => (e.type === 'weather' ? e.msg : '')).filter(Boolean);
    expect(msgs).toEqual(['rainSoon', 'rainStarted', 'intersNow', 'wetsNow', 'drying', 'slicksNow']);
    expect(cxOf(c).durationS).toBe(3600);
    expect(c.trackC).toBeGreaterThan(30); // dried and warmed back up toward base
  });
});
