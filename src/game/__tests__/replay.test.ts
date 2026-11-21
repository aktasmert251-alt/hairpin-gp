// L8 replay (CR-01): I-04 record → encode → decode → frameAt exact at sample times; codec speed; allocation-free
// frameAt; flashback truncation.

import { PerformanceObserver } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { REPLAY_CAR_STRIDE, REPLAY_HZ, type ReplayData } from '../../contracts/replay';
import { createSim, defaultSessionConfig } from '../createSim';
import { createReplayFrame, createReplayPlayer, createReplayRecorder, decodeReplay, encodeReplay } from '../replay/index';

function record(seconds: number) {
  const sim = createSim(defaultSessionConfig({ aiCount: 19, autodrive: true, seed: 3, laps: 3 }), { skipLights: true });
  const w = sim.world;
  const rec = createReplayRecorder();
  rec.begin(w);
  const expected: { t: number; car: number; px: number; speed: number; gear: number; laps: number; raceMs: number }[] = [];
  let t0 = -1;
  for (let i = 0; i < seconds * 240; i++) {
    sim.step();
    rec.sample(w);
    w.events.drain((e) => rec.event(w, e));
    if (w.state.tick % 4 === 0) {
      if (t0 < 0) t0 = w.state.time;
      if (rec.frameCount() % 37 === 1) {
        const car = rec.frameCount() % 20;
        const c = w.state.cars[car]!;
        expected.push({ t: w.state.time - t0, car, px: c.vehicle.x, speed: c.vehicle.speed, gear: c.vehicle.gear, laps: c.race.lapsCompleted, raceMs: w.state.race.raceMs });
      }
    }
  }
  return { sim, rec, expected };
}

describe('replay (CR-01)', () => {
  it('I-04: record → encode → decode → frameAt equals the recorded samples at sample times', () => {
    const { rec, expected } = record(10);
    const data = rec.end();
    expect(data.frameCount).toBe(600);
    expect(data.cars.length).toBe(600 * 20 * REPLAY_CAR_STRIDE);
    expect(data.events.length).toBeGreaterThan(0);
    const back = decodeReplay(encodeReplay(data));
    expect(back.meta).toEqual(data.meta);
    expect(back.events).toEqual(data.events);
    const p = createReplayPlayer(back);
    expect(p.duration()).toBeCloseTo(599 / REPLAY_HZ, 9);
    const f = createReplayFrame(back);
    expect(expected.length).toBeGreaterThan(10);
    for (const x of expected) {
      p.frameAt(x.t, f);
      const cs = f.cars[x.car]!;
      expect(cs.px).toBe(Math.fround(x.px));
      expect(cs.speed).toBe(Math.fround(x.speed));
      expect(cs.gear).toBe(x.gear);
      expect(f.laps[x.car]).toBe(x.laps);
      expect(f.raceMs).toBe(Math.fround(x.raceMs));
    }
    // between samples: interpolated, inside the neighbours' range
    p.frameAt(5 + 0.5 / REPLAY_HZ, f);
    const a = createReplayFrame(back), b = createReplayFrame(back);
    p.frameAt(5, a);
    p.frameAt(5 + 1 / REPLAY_HZ, b);
    expect(f.cars[3]!.px).toBeCloseTo((a.cars[3]!.px + b.cars[3]!.px) / 2, 3);
    expect([...f.order].sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('flashback truncate drops later frames and events; recording continues on the same 60 Hz grid', () => {
    const { sim, rec } = record(6);
    const tCut = sim.world.state.time - 3;
    rec.truncate(tCut);
    const n = rec.frameCount();
    expect(n).toBeLessThan(6 * 60 - 170);
    for (let i = 0; i < 240; i++) {
      sim.step();
      rec.sample(sim.world);
    }
    expect(rec.frameCount()).toBe(n + 60);
    expect(rec.end().events.every((e) => e.t <= tCut + 1)).toBe(true);
  });

  it('3-lap size (16,200 frames × 20 cars) encodes + decodes in ≤ 1.5 s; 10,000 frameAt calls allocate nothing', { timeout: 60_000 }, async () => {
    const frames = 16_200;
    const src = record(10).rec.end(); // 600 real frames, tiled 27× → a 3-lap-sized replay
    const cars = new Float32Array(frames * 20 * REPLAY_CAR_STRIDE);
    const global = new Float32Array(frames * 8);
    for (let k = 0; k < 27; k++) {
      cars.set(src.cars, k * src.cars.length);
      global.set(src.global, k * src.global.length);
    }
    const d: ReplayData = {
      version: 1, buildHash: 'test', trackId: 'istanbul', config: defaultSessionConfig(), hz: 60, startTime: 0, frameCount: frames,
      meta: Array.from({ length: 20 }, (_, i) => ({ id: i, driverId: `d${i}`, teamId: 'anka', number: i, tcam: 'black' as const, isPlayer: i === 0 })),
      cars, global, events: [],
    };
    const t0 = performance.now();
    const back = decodeReplay(encodeReplay(d));
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(back.cars[123_456]).toBe(d.cars[123_456]);
    const p = createReplayPlayer(back);
    const f = createReplayFrame(back);
    for (let i = 0; i < 3000; i++) p.frameAt(i * 0.0137, f); // warm-up (JIT)
    await new Promise((r) => setTimeout(r, 300)); // let GC work started by the 57 MB buffers above finish
    // Allocation-free = no scavenge while 10,000 calls run (heapUsed deltas are noise without --expose-gc).
    let gcs = 0;
    const obs = new PerformanceObserver((l) => {
      gcs += l.getEntries().length;
    });
    obs.observe({ entryTypes: ['gc'] });
    for (let i = 0; i < 10_000; i++) p.frameAt((i * 0.0271) % 270, f);
    await new Promise((r) => setTimeout(r, 20));
    obs.disconnect();
    expect(gcs, 'GCs during 10,000 frameAt calls').toBe(0);
  });
});
