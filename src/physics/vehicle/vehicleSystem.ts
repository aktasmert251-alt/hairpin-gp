// VehicleSystem (ARCHITECTURE §4.1 row 4; planner-report §5.1–§5.6, §5.10). Writes car.vehicle only.
// 2.5D: planar body (x, z, yaw, vx, vz, r) + 4 wheel spins; quasi-static load transfer from filtered
// accelerations; combined-slip tyres; wheel spin in 4 implicit substeps (960 Hz); drivetrain with diff and
// auto-clutch; ERS/DRS/limiter; semi-implicit Euler. 60 Hz tasks: tyre thermal/wear, slipstream, sparks.
// Sim layer: no three, no DOM, no Math.random; step() allocates nothing (events aside).

import type { SimCarState, SimSystem, SimWorld } from '../../contracts/sim';
import type { GroundHit, TrackFrame } from '../../contracts/track';
import type { VehicleParams } from '../../contracts/vehicle';
import { wrapAngle } from '../../contracts/frames';
import { airDensity, G, PIT_LIMIT_MS, RPM_PER_RADS, SLOW_EVERY, WHEEL_SUBSTEPS } from '../constants';
import { updateSlipstream } from '../aero/slipstream';
import { AI_ASSISTS, absBrakeTorque, absCoastTorque, tcDriveTorque, TC_TARGET } from '../assists/wheelAssists';
import { chooseGear, engineTorque, ersDeploys, overallRatio, REVERSE_MAX_MS, REVERSE_THROTTLE, reverseGear, rpmAtWheel } from '../powertrain/powertrain';
import { aeroCdA, aeroClA, tuning } from '../params';
import { aux } from '../state';
import { loadSens, localWetness, tyreForce, wetGrip, type TyreForceOut } from '../tyre/grip';
import { stepTyre } from '../tyre/thermal';

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;
/** Relaxation length of the slip angle (m). */
const RELAX_LEN = 0.3;
/** Low-speed floors for κ and α (§5.10). */
const KAPPA_FLOOR = 3;
const ALPHA_FLOOR = 1;
/** Lateral-force cap factor: |Fy| ≤ LAT_CAP·m·|v_y|/dt keeps the low-speed contact from overshooting. */
const LAT_CAP = 0.125;
const CLUTCH_RAMP_S = 0.6;
/** ESC-lite (assisted presets): rear lateral slip share where the brake starts to move forward, span to full, max share moved. */
const ESC_ON = 0.6;
const ESC_SPAN = 0.4;
const ESC_SHIFT = 0.8;
const LOAD_FILTER_TAU = 0.05;
const SUSP_RATE = 1 / 180_000; // m per N
const BRAKE_HEAT_CAP = 1500; // J/K per disc
const KERB_EVENT_GAP = 0.15;
/** D-040: a wet contact patch is less peaky; the force lost past the peak slip is × (1 − this·W_local). */
const WET_SLIDE_SOFTEN = 0.6;

function finite(n: number): boolean {
  return n === n && n !== Infinity && n !== -Infinity;
}

