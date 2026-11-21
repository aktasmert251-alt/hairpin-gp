// PlayerInputSystem (ARCHITECTURE §4.1 row 2): turns the latched DriverControls of every player-controlled car
// into VehicleInput through the §5.7 keyboard filter and the driver-side assists (§5.8). Writes only car.input
// and car.kb of cars whose control is 'player' (skipped under autodrive / pit-auto). Sim layer, allocation-free.

import type { SpeedProfile } from '../../contracts/ai';
import type { SimCarState, SimSystem, SimWorld } from '../../contracts/sim';
import type { DriverControls, ErsMode } from '../../contracts/vehicle';
import { airDensity } from '../constants';
import { brakingAssist, counterSteer, frontSlipWindow, frontWindowK } from '../assists/driverAssists';
import { ABS_TARGET, absTarget } from '../assists/wheelAssists';
import { tuning } from '../params';
import { wetGrip, wetGripFor } from '../tyre/grip';
import { brakeLockPedal, lateralLimit, MU_EST, steerLimit } from '../vehicle/estimates';
import { brakeLimiterScale, filterBrake, filterSteer, filterThrottle, shapeSteer } from './keyboardFilter';

/** D-023: DriverControls.steerSensitivity (settings.controls.steerSensitivity, 0.5–1.5) scales the steer ramp rate;
 * NaN or an out-of-range value falls back to 1. */
function sensitivityOf(c: DriverControls): number {
  const s = c.steerSensitivity;
  return s > 0.2 && s < 3 ? s : 1;
}

function ersModeOf(c: DriverControls): ErsMode {
  if (c.ersOvertakeHeld) return 'overtake';
  const sel = c.ersModeSel;
  // 'auto' (ERS assist) and a missing value (older glue) both mean the medium deploy strategy.
  return sel === 'none' || sel === 'hotlap' || sel === 'overtake' || sel === 'medium' ? sel : 'medium';
}

/** D-051 #3: keyboard brake cap while steering = lock pedal × (TOP − K × steer use 0..1), above a small steer use. */
const KB_TRAIL_TOP = 1.0;
// 0.25 since 2026-10-23 (was 0.5): with ESC-lite, the yaw limiter and the braking front window doing the turning work, the
// full 0.5 cut only cost braking (brake + full lock 62–65 % of the straight-line deceleration, read as "brake not
// registered"); 0.25 keeps the same yaw rate and gives 66–71 %. The rest is the tyre friction circle.
const TRAIL_K = 0.25;
const TRAIL_STEER_MIN = 0.05;
/** Lock guard (no ABS): slip-ratio threshold as a multiple of the compound's peak, and the pedal release rate (1/s). */
const LOCK_GUARD = 1.1;
const LOCK_GUARD_DROP = 40;
/** Surfaces below this μ count as loose for the steering assist (grass 0.55, gravel 0.45; astroturf 0.8 does not). */
const LOOSE_MU = 0.7;

/** Yaw limiter: allowed yaw rate as a multiple of the friction-limit yaw rate aLat/v, and the gain (rad of lock per rad/s). */
const YAW_MARGIN = 1.1;
const YAW_GAIN = 0.25;
/** Counter-steer gain while the steer key is still ramping in (normal turn-in). */
const CS_RAMP_GAIN = 0.3;
/** Opposite lock against the held key is allowed past this body slip (rad): a genuine slide to catch. */
const BIG_SLIDE_BETA = 10 * (Math.PI / 180);
/** Gamepad (2026-10-27): slew limit of the analog steer value (1/s; centre to full lock in 0.1 s) against 60 Hz pad steps. */
export const PAD_STEER_SLEW = 10;

function bigSlide(v: SimCarState['vehicle']): boolean {
  if (v.speed < 5) return false;
  const beta = Math.atan2(v.vLat, v.vLong > 0.1 ? v.vLong : 0.1);
  return (beta > 0 ? beta : -beta) >= BIG_SLIDE_BETA;
}

