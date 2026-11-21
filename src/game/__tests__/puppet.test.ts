import { describe, expect, it } from 'vitest';
import type { NetCarState } from '../../contracts/net';
import { NET_FLAG_RESET, newNetCarState } from '../../net/index';
import {
  PUPPET_BLEND_POS_S, PUPPET_MAX_EXTRAP_S, PUPPET_STOP_S, createPuppetBuffer, extrapolateArc, hermite, newPuppetPose,
} from '../net/puppet';

/** A car on a circle of radius R around the origin, speed v, turning left (yaw increasing), at time t (s). */
function onCircle(t: number, R = 100, v = 50): NetCarState {
  const w = v / R;
  const yaw = w * t;
  const s = newNetCarState();
  // heading (cos yaw, −sin yaw); centre to the left: position = centre + R·(sin yaw, cos yaw) with centre (0, −R).
  s.x = R * Math.sin(yaw);
  s.z = -R + R * Math.cos(yaw);
  s.yaw = yaw;
  s.vx = v * Math.cos(yaw);
  s.vz = -v * Math.sin(yaw);
  s.yawRate = w;
  s.progress = v * t;
  s.simMs = Math.round(t * 1000);
  return s;
}

describe('puppet sampling', () => {
  it('the arc extrapolation follows a constant-curvature path exactly', () => {
    const a = onCircle(0);
    const out = newPuppetPose();
    for (const dt of [0.05, 0.1, 0.25]) {
      extrapolateArc(a, dt, false, out);
      const ref = onCircle(dt);
      expect(Math.hypot(out.x - ref.x, out.z - ref.z)).toBeLessThan(1e-6);
      expect(out.yaw).toBeCloseTo(ref.yaw, 9);
      expect(out.vx).toBeCloseTo(ref.vx, 6);
      expect(out.progress).toBeCloseTo(ref.progress, 6);
    }
  });

  it('the arc degenerates to a straight line at zero yaw rate', () => {
    const s = newNetCarState();
    s.vx = 30;
    s.vz = -40;
    const out = newPuppetPose();
    extrapolateArc(s, 0.2, false, out);
    expect(out.x).toBeCloseTo(6, 9);
    expect(out.z).toBeCloseTo(-8, 9);
    extrapolateArc(s, 0.2, true, out);
    expect(out.progress).toBeCloseTo(-10, 9);
  });

  it('Hermite hits both samples and stays within centimetres of the true arc between 20 Hz samples', () => {
    const a = onCircle(1);
    const b = onCircle(1.05);
    const out = newPuppetPose();
    hermite(a, b, 1, 1.05, 1, out);
    expect(out.x).toBeCloseTo(a.x, 9);
    hermite(a, b, 1, 1.05, 1.05, out);
    expect(out.z).toBeCloseTo(b.z, 9);
    let worst = 0;
    for (let k = 1; k < 10; k++) {
      const t = 1 + 0.005 * k;
      hermite(a, b, 1, 1.05, t, out);
      const ref = onCircle(t);
      worst = Math.max(worst, Math.hypot(out.x - ref.x, out.z - ref.z));
    }
    expect(worst).toBeLessThan(0.01);
  });

  it('Hermite interpolates yaw across the ±π wrap', () => {
    const a = newNetCarState();
    const b = newNetCarState();
    a.yaw = Math.PI - 0.05;
    b.yaw = -Math.PI + 0.05;
    const out = newPuppetPose();
    hermite(a, b, 0, 0.05, 0.025, out);
    expect(Math.abs(Math.abs(out.yaw) - Math.PI)).toBeLessThan(0.01);
  });
});

