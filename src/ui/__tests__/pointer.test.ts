// Mouse support: the stepper / toggle part hit test, the stepper step and the slider value under the pointer.

import { describe, expect, it } from 'vitest';
import { partOf, sliderValueAt, stepIndex } from '../pointer';

/** Minimal Node: contains() walks a parent chain. */
function node(parent: Node | null = null): Node {
  const n = { parent, contains: (o: Node | null) => {
    for (let x = o as unknown as { parent: Node | null } | null; x; x = x.parent as unknown as { parent: Node | null } | null) if (x === (n as unknown)) return true;
    return false;
  } };
  return n as unknown as Node;
}

describe('partOf (‹ › chevrons, KAPALI | AÇIK segments, key chips)', () => {
  const row = node();
  const left = node(row);
  const right = node(row);
  const leftPath = node(left); // an <svg><path> inside the chevron
  it('finds the part that contains the target, including descendants', () => {
    expect(partOf(left, [left, right])).toBe(0);
    expect(partOf(leftPath, [left, right])).toBe(0);
    expect(partOf(right, [left, right])).toBe(1);
  });
  it('returns -1 elsewhere on the row', () => {
    expect(partOf(row, [left, right])).toBe(-1);
    expect(partOf(node(row), [left, right])).toBe(-1);
  });
});

describe('stepIndex (stepper ‹ / ›)', () => {
  it('ordered scales clamp at the ends', () => {
    expect(stepIndex(1, 1, 4, true)).toBe(2); // ORTA -> YÜKSEK
    expect(stepIndex(3, 1, 4, true)).toBeNull();
    expect(stepIndex(0, -1, 4, true)).toBeNull();
  });
  it('sets wrap', () => {
    expect(stepIndex(2, 1, 3, false)).toBe(0);
    expect(stepIndex(0, -1, 3, false)).toBe(2);
  });
  it('empty option lists never step', () => {
    expect(stepIndex(0, 1, 0, false)).toBeNull();
  });
});

describe('sliderValueAt (click / drag on the track)', () => {
  // 220 px track at x 1000 (DESIGN §6.12), master volume 0..1 step .05.
  it('maps the ends and the middle', () => {
    expect(sliderValueAt(1000, 1000, 220, 0, 1, 0.05)).toBe(0);
    expect(sliderValueAt(1220, 1000, 220, 0, 1, 0.05)).toBe(1);
    expect(sliderValueAt(1110, 1000, 220, 0, 1, 0.05)).toBe(0.5);
  });
  it('clamps outside the track (drag past the ends)', () => {
    expect(sliderValueAt(900, 1000, 220, 0, 1, 0.05)).toBe(0);
    expect(sliderValueAt(1500, 1000, 220, 0, 1, 0.05)).toBe(1);
  });
  it('snaps to the step from min without float noise', () => {
    // render scale 0.5..1 step .05: 30 % of the way = 0.65
    expect(sliderValueAt(1000 + 0.3 * 220, 1000, 220, 0.5, 1, 0.05)).toBe(0.65);
    // FOV −10..10 step 1: 26 % -> −4.8 -> −5
    expect(sliderValueAt(1000 + 0.26 * 220, 1000, 220, -10, 10, 1)).toBe(-5);
    // tree density 0.2..1.3 step .1 lands on the keyboard grid
    expect(sliderValueAt(1000 + 0.5 * 220, 1000, 220, 0.2, 1.3, 0.1)).toBe(0.8);
  });
  it('works with a scaled stage (rect in client px)', () => {
    // kView 0.5: the track is 110 px wide on screen.
    expect(sliderValueAt(555, 500, 110, 0, 110, 5)).toBe(55);
  });
  it('a zero-width track yields min', () => {
    expect(sliderValueAt(10, 0, 0, 0, 1, 0.1)).toBe(0);
  });
});
