import { describe, expect, it } from 'vitest';
import { CLOCK_SAMPLES, createClockSync } from '../clock';

describe('clock sync (design §5.3)', () => {
  it('is neutral before the first sample', () => {
    const c = createClockSync();
    expect(c.offsetMs()).toBe(0);
    expect(c.rttMs()).toBe(Infinity);
    expect(c.serverNow(1000)).toBe(1000);
    expect(c.count()).toBe(0);
  });

  it('recovers a constant offset exactly with symmetric delays', () => {
    const c = createClockSync();
    const offset = 1_760_000_000_000 - 5000;
    c.addSample(5000, 5020 + offset, 5040); // 20 ms each way
    expect(c.offsetMs()).toBe(offset);
    expect(c.rttMs()).toBe(40);
    expect(c.serverNow(6000)).toBe(6000 + offset);
  });

  it('uses the lowest-RTT sample of the last 8 (error ≤ RTT/2 of that sample)', () => {
    const c = createClockSync();
    const offset = 250;
    // Asymmetric samples: up delay a, down delay b → error (a − b) / 2.
    const add = (t: number, up: number, down: number): void => c.addSample(t, t + up + offset, t + up + down);
    add(0, 80, 10); // rtt 90, error +35
    add(100, 3, 2); // rtt 5, error +0.5  ← best
    add(200, 10, 60); // rtt 70, error −25
    expect(c.rttMs()).toBe(5);
    expect(Math.abs(c.offsetMs() - offset)).toBeLessThanOrEqual(2.5);
    // After 8 newer (worse) samples the best one falls out of the window.
    for (let i = 0; i < CLOCK_SAMPLES; i++) add(300 + i * 100, 20, 20);
    expect(c.count()).toBe(CLOCK_SAMPLES);
    expect(c.rttMs()).toBe(40);
    expect(c.offsetMs()).toBe(offset);
  });

  it('ignores impossible samples and resets', () => {
    const c = createClockSync();
    c.addSample(100, 500, 90); // negative RTT
    c.addSample(Number.NaN, 500, 90);
    c.addSample(100, Infinity, 120);
    expect(c.count()).toBe(0);
    c.addSample(100, 500, 120);
    expect(c.count()).toBe(1);
    c.reset();
    expect(c.count()).toBe(0);
    expect(c.offsetMs()).toBe(0);
  });
});
