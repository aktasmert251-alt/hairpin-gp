// Trailer shot list (media/trailer/BEATMAP.md). Pure data: film time -> clip, replay time, focus car, camera.
// Replay times and car ids come from the deterministic recordings in clips.ts (found with probe scripts, see
// media/trailer/BEATMAP.md); change a clip's seed and these numbers must be re-derived.

import type { ClipId } from './clips';

/** A world point: relative to a car's pose at replay time `at` (fwd / left / up in m), or to the track (s, d, h). */
export type Anchor =
  | { car: number; at: number; fwd: number; left: number; up: number }
  | { s: number; d: number; h: number };

export type Ease = 'io' | 'out' | 'lin';

export type Cam =
  /** Camera moves from `from` to `to` (eased) and aims at the focus car (aimUp above its origin) or a fixed point. */
  | { k: 'fixed'; from: Anchor; to?: Anchor; ease?: Ease; look: 'car' | Anchor; lookTo?: Anchor; fov: number; fovTo?: number; lag?: number; aimUp?: number; roll?: number }
  /** Follows the focus car from behind; its position trails the car by `lag` s (natural chase lag). */
  | { k: 'chase'; back: number; up: number; side: number; aim: number; aimLeft?: number; fov: number; lag: number; backTo?: number }
  /** The game's own on-board camera (CameraRig view). */
  | { k: 'onboard'; view: 'tcam' | 'cockpit' };

export interface Shot {
  id: string;
  t0: number;
  t1: number;
  clip: ClipId;
  /** Replay time at t0; replay time = rt0 + (t - t0) * rate. */
  rt0: number;
  rate: number;
  car: number;
  cam: Cam;
}

/** Film length (s). */
export const DURATION = 30;
/** End card starts here; the last game shot fades into it. */
export const END_T = 26;
/** Music: 120 BPM, drop (lights out) at 8.0 s. */
export const BPM = 120;
export const DROP_T = 8;
/** start clip: lights out at replay 7.5000 s (first frame with lights.out) -> film 8.0 s. */
const START_OFF = 7.5 - DROP_T;
/** S11: long lens from the end of the waterfront straight, the pack coming head-on with the bridge behind it. */
const HERO_END: Anchor = { s: 4762, d: -4.6, h: 5 };
const HERO: Cam = { k: 'fixed', from: { s: 4760, d: -5, h: 1.5 }, to: HERO_END, ease: 'io', look: { s: 4300, d: 0, h: 9 }, lookTo: { s: 4300, d: 0, h: 5 }, fov: 15, fovTo: 19 };