export function createVehicleSystem(): SimSystem {
  const hit: GroundHit = { y: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt', ribbon: 'main', s: 0, d: 0, sp: NaN, inLimits: true, wetLocal: 1 };
  const frame: TrackFrame = {
    s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0,
  };
  const tf: TyreForceOut = { fx: 0, fy: 0, sigma: 0, dfxdk: 0 };
  // Per-wheel scratch (reused for every car).
  const posF = new Float64Array(4);
  const posL = new Float64Array(4);
  const cosD = new Float64Array(4);
  const sinD = new Float64Array(4);
  const vix = new Float64Array(4);
  const viy = new Float64Array(4);
  const tanA = new Float64Array(4);
  const peak = new Float64Array(4);
  const fz = new Float64Array(4);
  const inert = new Float64Array(4);
  const tBrake = new Float64Array(4);
  const tRoll = new Float64Array(4);
  const fxAcc = new Float64Array(4);
  const fyAcc = new Float64Array(4);
  const powAcc = new Float64Array(4);
  const tDrive = new Float64Array(4);
  const kappaW = new Float64Array(4);
  const prevKerb = new Uint8Array(4);
  const wetW = new Float64Array(4);
  const dropW = new Float64Array(4);
  const wetLoc = new Float64Array(4);

  const stepCar = (world: SimWorld, car: SimCarState, p: VehicleParams, dt: number, slow: boolean): void => {
    const st = world.state;
    const q = world.static.track.query;
    const cfg = world.static.config;
    const cond = st.conditions;
    const v = car.vehicle;
    const inp = car.input;
    const x = aux(v);
    const L = p.wheelbase;
    const a = L * (1 - p.frontWeightFrac);
    const b = L - a;
    const h = p.cgHeight;
    const R = p.wheelRadius;
    const m = v.massKg;
    const comp = p.compounds[v.compound];
    const kpk = comp.slipRatioPeak;
    const tanApkF = Math.tan(comp.slipAnglePeak);
    const tanApkR = Math.tan(comp.slipAnglePeak * tuning(p).rearAlphaFactor);
    const shapeC = comp.shapeC;
    const rho = airDensity(p.airDensity, cond.airC);
    const isPlayer = car.control === 'player';
    const assists = cfg.assists;
    const absOn = isPlayer ? assists.abs : AI_ASSISTS.abs;
    const tcTarget = isPlayer ? TC_TARGET[assists.tc] : TC_TARGET[AI_ASSISTS.tc];
    const autoBox = isPlayer ? assists.gearbox === 'auto' : AI_ASSISTS.auto;
    const phase = st.race.phase;
    const length = q.length;

    // ---- 1. Ground query under the 4 wheels and the centre ----
    let yaw = v.yaw;
    let cy = Math.cos(yaw);
    let sy = Math.sin(yaw);
    let fwx = cy, fwz = -sy, lfx = -sy, lfz = -cy;
    posF[0] = a; posL[0] = p.trackFront * 0.5;
    posF[1] = a; posL[1] = -p.trackFront * 0.5;
    posF[2] = -b; posL[2] = p.trackRear * 0.5;
    posF[3] = -b; posL[3] = -p.trackRear * 0.5;
    let groundSum = 0;
    let off = 0;
    let dragDecel = 0;
    let sausage = false;
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i]!;
      const wasKerb = w.surface === 'kerbFlat' || w.surface === 'kerbSausage';
      prevKerb[i] = wasKerb ? 1 : 0;
      q.ground(v.x + fwx * posF[i]! + lfx * posL[i]!, v.z + fwz * posF[i]! + lfz * posL[i]!, w.hint, hit);
      w.surface = hit.surface;
      w.inLimits = hit.inLimits;
      w.groundY = hit.y;
      wetW[i] = hit.wetLocal;
      groundSum += hit.y;
      if (!hit.inLimits) off++;
      const sp = q.surfaceProps(hit.surface);
      dragDecel += sp.dragDecel * 0.25;
      if (hit.surface === 'kerbSausage') sausage = true;
    }
    v.offTrackWheels = off;
    const prevS = v.s;
    q.ground(v.x, v.z, v.hint, hit);
    v.s = hit.s;
    v.d = hit.d;
    v.nx = hit.nx;
    v.ny = hit.ny;
    v.nz = hit.nz;
    if (prevS === prevS) {
      const jump = v.s - prevS;
      if (jump < -length / 2) {
        v.lapWraps++;
        v.tyreAgeLaps++;
        v.ers.deployedLapJ = 0;
        v.ers.harvestedKLapJ = 0;
      } else if (jump > length / 2) v.lapWraps--;
    }
    q.frameAt(v.s, frame);
    const kv = frame.vCurvature;

    // ---- 2. Body velocities ----
    let vLong = v.vx * fwx + v.vz * fwz;
    let vLat = v.vx * lfx + v.vz * lfz;
    let speed = Math.sqrt(v.vx * v.vx + v.vz * v.vz);

    // ---- Driver inputs ----
    const thrIn = inp.throttle < 0 ? 0 : inp.throttle > 1 ? 1 : inp.throttle;
    const brkIn = inp.brake < 0 ? 0 : inp.brake > 1 ? 1 : inp.brake;
    // D-049: in R (swapped below, once this tick's gear is known) the brake pedal drives backwards and the throttle brakes.
    let thr = thrIn;
    let brk = brkIn;
    v.pitLimiterOn = inp.pitLimiter;
    if (v.pitLimiterOn) {
      const lim = (PIT_LIMIT_MS - speed) * 0.6;
      if (thr > lim) thr = lim < 0 ? 0 : lim;
    }
    const bias = inp.brakeBias >= 0.5 && inp.brakeBias <= 0.7 ? inp.brakeBias : p.brakeBiasDefault;
    const preStart = phase === 'grid' || phase === 'lights';

    // ---- Gear (start of tick); D-040 reverse for player cars, and for AI cars in stuck recovery (D-051 #4) ----
    const rearOmega0 = 0.5 * (v.wheels[2].omega + v.wheels[3].omega);
    let newGear: number;
    if ((isPlayer || car.ai.mode === 'recover') && !preStart) newGear = reverseGear(v, inp, speed, dt);
    else {
      if (v.shiftTimer < 0) v.shiftTimer = 0;
      newGear = v.gear < 1 ? 1 : v.gear;
    }
    if (newGear >= 1 && v.gear >= 1) newGear = chooseGear(p, v, inp, autoBox, rearOmega0 > 0 ? rearOmega0 : 0);
    if (newGear !== v.gear) {
      v.shiftTimer = newGear > v.gear ? p.upshiftTime : p.downshiftTime;
      v.gear = newGear;
      world.events.push({ type: 'gear', car: car.id, gear: newGear });
    }
    if (v.gear < 0) { thr = brkIn; brk = thrIn; }
    const gear = v.gear < 1 ? 1 : v.gear;
    // R drives backwards through the 1st-gear ratio: `dir` flips the drivetrain torque and the wheel→engine speed.
    const dir = v.gear < 0 ? -1 : 1;
    const shifting = v.shiftTimer > 0;
    // A negative shiftTimer is the reverse brake-hold time (reverseGear) and is left alone.
    v.shiftTimer = v.shiftTimer > dt ? v.shiftTimer - dt : v.shiftTimer < 0 ? v.shiftTimer : 0;
    const ratio = overallRatio(p, gear);
    if (dir < 0) {
      // Gentle reverse torque, faded out at the 25 km/h cap.
      const room = REVERSE_MAX_MS + vLong;
      thr *= REVERSE_THROTTLE * (room <= 0 ? 0 : room < 1 ? room : 1);
    }
    const vFwd = dir * vLong;

    // ---- Holds (§5.10, rules.md §2 start hold) ----
    const launchHold = brk >= 0.5 || (brk >= 0.1 && thr < 0.05);
    const holding = (preStart && (thr < 0.05 || brk >= 0.5)) || (speed < 1.5 && launchHold);

    // Clutch (tick level): in 1st below 5 m/s it ramps in over 0.6 s while throttle is applied.
    const launchFloor = p.idleRpm + (p.launchRpm - p.idleRpm) * thr;
    let rpmFloor = p.idleRpm;
    if (gear === 1 && vFwd < 10) {
      const fade = vFwd <= 5 ? 1 : 1 - (vFwd - 5) / 5;
      rpmFloor = p.idleRpm + (launchFloor - p.idleRpm) * fade;
    }
    if (holding) v.clutch = 0;
    else if (gear === 1 && vFwd < 5) {
      const target = thr > 0.05 ? 1 : 0;
      const step = dt / (target > v.clutch ? CLUTCH_RAMP_S : 0.1);
      v.clutch = target > v.clutch ? Math.min(target, v.clutch + step) : Math.max(target, v.clutch - step);
    } else v.clutch = 1;

    // ERS decision for this tick.
    const lapFrac = length > 0 ? (v.s < 0 ? 0 : v.s > length ? 1 : v.s / length) : 0;
    const ers = v.ers;
    ers.mode = inp.ersOvertake ? 'overtake' : inp.ersMode;
    const deploying = !holding && !v.pitLimiterOn && ersDeploys(p, v, inp, thr, lapFrac);
    const deployW = deploying ? p.ers.maxKw * 1000 : 0;

    // ---- 3. Aero ----
    const flap = v.drs.flap;
    const qd = 0.5 * rho * vLong * vLong;
    const perf = 1 + p.teamPerf;
    const fdf = qd * aeroClA(p) * (1 - (1 - p.drsDownforceFactor) * flap) * (1 - 0.22 * v.dirtyAir) * perf;
    const fdrag = qd * aeroCdA(p) * (1 - (1 - p.drsDragFactor) * flap) * (1 - 0.3 * v.slipstream);

    // ---- 4. Loads ----
    const ny = v.ny > 0.5 ? v.ny : 1;
    const axF = x.axF;
    const ayF = x.ayF;
    const ff = (m * G * ny * b) / L + fdf * p.aeroFrontShare - (m * axF * h) / L + (m * vLong * vLong * kv * b) / L;
    const fr = (m * G * ny * a) / L + fdf * (1 - p.aeroFrontShare) + (m * axF * h) / L + (m * vLong * vLong * kv * a) / L;
    const dF = (p.lltdFront * m * ayF * h) / p.trackFront;
    const dR = ((1 - p.lltdFront) * m * ayF * h) / p.trackRear;
    fz[0] = ff * 0.5 - dF;
    fz[1] = ff * 0.5 + dF;
    fz[2] = fr * 0.5 - dR;
    fz[3] = fr * 0.5 + dR;
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i]!;
      const sp = q.surfaceProps(w.surface);
      if (sp.loadNoise > 0 && sp.bumpWavelength > 0) fz[i]! *= 1 + sp.loadNoise * Math.sin((TWO_PI * w.spin * R) / sp.bumpWavelength);
      if (fz[i]! < 50) fz[i] = 50;
      w.load = fz[i]!;
    }

    // ---- 5. Steering (Ackermann on the inner wheel) ----
    const delta = (inp.steer < -1 ? -1 : inp.steer > 1 ? 1 : inp.steer) * p.maxSteerRad;
    v.steerAngle = delta;
    const ack = 1 + (p.ackermann * Math.abs(delta)) / p.maxSteerRad;
    const dFL = delta > 0 ? delta * ack : delta;
    const dFR = delta < 0 ? delta * ack : delta;
    cosD[0] = Math.cos(dFL); sinD[0] = Math.sin(dFL);
    cosD[1] = Math.cos(dFR); sinD[1] = Math.sin(dFR);
    cosD[2] = 1; sinD[2] = 0;
    cosD[3] = 1; sinD[3] = 0;

    // ---- 6./7. Contact velocities, slip angles (relaxed), grip ----
    const r = v.yawRate;
    const wetBase = cond.wetness;
    const lineWet = cond.lineWetness < wetBase ? cond.lineWetness : wetBase;
    const tbTotal = brk * p.brakeTorqueTotal;
    // ESC-lite (assisted presets, player only; 2026-10-19): braking into a corner loads the front and unloads the rear,
    // so with the base 0.575 front bias the rear runs out of lateral grip first and the car steps out before ABS (which
    // reacts to slip) or the stability window (which waits for body slip) can help. While the rear's lateral slip is past
    // ESC_ON of its peak, brake torque moves from the rear to the front (up to ESC_SHIFT of the rear share), so the rear
    // keeps its grip for cornering. Uses last tick's rear slip angles.
    let biasEff = bias;
    if (isPlayer && assists.steering && brk > 0) {
      const ar = Math.max(Math.abs(Math.tan(v.wheels[2].slipAngle)), Math.abs(Math.tan(v.wheels[3].slipAngle))) / tanApkR;
      let e = (ar - ESC_ON) / ESC_SPAN;
      e = e < 0 ? 0 : e > 1 ? 1 : e;
      biasEff = bias + (1 - bias) * ESC_SHIFT * e;
    }
    const engineI = p.engineInertia * ratio * ratio * 0.5;
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i]!;
      const vbx = vLong - r * posL[i]!;
      const vby = vLat + r * posF[i]!;
      const cx = vbx * cosD[i]! + vby * sinD[i]!;
      const cyv = -vbx * sinD[i]! + vby * cosD[i]!;
      vix[i] = cx;
      viy[i] = cyv;
      const ax = cx < 0 ? -cx : cx;
      const aSS = Math.atan2(cyv, ax > ALPHA_FLOOR ? ax : ALPHA_FLOOR);
      let k = ((ax > ALPHA_FLOOR ? ax : ALPHA_FLOOR) * dt) / RELAX_LEN;
      if (k > 1) k = 1;
      const al = holding ? 0 : w.slipAngle + (aSS - w.slipAngle) * k;
      w.slipAngle = al;
      tanA[i] = Math.tan(al);
      const sp = q.surfaceProps(w.surface);
      let W = localWetness(wetBase, lineWet, wetW[i]!);
      W = W < 0 ? 0 : W > 1 ? 1 : W;
      let mu = comp.mu * wetGrip(comp, W) * sp.mu * (1 + (sp.muWetMul - 1) * W) * v.tyres[i]!.gripMul * loadSens(p, fz[i]!);
      // Aquaplaning (§5.3): puddles only (wetLocal 2, fully wet above W 0.65), above 160 km/h.
      if (wetW[i]! > 1 && W > 0.98 && speed > 44.4) mu *= v.compound === 'wet' ? 0.95 : v.compound === 'inter' ? 0.8 : 0.5;
      peak[i] = mu * fz[i]!;
      dropW[i] = 1 - WET_SLIDE_SOFTEN * W;
      wetLoc[i] = W;
      inert[i] = i < 2 ? p.wheelInertiaFront : p.wheelInertiaRear;
      tBrake[i] = tbTotal * (i < 2 ? biasEff : 1 - biasEff) * 0.5;
      tRoll[i] = p.rollingResistance * (sp.rollingResistance / 0.012) * fz[i]! * R;
      fxAcc[i] = 0;
      fyAcc[i] = 0;
      powAcc[i] = 0;
    }

    if (holding) {
      // Stationary hold: no motion, wheels still, engine free (launch revs with throttle).
      v.vx = 0; v.vz = 0; v.yawRate = 0;
      for (let i = 0; i < 4; i++) {
        const w = v.wheels[i]!;
        w.omega = 0; w.slipRatio = 0; w.fx = 0; w.fy = 0; w.locked = false;
      }
      const target = p.idleRpm + (p.launchRpm - p.idleRpm) * thr;
      v.rpm += (target - v.rpm) * Math.min(1, dt * 12);
      v.limiterHit = false;
      x.axF += (0 - x.axF) * Math.min(1, dt / LOAD_FILTER_TAU);
      x.ayF += (0 - x.ayF) * Math.min(1, dt / LOAD_FILTER_TAU);
      vLong = 0; vLat = 0; speed = 0;
    } else {
      // ---- 8./9. Wheel spin substeps with the drivetrain ----
      const hs = dt / WHEEL_SUBSTEPS;
      const decel = -axF;
      const accel = axF;
      let rpmE = v.rpm;
      for (let sub = 0; sub < WHEEL_SUBSTEPS; sub++) {
        const wRL = v.wheels[2].omega;
        const wRR = v.wheels[3].omega;
        const wheelRpm = dir * rpmAtWheel(p, gear, 0.5 * (wRL + wRR));
        const coupled = wheelRpm >= rpmFloor && v.clutch >= 0.99;
        rpmE = wheelRpm > rpmFloor ? wheelRpm : rpmFloor;
        if (rpmE > p.limiterRpm + 50) v.limiterHit = true;
        else if (v.limiterHit && rpmE < p.limiterRpm - 150) v.limiterHit = false;
        const thrE = v.limiterHit ? 0 : thr;
        let te = engineTorque(p, rpmE, thrE);
        if (!coupled && te < 0) te = 0;
        te *= v.clutch;
        if (shifting) te *= p.shiftTorqueFactor;
        const omegaE = rpmE / RPM_PER_RADS;
        let tk = 0;
        if (deployW > 0 && !v.limiterHit) {
          tk = deployW / (omegaE > 1 ? omegaE : 1);
          if (tk > p.ers.maxTorqueNm) tk = p.ers.maxTorqueNm;
        }
        const tAxle = dir * (te + tk) * ratio * p.drivetrainEff;
        const lock = (tAxle >= 0 ? p.diffLockPower : p.diffLockCoast) * Math.abs(tAxle) * 0.5;
        let tDiff = 40 * (wRL - wRR);
        tDiff = tDiff > lock ? lock : tDiff < -lock ? -lock : tDiff;
        tDrive[0] = 0;
        tDrive[1] = 0;
        tDrive[2] = tAxle * 0.5 - tDiff;
        tDrive[3] = tAxle * 0.5 + tDiff;
        for (let i = 0; i < 4; i++) {
          const w = v.wheels[i]!;
          const vx = vix[i]!;
          const avx = vx < 0 ? -vx : vx;
          const den = avx > KAPPA_FLOOR ? avx : KAPPA_FLOOR;
          const kappa = (w.omega * R - vx) / den;
          const tanApk = i < 2 ? tanApkF : tanApkR;
          tyreForce(kappa, tanA[i]!, peak[i]!, kpk, tanApk, shapeC, tf, dropW[i]!);
          const fx = tf.fx;
          let fy = tf.fy;
          const vy = viy[i]!;
          const cap = (LAT_CAP * m * (vy < 0 ? -vy : vy)) / dt;
          if (fy > cap) fy = cap;
          else if (fy < -cap) fy = -cap;
          const I = inert[i]! + (i >= 2 && coupled ? engineI : 0);
          let td = tDrive[i]!;
          if (i >= 2 && tcTarget > 0 && dir > 0) td = tcDriveTorque(td, tcTarget, kappa, tanA[i]!, peak[i]!, kpk, tanApk, shapeC, I, accel, tRoll[i]!, R, wetLoc[i]!);
          if (absOn && td < 0 && dir > 0) td = -absCoastTorque(-td, tanA[i]!, peak[i]!, kpk, tanApk, shapeC, I, decel, R);
          let tb = tBrake[i]!;
          if (absOn && tb > 0) tb = absBrakeTorque(tb, kappa, tanA[i]!, peak[i]!, kpk, tanApk, shapeC, I, decel, R, td < 0 ? -td : 0, i >= 2);
          const k0 = (peak[i]! * shapeC * 2.3) / kpk;
          const slope = tf.dfxdk > 0.3 * k0 ? tf.dfxdk : 0.3 * k0;
          const ieff = I + (hs * slope * R * R) / den;
          const free = w.omega + (hs * (td - fx * R)) / ieff;
          const fric = ((tb + tRoll[i]!) * hs) / ieff;
          let om: number;
          if (free > 0) om = free - fric > 0 ? free - fric : 0;
          else om = free + fric < 0 ? free + fric : 0;
          w.omega = om;
          kappaW[i] = kappa;
          fxAcc[i]! += fx;
          fyAcc[i]! += fy;
          const svx = w.omega * R - vx;
          powAcc[i]! += Math.abs(fx * svx) + Math.abs(fy * vy);
        }
      }
      v.rpm = rpmE;

      // ---- 10. Integration (semi-implicit Euler, world frame) ----
      let fbx = 0;
      let fby = 0;
      let mz = 0;
      const inv = 1 / WHEEL_SUBSTEPS;
      for (let i = 0; i < 4; i++) {
        const w = v.wheels[i]!;
        const fx = fxAcc[i]! * inv;
        const fy = fyAcc[i]! * inv;
        w.fx = fx;
        w.fy = fy;
        w.slipRatio = kappaW[i]!;
        w.locked = w.omega === 0 && (vix[i]! > 1 || vix[i]! < -1);
        w.spin = (w.spin + w.omega * dt) % TWO_PI;
        x.heatJ[i] += powAcc[i]! * inv * dt;
        const bx = fx * cosD[i]! - fy * sinD[i]!;
        const by = fx * sinD[i]! + fy * cosD[i]!;
        fbx += bx;
        fby += by;
        mz += posF[i]! * by - posL[i]! * bx;
      }
      // Aero drag along the body axis; surface drag (gravel) against the velocity.
      if (vLong > 0) fbx -= fdrag;
      else if (vLong < 0) fbx += fdrag;
      if (dragDecel > 0 && speed > 0.01) {
        const dd = m * dragDecel * (speed < 10 ? speed / 10 : 1);
        fbx -= (dd * vLong) / speed;
        fby -= (dd * vLat) / speed;
      }
      const axB = fbx / m;
      const ayB = fby / m;
      const gx = G * ny * v.nx;
      const gz = G * ny * v.nz;
      v.vx += ((fbx * fwx + fby * lfx) / m + gx) * dt;
      v.vz += ((fbx * fwz + fby * lfz) / m + gz) * dt;
      v.yawRate += (mz / (p.yawInertiaPerKg * m)) * dt;
      yaw = wrapAngle(yaw + v.yawRate * dt);
      v.yaw = yaw;
      v.x += v.vx * dt;
      v.z += v.vz * dt;
      const kf = Math.min(1, dt / LOAD_FILTER_TAU);
      x.axF += (axB - x.axF) * kf;
      x.ayF += (ayB - x.ayF) * kf;

      // Low-speed settling (§5.10).
      speed = Math.sqrt(v.vx * v.vx + v.vz * v.vz);
      if (speed < 0.5 && thr < 0.05 && brk < 0.05) {
        v.vx *= 0.9;
        v.vz *= 0.9;
        v.yawRate *= 0.9;
        for (let i = 0; i < 4; i++) v.wheels[i]!.omega *= 0.9;
        speed *= 0.9;
      }
      cy = Math.cos(yaw);
      sy = Math.sin(yaw);
      fwx = cy; fwz = -sy; lfx = -sy; lfz = -cy;
      vLong = v.vx * fwx + v.vz * fwz;
      vLat = v.vx * lfx + v.vz * lfz;
    }
    v.vLong = vLong;
    v.vLat = vLat;
    v.speed = speed;
    v.axLong = x.axF;
    v.ayLat = x.ayF;

    // ---- ERS energy ----
    if (deploying) {
      const e = deployW * dt;
      ers.socJ = ers.socJ > e ? ers.socJ - e : 0;
      ers.deployedLapJ += e;
    }
    const capJ = p.ers.capacityMJ * 1e6;
    let harvest = 0;
    if (brk > 0.05 && speed > 5 && ers.harvestedKLapJ < p.ers.harvestKLimitMJ * 1e6 && ers.socJ < capJ) {
      harvest = brk * speed * 3;
      if (harvest > p.ers.maxHarvestKkW) harvest = p.ers.maxHarvestKkW;
      const e = harvest * 1000 * dt;
      ers.socJ = ers.socJ + e < capJ ? ers.socJ + e : capJ;
      ers.harvestedKLapJ += e;
    }
    if (thr >= 0.95 && v.rpm > 10000 && ers.socJ < capJ) {
      const e = p.ers.maxHarvestHkW * 1000 * dt;
      ers.socJ = ers.socJ + e < capJ ? ers.socJ + e : capJ;
    }
    ers.deployKw = deploying ? p.ers.maxKw : 0;
    ers.harvestKw = harvest;

    // ---- DRS ----
    const zoneOk = car.race.drsZone >= 0;
    if (inp.drsRequest && zoneOk && brk <= 0.05) v.drs.open = true;
    if (v.drs.open && (brk > 0.05 || !zoneOk)) v.drs.open = false;
    const ft = v.drs.open ? 1 : 0;
    const rate = dt / (v.drs.open ? p.drsOpenTime : p.drsCloseTime);
    v.drs.flap = v.drs.flap < ft ? Math.min(ft, v.drs.flap + rate) : Math.max(ft, v.drs.flap - rate);

    // ---- Fuel, brake temperatures, kerb events ----
    if (length > 0) {
      const burn = (p.fuelKgPerLap * speed * dt) / length;
      v.fuelKg = v.fuelKg > burn ? v.fuelKg - burn : 0;
    }
    v.massKg = p.massDryKg + v.fuelKg;
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i]!;
      const pw = (holding ? 0 : tBrake[i]!) * (w.omega > 0 ? w.omega : -w.omega);
      w.brakeTempC += (pw / BRAKE_HEAT_CAP - (w.brakeTempC - cond.airC) * (0.05 + 0.006 * speed)) * dt;
      const kt = x.kerbT[i]! + dt;
      x.kerbT[i] = kt > 1 ? 1 : kt;
      const isKerb = w.surface === 'kerbFlat' || w.surface === 'kerbSausage';
      if (isKerb && prevKerb[i] === 0 && x.kerbT[i]! >= KERB_EVENT_GAP && speed > 3) {
        x.kerbT[i] = 0;
        world.events.push({ type: 'kerb', car: car.id, wheel: i as 0 | 1 | 2 | 3, sausage: w.surface === 'kerbSausage' });
      }
    }

    // ---- Visual body motion, suspension, height ----
    const g1 = 1 / G;
    v.pitch = 0.3 * DEG * x.axF * g1;
    v.roll = 0.25 * DEG * x.ayF * g1;
    const vr = speed / 83.3;
    v.heave = -0.022 * Math.min(1.5, vr * vr);
    const static0 = (m * G * b) / L / 2;
    const static2 = (m * G * a) / L / 2;
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i]!;
      const sp = q.surfaceProps(w.surface);
      let s = (fz[i]! - (i < 2 ? static0 : static2)) * SUSP_RATE;
      if (sp.bumpAmp > 0 && sp.bumpWavelength > 0 && speed > 1) s += sp.bumpAmp * 0.5 * (1 + Math.sin((TWO_PI * w.spin * R) / sp.bumpWavelength));
      w.susp = s > 0.04 ? 0.04 : s < -0.04 ? -0.04 : s;
    }
    v.y = groundSum * 0.25 + v.heave;

    // ---- 60 Hz: tyre thermal/wear, sparks ----
    if (slow) {
      const dt4 = dt * SLOW_EVERY;
      const wetN = cond.wetness;
      for (let i = 0; i < 4; i++) {
        const pw = x.heatJ[i]! / dt4;
        x.heatJ[i] = 0;
        const front = i < 2;
        const turning = Math.abs(x.ayF) > 8 ? 1 : 0;
        const extra = front ? 5 * v.dirtyAir * turning : 0;
        stepTyre(v.tyres[i]!, comp, v.compound, pw, fz[i]!, speed, wetN, cond.trackC, cond.airC, cfg.wearScale, extra, !front, dt4);
      }
      const kmh = speed * 3.6;
      const bottom = kv * speed * speed > 4 || (sausage && kmh > 120) ? 1 : 0;
      let target = ((kmh - 180) / 100) * bottom;
      target = target < 0 ? 0 : target > 1 ? 1 : target;
      const ks = Math.min(1, dt4 / 0.1);
      v.sparks += (Math.max(target, 0) - v.sparks) * ks;
      x.spool += ((thr > x.spool ? 1 / 0.4 : 1 / 0.25) * dt4) * (thr - x.spool);
    }

    if (!finite(v.x) || !finite(v.z) || !finite(v.vx) || !finite(v.vz) || !finite(v.yaw) || !finite(v.yawRate)) {
      // Left for the CollisionSystem's NaN guard (it runs right after and resets the car).
      v.speed = NaN;
    }
  };

  return {
    name: 'vehicle',
    step(world, dt) {
      const st = world.state;
      const cars = st.cars;
      const params = world.static.params;
      const slow = st.tick % SLOW_EVERY === 0;
      if (slow) updateSlipstream(world);
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i]!;
        // P3: a remote puppet's pose and velocity are written by the glue before the tick; never integrate it.
        if (car.control === 'remote') continue;
        stepCar(world, car, params[car.id]!, dt, slow);
      }
    },
  };
}
