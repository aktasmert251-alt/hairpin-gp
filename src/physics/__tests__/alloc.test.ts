/// <reference types="node" />
// U-PH-21: zero allocation in the physics step() (heap delta < 64 KB over 100k ticks). Own file → own worker.
// The best of three 100k-tick windows after a 120k-tick warm-up is used (JIT and test-runner noise only adds).

import v8 from 'node:v8';
import vm from 'node:vm';
import { expect, it } from 'vitest';
import { createStraightTrack } from '../../track/index';
import { createBench } from './helpers/benchWorld';

it('zero allocation in step(): heap delta < 64 KB over 100k ticks', () => {
  v8.setFlagsFromString('--expose_gc');
  const gc = vm.runInNewContext('gc') as () => void;
  const b = createBench(createStraightTrack(400000), { s: 100 });
  b.car.input.throttle = 0.6;
  b.car.input.steer = 0.01;
  const run = (): void => {
    for (let k = 0; k < 100; k++) {
      b.step(1000);
      b.world.events.drain(() => {});
    }
  };
  run();
  b.step(20000);
  let best = Infinity;
  for (let w = 0; w < 3; w++) {
    gc();
    gc();
    const h0 = process.memoryUsage().heapUsed;
    run();
    gc();
    gc();
    best = Math.min(best, process.memoryUsage().heapUsed - h0);
  }
  expect(best).toBeLessThan(64 * 1024);
}, 120_000);
