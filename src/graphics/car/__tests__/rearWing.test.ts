import { describe, expect, it } from 'vitest';
import { DRS_FLAP_OPEN } from '../carParts';
import { drsGeometry } from '../carRear';
import { drsEase } from '../carVisuals';

describe('rear wing DRS', () => {
  for (const style of ['classic', 'swept', 'tall'] as const) {
    it(`${style}: open flap leaves a 65-85 mm slot and stays inside the endplates`, () => {
      const open = drsGeometry(style, DRS_FLAP_OPEN);
      expect(open.slot).toBeGreaterThan(0.065);
      expect(open.slot).toBeLessThan(0.085);
      expect(open.clearance).toBeGreaterThan(0.01);
      // Closed: only the 2 mm seam.
      const closed = drsGeometry(style, 0);
      expect(closed.slot).toBeLessThan(0.004);
      expect(closed.clearance).toBeGreaterThan(0.01);
    });
  }

  it('flap visual travel is eased and completes within the sim ramp', () => {
    expect(drsEase(0)).toBe(0);
    expect(drsEase(0.6)).toBe(1);
    expect(drsEase(1)).toBe(1);
    expect(drsEase(0.3)).toBeCloseTo(0.5, 5);
  });
});
