// Mobile branch of the quality presets (2026-11-21): desktop tables untouched, phone costs capped, same ids.

import { describe, expect, it } from 'vitest';
import type { QualityId } from '../../contracts/common';
import { PRESET_DERIVED, QUALITY_PRESETS, mobilePreset } from '../presets';

const IDS: QualityId[] = ['low', 'medium', 'high', 'ultra'];

describe('mobilePreset', () => {
  it('keeps the desktop presets as tabled (frozen, unchanged values)', () => {
    expect(Object.isFrozen(QUALITY_PRESETS.high)).toBe(true);
    expect(QUALITY_PRESETS.high.shadowSize).toBe(2048);
    expect(QUALITY_PRESETS.high.ao).toBe('half');
    expect(QUALITY_PRESETS.ultra.mirrors).toBe('high60');
    expect(QUALITY_PRESETS.low.renderScale).toBe(0.75);
  });
  it('caps every heavy cost and keeps the id (PRESET_DERIVED stays valid)', () => {
    for (const id of IDS) {
      const d = QUALITY_PRESETS[id];
      const m = mobilePreset(d);
      expect(m.id).toBe(id);
      expect(PRESET_DERIVED[m.id]).toBeDefined();
      expect(m.renderScale).toBeLessThanOrEqual(0.8);
      expect(m.renderScale).toBeLessThanOrEqual(d.renderScale);
      expect(m.shadowSize).toBe(1024);
      expect(m.ao).toBe('off');
      expect(m.mirrors).toBe('static');
      expect(m.lens).toBe('droplets');
      expect(m.grassCards).toBe(0);
      expect(m.envSize).toBe(128);
      expect(m.far).toBeLessThanOrEqual(1800);
      expect(m.treeDensity).toBeLessThan(d.treeDensity);
      expect(m.aa).toBe('fxaa');
    }
    expect(mobilePreset(QUALITY_PRESETS.low).bloom).toBe(false);
    expect(mobilePreset(QUALITY_PRESETS.low).renderScale).toBe(0.7);
  });
});
