// Desert Cliff acceptance (docs/design/tracks-cliff.md §10): U-TR-01…12 through the shared suite, plus the ramp:
// vertical curvature small enough that cars neither launch over the crest nor bottom out at the foot.
import { expect, it } from 'vitest';
import { RAMP } from '../authoring/cliff-ctrl';
import { getTrackExtras } from '../build/extras';
import { loadTrack } from '../index';
import { trackSuite } from './trackSuite';

trackSuite('cliff', {
  length: [7150, 7300],
  sequence: 'R L L L R R L L R L L L R L R L L R L L R',
  minRadius: 20,
  minTurn: 15,
  heading: 360,
  pitLength: [650, 800],
  elevationRange: [100, 115],
  maxGrade: 0.16,
  attribution: /HAIRPIN GP/,
});

it('cliff ramp: T1 crest ≈ 70 m, |vertical curvature| ≤ 1/1,100 m over the ramp and the plunge', () => {
  const { data } = loadTrack('cliff');
  const ex = getTrackExtras(data)!;
  const s0 = Math.round(RAMP.from * ex.sScale) - 60, s1 = Math.round(RAMP.to * ex.sScale) + 60;
  let top = -Infinity, worst = 0;
  for (let i = s0; i <= s1; i++) {
    top = Math.max(top, data.y[i]!);
    worst = Math.max(worst, Math.abs(data.vCurvature[i]!));
  }
  console.log(`cliff ramp top ${top.toFixed(1)} m, max |vertical curvature| 1/${(1 / worst).toFixed(0)} m`);
  expect(top).toBeGreaterThan(65);
  expect(top).toBeLessThan(75);
  expect(worst).toBeLessThan(1 / 1100);
});
