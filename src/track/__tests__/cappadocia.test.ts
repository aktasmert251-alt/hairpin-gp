// Cappadocia Valley acceptance (docs/design/tracks-cappadocia.md §9): U-TR-01…12 through the shared suite, plus the
// technical character: 21 corners, the S/F straight the longest (≤ 560 m) and every other straight ≤ 400 m, at least a
// third of the lap in corners, walls close (≤ 6 m from the edge) over a large part of the lap, narrow walled sections.
import { expect, it } from 'vitest';
import { loadTrack } from '../index';
import { trackSuite } from './trackSuite';

trackSuite('cappadocia', {
  length: [4400, 4800],
  sequence: 'R L R L R L L R R L R L R R L R L R R L R',
  minRadius: 20,
  minTurn: 20,
  heading: -360,
  pitLength: [600, 900],
  elevationRange: [50, 70],
  maxGrade: 0.13,
  attribution: /HAIRPIN GP/,
});

/** Straights: runs of |curvature| < 1/400 m, merged across the S/F line. */
function straights(): number[] {
  const { data } = loadTrack('cappadocia');
  const N = data.count;
  let start = 0;
  while (Math.abs(data.curvature[start]!) < 1 / 400) start++;
  const out: number[] = [];
  let run = 0;
  for (let k = 1; k <= N; k++) {
    const i = (start + k) % N;
    if (Math.abs(data.curvature[i]!) < 1 / 400) run++;
    else if (run > 0) { out.push(run); run = 0; }
  }
  return out.sort((a, b) => b - a);
}

it('cappadocia: technical lap: longest straight ≤ 560 m, every other ≤ 400 m, ≥ 33 % in corners', () => {
  const { data } = loadTrack('cappadocia');
  const st = straights();
  const straight = st.reduce((a, b) => a + b, 0);
  console.log(`cappadocia L ${data.length.toFixed(0)} m, straights ${st.slice(0, 6).join(' / ')} m; ${(100 * (1 - straight / data.length)).toFixed(1)} % of the lap in corners`);
  expect(st[0]!).toBeLessThanOrEqual(560);
  expect(st[1]!).toBeLessThanOrEqual(400);
  expect(1 - straight / data.length).toBeGreaterThan(0.33);
});

it('cappadocia: unforgiving edges: barriers within 6 m of the edge on ≥ 45 % of each side, narrow sections ≤ 11 m', () => {
  const { data } = loadTrack('cappadocia');
  let l = 0, r = 0, narrow = 0;
  for (let i = 0; i < data.count; i++) {
    if (data.wallL[i]! - data.halfWidthL[i]! <= 6) l++;
    if (data.wallR[i]! - data.halfWidthR[i]! <= 6) r++;
    if (data.halfWidthL[i]! + data.halfWidthR[i]! <= 11.01) narrow++;
  }
  console.log(`cappadocia walls ≤ 6 m: left ${(100 * l / data.count).toFixed(0)} %, right ${(100 * r / data.count).toFixed(0)} %; ≤ 11 m wide: ${narrow} m`);
  expect(l / data.count).toBeGreaterThan(0.45);
  expect(r / data.count).toBeGreaterThan(0.45);
  expect(narrow).toBeGreaterThan(250);
});