export function createPlayerInputSystem(): SimSystem {
  const win = new Float64Array(2);
  const stepCar = (world: SimWorld, car: SimCarState, dt: number): void => {
    const cfg = world.static.config;
    const assists = cfg.assists;
    const cond = world.state.conditions;
    const q = world.static.track.query;
    const p = world.static.params[car.id]!;
    const c = car.controls;
    const kb = car.kb;
    const inp = car.input;
    const v = car.vehicle;
    const speed = v.speed;
    const rho = airDensity(p.airDensity, cond.airC);
    const comp = p.compounds[v.compound];
    const wet = cond.wetness;

    // ---- Steering (§5.7) + steering assist counter-steer (§5.8) ----
    const u0 = kb.steerU;
    // Gamepad: the already shaped stick value (only slew-limited); the keyboard ramp and |u|^1.4 shaping are keyboard-only.
    const analog = c.analog;
    let u: number;
    if (analog) {
      const target = c.steerAxis > 1 ? 1 : c.steerAxis < -1 ? -1 : c.steerAxis;
      const step = PAD_STEER_SLEW * dt;
      u = target > u0 + step ? u0 + step : target < u0 - step ? u0 - step : target;
      kb.steerU = u;
    } else u = filterSteer(kb, c.left, c.right, speed, sensitivityOf(c), dt);
    const shaped = analog ? u : shapeSteer(u);
    const dMax = steerLimit(p, v.compound, wet, speed, v.massKg, rho, assists.steering);
    let delta = shaped * dMax;
    if (assists.steering) {
      // Key ramping in (|u| still growing) = ordinary turn-in: the counter-steer only acts at a reduced gain then.
      const rampIn = (u > 0 ? u : -u) > (u0 > 0 ? u0 : -u0) + 1e-9;
      // Loose surface under the rear (2026-10-17 user request): gravel/grass under one rear wheel loosens the rear a little
      // (0.25: it steps out ~31° at 120 km/h with the throttle held and comes back), under both fully (1): the stability
      // shrink fades out with it and the counter-steer halves, so the car slides and scrubs instead of staying planted. With
      // any rear wheel loose the 2026-10-19 turn-in helpers (reduced counter-steer while the key ramps, yaw limiter, no
      // opposite lock against the key) stand aside: there the slide is wanted, and the catch must come freely. Fronts off =
      // the car just scrubs (the low μ does that by itself), so only the rear axle counts.
      let looseRear = 0;
      for (let i = 2; i < 4; i++) if (q.surfaceProps(v.wheels[i]!.surface).mu < LOOSE_MU) looseRear++;
      const rearLoose = looseRear === 0 ? 0 : looseRear === 1 ? 0.25 : 1;
      delta -= counterSteer(p, v) * (1 - 0.5 * rearLoose) * (rampIn && rearLoose === 0 ? CS_RAMP_GAIN : 1);
      // Keep the fronts at ≤ 0.9·αpk of their actual velocity direction (only once moving; less in a wet rear slide).
      if (speed > 8) {
        frontSlipWindow(p, v, frontWindowK(p, v, wet, rearLoose), win);
        if (delta > win[1]!) delta = win[1]!;
        else if (delta < win[0]!) delta = win[0]!;
      }
      // Yaw limiter (2026-10-19): a held key overshoots the yaw rate the tyres can hold (r = aLat/v) on turn-in, and the
      // rear then steps out. Past YAW_MARGIN × that rate in the key's direction, the lock is taken back proportionally.
      if (u !== 0 && speed > 8 && rearLoose === 0) {
        const rLim = (YAW_MARGIN * lateralLimit(p, MU_EST * wetGripFor(p, v.compound, wet), speed, v.massKg, rho)) / speed;
        const r = u > 0 ? v.yawRate : -v.yawRate;
        if (r > rLim) delta -= (u > 0 ? 1 : -1) * YAW_GAIN * (r - rLim);
      }
      // 2026-10-19 user report: the front wheels turned AGAINST the held corner key. While a key is held the assist may
      // take the lock back to straight, but opposite lock only in a genuine big slide (body slip > 10°).
      // On a loose rear (gravel/grass) the slide is meant to happen, so the catch is not held back there.
      if (u !== 0 && delta * u < 0 && rearLoose === 0 && !bigSlide(v)) delta = 0;
    }
    let steer = delta / p.maxSteerRad;
    steer = steer < -1 ? -1 : steer > 1 ? 1 : steer;
    inp.steer = steer;

    // ---- Pedals (§5.7) ----
    // Gamepad pedals are analog already: no keyboard ramps (kb keeps them so a device switch is continuous).
    let thr: number;
    let brk: number;
    if (analog) {
      thr = c.throttleAxis > 1 ? 1 : c.throttleAxis > 0 ? c.throttleAxis : 0;
      brk = c.brakeAxis > 1 ? 1 : c.brakeAxis > 0 ? c.brakeAxis : 0;
      kb.throttle = thr;
      kb.brake = brk;
    } else {
      thr = filterThrottle(kb, c.throttle, dt);
      brk = filterBrake(kb, c.brake, dt);
    }
    const bias = c.brakeBias >= 0.5 && c.brakeBias <= 0.7 ? c.brakeBias : p.brakeBiasDefault;
    // D-049: in R the brake key is the reverse pedal (the VehicleSystem swaps them), so no brake limiter or braking assist.
    const inR = v.gear < 0;
    const steerUse = shaped < 0 ? -shaped : shaped;
    let lockPedal = 0;
    // The keyboard brake limiter, its trail-braking cap and the lock guard exist because a key cannot be modulated: an
    // analog trigger can, so they stay off for it (ABS, TC and the braking assist still apply as configured).
    if (assists.kbBrakeLimiter && brk > 0 && !inR && !analog) {
      let surf = 0;
      let grip = 0;
      for (let i = 0; i < 4; i++) {
        surf += q.surfaceProps(v.wheels[i]!.surface).mu;
        grip += v.tyres[i]!.gripMul;
      }
      const muBase = comp.mu * wetGrip(comp, wet) * surf * 0.25 * grip * 0.25;
      lockPedal = brakeLockPedal(p, muBase, speed, v.massKg, rho, bias);
      brk *= brakeLimiterScale(lockPedal);
    }
    // Braking assist (uses the player's SpeedProfile).
    if (assists.braking !== 'off' && !inR) {
      let prof: SpeedProfile | null = null;
      try {
        prof = world.static.ai.getProfile(car.id);
      } catch {
        prof = null;
      }
      const ab = brakingAssist(assists.braking, prof, v.s, speed, q.length);
      if (ab > brk) brk = ab;
      if (assists.braking === 'high' && ab > 0) thr = thr * (1 - (ab * 2 < 1 ? ab * 2 : 1));
    }
    // D-051 #3 trail braking: the keyboard brake limiter holds a binary brake key at 1.05 × the lock threshold, which
    // leaves the fronts little lateral grip. While a steer key is held it is capped lower in proportion to the steering used
    // (friction circle), so braking into a corner still turns the car.
    if (lockPedal > 0 && steerUse > TRAIL_STEER_MIN) {
      const cap = lockPedal * (KB_TRAIL_TOP - TRAIL_K * (steerUse > 1 ? 1 : steerUse));
      if (brk > cap) brk = cap > 0 ? cap : 0;
    }
    // Keyboard lock guard (no ABS: Expert or a custom set). A binary brake key cannot be modulated, so once any wheel slips
    // past 1.1 × the peak slip ratio (less while cornering, as the ABS target) the pedal eases off at 40/s (faster than the 8/s press ramp) and re-applies as the wheel
    // recovers, like a driver's foot. Coarser than ABS (one pedal for four wheels, reacting after the slip): trail braking
    // still costs grip and a stab can flash-lock for a moment, but a held key no longer locks the wheels.
    if (!assists.abs && !inR && brk > 0 && !analog) {
      const tanF = Math.tan(comp.slipAnglePeak);
      const tanR = Math.tan(comp.slipAnglePeak * tuning(p).rearAlphaFactor);
      let slipping = false;
      for (let i = 0; i < 4; i++) {
        const w = v.wheels[i]!;
        const rear = i >= 2;
        // Same combined-slip shape as the ABS target: a cornering tyre gets a smaller slip-ratio allowance.
        const f = absTarget(Math.tan(w.slipAngle), rear ? tanR : tanF, rear) / ABS_TARGET;
        if (w.slipRatio < -LOCK_GUARD * comp.slipRatioPeak * f) slipping = true;
      }
      if (slipping && speed > 3) {
        const eased = (brk < kb.brake ? brk : kb.brake) - LOCK_GUARD_DROP * dt;
        kb.brake = eased > 0 ? eased : 0;
        if (brk > kb.brake) brk = kb.brake;
      }
    }
    inp.throttle = thr;
    inp.brake = brk;
    inp.brakeBias = bias;

    // ---- Discrete controls ----
    inp.gearUp = c.gearUpPressed;
    inp.gearDown = c.gearDownPressed;
    inp.drsRequest = c.drsPressed || (assists.drs && car.race.drsZone >= 0 && brk < 0.05);
    inp.ersOvertake = c.ersOvertakeHeld;
    inp.ersMode = ersModeOf(c);
    if (c.pitLimiterPressed) inp.pitLimiter = !inp.pitLimiter;
  };

  return {
    name: 'playerInput',
    step(world, dt) {
      const cars = world.state.cars;
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i]!;
        if (car.control === 'player') stepCar(world, car, dt);
      }
    },
  };
}
