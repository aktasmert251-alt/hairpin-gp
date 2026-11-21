import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../contracts/sim';
import { MAX_TARGET_TICKS, MAX_TICKS_PER_FRAME, createLoop, type LoopHooks } from '../loop';
import { createPerfRecorder } from '../perf';

function harness(running = true) {
  const calls = { ticks: 0, before: 0, frames: 0, alphas: [] as number[], after: [] as number[] };
  let isRunning = running;
  const hooks: LoopHooks = {
    isRunning: () => isRunning,
    beforeTick: () => calls.before++,
    tick: () => calls.ticks++,
    afterTicks: (n) => calls.after.push(n),
    frame: (alpha) => {
      calls.frames++;
      calls.alphas.push(alpha);
    },
  };
  const perf = createPerfRecorder(64);
  const loop = createLoop(hooks, { perf });
  return { loop, calls, perf, setRunning: (v: boolean) => (isRunning = v) };
}

describe('loop', () => {
  it('runs 4 ticks per 1/60 s frame at 240 Hz and renders every frame', () => {
    const { loop, calls } = harness();
    for (let i = 0; i < 60; i++) loop.advance(1 / 60);
    expect(calls.ticks).toBe(240);
    expect(calls.before).toBe(240);
    expect(calls.frames).toBe(60);
    expect(calls.after.every((n) => n === 4)).toBe(true);
    expect(loop.simOverrun).toBe(0);
  });

  it('carries the remainder and exposes the interpolation alpha', () => {
    const { loop, calls } = harness();
    loop.advance(SIM_DT * 2.5);
    expect(calls.ticks).toBe(2);
    expect(calls.alphas[0]).toBeCloseTo(0.5, 6);
    loop.advance(SIM_DT * 0.5);
    expect(calls.ticks).toBe(3);
    expect(calls.alphas[1]).toBeCloseTo(0, 6);
  });

  it('caps at 12 ticks, drops the accumulator and counts the overrun', () => {
    const { loop, calls, perf } = harness();
    loop.advance(0.1); // 24 ticks of backlog
    expect(calls.ticks).toBe(MAX_TICKS_PER_FRAME);
    expect(loop.simOverrun).toBe(1);
    expect(loop.accumulator).toBe(0);
    expect(calls.alphas[0]).toBe(0);
    loop.advance(1); // clamped to 0.1 s
    expect(calls.ticks).toBe(24);
    expect(loop.simOverrun).toBe(2);
    expect(perf.stats({ calls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0 }).simOverrun).toBe(2);
  });

  it('does not tick while paused but still renders, and honours timeScale', () => {
    const { loop, calls, setRunning } = harness(false);
    loop.advance(1 / 60);
    expect(calls.ticks).toBe(0);
    expect(calls.frames).toBe(1);
    setRunning(true);
    loop.timeScale = 0.5;
    for (let i = 0; i < 60; i++) loop.advance(1 / 60);
    expect(calls.ticks).toBe(120);
  });

  it('treats the first timestamp as dt = 0 and stepNow ignores pause', () => {
    const { loop, calls, setRunning } = harness();
    loop.frameAt(1000);
    expect(calls.ticks).toBe(0);
    loop.frameAt(1000 + 1000 / 60);
    expect(calls.ticks).toBe(4);
    setRunning(false);
    loop.stepNow(10);
    expect(calls.ticks).toBe(14);
    expect(loop.totalTicks).toBe(14);
  });

  it('drives from an animation driver and stops cleanly', () => {
    const { loop, calls } = harness();
    let cb: ((t: number) => void) | null = null;
    const driver = { setAnimationLoop: (f: ((t: number) => void) | null) => (cb = f) };
    loop.start(driver);
    expect(loop.running()).toBe(true);
    cb!(0);
    cb!(1000 / 60);
    expect(calls.ticks).toBe(4);
    loop.dispose();
    expect(cb).toBeNull();
    expect(loop.running()).toBe(false);
  });

  it('CR-NET-7: targetTicks slaves the tick count to the hook, clamps to [0, 48] and ignores timeScale', () => {
    const calls = { ticks: 0, before: 0, alphas: [] as number[] };
    let target: number | null = 3.25;
    const slaved = createLoop({
      isRunning: () => true,
      beforeTick: () => calls.before++,
      tick: () => calls.ticks++,
      targetTicks: () => target,
      frame: (alpha) => calls.alphas.push(alpha),
    });
    slaved.timeScale = 4;
    slaved.advance(1 / 60);
    expect(calls.ticks).toBe(3);
    expect(calls.alphas.at(-1)).toBeCloseTo(0.25, 9);
    target = -2;
    slaved.advance(1 / 60);
    expect(calls.ticks).toBe(3);
    expect(calls.alphas.at(-1)).toBe(0);
    target = 500;
    slaved.advance(1 / 60);
    expect(calls.ticks).toBe(3 + MAX_TARGET_TICKS);
    expect(slaved.simOverrun).toBe(1);
    target = null; // falls back to the accumulator (timeScale 4 → 16 ticks per 1/60 s, capped at 12)
    slaved.advance(1 / 60);
    expect(calls.ticks).toBe(3 + MAX_TARGET_TICKS + MAX_TICKS_PER_FRAME);
  });

  it('without targetTicks the offline path is unchanged', () => {
    const { loop, calls } = harness();
    loop.advance(SIM_DT * 2.5);
    expect(calls.ticks).toBe(2);
    expect(calls.alphas[0]).toBeCloseTo(0.5, 6);
  });
});