describe('puppet buffer', () => {
  it('interpolates inside the buffer, extrapolates ≤ 400 ms past the newest sample, then rolls to a stop and holds as stale', () => {
    const b = createPuppetBuffer();
    expect(b.sample(0, newPuppetPose())).toBe('none');
    for (let k = 0; k <= 10; k++) b.push(onCircle(k * 0.05), k * 0.05);
    const out = newPuppetPose();
    expect(b.sample(0.225, out)).toBe('live');
    expect(Math.hypot(out.x - onCircle(0.225).x, out.z - onCircle(0.225).z)).toBeLessThan(0.01);
    expect(b.sample(0.5 + 0.2, out)).toBe('live');
    expect(Math.hypot(out.x - onCircle(0.7).x, out.z - onCircle(0.7).z)).toBeLessThan(1e-3);
    expect(b.sample(0.5 + PUPPET_MAX_EXTRAP_S, out)).toBe('live');
    expect(Math.hypot(out.x - onCircle(0.5 + PUPPET_MAX_EXTRAP_S).x, out.z - onCircle(0.5 + PUPPET_MAX_EXTRAP_S).z)).toBeLessThan(1e-3);
    // Past the horizon: no freeze at speed (stop / jump stutter) but a roll-out on the same circle, half the distance of
    // PUPPET_STOP_S at speed, then a hold.
    expect(b.sample(0.5 + PUPPET_MAX_EXTRAP_S + PUPPET_STOP_S + 0.1, out)).toBe('stale');
    const held = onCircle(0.5 + PUPPET_MAX_EXTRAP_S + PUPPET_STOP_S / 2);
    expect(Math.hypot(out.x - held.x, out.z - held.z)).toBeLessThan(1e-3);
    expect(out.vx).toBe(0);
    const later = newPuppetPose();
    b.sample(0.5 + PUPPET_MAX_EXTRAP_S + PUPPET_STOP_S + 1, later);
    expect(later.x).toBe(out.x);
  });

  it('extrapolates with the path acceleration of the two newest samples (braking zone)', () => {
    // Straight line along +x, braking at 30 m/s² from 80 m/s.
    const s = (t: number): NetCarState => {
      const v = newNetCarState();
      v.simMs = Math.round(t * 1000);
      v.x = 80 * t - 15 * t * t;
      v.vx = 80 - 30 * t;
      return v;
    };
    const b = createPuppetBuffer();
    b.push(s(0), 0);
    b.push(s(0.05), 0.05);
    const out = newPuppetPose();
    b.sample(0.3, out);
    expect(out.x).toBeCloseTo(s(0.3).x, 1); // a constant-speed arc would be 0.94 m long
    expect(out.vx).toBeCloseTo(s(0.3).vx, 1);
  });

  it('drops samples that are not newer, and keeps at most 16', () => {
    const b = createPuppetBuffer();
    expect(b.push(onCircle(0.1), 0)).toBe(true);
    expect(b.push(onCircle(0.1), 0)).toBe(false);
    expect(b.push(onCircle(0.05), 0)).toBe(false);
    for (let k = 3; k < 40; k++) b.push(onCircle(k * 0.05), k * 0.05);
    expect(b.count()).toBe(16);
    expect(b.newestT()).toBeCloseTo(39 * 0.05, 9);
  });

  it('blends a small correction out over 150 ms and snaps a large one (or a reset)', () => {
    const b = createPuppetBuffer();
    b.push(onCircle(0), 0);
    expect(b.takeSnap()).toBe(true); // first sample: placed, not blended
    b.push(onCircle(0.05), 0.05);
    const out = newPuppetPose();
    // The next sample says the car is 2 m further left than the arc predicted.
    const off = onCircle(0.1);
    off.z -= 2;
    const shownBefore = newPuppetPose();
    b.sample(0.1, shownBefore);
    b.push(off, 0.1);
    expect(b.takeSnap()).toBe(false);
    b.sample(0.1, out);
    expect(Math.hypot(out.x - shownBefore.x, out.z - shownBefore.z)).toBeLessThan(1e-6); // continuous at the correction
    b.sample(0.1 + PUPPET_BLEND_POS_S / 2, out);
    const mid = newPuppetPose();
    extrapolateArc(off, PUPPET_BLEND_POS_S / 2, false, mid);
    expect(mid.z - out.z).toBeCloseTo(-1, 1); // half the 2 m error left
    b.sample(0.1 + PUPPET_BLEND_POS_S + 0.01, out);
    extrapolateArc(off, PUPPET_BLEND_POS_S + 0.01, false, mid);
    expect(Math.hypot(out.x - mid.x, out.z - mid.z)).toBeLessThan(1e-6);

    const far = onCircle(0.15);
    far.x += 40;
    b.push(far, 0.15);
    expect(b.takeSnap()).toBe(true);
    b.sample(0.15, out);
    expect(out.x).toBeCloseTo(far.x, 6);

    const reset = onCircle(0.2);
    reset.flags = NET_FLAG_RESET;
    b.push(reset, 0.2);
    expect(b.takeSnap()).toBe(true);
  });
});
