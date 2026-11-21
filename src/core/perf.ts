// Frame-time recorder backing __APEX__.getPerf() (allocation-free in record()).

import type { PerfStats } from '../contracts/debug';
import type { RendererPerf } from '../contracts/render';

export interface PerfRecorder {
  /** Records one rendered frame: raw wall-clock frame time (ms), ticks run, and whether the tick cap was hit. */
  record(frameMs: number, ticks: number, overrun: boolean): void;
  stats(renderer: RendererPerf): PerfStats;
  reset(): void;
}

const EMPTY_RENDERER: RendererPerf = { calls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0 };
/** CR-07: a frame longer than this counts as a hitch. */
export const HITCH_MS = 50;

/** JS heap in MB (Chrome's non-standard performance.memory); 0 when unavailable. */
export function heapMB(): number {
  const mem = (globalThis.performance as (Performance & { memory?: { usedJSHeapSize: number } }) | undefined)?.memory;
  return mem && Number.isFinite(mem.usedJSHeapSize) ? mem.usedJSHeapSize / (1024 * 1024) : 0;
}

export function createPerfRecorder(capacity = 1800): PerfRecorder {
  const ring = new Float32Array(capacity);
  const scratch = new Float32Array(capacity);
  let head = 0;
  let count = 0;
  let frames = 0;
  let totalMs = 0;
  let maxMs = 0;
  let ticks = 0;
  let overruns = 0;
  let hitches = 0;

  return {
    record(frameMs, n, overrun) {
      if (!(frameMs >= 0) || frameMs > 10_000) return;
      ring[head] = frameMs;
      head = (head + 1) % capacity;
      if (count < capacity) count++;
      frames++;
      totalMs += frameMs;
      if (frameMs > maxMs) maxMs = frameMs;
      ticks += n;
      if (overrun) overruns++;
      if (frameMs > HITCH_MS) hitches++;
    },
    stats(renderer) {
      let p95 = 0;
      let windowSum = 0;
      if (count > 0) {
        for (let i = 0; i < count; i++) {
          scratch[i] = ring[i]!;
          windowSum += ring[i]!;
        }
        const view = scratch.subarray(0, count);
        view.sort();
        p95 = view[Math.min(count - 1, Math.floor(0.95 * (count - 1) + 0.5))]!;
      }
      const avg = count > 0 ? windowSum / count : 0;
      return {
        frames,
        seconds: totalMs / 1000,
        fps: avg > 0 ? 1000 / avg : 0,
        frameMsAvg: avg,
        frameMsP95: p95,
        frameMsMax: maxMs,
        ticks,
        simOverrun: overruns,
        renderer: { ...(renderer ?? EMPTY_RENDERER) },
        hitches,
        heapMB: heapMB(),
      };
    },
    reset() {
      head = 0;
      count = 0;
      frames = 0;
      totalMs = 0;
      maxMs = 0;
      ticks = 0;
      overruns = 0;
      hitches = 0;
    },
  };
}
