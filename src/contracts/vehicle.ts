// Contract: vehicle parameters, inputs and state. Implemented by: Sürüş (src/physics/**).

import type { Compound, Quad, SurfaceType } from './common';
import type { TrackHint } from './track';

export interface TyreCompoundParams {
  mu: number; tOptC: number; windowC: number; wearRate: number; heatRate: number;
  slipAnglePeak: number; slipRatioPeak: number; shapeC: number; blanketC: number;
  /** [W, multiplier] pairs, linear interpolation in W. */
  wetTable: [number, number][];
}

export interface VehicleParams {
  massDryKg: number; cgHeight: number; frontWeightFrac: number; wheelbase: number; trackFront: number; trackRear: number;
  yawInertiaPerKg: number; wheelRadius: number; wheelInertiaFront: number; wheelInertiaRear: number; engineInertia: number;
  maxSteerRad: number; ackermann: number; steeringWheelRatio: number; lltdFront: number;
  ClA: number; CdA: number; aeroFrontShare: number; airDensity: number; drsDragFactor: number; drsDownforceFactor: number; drsOpenTime: number; drsCloseTime: number;
  torqueCurve: [number, number][]; engineBrakeCurve: [number, number][]; idleRpm: number; limiterRpm: number; launchRpm: number;
  gearRatios: number[]; finalDrive: number; drivetrainEff: number; upshiftTime: number; downshiftTime: number; shiftTorqueFactor: number;
  diffLockPower: number; diffLockCoast: number; brakeTorqueTotal: number; brakeBiasDefault: number;
  ers: { maxKw: number; capacityMJ: number; deployLimitMJ: number; harvestKLimitMJ: number; maxHarvestKkW: number; maxHarvestHkW: number; maxTorqueNm: number };
  rollingResistance: number; loadSensitivity: number; loadRefN: number; fuelKgPerLap: number;
  compounds: Record<Compound, TyreCompoundParams>; bodyLength: number; bodyWidth: number; teamPerf: number;
  /**
   * CR-13 / D-023 (optional until S3): physics tuning. `rearAlphaFactor`: rear tyres peak at αpk × factor
   * (also used by renderFrame for the rear slip ratio shown to graphics/audio).
   */
  tuning?: VehicleTuningParams;
  /**
   * D-037: per-track aero trim, −1..+1 (negative = low downforce / low drag, 0 or omitted = baseline). Set by createSim
   * from src/data/tracks.ts for every car on the track; Sürüş owns the mapping to ClA/CdA.
   */
  aeroTrim?: number;
}

/** CR-13 / D-023 */
export interface VehicleTuningParams { rearAlphaFactor: number }

export type ErsMode = 'none' | 'medium' | 'hotlap' | 'overtake';

export interface VehicleInput {
  throttle: number; brake: number;
  /** -1..1 (+left) × maxSteer */
  steer: number;
  /** Edges: true for exactly one tick. */
  gearUp: boolean; gearDown: boolean; drsRequest: boolean;
  /** Level (held). */
  ersOvertake: boolean;
  /** Level: limiter engaged (the input system toggles it on a key edge). */
  pitLimiter: boolean;
  ersMode: ErsMode; brakeBias: number;
}

/** Raw keyboard state latched once per sim tick by the InputManager (glue). `*Pressed` = edge since the previous tick. */
export interface DriverControls {
  throttle: boolean; brake: boolean; left: boolean; right: boolean;
  gearUpPressed: boolean; gearDownPressed: boolean; drsPressed: boolean; ersOvertakeHeld: boolean; pitLimiterPressed: boolean;
  /**
   * CR-03 player strategy inputs: persistent values (not edges) set by the glue from the MFD and latched with
   * every tick. PlayerInputSystem copies ersModeSel/brakeBias into VehicleInput ('auto' = ERS assist decides);
   * PitProcedure reads boxRequest/nextCompound for the player car.
   */
  ersModeSel: ErsMode | 'auto';
  brakeBias: number;
  boxRequest: boolean;
  nextCompound: Compound;
  /** CR-14 / D-023: settings.controls.steerSensitivity, latched by the glue every tick (scales the keyboard steer rate). */
  steerSensitivity: number;
  /**
   * Gamepad (2026-10-27): true while a gamepad drives the car; the axes below then replace the keyboard booleans in the
   * PlayerInputSystem (no keyboard ramp / shaping / brake limiter). The values are the already deadzoned and curved results
   * (the recorded inputs; raw device reads never enter the sim). steerAxis: +1 = full left (as left − right), pedals 0..1.
   */
  analog: boolean; steerAxis: number; throttleAxis: number; brakeAxis: number;
}

/**
 * Deviation from §4 (addition): persistent keyboard-filter state per car, written only by the PlayerInputSystem.
 * The filter needs the unshaped steering ramp value between ticks; VehicleInput only carries the shaped output.
 */
export interface KeyboardFilterState { steerU: number; throttle: number; brake: number }

export interface WheelState {
  omega: number; spin: number; slipRatio: number; slipAngle: number; load: number; fx: number; fy: number;
  surface: SurfaceType; inLimits: boolean; groundY: number; susp: number; brakeTempC: number; locked: boolean; hint: TrackHint;
}

export interface TyreState { wear: number; surfC: number; coreC: number; gripMul: number }

export interface VehicleState {
  x: number; y: number; z: number; yaw: number; vx: number; vz: number; yawRate: number;
  vLong: number; vLat: number; speed: number; axLong: number; ayLat: number;
  nx: number; ny: number; nz: number; pitch: number; roll: number; heave: number; steerAngle: number;
  wheels: Quad<WheelState>; tyres: Quad<TyreState>; compound: Compound; tyreAgeLaps: number;
  rpm: number; gear: number; shiftTimer: number; clutch: number; limiterHit: boolean; pitLimiterOn: boolean;
  ers: { socJ: number; deployedLapJ: number; harvestedKLapJ: number; mode: ErsMode; deployKw: number; harvestKw: number };
  drs: { open: boolean; flap: number }; fuelKg: number; massKg: number;
  /**
   * progress = lapWraps*L + s. A car that starts behind the S/F line (grid) starts with lapWraps = -1,
   * so progress < 0 until it first crosses the line.
   */
  hint: TrackHint; s: number; d: number; lapWraps: number;
  offTrackWheels: number; wallImpulse: number; carImpulse: number; sparks: number; slipstream: number; dirtyAir: number; resetCount: number;
  /** CR-13 / D-023 (optional until S3): physics auxiliary state, written only by the physics systems. */
  aux?: VehicleAuxState;
}

/** CR-13 / D-023 */
export interface VehicleAuxState {
  /** s left in the post-reset non-colliding window. */
  ghostT: number;
  /** s the car has been slower than 2 km/h off track (recovery trigger). */
  stuckT: number;
  /** Per-wheel s since the last `kerb` event. */
  kerbT: Quad<number>;
  /** Turbo spool 0..1. */
  spool: number;
  /** Filtered longitudinal / lateral acceleration for load transfer, m/s². */
  axF: number;
  ayF: number;
  /** Per-wheel slip energy (J) since the last thermal update. */
  heatJ: Quad<number>;
}
