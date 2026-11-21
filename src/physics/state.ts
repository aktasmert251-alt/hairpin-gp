// initVehicleState + the physics-private auxiliary state (sim layer).
//
// `aux` (D-023, `VehicleState.aux`) is the plain-data auxiliary state owned by the physics systems
// (VehicleSystem and CollisionSystem). It lives in SimState so snapshots, flashback and hashing include it; it is
// optional in the contract until L12, so it is read through `aux()`.

import type { Compound } from '../contracts/common';
import { yawFromDir } from '../contracts/frames';
import type { TrackBundle, TrackFrame } from '../contracts/track';
import type { TyreState, VehicleAuxState, VehicleParams, VehicleState, WheelState } from '../contracts/vehicle';
import { G } from './constants';

export function newAux(): VehicleAuxState {
  return { ghostT: 0, stuckT: 0, kerbT: [1, 1, 1, 1], spool: 0, axF: 0, ayF: 0, heatJ: [0, 0, 0, 0] };
}

/** The physics auxiliary state of a vehicle (attached once if a foreign builder created the object). */
export function aux(v: VehicleState): VehicleAuxState {
  return v.aux ?? (v.aux = newAux());
}

function wheel(s: number, load: number): WheelState {
  return {
    omega: 0, spin: 0, slipRatio: 0, slipAngle: 0, load, fx: 0, fy: 0, surface: 'asphalt', inLimits: true, groundY: 0, susp: 0,
    brakeTempC: 300, locked: false, hint: { s, ribbon: 'main', sp: NaN },
  };
}

function tyre(tempC: number): TyreState {
  return { wear: 0, surfC: tempC, coreC: tempC, gripMul: 1 };
}

/** A car at rest on a slot (s, d) of the main ribbon, aligned with the driving direction; tyres at blanket temperature. */
export function initVehicleState(p: VehicleParams, t: TrackBundle, slot: { s: number; d: number }, c: Compound): VehicleState {
  const q = t.query;
  const frame: TrackFrame = {
    s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0,
    crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0,
  };
  q.frameAt(slot.s, frame);
  const pos = q.worldFromSD(slot.s, slot.d, { x: 0, y: 0, z: 0 });
  const s = q.wrapS(slot.s);
  const blanket = p.compounds[c].blanketC;
  const L = p.wheelbase;
  const a = L * (1 - p.frontWeightFrac);
  const b = L - a;
  const mg = p.massDryKg * G;
  const fl = (mg * b) / L / 2;
  const rl = (mg * a) / L / 2;
  const v: VehicleState = {
    x: pos.x, y: pos.y, z: pos.z, yaw: yawFromDir(frame.tx, frame.tz), vx: 0, vz: 0, yawRate: 0,
    vLong: 0, vLat: 0, speed: 0, axLong: 0, ayLat: 0,
    nx: 0, ny: 1, nz: 0, pitch: 0, roll: 0, heave: 0, steerAngle: 0,
    wheels: [wheel(s, fl), wheel(s, fl), wheel(s, rl), wheel(s, rl)],
    tyres: [tyre(blanket), tyre(blanket), tyre(blanket), tyre(blanket)],
    compound: c,
    tyreAgeLaps: 0,
    rpm: p.idleRpm, gear: 1, shiftTimer: 0, clutch: 0, limiterHit: false, pitLimiterOn: false,
    ers: { socJ: p.ers.capacityMJ * 1e6, deployedLapJ: 0, harvestedKLapJ: 0, mode: 'medium', deployKw: 0, harvestKw: 0 },
    drs: { open: false, flap: 0 },
    fuelKg: 0,
    massKg: p.massDryKg,
    hint: { s, ribbon: 'main', sp: NaN },
    s,
    d: slot.d,
    // Behind the S/F line (grid): progress < 0 until the first crossing.
    lapWraps: s > q.length / 2 ? -1 : 0,
    offTrackWheels: 0, wallImpulse: 0, carImpulse: 0, sparks: 0, slipstream: 0, dirtyAir: 0, resetCount: 0,
    aux: newAux(),
  };
  return v;
}
