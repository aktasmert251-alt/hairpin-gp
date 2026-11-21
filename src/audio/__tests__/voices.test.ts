// S2-S8 AI voice selection (audio.md §5): ≤ 8 nearest AI cars, 0.25 s re-rank, 15 % hysteresis, Doppler clamp.

import { describe, expect, it } from 'vitest';
import { activeVoices, dopplerRatio, MAX_AI_VOICES, newVoiceSelection, selectVoices, type VoiceCar, type VoiceListener } from '../voices';

const lis: VoiceListener = { px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0 };
const car = (x: number, isPlayer = false): VoiceCar => ({ px: x, py: 0, pz: 0, fx: 1, fy: 0, fz: 0, speed: 0, visible: true, isPlayer });

describe('AI voices', () => {
  it('picks the 8 nearest AI cars, never the player', () => {
    const cars = [car(0, true), ...Array.from({ length: 19 }, (_, i) => car(10 + 10 * i))];
    const sel = newVoiceSelection();
    selectVoices(sel, cars, cars.length, lis, 0);
    expect(activeVoices(sel)).toBe(MAX_AI_VOICES);
    expect([...sel.slot].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('re-ranks only every 0.25 s and keeps a held car unless a free one is > 15 % nearer', () => {
    const cars = [car(0, true), ...Array.from({ length: 9 }, (_, i) => car(10 + 10 * i))];
    const sel = newVoiceSelection();
    selectVoices(sel, cars, cars.length, lis, 0);
    expect(sel.slot.includes(9)).toBe(false);
    cars[9]!.px = 79; // 10 % nearer than car 8 at 80 m: not enough
    expect(selectVoices(sel, cars, cars.length, lis, 0.1)).toBe(false);
    selectVoices(sel, cars, cars.length, lis, 0.3);
    expect(sel.slot.includes(9)).toBe(false);
    cars[9]!.px = 60; // 25 % nearer than the farthest held car
    selectVoices(sel, cars, cars.length, lis, 0.6);
    expect(sel.slot.includes(9)).toBe(true);
    expect(sel.slot.includes(8)).toBe(false);
  });

  it('Doppler: approaching raises, receding lowers, clamped to [0.6, 1.6]', () => {
    const a = { ...car(-100), speed: 80 };
    expect(dopplerRatio(a, lis)).toBeGreaterThan(1.2);
    const r = { ...car(100), speed: 80 };
    expect(dopplerRatio(r, lis)).toBeLessThan(0.85);
    expect(dopplerRatio({ ...car(-100), speed: 400 }, lis)).toBe(1.6);
    expect(dopplerRatio({ ...car(0), speed: 80 }, lis)).toBe(1);
  });
});
