// AIModule (planner-report §6): racing line, per-car speed profiles, difficulty, driver controller (pure pursuit
// + speed PI with profile feed-forward, §6.3), racecraft (§6.5), start (§6.6), mistakes (§6.9), recovery (§6.10)
// and pit-lane driving in pitAuto. `perfect` mode (autodrive, rival ghost) disables mistakes and line noise.
// computeInput writes `out` (car.input) and car.ai only. Sim layer: allocation-free per call.

import type { AIDriverProfile, AIModule, SpeedProfile } from '../contracts/ai';
import type { SimCarState, SimWorld } from '../contracts/sim';
import type { VehicleInput } from '../contracts/vehicle';
import { nextNormal, nextRandom } from '../core/rng';
import { airDensity, G } from '../physics/constants';
import { aeroClA, tuning } from '../physics/params';
import { aux } from '../physics/state';
import { wearGrip, wetGrip } from '../physics/tyre/grip';
import { brakeDecelLimit } from '../physics/vehicle/estimates';
import { newCarStatic, newContext, type AiContext } from './context';
import { buildRacingLine, EDGE_MARGIN, lineAt } from './line/racingLine';
import { buildCornerWindows, hashU, variety, varietySeed, type VarietyOut } from './line/variety';
import { buildPitGeometry, pitDrive, pitExitTrackD, type PitDriveOut } from './pit/pitDriver';
import { AI_MARGIN, buildLineTrackCache, buildSpeedProfile, type ProfileOpts, brakeEffFor, gripScaleFor, mistakeChanceFor, powerScaleFor, startReactionFor, varietyScaleFor } from './profile/speedProfile';
import { keepRoom, raceAggression, racecraft, type RacecraftOut, type RoomOut } from './racecraft/racecraft';
import { initStrategy, stepStrategy } from './strategy/strategy';

const AI_DT = 4 / 240;
const STEER_RATE = 1.5;
const KUS = 0.0015;
const KR = 0.12;
/** Own-line variety fades in from this progress (m) or the start-mode end, whichever is later. */
const START_MODE_PROGRESS = 600;
/** Start lanes: each car holds its grid lateral position until this far (m) before the first brake zone, then
 * blends onto its side of the start lane pair over START_BLEND m. */
const START_BLEND = 90;
/** Half the lateral spacing of the two start lanes into the first corner (m). */
const START_LANE = 1.5;
const RECOVER_KMH = 60;
const MISTAKE_TIME = 3;
/** Speed-target lead (s): actuator and 60 Hz update lag only. A longer look-ahead makes the car brake early and
 * arrive under the profile at every apex (S2-S1: 0.15 s cost ~20 km/h through T1). */
