// Bosphorus acceptance (tracks.md §4): U-TR-01…12 through the shared suite, plus the street-circuit wall clearance.
import { expect, it } from 'vitest';
import { loadTrack } from '../index';
import { trackSuite } from './trackSuite';

trackSuite('bosphorus', {
  length: [4940, 5020],
  sequence: 'L R L L L R L R L L R',
  minRadius: 17,
  heading: 360,
  pitLength: [870, 930],
  elevationRange: [18, 21],
  maxGrade: 0.07,
});

it('bosphorus U-TR-06: wall–edge clearance ≥ 1.5 m everywhere', () => {
  const { data } = loadTrack('bosphorus');
  let worst = Infinity;
  for (let i = 0; i < data.count; i++) worst = Math.min(worst, data.wallL[i]! - data.halfWidthL[i]!, data.wallR[i]! - data.halfWidthR[i]!);
  expect(worst).toBeGreaterThanOrEqual(1.5);
});
