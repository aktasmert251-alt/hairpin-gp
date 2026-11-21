import { describe, expect, it } from 'vitest';
import { CAR_LEN, classifyCar, emptyProximity, resetProximity } from '../proximity';

const one = (f: number, l: number, closing = 0) => {
  const p = emptyProximity();
  classifyCar(f, l, closing, p);
  return p;
};

describe('proximity classification (D-051 #2)', () => {
  it('a car alongside on the left lights the left marker with the alarm', () => {
    const p = one(0, 2.2);
    expect(p.left).toBe(1);
    expect(p.leftAlarm).toBe(true);
    expect(p.right).toBe(0);
    expect(p.rear).toBe(0);
  });

  it('a car alongside on the right lights the right marker', () => {
    const p = one(-1, -2.4);
    expect(p.right).toBe(1);
    expect(p.rightAlarm).toBe(true);
    expect(p.left).toBe(0);
  });

  it('a car half a length behind on the side is shown, fading out beyond one length', () => {
    expect(one(-CAR_LEN * 1.5, 2.5).left).toBeCloseTo(0.5, 5);
    expect(one(-CAR_LEN * 1.5, 2.5).leftAlarm).toBe(false);
    expect(one(-CAR_LEN * 2.1, 2.5).left).toBe(0);
  });

  it('far to the side or ahead is ignored', () => {
    expect(one(0, 7).left).toBe(0);
    expect(one(CAR_LEN + 1, 2).left).toBe(0);
  });

  it('a car directly behind and closing lights the rear chevron; a slower one far back does not', () => {
    const p = one(-8, 0.3, 6);
    expect(p.rear).toBeGreaterThan(0.5);
    expect(p.rearAlarm).toBe(true);
    expect(p.left + p.right).toBe(0);
    expect(one(-20, 0, -2).rear).toBe(0);
    expect(one(-40, 0, 10).rear).toBe(0);
  });

  it('a close car directly behind shows weakly even without closing speed', () => {
    const p = one(-7, 0, 0);
    expect(p.rear).toBeGreaterThan(0);
    expect(p.rear).toBeLessThan(0.5);
    expect(p.rearAlarm).toBe(false);
  });

  it('keeps the strongest car per channel and resets', () => {
    const p = emptyProximity();
    classifyCar(-CAR_LEN * 1.8, 2.5, 0, p);
    classifyCar(-1, 2.5, 0, p);
    expect(p.left).toBe(1);
    expect(p.leftF).toBe(-1);
    resetProximity(p);
    expect(p.left).toBe(0);
    expect(p.leftAlarm).toBe(false);
  });

  it('remembers which car is strongest per channel (team colour), -1 after reset', () => {
    const p = emptyProximity();
    classifyCar(0, 2.4, 0, p, 5);
    classifyCar(-CAR_LEN * 1.8, 2.4, 0, p, 6);
    classifyCar(-1, -2.4, 0, p, 7);
    classifyCar(-8, 0, 6, p, 9);
    expect([p.leftI, p.rightI, p.rearI]).toEqual([5, 7, 9]);
    resetProximity(p);
    expect([p.leftI, p.rightI, p.rearI]).toEqual([-1, -1, -1]);
  });
});