const LEAD_T = 0.15;
/** Braking-zone feedback: feed-forward fade window below the curve (m/s) and gain on the overspeed (1/(m/s)). */
const BRAKE_FADE = 2;
const BRAKE_KP = 0.12;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createAIModule(): AIModule {
  const ctx: AiContext = newContext();
  const rc: RacecraftOut = { vCap: Infinity, brake: 0, cornerFactor: 1, late: false, dAbs: NaN };
  const pd: PitDriveOut = { active: false, tx: 0, tz: 0, vT: Infinity, limiter: false, hold: false, mainD: 0, blend: 0 };

  const vo: VarietyOut = { dOff: 0, vMul: 1, option: -1 };
  const room: RoomOut = { d: 0, vCap: Infinity };
  const profileOpts: ProfileOpts = { gripScale: 1, brakeEff: 1, powerScale: 1, wetness: 0, compound: 'medium', massKg: 808, airC: 24 };

  const rebuild = (carId: number): void => {
    const st = ctx.cars[carId]!;
    const p = ctx.params[carId]!;
    const d = st.perfect ? 100 : ctx.difficulty;
    // Team performance is physical (power, ClA, D-036 traits in the params, which the profile reads); a (1 + perf)
    // grip factor on top made top-team drivers use more of their margin as well (d100 field spread 2.0 s).
    // The perfect (reference / autodrive) driver plans with exactly the calibrated grip (1.0): the d100 ladder knot (1.02)
    // pays back the line noise of normal drivers only. Using it for the perfect driver as well (2026-10-25) shifted the
    // reference laps the physics benches measure against (wet.test inters W 0.5 fell to +7.98 %).
    let grip = (st.perfect ? 1 : gripScaleFor(d)) * (st.perfect ? 1 : st.pace * st.form);
    if (!st.perfect && ctx.wetness > 0) grip *= 1 + 0.02 * (st.wetSkill * 2 - 1) * ctx.wetness;
    profileOpts.gripScale = grip;
    profileOpts.brakeEff = brakeEffFor(d);
    profileOpts.powerScale = powerScaleFor(d);
    profileOpts.wetness = ctx.wetness;
    profileOpts.compound = st.compound;
    profileOpts.massKg = p.massDryKg + 10;
    profileOpts.airC = ctx.airC;
    ctx.profiles[carId] = buildSpeedProfile(ctx.line!, ctx.cache!, p, profileOpts, ctx.profiles[carId]);
  };
  /** Profiles are rebuilt lazily: initCar builds at once; difficulty/wetness changes mark them dirty and
   * computeInput rebuilds at most one car per tick (spread over ticks, §6.7). */
  const markAll = (onlyAi: boolean): void => {
    for (let i = 0; i < ctx.params.length; i++) if (!onlyAi || !ctx.cars[i]!.perfect) ctx.dirty[i] = 1;
  };
  const ensure = (carId: number): void => {
    if (ctx.dirty[carId] === 1) {
      ctx.dirty[carId] = 0;
      rebuild(carId);
    }
  };

  const profileAt = (prof: SpeedProfile, arr: Float32Array | Uint8Array, s: number): number => {
    const line = prof.line;
    const L = ctx.track!.length;
    let sw = s % L;
    if (sw < 0) sw += L;
    const f = sw / line.ds;
    const i0 = Math.floor(f);
    const t = f - i0;
    const n = line.count;
    const i = i0 % n;
    const j = (i + 1) % n;
    return arr[i]! + (arr[j]! - arr[i]!) * t;
  };

  const steerToward = (car: SimCarState, tx: number, tz: number, kLine: number, out: VehicleInput): void => {
    const v = car.vehicle;
    const p = ctx.params[car.id]!;
    const fx = Math.cos(v.yaw);
    const fz = -Math.sin(v.yaw);
    const lx = -Math.sin(v.yaw);
    const lz = -Math.cos(v.yaw);
    const dx = tx - v.x;
    const dz = tz - v.z;
    const fwd = dx * fx + dz * fz;
    const lat = dx * lx + dz * lz;
    const dist2 = dx * dx + dz * dz > 1 ? dx * dx + dz * dz : 1;
    let delta: number;
    if (fwd < 0.3 * Math.sqrt(dist2)) delta = lat >= 0 ? p.maxSteerRad : -p.maxSteerRad;
    else {
      const kpp = (2 * lat) / dist2;
      const sp = v.speed;
      // Pursuit curvature + understeer feed-forward (blend of path and line curvature) + yaw-rate damping.
      const kFF = 0.5 * (kpp + kLine);
      delta = Math.atan(p.wheelbase * kpp) + KUS * sp * sp * kFF + KR * (sp * kpp - v.yawRate);
    }
    const ai = car.ai;
    const maxStep = STEER_RATE * AI_DT;
    // Front scrub guard (QC2-12): with the fronts past 1.3× their peak slip angle more lock only adds scrub (T12 at
    // full lock, 27° front slip, a long smoke trail); back off a little instead.
    const pk = p.compounds[v.compound].slipAnglePeak;
    const fa = Math.max(Math.abs(v.wheels[0].slipAngle), Math.abs(v.wheels[1].slipAngle));
    // Only when more lock adds front slip (slip opposes the steer, physics sign): with the car sliding the other way
    // (front slip from its sideslip) lock toward the target reduces it, and the guard held the wheel straight while the
    // car slid wide off the track (D-051 #6 traces, İstanbul T1 / T4).
    const sf = Math.abs(v.wheels[0].slipAngle) > Math.abs(v.wheels[1].slipAngle) ? v.wheels[0].slipAngle : v.wheels[1].slipAngle;
    if (fa > 1.3 * pk && Math.abs(delta) > Math.abs(ai.lastSteer) && sf * delta < 0) delta = ai.lastSteer - Math.sign(ai.lastSteer) * 0.5 * maxStep;
    delta = clamp(delta, ai.lastSteer - maxStep, ai.lastSteer + maxStep);
    delta = clamp(delta, -p.maxSteerRad, p.maxSteerRad);
    ai.lastSteer = delta;
    out.steer = delta / p.maxSteerRad;
  };

  /** Speed PI with profile brake feed-forward. In a braking zone (`brakeFF` > 0) the car follows the profile's
   * braking curve: feed-forward (profile deceleration / car limit) faded out as the car drops below the curve, plus a
   * proportional term on the overspeed. Full throttle is never commanded there, so the pedals never chatter. */
  const speedControl = (car: SimCarState, vT: number, brakeFF: number, brakeMin: number, out: VehicleInput): void => {
    const v = car.vehicle;
    const ai = car.ai;
    const e = vT - v.speed;
    ai.integ = clamp(ai.integ + e * AI_DT, -4, 4);
    let thr: number;
    let brk = e < -1.5 ? clamp(-0.25 * e, 0, 1) : 0;
    if (brakeFF > 0) {
      const fade = clamp((v.speed - vT + BRAKE_FADE) / BRAKE_FADE, 0, 1);
      const b = brakeFF * fade + (e < 0 ? -BRAKE_KP * e : 0);
      if (b > brk) brk = b;
      thr = clamp(0.15 + 0.35 * e, 0, 1);
    } else thr = e > 1 ? 1 : clamp(0.15 + 0.35 * e + 0.05 * ai.integ, 0, 1);
    if (brakeMin > brk) brk = brakeMin;
    if (brk > 1) brk = 1;
    if (brk > 0.02) thr = 0;
    out.throttle = thr;
    out.brake = brk;
  };

  /** A faster car on the main track behind (≤ 2.5 s away at the closing speed, or within 10 m). */
  const trafficBehind = (world: SimWorld, car: SimCarState): boolean => {
    const q = ctx.track!;
    const me = car.vehicle;
    const cars = world.state.cars;
    for (let j = 0; j < cars.length; j++) {
      if (j === car.id) continue;
      const o = cars[j]!.vehicle;
      if (o.hint.ribbon !== 'main' || aux(o).ghostT > 0) continue;
      const ds = q.deltaS(me.s, o.s);
      const closing = o.speed - me.speed;
      if (ds < 3 && ds > -10 - (closing > 0 ? 2.5 * closing : 0)) return true;
    }
    return false;
  };

  /** A car within 10 m behind this car's rear, in its reversing path (car frame). */
  const carBehind = (world: SimWorld, car: SimCarState): boolean => {
    const me = car.vehicle;
    const fx = Math.cos(me.yaw);
    const fz = -Math.sin(me.yaw);
    const cars = world.state.cars;
    for (let j = 0; j < cars.length; j++) {
      if (j === car.id) continue;
      const o = cars[j]!.vehicle;
      if (aux(o).ghostT > 0) continue;
      const dx = o.x - me.x;
      const dz = o.z - me.z;
      const fwd = dx * fx + dz * fz;
      const lat = -dx * fz + dz * fx;
      if (fwd < 1 && fwd > -10 && lat < 2.5 && lat > -2.5) return true;
    }
    return false;
  };

  /**
   * Stuck recovery (D-051 #4): a car in 'recover' that has stood still 0.5 s although it wants to move (nose in a wall,
   * in the gravel, against a car, facing the wrong way at the edge) backs out first, with the D-049 rule: it
   * holds the brake at a standstill (R engages after 0.3 s), in R the brake drives backwards with opposite lock so the
   * nose swings toward the target, then the throttle stops it and selects 1st and the normal recovery drives on.
   * Bounded by ai.stuckTimer (stopped or in R): R is only sought in the first second of a stop, it is left once the
   * nose points within 30° of the target (after 0.4 s in R) or after 1.2 s, and never with a car close behind; the
   * stuck reset (3.3 s) stays the fallback. Facing away (> 90°) above 4 m/s it brakes instead of a fast, wide U-turn
   * across the track; at walking pace it turns at full lock (and backs out again when that is blocked).
   * Returns true when it wrote the inputs.
   */
  const backOut = (world: SimWorld, car: SimCarState, tx: number, tz: number, out: VehicleInput): boolean => {
    const v = car.vehicle;
    const ai = car.ai;
    const p = ctx.params[car.id]!;
    const dx = tx - v.x;
    const dz = tz - v.z;
    const fwd = dx * Math.cos(v.yaw) - dz * Math.sin(v.yaw);
    const lat = -dx * Math.sin(v.yaw) - dz * Math.cos(v.yaw);
    const ang = Math.atan2(lat, fwd);
    const away = ang > 1.6 || ang < -1.6;
    let steer: number;
    if (v.gear < 0) {
      const t = ai.stuckTimer;
      if (t > 2 || (t > 1.2 && ang < 0.5 && ang > -0.5) || carBehind(world, car)) {
        // In R the throttle is the brake: stop, then (at a standstill) 1st.
        out.throttle = 1;
        out.brake = 0;
        steer = 0;
      } else {
        out.throttle = 0;
        out.brake = 1;
        steer = ang > 0 ? -1 : 1;
      }
    } else if (v.speed < 1 && ai.stuckTimer >= (away ? 0.2 : 0.5) && ai.stuckTimer < 1 && !carBehind(world, car)) {
      out.throttle = 0;
      out.brake = 1;
      steer = ang > 0 ? -1 : 1;
    } else if (away && v.speed > 4) {
      out.throttle = 0;
      out.brake = 0.5;
      return true;
    } else return false;
    const maxStep = STEER_RATE * AI_DT;
    const delta = clamp(steer * p.maxSteerRad, ai.lastSteer - maxStep, ai.lastSteer + maxStep);
    ai.lastSteer = delta;
    out.steer = delta / p.maxSteerRad;
    return true;
  };

  const module: AIModule = {
    prepare(q, ps) {
      ctx.track = q;
      ctx.params = ps;
      const built = buildRacingLine(q);
      ctx.line = built.line;
      ctx.dMin = built.dMin;
      ctx.dMax = built.dMax;
      ctx.cache = buildLineTrackCache(q, built.line);
      ctx.pit = buildPitGeometry(q, ctx.frame);
      ctx.corners = buildCornerWindows(q);
      ctx.profiles.length = 0;
      ctx.cars.length = 0;
      ctx.dirty = new Uint8Array(ps.length);
      const n = built.line.count;
      for (let i = 0; i < ps.length; i++) {
        ctx.cars.push(newCarStatic());
        ctx.profiles.push({ line: built.line, v: new Float32Array(n), accel: new Float32Array(n), zone: new Uint8Array(n), gripScale: 1, wetness: 0 });
        ctx.dirty[i] = 1;
      }
    },
    getRacingLine() {
      if (!ctx.line) throw new Error('AI module not prepared');
      return ctx.line;
    },
    getProfile(carId) {
      const p = ctx.profiles[carId];
      if (!p) throw new Error(`No AI profile for car ${carId}`);
      // The player's car (braking assist, limits) never runs computeInput: follow its fitted compound here so its
      // profile is not left built for the starting tyre (Inters / Wets braked far too early). Wetness is global.
      const car = ctx.world?.state.cars[carId];
      const st = ctx.cars[carId];
      if (car && st && car.vehicle.compound !== st.compound) {
        st.compound = car.vehicle.compound;
        ctx.dirty[carId] = 1;
      }
      ensure(carId);
      return p;
    },
    setDifficulty(d) {
      const nd = clamp(d, 0, 110);
      if (nd === ctx.difficulty) return;
      ctx.difficulty = nd;
      markAll(true);
    },
    onWetnessChanged(w) {
      if (Math.abs(w - ctx.wetness) <= 0.05) return;
      ctx.wetness = w;
      markAll(false);
    },
    initCar(world, carId, profile: AIDriverProfile) {
      const car = world.state.cars[carId]!;
      ctx.world = world;
      const st = ctx.cars[carId] ?? (ctx.cars[carId] = newCarStatic());
      const ai = car.ai;
      const d = car.isPlayer ? 100 : ctx.difficulty;
      st.perfect = car.isPlayer;
      st.pace = car.isPlayer ? 1 : profile.pace;
      st.aggression = profile.aggression;
      st.startSkill = profile.startSkill;
      st.wetSkill = profile.wetSkill;
      st.compound = car.vehicle.compound;
      st.mistakeChance = mistakeChanceFor(d);
      // Line / pace variety (line/variety.ts): less consistent drivers vary their line and corner commitment more.
      // The race seed is mixed in: a different line every race, the same one on replay / flashback.
      const vd = st.vd;
      vd.seed = varietySeed(world.static.config.seed, carId);
      vd.bias = 0.4 * hashU(vd.seed, -1, 1);
      vd.consistency = profile.consistency;
      vd.aggression = profile.aggression;
      vd.tyreMgmt = profile.tyreMgmt;
      vd.sigmaV = 0.004 + 0.03 * (1 - profile.consistency);
      // Form on the day (QC2-05): a seeded race-pace offset, σ ≈ 0.6 % grip ≈ 0.4 s/lap, wider for less consistent
      // drivers. The grid is sorted by nominal pace, so the race order is not simply the grid order.
      const fz = hashU(vd.seed, -2, 11) + hashU(vd.seed, -2, 12) + hashU(vd.seed, -2, 13);
      st.form = 1 + (0.004 + 0.012 * (1 - profile.consistency)) * fz;
      st.startSide = car.vehicle.d >= 0 ? 1 : -1;
      st.startD = car.vehicle.d;
      ctx.airC = world.state.conditions.airC;
      // Start reaction: 0.40 − 0.18·min(d,110)/110 ± 0.07 (start skill) + N(0, 0.04), plus a seeded poor launch
      // (+0.25–0.4 s, ~6 % of starts, likelier with a low start skill). Sprint 4: the old ±0.03 / N(0, 0.02) spread
      // never changed a position on lap 1.
      let noise = 0;
      if (!st.perfect) {
        const rs = ai as unknown as Record<'rng', number>;
        noise = 0.04 * (1 - 2 * st.startSkill) + nextNormal(rs, 'rng') * 0.03;
        if (nextRandom(rs, 'rng') < 0.02 + 0.03 * (1 - st.startSkill)) noise += 0.2 + 0.15 * nextRandom(rs, 'rng');
      }
      st.reaction = Math.max(0.12, startReactionFor(d) + noise);
      ctx.dirty[carId] = 0;
      rebuild(carId);
      const line = ctx.line!;
      const zone = ctx.profiles[carId]!.zone;
      for (let i = 0; i < line.count; i++) {
        if (zone[i] === 2) {
          ctx.startBrakeS = i * line.ds;
          break;
        }
      }
      // Start mode (paired lanes, no moves) ends at the exit of the first braking corner (600 m if none). Holding the
      // pair to a fixed 600 m merged the İstanbul columns on the run to T3 (lap-1 rear-ends).
      const first = world.static.track.data.corners.find((c) => c.apexS > ctx.startBrakeS);
      ctx.startEndS = first ? first.exitS : START_MODE_PROGRESS;
      // Every car, the autodrive 'perfect' one included, starts in 'start' mode (grid lanes, no moves); a perfect
      // car returns to 'perfect' after it (no mistakes, no line noise).
      ai.mode = 'start';
      ai.laneOffset = car.vehicle.d - lineAt(line.d, line, car.vehicle.s, ctx.track!.length);
      ai.laneTarget = 0;
      ai.targetCar = -1;
      ai.integ = 0;
      ai.lastSteer = 0;
      ai.stuckTimer = 0;
      ai.overtakeTimer = 0;
      ai.mistakeTimer = 0;
      ai.mistakeKind = 0;
      ai.defendUsed = false;
      initStrategy(world, car, profile.wetSkill);
    },
    computeInput(world, carId, out) {
      const q = ctx.track!;
      const line = ctx.line!;
      const L = q.length;
      const car = world.state.cars[carId]!;
      const st = ctx.cars[carId]!;
      const v = car.vehicle;
      const ai = car.ai;
      const p = ctx.params[carId]!;
      const race = world.state.race;
      // Profiles follow the racing-line wetness (what the car drives on; S2-S6: nothing else calls onWetnessChanged
      // during a session, so the AI drove dry speeds on a wet track). Hysteresis 0.05 inside onWetnessChanged.
      module.onWetnessChanged(world.state.conditions.lineWetness);
      if (ctx.dirty[carId] === 1 && ctx.lastBuildTick !== world.state.tick) {
        ctx.lastBuildTick = world.state.tick;
        ensure(carId);
      }
      const prof = ctx.profiles[carId]!;
      out.gearUp = false;
      out.gearDown = false;
      out.ersOvertake = false;
      out.ersMode = 'medium';
      out.brakeBias = p.brakeBiasDefault;
      out.drsRequest = false;
      out.pitLimiter = false;

      // ---- Start: hold on the grid, then react (§6.6). The AI never jump-starts. ----
      if (race.phase === 'grid' || race.phase === 'lights') {
        out.throttle = 0;
        out.brake = 1;
        out.steer = 0;
        ai.lastSteer = 0;
        ai.mistakeTimer = st.reaction;
        return;
      }
      const sinceStart = (race.raceMs - race.lightsOutAtMs) / 1000;
      // Tyre change (pit stop): the profile depends on the compound.
      if (v.compound !== st.compound) {
        st.compound = v.compound;
        ctx.dirty[carId] = 1;
      }
      if (race.phase === 'running') stepStrategy(world, car, st.aggression, AI_DT);
      if (sinceStart >= 0 && sinceStart < st.reaction && race.lightsOutAtMs > 0) {
        out.throttle = 0;
        out.brake = 1;
        return;
      }
      if (ai.mode === 'start' && (car.race.progress > ctx.startEndS || sinceStart > 30)) {
        ai.mode = st.perfect ? 'perfect' : 'race';
        ai.laneTarget = 0;
      }

      const speed = v.speed;
      const s = v.s;
      const lineD = lineAt(line.d, line, s, L);

      // ---- Stuck timer / recovery mode (§6.10) ----
      const running = race.phase === 'running' || race.phase === 'finishing';
      // Waiting in the pit lane (box, queue slot, release hold, lane traffic) is not being stuck. Backing out in R
      // (D-051 #4) is not progress either: the timer bounds the manoeuvre and the stuck reset stays the fallback.
      // Queueing for the pit entry on the main track (pit request, ≤ 350 m before the split, on the road) is waiting too: the
      // entry gap control (pitDriver entryCap) holds a car at 0 while the car ahead clears the single-lane entry, and with
      // 20 cars boxing on one lap that hold passed the 3.3 s stuck limit (pitDrive 20-car test: car 0 reset at İstanbul
      // s 4,619, 2026-10-25).
      const toSplitQ = q.data.pit.mainSAtSplit >= 0 ? q.deltaS(v.s, q.data.pit.mainSAtSplit) : -1e9;
      const pitQueue = (car.pit.phase === 'requested' || car.pit.phase === 'entry') && toSplitQ > -20 && toSplitQ < 350 && v.offTrackWheels < 3;
      ai.stuckTimer = running && aux(v).ghostT <= 0 && (speed < 1 || v.gear < 0) && v.hint.ribbon !== 'pit' && !pitQueue ? ai.stuckTimer + AI_DT : 0;
      q.frameAt(s, ctx.frame);
      const hwL = ctx.frame.halfWidthL;
      const hwR = ctx.frame.halfWidthR;
      const cosHead = Math.cos(v.yaw) * ctx.frame.tx - Math.sin(v.yaw) * ctx.frame.tz;
      const offTrack = v.offTrackWheels >= 3 || v.d > hwL + 0.5 || v.d < -hwR - 0.5;
      if (car.pit.phase === 'none' && (offTrack || cosHead < 0.5) && ai.mode !== 'recover') {
        ai.mode = 'recover';
        ai.laneTarget = -lineD;
      }
      // Rejoined: on track, moving and aligned (≤ 16°) with the racing line, which crosses the centreline at up
      // to ~25° in chicanes (a centreline test kept cars crawling in 'recover' through T5–T6 for 16 s on lap 1).
      const lx0 = lineAt(line.x, line, s, L);
      const lz0 = lineAt(line.z, line, s, L);
      const ltx = lineAt(line.x, line, s + 4, L) - lx0;
      const ltz = lineAt(line.z, line, s + 4, L) - lz0;
      const lt = Math.sqrt(ltx * ltx + ltz * ltz);
      const cosLine = lt > 1e-6 ? (Math.cos(v.yaw) * ltx - Math.sin(v.yaw) * ltz) / lt : cosHead;
      if (ai.mode === 'recover' && !offTrack && (cosHead > 0.95 || cosLine > 0.96) && speed > 8) {
        ai.mode = st.perfect ? 'perfect' : 'race';
        ai.laneTarget = 0;
      }
      // Rejoin without cutting across traffic (D-051 #4): while a car on the track behind would arrive within 2.5 s,
      // the recovering car aims at its own edge of the track instead of the centre.
      if (ai.mode === 'recover') {
        const side = v.d >= 0 ? 1 : -1;
        ai.laneTarget = trafficBehind(world, car) ? side * ((side > 0 ? hwL : hwR) - 1.5) - lineD : -lineD;
      }

      // ---- Pit lane (pitAuto) ----
      let ld = clamp(6 + 0.35 * speed, 8, 45);
      pd.blend = 0;
      pd.vT = Infinity;
      // Any pit phase: the PitProcedure may hand control back to 'ai' at the split while the car is still crossing
      // onto the pit ribbon (S2-S7: the racing line then steered it straight back out of the lane).
      if (car.pit.phase === 'exit') st.fromPit = 1;
      if (car.pit.phase !== 'none') {
        pitDrive(ctx, world.state.cars, car, ld, pd);
        if (pd.active) {
          out.pitLimiter = pd.limiter;
          if (pd.hold) {
            out.throttle = 0;
            out.brake = 1;
            // Braking into the box still needs lateral control. Zeroing the steering here stopped cars halfway
            // across the fast lane, where their subsequent release blocked the queue behind them.
            if (speed > 0.5) steerToward(car, pd.tx, pd.tz, 0, out);
            else { out.steer = 0; ai.lastSteer = 0; }
            return;
          }
          steerToward(car, pd.tx, pd.tz, 0, out);
          // The main-track profile at the projected s means nothing in the lane: the pit speed curve alone, built for
          // dry grip: scaled by √(wet grip) on a wet track (S-SM-14: slicks at W 0.27 ran into the İstanbul entry wall
          // at the curve's 100 km/h and blocked the lane; the dry curve is unchanged).
          const wg = wetGrip(p.compounds[v.compound], world.state.conditions.wetness);
          const pitTarget = wg < 1 && pd.vT < Infinity ? pd.vT * Math.sqrt(wg) : pd.vT;
          // Queue control must brake below the racing controller's 1.5 m/s deadband as well.
          speedControl(car, pitTarget, 0, pitTarget < 5 ? clamp((speed - pitTarget) * 0.4, 0, 1) : 0, out);
          return;
        }
      }

      // ---- Racecraft lanes ----
      if (ai.mode !== 'recover') racecraft(ctx, world, car, rc);
      else {
        rc.vCap = Infinity;
        rc.brake = 0;
        rc.cornerFactor = 1;
        rc.late = false;
      }
      // Safety car (D-056): the director's queue speed (gap to the car ahead / the SC) caps the speed below; no passing,
      // so a move on a racing car is dropped at once (going round a stopped or crashed car stays allowed).
      const scT = car.race.scTargetSpeed;
      if (scT >= 0 && ai.mode === 'overtake' && ai.targetCar >= 0 && world.state.cars[ai.targetCar]!.vehicle.speed > 30 / 3.6) {
        ai.mode = 'race';
        ai.overtakeTimer = 0;
        ai.laneTarget = 0;
        ai.targetCar = -1;
        rc.late = false;
      }
      // Start lanes (§6.6): two columns 2 m either side of the racing line (clamped to the track at the target).
      // Start lanes (§6.6): the grid column's own lateral position (two columns either side of the centreline;
      // Sprint 1 used ±2 m around the racing line, which before T1 hugs the right edge and stacked both columns
      // there), faded onto the line ahead of the first brake zone.
      // Sprint 4: into the first corner the two columns stay side by side on a lane pair around the racing line
      // (± START_LANE, shifted to stay inside the edges), each column on its own side; blending both columns onto the
      // one line put the whole field in a single 0.1 s train that concertinaed to a stop at Bosphorus / Lombardia T1.
      if (ai.mode === 'start') {
        const f = clamp((ctx.startBrakeS - START_BLEND - car.race.progress) / START_BLEND, 0, 1);
        const dl = lineAt(line.d, line, s + ld, L);
        q.frameAt(s + ld, ctx.frame);
        const hi = ctx.frame.halfWidthL - EDGE_MARGIN;
        const lo = -(ctx.frame.halfWidthR - EDGE_MARGIN);
        let dL = dl + START_LANE;
        let dR = dl - START_LANE;
        if (dL > hi) { dR -= dL - hi; dL = hi; }
        if (dR < lo) { dL += lo - dR; dR = lo; }
        ai.laneTarget = f * (st.startD - dl) + (1 - f) * ((st.startSide > 0 ? dL : dR) - dl);
      }
      ai.laneOffset += clamp(ai.laneTarget - ai.laneOffset, -2.5 * AI_DT, 2.5 * AI_DT);

      // ---- Mistakes (§6.9), rolled on brake-zone entry ----
      const look = s + 0.15 * speed;
      if (ai.mistakeTimer > 0) ai.mistakeTimer -= AI_DT;
      else ai.mistakeKind = 0;
      if (!st.perfect && ai.mode !== 'start' && ai.mistakeTimer <= 0) {
        const zNow = prof.zone[Math.floor((((look % L) + L) % L) / line.ds) % line.count]!;
        const prevLook = look - speed * AI_DT;
        const zPrev = prof.zone[Math.floor((((prevLook % L) + L) % L) / line.ds) % line.count]!;
        if (zNow === 2 && zPrev !== 2) {
          const pressure = rc.vCap < Infinity ? 1.5 : 1;
          const chance = st.mistakeChance * (1 + 1.5 * world.state.conditions.wetness) * pressure;
          const r = nextRandom(ai as unknown as Record<'rng', number>, 'rng');
          if (r < chance) {
            const k = nextRandom(ai as unknown as Record<'rng', number>, 'rng');
            ai.mistakeKind = k < 0.6 ? 1 : k < 0.9 ? 2 : 3;
            ai.mistakeTimer = MISTAKE_TIME;
          }
        }
      }

      // ---- Steering: pure pursuit to the line + lane at s + Ld (§6.3) ----
      // Going round a stopped car at walking pace: a short look-ahead, so the car turns out within the 10 m between grid slots
      // (pure pursuit at 8 m cut back toward the target past the stalled car and met its corner, 2026-10-26).
      if (rc.dAbs === rc.dAbs && ai.mode !== 'recover' && ld > 4.5) ld = 4.5;
      const sT = s + ld;
      let laneT = ai.laneOffset;
      if (ai.mistakeKind === 2) laneT -= 1.5 * Math.sign(lineAt(line.curvature, line, sT, L) || 1);
      // Own line (line/variety.ts): per-car bias, lap-dependent drift, per-corner entry / apex offsets and corner
      // commitment. Off in 'perfect' mode; faded in over 200 m after the start lanes.
      const fadeV = st.perfect ? 0 : clamp((car.race.progress - Math.max(START_MODE_PROGRESS, ctx.startEndS)) / 200, 0, 1);
      if (fadeV > 0) {
        const wear = Math.max(v.tyres[0].wear, v.tyres[1].wear, v.tyres[2].wear, v.tyres[3].wear);
        variety(ctx.corners!, q, st.vd, sT, car.race.lapsCompleted, wear, world.state.conditions.lineWetness, vo);
        // Commitment above the profile eats the 2 % grip margin (d 100 cars ran wide at T5 / T10 exits): cap at +0.5 %.
        // (Scaled by the difficulty: less noise for the better drivers.)
        vo.vMul = 1 + (vo.vMul - 1) * fadeV * varietyScaleFor(ctx.difficulty);
        if (vo.vMul > 1.005) vo.vMul = 1.005;
      } else {
        vo.dOff = 0;
        vo.vMul = 1;
      }
      // Own-line offsets shrink above d70 too (√ of the commitment scale: d100 keeps ~60 % of the line spread).
      const vsc = varietyScaleFor(ctx.difficulty);
      let noise = vo.dOff * fadeV * (vsc < 1 ? Math.sqrt(vsc) : 1);
      // No own-line offset toward the pit lane around its entry: the lane splits off the main track there and an offset
      // toward it put cars onto the pit ribbon (unrequested stops in a 3-lap race).
      const split = q.data.pit.mainSAtSplit;
      if (split >= 0 && ctx.pit && noise * ctx.pit.entryD > 0) {
        const dsp = q.deltaS(split, sT);
        if (dsp > -200 && dsp < 100) noise *= clamp((dsp < 0 ? -dsp - 150 : dsp - 50) / 50, 0, 1);
      }
      // Toward the inside (own line or a racecraft lane), leave room for the chord pure pursuit cuts between here and
      // the target (sag ≈ Ld²·κ/8): inside offsets at the T8 entry put cars over the inside kerb into 'recover'.
      const kV = lineAt(line.curvature, line, s + 0.5 * ld, L);
      const off = laneT + noise;
      if (off * kV > 0 && ai.mode !== 'recover') {
        const room = kV > 0 ? lineAt(ctx.dMax, line, sT, L) - lineAt(line.d, line, sT, L) : lineAt(line.d, line, sT, L) - lineAt(ctx.dMin, line, sT, L);
        const lim = room - (ld * ld * (kV < 0 ? -kV : kV)) / 8;
        const ao = off < 0 ? -off : off;
        if (ao > lim) {
          const cap = lim > 0 ? (off > 0 ? lim : -lim) : 0;
          noise = cap - laneT;
        }
      }
      let dT = lineAt(line.d, line, sT, L) + laneT + noise;
      const lo = lineAt(ctx.dMin, line, sT, L) - 0.2;
      const hi = lineAt(ctx.dMax, line, sT, L) + 0.2;
      // Going round a stopped car (racecraft): its absolute lane abeam that car.
      if (rc.dAbs === rc.dAbs && ai.mode !== 'recover') dT = rc.dAbs;
      dT = clamp(dT, lo, hi);
      // Rejoin (QC2-12 / pit exit): fade from the lane's exit side onto the line over 150 m past the merge, at no more
      // than 90 % of the line speed (new tyres are cold; cars jumped onto the T2 line at 200 km/h and spun).
      let rejoin = 0;
      if (st.fromPit === 1 && ctx.pit) {
        const dsm = q.deltaS(q.data.pit.mainSAtMerge, s);
        if (dsm > 150 || dsm < -50) st.fromPit = 0;
        else {
          rejoin = 1 - clamp(dsm / 150, 0, 1);
          dT += (ctx.pit.exitD - dT) * rejoin;
        }
      }
      if (pd.blend > 0) {
        // Pit approach: blend toward the entry side, kept 1 m inside the track edges at the target.
        q.frameAt(sT, ctx.frame);
        const dP = clamp(pd.mainD, -ctx.frame.halfWidthR + 1, ctx.frame.halfWidthL - 1);
        // Not across the inside of a tight corner at racing speed (T12: full lock and scrubbed fronts, QC2-12): the
        // blend waits while the line curvature here is above 1/100 m. Only toward the inside: İstanbul's entry is on
        // the outside of T14 (line −5.7 m, entry +4.75 m at the split), and the guard there held faster cars on the
        // line until it was too late (missed entries, S-SM-10 / d70 seed 4321).
        const kl = lineAt(line.curvature, line, s, L);
        const kb = (dP - dT) * kl > 0 ? Math.abs(kl) : 0;
        dT += (dP - dT) * pd.blend * clamp(2 - kb / 0.01, 0, 1);
      }
      // Room for a car alongside (player or AI) on the final target: every offset above ignores neighbours.
      // Corner ahead (brake zone within 1 s, or curve within the look-ahead): a car held off its line there yields by
      // speed. Earlier on a straight it only gives room laterally (user report 2026-10-17: no lifting while being passed).
      const kR = lineAt(line.curvature, line, sT, L);
      const cornerNear = profileAt(prof, prof.zone, s + speed) > 1.5 || profileAt(prof, prof.zone, look) > 1.5 || kV > 0.003 || kV < -0.003 || kR > 0.003 || kR < -0.003;
      // (Corner: only to a car clearly ahead, > 1.5 m; a car level shares the corner, user 2026-10-21.)
      const fromExit = q.deltaS(q.data.pit.mainSAtMerge, s);
      const exitNear = ctx.pit !== null && st.fromPit === 0 && fromExit >= -100 && fromExit <= 30;
      keepRoom(ctx, world, car, sT, dT, (ld * ld * kV) / 8, pd.blend > 0 ? -1.5 : exitNear ? 0 : cornerNear ? 1.5 : Infinity, room);
      dT = room.d;
      // A pit car and a racing car use different ribbons, so normal racecraft cannot separate them here. Reserve
      // the exit corridor even when no exiting car is visible yet; keepRoom must not push a racer across its line.
      if (ctx.pit && st.fromPit === 0) dT = pitExitTrackD(q, ctx.pit, sT, dT, ctx.frame);
      const offT = dT - lineAt(line.d, line, sT, L);
      q.worldFromSD(sT, dT, ctx.p0);
      const kLine = lineAt(line.curvature, line, s + 0.5 * ld, L);
      if (ai.mode === 'recover' && backOut(world, car, ctx.p0.x, ctx.p0.z, out)) return;
      steerToward(car, ctx.p0.x, ctx.p0.z, kLine, out);

      // ---- Speed target from the profile (+ racecraft, start, mistakes, recovery) ----
      // Tyre grip (temperature / wear) the profile does not know about: the weaker axle limits the car.
      const gF = 0.5 * (v.tyres[0].gripMul + v.tyres[1].gripMul);
      const gR = 0.5 * (v.tyres[2].gripMul + v.tyres[3].gripMul);
      const gripNow = gF < gR ? gF : gR;
      // Braking zones follow the profile's braking curve at the car's own position (the feed-forward carries the
      // lead); elsewhere the target leads by LEAD_T.
      const aP = profileAt(prof, prof.accel, s + LEAD_T * speed);
      let lookV = aP < -3 ? s : s + LEAD_T * speed;
      if (ai.mistakeKind === 1) lookV -= 8 + 7 * ((ai.rng >>> 8) % 100) / 100;
      // Committed on the inside: brake 4–12 m later (a dive), more for harder racers (difficulty and the driver's aggression).
      else if (rc.late) lookV -= 4 + 8 * raceAggression(ctx, carId);
      let vT = profileAt(prof, prof.v, lookV);
      const zoneLook = profileAt(prof, prof.zone, look);
      const kAhead = lineAt(line.curvature, line, look + 10, L);
      // A lift zone on a straight (the profile marks terminal speed, accel < 0.5 m/s², as 'lift') is not a corner:
      // the corner scalings (dirty air, grip) capped the flat-out speed of a following car there (S2-S5).
      const inCorner = zoneLook > 1.5 || kAhead > 0.003 || kAhead < -0.003;
      if (inCorner) {
        vT *= rc.cornerFactor * vo.vMul;
        // Off the line on the inside the radius shrinks: v ∝ √R, R_lane ≈ R_line·(1 − κ·offset).
        // (The actual target offset: lane, own line, rejoin and the pit-approach blend; QC2-12: the blend toward the
        // entry through T12 at racing speed held full lock and scrubbed the fronts, a long smoke trail.)
        const shrink = 1 - kAhead * offT;
        if (shrink < 1) vT *= Math.sqrt(shrink > 0.5 ? shrink : 0.5);
        // Off-line guard (D-051 #6): a car held wide by a car alongside (or just released / rejoining far off its line)
        // drives a path the profile never planned, flattened against the edge through a tighter arc (outside of a
        // hairpin, the wrong side of a chicane). At line speed it understeered over the kerb and off the track. More
        // than 2 m off near a curve: no faster than the slowest profile speed of the next 60 m + 0.5 s (the apex), less
        // 5 %/m beyond 2 m (not on a straight brake zone: an overtaking lane there is 3 m off the line; not on the planned
        // pit approach / pit-exit rejoin, which have their own speeds: crawling to the entry jammed the S-SM-14 pit lane).
        const offNow = v.d - lineD;
        const offA = (offNow < 0 ? -offNow : offNow) > (offT < 0 ? -offT : offT) ? (offNow < 0 ? -offNow : offNow) : (offT < 0 ? -offT : offT);
        const curveNear = kV > 0.003 || kV < -0.003 || kAhead > 0.003 || kAhead < -0.003;
        // Only on the outside of the curve: on the inside the radius shrink above covers the tighter arc, and capping at the
        // apex speed from the turn-in made a car holding the inside next to another lift by 50–70 km/h (user 2026-10-21).
        const offS = (offNow < 0 ? -offNow : offNow) > (offT < 0 ? -offT : offT) ? offNow : offT;
        const kS = (kAhead < 0 ? -kAhead : kAhead) > (kV < 0 ? -kV : kV) ? kAhead : kV;
        if (offA > 2 && curveNear && offS * kS < 0 && pd.blend <= 0 && rejoin <= 0) {
          let vMin = vT;
          const span = 60 + 0.5 * speed;
          for (let k = 0; k <= span; k += 4) {
            const vk = profileAt(prof, prof.v, s + k);
            if (vk < vMin) vMin = vk;
          }
          const f = 1 - 0.05 * (offA - 2);
          vMin *= f > 0.7 ? f : 0.7;
          if (vMin < vT) vT = vMin;
        }
        // Dirty air costs up to 22 % of downforce (§5.6): give back corner speed when following closely, but only the
        // part of the grip loss the driver's own margin does not cover (QC2-05: a flat −6 % at full dirty air held
        // every follower ≥ 0.6 s back even in slow corners, where downforce is ~20 % of the load and a d70 driver
        // leaves ~6 % of grip unused). Grip loss = downforce share · 0.22 · dirty; speed ∝ √grip.
        if (v.dirtyAir > 0) {
          const qA = 0.5 * airDensity(p.airDensity, world.state.conditions.airC) * speed * speed * aeroClA(p);
          const loss = (qA / (v.massKg * G + qA)) * 0.22 * v.dirtyAir;
          const use = prof.gripScale * AI_MARGIN;
          const avail = (1 - loss) / (use < 1 ? use : 1);
          if (avail < 1) vT *= Math.sqrt(avail);
        }
        // Tyre grip (temperature / wear) the profile does not know about.
        vT *= Math.sqrt(gripNow < 1 ? gripNow : 1);
        // Cold tyres (lap 1, out lap): extra margin below 95 % grip (QC2-07: T3/T4 slides at 77–80 °C).
        // Temperature part only (wear is a slow, known loss the sqrt above already covers).
        const gT = gripNow / wearGrip(v.tyres[0].wear > v.tyres[2].wear ? v.tyres[0].wear : v.tyres[2].wear);
        if (gT < 0.95) vT *= Math.sqrt(Math.sqrt(gT / 0.95));
        if (ai.mode === 'start') vT *= 0.97;
        // Edge protection: lift when drifting toward the outside edge with less than 0.8 m to spare.
        const side = v.d > 0 ? 1 : -1;
        const margin = (side > 0 ? hwL : hwR) - (v.d > 0 ? v.d : -v.d) - 1.0;
        const outward = v.vLat * side;
        // (Not while recovering: a car sliding off at walking pace lifted to a stop on the run-off and was reset.)
        // Outside edge only: on the inside edge a lift only tightens the line further inward, and the car crawled the
        // T12 apex at 37 km/h lifting every tick (seed 18: the train behind rear-ended at 6 kN·s).
        if (margin < 0.8 && outward > 0.5 && side * kAhead <= 0 && speed - 2 < vT && ai.mode !== 'recover') vT = speed - 2;
      } else if (aP > -3) {
        // Full-throttle straight (S2-S5): the profile speed here is what the car reaches flat out without a tow, so
        // it must not cap a car in the slipstream or with DRS open (followers lifted at the profile's 330 km/h and a
        // DRS pass never closed). The brake zone ahead still comes from the profile's braking curve.
        vT += 8;
      }
      if (ai.mistakeKind === 3) vT *= 1.03;
      if (ai.mode === 'recover') vT = Math.min(vT, RECOVER_KMH / 3.6);
      // Understeer guard: fronts past 1.6× their peak slip angle (scrubbing at full lock) → shed speed.
      const fa = Math.max(Math.abs(v.wheels[0].slipAngle), Math.abs(v.wheels[1].slipAngle));
      if (fa > 1.6 * p.compounds[v.compound].slipAnglePeak && speed - 1.5 < vT) vT = speed - 1.5;
      if (rc.vCap < vT) vT = rc.vCap;
      if (scT >= 0 && scT < vT) vT = scT;
      if (room.vCap < vT) vT = room.vCap;
      if (pd.vT < vT) vT = pd.vT;
      if (rejoin > 0) vT *= 1 - 0.1 * rejoin;
      // Brake feed-forward from the profile deceleration ahead.
      let brakeFF = 0;
      if (aP < -3) {
        const comp = p.compounds[v.compound];
        const muBase = comp.mu * wetGrip(comp, world.state.conditions.wetness);
        const aMax = brakeDecelLimit(p, muBase * gripNow, speed, v.massKg, airDensity(p.airDensity, world.state.conditions.airC));
        brakeFF = clamp(-aP / aMax, 0, 1) * (ai.mistakeKind === 1 ? 0.9 : 1);
      }
      speedControl(car, vT, brakeFF, rc.brake, out);
      // Difficulty throttle cap (the profile's forward pass plans with the same share of the power).
      const pw = st.perfect ? 1 : powerScaleFor(ctx.difficulty);
      if (out.throttle > pw) out.throttle = pw;
      // Pit approach (QC2-12): trail-brake within a friction circle; 0.5 brake at 0.4 steer into T13 stepped the rear
      // out (a smoke trail into the pit entry).
      if (pd.blend > 0) {
        const bMax = 0.7 * (1 - Math.abs(out.steer));
        if (out.brake > bMax) out.brake = bMax > 0.25 ? bMax : 0.25;
      }
      // Recovery: no panic stop (a locked car cannot steer back; cars rejoining at the pit merge slid straight off).
      if (ai.mode === 'recover' && out.brake > 0.5) out.brake = 0.5;
      // Slide guard (power oversteer): past 1.25× the rear peak slip angle the driver lifts; steering already counters.
      const rPk = p.compounds[v.compound].slipAnglePeak * tuning(p).rearAlphaFactor;
      const wa = v.wheels[2].slipAngle;
      const wb = v.wheels[3].slipAngle;
      const ra = Math.max(wa < 0 ? -wa : wa, wb < 0 ? -wb : wb);
      if (ra > 1.25 * rPk) out.throttle *= clamp(1 - (ra - 1.25 * rPk) / rPk, 0, 1);
      out.drsRequest = car.race.drsZone >= 0 && out.brake < 0.05;
      // ERS overtake mode while a move is on (§5.6: max deploy, still capped by the lap budget).
      out.ersOvertake = ai.targetCar >= 0 && ai.overtakeTimer > 0 && out.throttle > 0.9;
    },
  };
  return module;
}
