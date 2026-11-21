// Ghost codec/recorder (sprint-2 §2, I-05 size budget) and the TT lap start / restartLap rule.

import { describe, expect, it } from 'vitest';
import { SIM_DT, type SimEvent } from '../../contracts/sim';
import { createStraightTrack, loadTrack } from '../../track/index';
import { decodeRival, encodeRival, recordRivalLap } from '../ghost/rival';
import { createSim, defaultSessionConfig } from '../createSim';
import { GHOST_ALPHA, createGhostRecorder, decodeGhost, encodeGhost, ghostAlphaAt, ghostPoseAt } from '../ghost/ghost';

describe('ghost', () => {
  it('I-05: a 95 s lap encodes to ≤ 100 KB and round-trips; poses interpolate', () => {
    const rec = createGhostRecorder();
    rec.begin();
    for (let t = 0; t <= 95_000; t += SIM_DT * 1000) rec.sample(t, t / 10, 1, -t / 20, 1, 0, 0, 80);
    const lap = rec.finish(95_000)!;
    expect(lap.count).toBeGreaterThanOrEqual(1900);
    const text = encodeGhost(lap);
    expect(text.length).toBeLessThanOrEqual(100 * 1024);
    const back = decodeGhost(text)!;
    expect(back.count).toBe(lap.count);
    expect(back.lapMs).toBe(95_000);
    const pose = { px: 0, py: 0, pz: 0, fx: 0, fy: 0, fz: 0, speed: 0 };
    expect(ghostPoseAt(back, 10_025, pose)).toBe(true);
    expect(Math.abs(pose.px - 1002.5)).toBeLessThan(0.5); // samples land on the first tick at or after each 50 ms slot
    expect(ghostPoseAt(back, 96_000, pose)).toBe(false);
    expect(decodeGhost('not base64!')).toBeNull();
    expect(ghostAlphaAt(20)).toBe(GHOST_ALPHA);
    expect(ghostAlphaAt(0)).toBe(0);
  });

  it('rival ghost: a valid perfect AI lap with monotone markers, cache round trip', () => {
    const t0 = performance.now();
    const r = recordRivalLap(loadTrack())!;
    const ms = performance.now() - t0;
    expect(r, 'rival lap recorded').not.toBeNull();
    expect(ms, 'headless rival lap cost (ms)').toBeLessThan(4000);
    expect(r.ghost.lapMs).toBeGreaterThan(80_000);
    expect(r.ghost.lapMs).toBeLessThan(95_000);
    for (let k = 2; k < r.markers.length; k++) expect(r.markers[k]!).toBeGreaterThanOrEqual(r.markers[k - 1]!);
    expect(r.markers[r.markers.length - 1]!).toBeLessThan(r.ghost.lapMs);
    const back = decodeRival(encodeRival(r))!;
    expect(back.ghost.count).toBe(r.ghost.count);
    expect(Array.from(back.markers)).toEqual(Array.from(r.markers));
  });

  it('time trial: flying start at L − 200 m and 200 km/h, the lap starts at the line', () => {
    const sim = createSim(defaultSessionConfig({ mode: 'timeTrial', aiCount: 0 }), { track: createStraightTrack(2000), skipLights: true });
    const v = sim.world.state.cars[0]!.vehicle;
    expect(v.s).toBeCloseTo(1800, 1);
    expect(v.speed * 3.6).toBeCloseTo(200, 3);
    const ev: SimEvent[] = [];
    for (let i = 0; i < 240 * 6 && sim.world.state.cars[0]!.race.lapStartMs < 0; i++) {
      sim.step();
      sim.world.events.drain((e) => ev.push(e));
    }
    expect(sim.world.state.cars[0]!.race.lapStartMs).toBeGreaterThan(0);
    expect(sim.world.state.cars[0]!.race.lapsCompleted).toBe(0);
    expect(ev.some((e) => e.type === 'lap')).toBe(false);
  });
});
