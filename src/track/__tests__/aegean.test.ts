// Aegean Islands acceptance (docs/design/tracks-aegean.md §10): U-TR-01…12 through the shared suite, plus the sea:
// every over-sea span is a walled bridge deck that clears the water, and the pontoon skims just above it.
import { expect, it } from 'vitest';
import { PONTOON, SEA_Y, seaSpans } from '../authoring/aegean-ctrl';
import { getTrackExtras } from '../build/extras';
import { loadTrack } from '../index';
import { trackSuite } from './trackSuite';

trackSuite('aegean', {
  length: [6000, 6150],
  sequence: 'R L R R L R L R R R L R R L R R',
  minRadius: 20,
  minTurn: 15,
  heading: -360,
  pitLength: [520, 650],
  elevationRange: [17, 30],
  maxGrade: 0.08,
  attribution: /HAIRPIN GP/,
});

it('aegean bridges: ≥ 45 % of the lap (trimmed spans) over the sea, decks 1.5–30 m above it, walls within hw + 3', () => {
  const { data } = loadTrack('aegean');
  const ex = getTrackExtras(data)!;
  let over = 0;
  for (const sp of seaSpans()) {
    for (let s = Math.round(sp.from * ex.sScale) + 25; s < sp.to * ex.sScale - 25; s++) {
      over++;
      const i = s % data.count;
      expect(data.y[i]! - SEA_Y, `deck height s ${s}`).toBeGreaterThan(1.5);
      expect(data.y[i]! - SEA_Y, `deck height s ${s}`).toBeLessThan(30);
      expect(data.wallL[i]! - data.halfWidthL[i]!, `wallL s ${s}`).toBeLessThanOrEqual(3);
      expect(data.wallR[i]! - data.halfWidthR[i]!, `wallR s ${s}`).toBeLessThanOrEqual(3);
    }
  }
  console.log(`aegean: ${(over / data.count * 100).toFixed(0)} % of the lap on bridges`);
  expect(over / data.count).toBeGreaterThan(0.45);
  const mid = Math.round(((PONTOON.from + PONTOON.to) / 2) * ex.sScale);
  expect(data.y[mid]! - SEA_Y).toBeLessThan(3);
});
