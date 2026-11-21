// Touch UI layout rules (mobile, 2026-11-21): phone layout only for a touch UI on a short viewport; portrait asks to rotate.

import { describe, expect, it } from 'vitest';
import { needsRotate } from '../../core/index';
import { phoneLayout } from '../touch/mobileUi';

describe('phone layout', () => {
  it('only a touch UI with a short side under 600 px (landscape phones 667×375 … 932×430)', () => {
    expect(phoneLayout(true, 844, 390)).toBe(true);
    expect(phoneLayout(true, 667, 375)).toBe(true);
    expect(phoneLayout(true, 932, 430)).toBe(true);
    expect(phoneLayout(true, 1024, 768)).toBe(false); // tablet: desktop stage, touch-sized rows
    expect(phoneLayout(false, 844, 390)).toBe(false); // small desktop window: unchanged
  });
  it('portrait overlay only for a touch UI held upright', () => {
    expect(needsRotate(390, 844, true)).toBe(true);
    expect(needsRotate(844, 390, true)).toBe(false);
    expect(needsRotate(390, 844, false)).toBe(false);
  });
});
