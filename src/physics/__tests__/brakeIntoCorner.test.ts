// User report 2026-10-19 (default Intermediate): braking into a corner the rear still slides out AND the front wheels turn
// the OPPOSITE way while the corner key is held. Open loop with the real keyboard filter (no self-correcting bot): from
// 220/250/300 km/h the brake key goes down, 0.2–0.4 s later one steer key is held (brake still held, or released
// progressively). On the flat plane and from the braking zones of İstanbul T1/T12 and Lombardia T1 (corner direction key).
// On Beginner/Intermediate: the steer never goes against the held key (while β < 10°), the rear slip angle stays ≲ 1.1 ×
// its peak, body slip β ≤ 6°, the car turns (yaw ≥ 70 % of the steer-only case) and the braking is not given away.

import { describe, expect, it } from 'vitest';
import { MODULE_STATUS as TRACK_STATUS } from '../../track/index';
import { fmt, run } from './helpers/brakeIntoCorner';
import { createFlatPlane } from './helpers/flatPlane';

describe('braking into a corner with a held steer key (user report 2026-10-19)', () => {
  it.each(['beginner', 'intermediate'] as const)('%s, flat plane: steer follows the key, rear stays in, the car turns', (preset) => {
    const track = createFlatPlane();
    for (const kmh of [220, 250, 300]) {
      const steerOnly = run(preset, kmh, 0.3, 'none', true, { track });
      const brakeOnly = run(preset, kmh, 10, 'hold', true, { track });
      for (const delay of [0.2, 0.4]) {
        for (const pedal of ['hold', 'release'] as const) {
          const r = run(preset, kmh, delay, pedal, true, { track });
          console.log(`${preset} flat ${kmh} ${delay}s ${pedal}: ${fmt(r)} | steer-only yaw ${steerOnly.yaw.toFixed(2)} brake-only dist60 ${brakeOnly.dist.toFixed(1)}`);
          expect(r.wrongS).toBe(0);
          expect(r.rearPk).toBeLessThan(1.1);
          expect(r.beta).toBeLessThan(6);
          expect(r.yaw).toBeGreaterThan(0.7 * steerOnly.yaw);
          // Steering costs braking (friction circle); before the fix the 60 % speed point came 1.6× later than braking straight.
          if (pedal === 'hold') expect(r.dist).toBeLessThan(1.5 * brakeOnly.dist);
        }
      }
    }
  }, 300_000);

  it.skipIf(TRACK_STATUS === 'stub').each([['istanbul', 1], ['istanbul', 12], ['lombardia', 1]] as const)(
    'intermediate, %s T%i braking zone: steer follows the key, rear stays in',
    (trackId, corner) => {
      for (const kmh of [250, 300]) {
        for (const pedal of ['hold', 'release'] as const) {
          const r = run('intermediate', kmh, 0.3, pedal, true, { trackId, corner });
          console.log(`intermediate ${trackId} T${corner} ${kmh} ${pedal}: ${fmt(r)}`);
          expect(r.wrongS).toBe(0);
          expect(r.rearPk).toBeLessThan(1.1);
          expect(r.beta).toBeLessThan(6);
        }
      }
    },
    300_000,
  );
});