export const SHOTS: Shot[] = [
  // S1 hook: night street circuit, bridge lit behind; the leader comes at ~280 km/h through a static low frame.
  { id: 'S1', t0: 0, t1: 2, clip: 'night', rt0: 57.65, rate: 1, car: 15,
    cam: { k: 'fixed', from: { car: 15, at: 58.45, fwd: 6, left: -8, up: 1.0 }, to: { car: 15, at: 58.45, fwd: 4, left: -8, up: 0.9 }, ease: 'lin',
      look: { car: 15, at: 58.45, fwd: -26, left: 3.5, up: 1.2 }, lookTo: { car: 15, at: 58.45, fwd: -24, left: 4.5, up: 1.1 }, fov: 50, fovTo: 52 } },
  // S2 grid: the field on the grid, lamps 1-3 come on (film 3.5, 4.5).
  { id: 'S2', t0: 2, t1: 5, clip: 'start', rt0: 2 + START_OFF, rate: 1, car: 9,
    cam: { k: 'fixed', from: { s: 5326, d: -12.5, h: 2.2 }, to: { s: 5318, d: -12, h: 1.9 }, ease: 'lin', look: { s: 5200, d: 1, h: 0.4 }, fov: 30, fovTo: 27 } },
  // S3 gantry: long lens up at the start lamps over the front row; lamps 3-5, lights OUT on the drop (8.0), launch.
  { id: 'S3', t0: 5, t1: 8.5, clip: 'start', rt0: 5 + START_OFF, rate: 1, car: 9,
    cam: { k: 'fixed', from: { s: 5265, d: 2.5, h: 1.3 }, to: { s: 5268, d: 2.5, h: 1.25 }, ease: 'lin', look: { s: 0, d: 0, h: 6.2 }, fov: 24, fovTo: 21 } },
  // S4: jump ahead to the field braking into turn 1, high behind the pole car (13).
  { id: 'S4', t0: 8.5, t1: 10, clip: 'start', rt0: 12.4, rate: 1, car: 13,
    cam: { k: 'chase', back: 17, up: 7.5, side: 3, aim: 16, fov: 46, lag: 0.2, backTo: 14 } },
  // S5 on board: the player car's T-cam in the pack.
  { id: 'S5', t0: 10, t1: 12, clip: 'start', rt0: 14.4, rate: 1, car: 0, cam: { k: 'onboard', view: 'tcam' } },
  // S6 sunset: a train of six (7, 10, 2, 12, 0, 11) braking from ~240 km/h for the right-left at 1,820 m, long lens.
  { id: 'S6', t0: 12, t1: 14, clip: 'sunset', rt0: 24.2, rate: 1, car: 12,
    cam: { k: 'fixed', from: { s: 1812, d: 17, h: 1.4 }, look: 'car', fov: 13, fovTo: 17, aimUp: 0.5 } },
  // S7 on board car 1 (T-cam), sunset: in car 15's slipstream at ~270 km/h, pulls out and blasts past as 15 brakes
  // for the kink at 1,150-1,200 m (position event 21.38 replay s -> film 15.48).
  { id: 'S7', t0: 14, t1: 16, clip: 'sunset', rt0: 19.9, rate: 1, car: 1, cam: { k: 'onboard', view: 'tcam' } },
  // S8 day, low at the track edge at 822 m (1.5-2 m from the racing line, which runs at d -5..-6 here), aimed up the
  // straight, zooming out: car 13 is ~40 m out on the first frame; 13, 6, 5 and 16 blast past within the 2 s.
  { id: 'S8', t0: 16, t1: 18, clip: 'start', rt0: 24.45, rate: 1, car: 13,
    cam: { k: 'fixed', from: { s: 822, d: -7.7, h: 0.4 }, to: { s: 821, d: -7.7, h: 0.45 }, ease: 'out', look: { s: 745, d: -4, h: 4.6 }, lookTo: { s: 755, d: -4.5, h: 4.0 }, fov: 24, fovTo: 36 } },
  // S9 rain: low chase behind car 0 in car 18's spray, accelerating onto the straight after 1,400 m, heavy rain.
  { id: 'S9', t0: 18, t1: 20, clip: 'rain', rt0: 21.0, rate: 1, car: 0,
    cam: { k: 'chase', back: 4.6, up: 0.9, side: 1.1, aim: 10, aimLeft: 1.5, fov: 62, lag: 0.015 } },
  // S10 pit stop: the player car stops in its box (stationary 83.28 s), crew around it.
  { id: 'S10', t0: 20, t1: 22, clip: 'night', rt0: 82.3, rate: 1, car: 0,
    cam: { k: 'fixed', from: { car: 0, at: 84.1, fwd: 7, left: -5, up: 1.6 }, to: { car: 0, at: 84.1, fwd: 6, left: -4.4, up: 1.5 }, ease: 'lin', look: { car: 0, at: 84.1, fwd: 0, left: 0, up: 0.5 }, fov: 45 } },
  // S11 hero: the waterfront at night, a rising camera; the train 10-2-11 comes head-on past the player car slowing
  // for the pit entry and sweeps past the lens just before the end card.
  { id: 'S11', t0: 22, t1: 26, clip: 'night', rt0: 69.15, rate: 1, car: 10, cam: HERO },
  // End card background: hold the last frame of the hero shot (it fades to ink).
  { id: 'END', t0: 26, t1: 30, clip: 'night', rt0: 73.15, rate: 0.15, car: 10,
    cam: { k: 'fixed', from: HERO_END, look: { s: 4300, d: 0, h: 5 }, fov: 19 } },
];

/** Hard cuts (sub-frame blending never mixes the two sides). */
export const CUTS: number[] = SHOTS.slice(1).map((s) => s.t0);

export function shotAt(t: number): Shot {
  for (let i = SHOTS.length - 1; i >= 0; i--) if (t >= SHOTS[i]!.t0) return SHOTS[i]!;
  return SHOTS[0]!;
}
