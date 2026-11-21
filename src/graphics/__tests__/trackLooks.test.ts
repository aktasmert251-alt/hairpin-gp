import { describe, expect, it } from 'vitest';
import { gradeFor, type GradeParams, NEUTRAL_GRADE } from '../post/lutPresets';
import { applyTrackLook, lookScale, TRACK_LOOKS } from '../post/trackLooks';

const fresh = (): GradeParams => ({ ...NEUTRAL_GRADE, slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1], shadowTint: [0.5, 0.5, 0.5], highTint: [0.5, 0.5, 0.5] });

describe('per-track looks', () => {
  it('no look = grade unchanged, scales 1', () => {
    const a = fresh(), b = fresh();
    gradeFor('day', 0, a);
    gradeFor('day', 0, b);
    applyTrackLook(b, null, 'day', 0);
    expect(b).toEqual(a);
    expect(lookScale(null, 'night', 0, 'exposure')).toBe(1);
  });

  it('İstanbul day is warmer and punchier; rain blends to the wet tone', () => {
    const base = fresh(), g = fresh();
    gradeFor('day', 0, base);
    gradeFor('day', 0, g);
    applyTrackLook(g, TRACK_LOOKS['istanbul']!, 'day', 0);
    expect(g.temp).toBeGreaterThan(base.temp);
    expect(g.contrast).toBeGreaterThan(base.contrast);
    const look = TRACK_LOOKS['istanbul']!;
    expect(lookScale(look, 'day', 1, 'exposure')).toBeCloseTo(look.wet.exposure, 6);
    expect(lookScale(look, 'day', 0, 'exposure')).toBeCloseTo(look.tod.day.exposure, 6);
  });
});
