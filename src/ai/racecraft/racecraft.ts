// Racecraft (planner-report §6.5, Sprint 1 subset): following (IDM-like gap 4 m + 0.25·v), overtake lanes
// (±3 m, inside of the next corner when its brake zone is > 150 m away, else the freer side; abort below 30 %
// overlap at the brake point), side-by-side separation (≥ 2.3 m; outside car −4 % corner speed), avoidance
// (time-to-collision < 1 s, slow car ahead < 30 km/h → wider gap). Defending and blue flags are Sprint 2.
// Writes car.ai only (lane target, mode, timers). Sim layer, allocation-free.

import type { SimCarState, SimWorld } from '../../contracts/sim';
import { lineAt } from '../line/racingLine';
import type { AiContext } from '../context';
import { pitExitTrackD } from '../pit/pitDriver';

const AI_DT = 4 / 240;
const CORRIDOR = 2.2;
const SIDE_GAP = 2.3;
const OVERTAKE_LANE = 3.0;
/** Deceleration (m/s²) taken as full brake pedal for the stopping-gap check. */
const BRAKE_REF = 45;

export interface RacecraftOut {
  /** Speed cap from following / avoidance (m/s), Infinity when free. */
  vCap: number;
  /** Extra brake demand 0..1 from avoidance. */
  brake: number;
  /** Corner-speed factor (outside car side by side). */
  cornerFactor: number;
  /** Committed move on the inside at the brake point: brake a few metres later. */
  late: boolean;
  /** Absolute lateral target (main d) while driving round a stopped car ahead; NaN otherwise. */
  dAbs: number;
}

/** Distance (m) along the line to the next brake zone from s, up to `max`. */
function distToBrakeZone(ctx: AiContext, carId: number, s: number, max: number): number {
  const prof = ctx.profiles[carId]!;
  const line = prof.line;
  const n = line.count;
  const L = ctx.track!.length;
  let sw = s % L;
  if (sw < 0) sw += L;
  const i0 = Math.floor(sw / line.ds);
  const steps = Math.ceil(max / line.ds);
  for (let k = 0; k < steps; k++) {
    if (prof.zone[(i0 + k) % n] === 2) return k * line.ds;
  }
  return max;
}

/** This car's own profile speed (m/s) at main-track s. */
function planSpeed(ctx: AiContext, carId: number, s: number): number {
  const prof = ctx.profiles[carId]!;
  const line = prof.line;
  const L = ctx.track!.length;
  let sw = s % L;
  if (sw < 0) sw += L;
  const f = sw / line.ds;
  const i0 = Math.floor(f);
  const i = i0 % line.count;
  const j = (i + 1) % line.count;
  return prof.v[i]! + (prof.v[j]! - prof.v[i]!) * (f - i0);
}

/** Sign (+1 left / −1 right) of the next corner within `max` m, 0 if none. */
function nextCornerSide(ctx: AiContext, s: number, max: number): number {
  const line = ctx.line!;
  const n = line.count;
  const L = ctx.track!.length;
  let sw = s % L;
  if (sw < 0) sw += L;
  const i0 = Math.floor(sw / line.ds);
  const steps = Math.ceil(max / line.ds);
  for (let k = 0; k < steps; k++) {
    const c = line.curvature[(i0 + k) % n]!;
    if (c > 0.004) return 1;
    if (c < -0.004) return -1;
  }
  return 0;
}

/**
 * Calm racing (pitDrive / pitTraffic 2026-10-25): this car has a pit request or is in a pit phase: no moves, and the
 * pre-2026-10-25 rules (full room, plain following); cars in a pit phase get the same from everyone (keepRoom). With
 * the harder racecraft, 20 cars boxing on one lap went side by side into the İstanbul pit-entry queue (s ≈ 4,617), one
 * moved out round a car that was stopping and a 12.6 kN pile-up blocked the queue (3 resets). Cars not pitting race on
 * normally past the entry and exit (a fixed calm window there cost Bosphorus ~60 % of its passes on the main straight).
 */
/**
 * A car that has not got away (or has stopped): under 1 m/s more than 1 s after the lights, not in a pit phase. Cars in
 * start mode normally do not change lanes round each other; one stalled on the grid (an absent online player, a failed
 * launch) must be driven round, SC or not (user report 2026-10-26: the field stayed stuck behind it under the SC).
 */
function stalled(world: SimWorld, c: SimCarState): boolean {
  const r = world.state.race;
  return c.vehicle.speed < 1 && c.pit.phase === 'none' && r.phase === 'running' && r.lightsOutAtMs >= 0 && r.raceMs - r.lightsOutAtMs > 1000;
}

export function calmZone(_ctx: AiContext, car: SimCarState): boolean {
  return car.pit.phase !== 'none';
}

/** Body-to-body room (m) an AI car leaves a car alongside (user bug 2026-10-13). */
const ROOM = 1.2;
/** Body-to-body room between two AI cars: they race closer (light rubbing allowed, user 2026-10-21); the player keeps ROOM. */
const ROOM_AI = 0.6;
/** Tightest body gap kept side by side before a car gives the place up by lifting (wheels almost touching). */
const ROOM_MIN = 0.3;
// (Next to a human the full ROOM stays the limit: the player is never squeezed, D-051 #6 / sideAwareness.)


/** Racing aggression 0..1: the driver's own trait scaled by the difficulty (d0 ×0.4, d55 ×0.87, d70 ×1.0, d100 ×1.25, d110 ×1.34). */
export function raceAggression(ctx: AiContext, carId: number): number {
  const a = ctx.cars[carId]!.aggression * (0.4 + 0.0086 * ctx.difficulty);
  return a < 0 ? 0 : a > 1 ? 1 : a;
}
/** Closest a car making room may run to the white line (centre, m): wheels just inside it. */
const EDGE_HARD = 0.9;
/** Room-ahead check: ROOM_STEPS points ROOM_STEP m apart. */
const ROOM_STEPS = 5;
const ROOM_STEP = 20;

export interface RoomOut {
  /** Lateral target (main-track d) after leaving room. */
  d: number;
  /** Speed cap (m/s) when there is no room on this car's side and the other car is level or ahead; else Infinity. */
  vCap: number;
}

/**
 * Leave room for every car alongside (player or AI), applied to the car's final lateral target `dT` (racing line,
 * own-line variety, start lanes, rejoin and pit blends, racecraft lanes). User bug 2026-10-13: the side-by-side rule
 * in racecraft() only saw a neighbour closer than 2.3 m centre-to-centre (0.3 m of body gap) and held its lane relative
 * to the racing line at the car's own s, so a car merging back onto the line (after a move, on corner entry, after a
 * pit stop or a recovery) drove into a car 2.5–8 m beside it as if it were not there. AI pairs mostly got away with it
 * (both follow the same line); the player does not follow the AI line.
 * "Alongside" = longitudinal overlap (± body length + 0.5 m) or a faster car behind that overlaps within 1 s, and
 * laterally clear of this car's own lane (|Δd| ≥ 1.5 m; a car in line is a following case). The target is kept at
 * least half-widths + ROOM away on this car's own side; no further toward the edge than 1.1 m inside it. `sag` (signed
 * main d, + = left) is how far pure pursuit cuts toward the inside of the curve between the car and its target
 * (≈ Ld²·κ/8, 3.5 m at T11): a bound on the inside side moves out by it. `yieldBlocked` (pit approach, corner entry /
 * apex / exit): when the room keeps the car > 0.5 m off its target, drop in behind a car ahead of it by more than `yieldBlocked` m
 * behind (−1.5 pit approach: level or ahead; 0 corner: ahead only, so a level pair never both yield; Infinity: a straight,\n * where room is only given laterally: no speed yield of any kind) instead of
 * missing the entry alongside it or being held off its line through the corner (D-051 #6: held on the outside of a
 * turn-in or the inside of an exit, the car ran out of track; it gives the corner up by lifting).
 */
export function keepRoom(ctx: AiContext, world: SimWorld, car: SimCarState, sT: number, dT: number, sag: number, yieldBlocked: number, out: RoomOut): void {
  out.d = dT;
  out.vCap = Infinity;
  const me = car.vehicle;
  if (me.hint.ribbon !== 'main') return;
  const q = ctx.track!;
  const cars = world.state.cars;
  const p = ctx.params[car.id]!;
  const startLanes = car.ai.mode === 'start';
  const line = ctx.line!;
  const L = q.length;
  const calm = calmZone(ctx, car);
  let lo = -Infinity;
  let hi = Infinity;
  let loId = -1;
  let hiId = -1;
  // Tight bounds (ROOM_MIN body gap): a car yields by speed only when not even these fit on the track (it fights for its
  // line side by side instead of lifting, user 2026-10-21).
  let loT = -Infinity;
  let hiT = Infinity;
  // Bounding car is a human: the old rule (squeezed as soon as the room passes the soft edge; the player is never
  // fought for room, D-051 #6 keepRoomEdge).
  let loH = false;
  let hiH = false;
  for (let j = 0; j < cars.length; j++) {
    if (j === car.id) continue;
    const oc = cars[j]!;
    const ov = oc.vehicle;
    if (ov.hint.ribbon !== 'main' || (ov.aux !== undefined && ov.aux.ghostT > 0)) continue;
    // Start lanes: AI cars both in start mode already run 3 m apart on the paired lanes; holding them to this room as
    // well made the lane pairs fight it into T1 (lap-1 contacts ×4). The player's car and remote puppets never run those lanes.
    if (startLanes && oc.control !== 'player' && oc.control !== 'remote' && oc.ai.mode === 'start') continue;
    const dd = ov.d - me.d;
    if (dd < 1.5 && dd > -1.5) continue;
    const ds = q.deltaS(me.s, ov.s);
    const reach = p.bodyLength + 0.5;
    const closing = ov.speed - me.speed;
    if (ds > reach || ds < -reach - (closing > 0 ? closing : 0) - 0.04 * me.speed) continue;
    // Humans, and anyone in a calm zone / pit phase: the full room and the old squeeze rule.
    const human = oc.isPlayer || oc.control === 'remote' || calm || oc.pit.phase !== 'none';
    const gap = 0.5 * (p.bodyWidth + ctx.params[j]!.bodyWidth) + (human ? ROOM : ROOM_AI);
    const gapT = 0.5 * (p.bodyWidth + ctx.params[j]!.bodyWidth) + (human ? ROOM : ROOM_MIN);
    // Room ahead (D-051 #6): with the other car keeping its offset to the line, is there still room for this car on its
    // side over the next 100 m (apex / exit / the second part of a chicane), inside the edge margin? If not, the car on
    // the outside there (or an inside car not level) gives the corner up now, by lifting, while it still can tuck in
    // behind. Held wide to the last moment it was released 10 m off its line at line speed and ran off the track.
    // Only one car of a pair yields (pile-ups 2026-10-16: the car ahead on the outside yielded to the inside car behind
    // it while that one yielded to it, both capped 6 km/h under the other down to a crawl, the field queued behind):
    // the other car must be clearly ahead, or level with me on the inside of the next corner (judged from the s of the
    // car further back, the same for both; no corner: the car further back yields).
    const rel = ov.d - lineAt(line.d, line, ov.s, L);
    const side = dd < 0 ? 1 : -1;
    // Only near a corner (yieldBlocked finite): on a straight the room is given laterally, never by lifting (user report
    // 2026-10-17: AI cars cut the throttle where the player was about to pass them).
    let mine = yieldBlocked !== Infinity && ds > 1.5;
    if (!mine && yieldBlocked !== Infinity && ds > -1.5) {
      const cs = nextCornerSide(ctx, ds > 0 ? me.s : ov.s, ROOM_STEPS * ROOM_STEP);
      mine = cs !== 0 ? side * cs < 0 : ds > 0;
    }
    for (let k = 1; mine && k <= ROOM_STEPS; k++) {
      const sp = me.s + k * ROOM_STEP;
      q.frameAt(sp, ctx.frame);
      const need = lineAt(line.d, line, sp, L) + rel + side * gapT;
      const edge = side > 0 ? ctx.frame.halfWidthL - 1.1 : -(ctx.frame.halfWidthR - 1.1);
      if (side * (need - edge) > 0.3) {
        const v = ov.speed - 2;
        if (v < out.vCap) out.vCap = v > 3 ? v : 3;
        break;
      }
    }
    if (dd < 0) {
      if (ov.d + gap > lo) { lo = ov.d + gap; loId = j; loH = human; }
      if (ov.d + gapT > loT) loT = ov.d + gapT;
    } else {
      if (ov.d - gap < hi) { hi = ov.d - gap; hiId = j; hiH = human; }
      if (ov.d - gapT < hiT) hiT = ov.d - gapT;
    }
  }
  if (loId < 0 && hiId < 0) return;
  if (sag < 0) lo -= sag;
  else hi -= sag;
  q.frameAt(sT, ctx.frame);
  let eHi = ctx.frame.halfWidthL - 1.1 - (sag > 0 ? sag : 0);
  let eLo = -(ctx.frame.halfWidthR - 1.1) - (sag < 0 ? sag : 0);
  if (ctx.pit && ctx.cars[car.id]!.fromPit === 0) {
    eHi = pitExitTrackD(q, ctx.pit, sT, eHi, ctx.frame);
    eLo = pitExitTrackD(q, ctx.pit, sT, eLo, ctx.frame);
  }
  let squeezedBy = -1;
  // D-051 #6: never past the edge margin to make room (a car already wider holds its d, but no wider than EDGE_HARD
  // inside the white line); with no room left on the track this car yields by speed below instead.
  let hHi = ctx.frame.halfWidthL - EDGE_HARD - (sag > 0 ? sag : 0);
  let hLo = -(ctx.frame.halfWidthR - EDGE_HARD) - (sag < 0 ? sag : 0);
  if (ctx.pit && ctx.cars[car.id]!.fromPit === 0) {
    hHi = pitExitTrackD(q, ctx.pit, sT, hHi, ctx.frame);
    hLo = pitExitTrackD(q, ctx.pit, sT, hLo, ctx.frame);
  }
  if (lo > eHi) {
    lo = me.d > eHi ? (me.d < lo ? me.d : lo) : eHi;
    if (lo > hHi) lo = hHi;
    if (loH || loT - sag * (sag < 0 ? 1 : 0) > hHi) squeezedBy = loId;
  }
  if (hi < eLo) {
    hi = me.d < eLo ? (me.d > hi ? me.d : hi) : eLo;
    if (hi < hLo) hi = hLo;
    if (hiH || hiT - sag * (sag > 0 ? 1 : 0) < hLo) squeezedBy = hiId;
  }
  let d = dT;
  let by = -1;
  if (lo > hi) d = 0.5 * (lo + hi);
  else if (d < lo) { d = lo; by = loId; }
  else if (d > hi) { d = hi; by = hiId; }
  out.d = d;
  // Against the player the corner yield keeps its old threshold (level or ahead: the player's car keeps its full room,
  // sideAwareness); between AI cars only a car clearly ahead is yielded to (they race side by side).
  const pl = by >= 0 && (cars[by]!.isPlayer || cars[by]!.control === 'remote');
  const yb = pl && yieldBlocked > 0 && yieldBlocked !== Infinity ? 0 : yieldBlocked;
  if (by >= 0 && (d - dT > 0.5 || dT - d > 0.5)) {
    const ob = cars[by]!.vehicle;
    const ahead = q.deltaS(me.s, ob.s);
    // Level with the player (not clearly ahead) on the inside of the next corner: hold the inside, the room is given
    // laterally (the AI braked 10 km/h off 90 m before İstanbul T3 with the player level on the outside, user 2026-10-21).
    let give = ahead > yb;
    if (give && ahead < 1.5 && !calm) {
      const cs = nextCornerSide(ctx, me.s, 150);
      if (cs !== 0 && (me.d > ob.d ? 1 : -1) * cs > 0) give = false;
    }
    // 4 m/s under its speed to drop in behind, less once it is clear ahead and pulling away (no lift behind a car going
    // away; while still overlapping the full 4 m/s, else the car held off its line ran out of track, keepRoomEdge).
    const away = !calm && ahead > p.bodyLength ? ob.speed - me.speed : 0;
    const v = ob.speed - 4 + (away > 2 ? 4 : away > 0 ? 2 * away : 0);
    if (give && v < out.vCap) out.vCap = v > 3 ? v : 3;
  }
  // No room on my side: the car not clearly ahead yields (drops in behind) rather than squeezing the other off.
  if (squeezedBy >= 0 && yieldBlocked !== Infinity) {
    const o = cars[squeezedBy]!.vehicle;
    if (q.deltaS(me.s, o.s) > -1.5 && o.speed - 1 < out.vCap) out.vCap = o.speed - 1 > 3 ? o.speed - 1 : 3;
  }
}

export function racecraft(ctx: AiContext, world: SimWorld, car: SimCarState, out: RacecraftOut): void {
  const q = ctx.track!;
  const line = ctx.line!;
  const L = q.length;
  const cars = world.state.cars;
  const me = car.vehicle;
  const ai = car.ai;
  const st = ctx.cars[car.id]!;
  const speed = me.speed;
  out.vCap = Infinity;
  out.brake = 0;
  out.cornerFactor = 1;
  out.late = false;
  out.dAbs = NaN;
  if (me.hint.ribbon !== 'main') return;
  const lineD = lineAt(line.d, line, me.s, L);
  // Safety car out (deployed, or coming in until the leader takes the line: race/safetyCar.ts penalises any gain over a
  // racing car then): no racing at all, the calm rules plus the SC queue below (user bug 2026-10-26).
  const scOut = world.state.race.sc.phase !== 'none';
  const calm = calmZone(ctx, car) || scOut;

  let aheadId = -1;
  let aheadDs = 80;
  let sideId = -1;
  let sideAbs = SIDE_GAP;
  for (let j = 0; j < cars.length; j++) {
    if (j === car.id) continue;
    const o = cars[j]!.vehicle;
    if (o.hint.ribbon !== 'main') continue;
    const ds = q.deltaS(me.s, o.s);
    if (ds < -6 || ds > 80) continue;
    const dd = o.d - me.d;
    const add = dd < 0 ? -dd : dd;
    // Ahead = in my lane now, or on my planned path (line + lane offset) where it is (a car slowed on the apex
    // kerb was only "ahead" once the follower had already swung across to the apex).
    const pd = o.d - (lineAt(line.d, line, o.s, L) + ai.laneOffset);
    const inPath = ds > 0 && ds < 40 && (pd < 0 ? -pd : pd) < CORRIDOR;
    // A car just outside the corridor that I am closing on fast (it brakes first) counts too: lanes 2.0–2.5 m apart converge
    // into a corner (İstanbul T1 after an SC restart: the follower 2.1 m to the side braked late and hit it, a D-056 penalty).
    const fastClose = add < CORRIDOR + 0.8 && speed - o.speed > 3;
    // Overlapping (its rear not yet clear of my nose, < 5.6 m) it is alongside, not ahead: followed only when it is truly
    // in my lane (< 2 m); else side by side is kept by keepRoom and nobody lifts (user 2026-10-21: the AI lifted when a
    // car came alongside into a corner).
    const overlap = ds < 5.6 && !calm;
    if (ds > 0 && (overlap ? add < 2.0 : add < CORRIDOR || inPath || fastClose) && ds < aheadDs) {
      aheadDs = ds;
      aheadId = j;
    }
    const ads = ds < 0 ? -ds : ds;
    if (ads < 5.8 && add < sideAbs) {
      sideAbs = add;
      sideId = j;
    }
  }

  // ---- Following and avoidance ----
  // Towing (S2-S5): on a straight the follower closes into the slipstream (gap 4 + 0.06·v ≈ 9 m at 300 km/h)
  // before it pulls out; with the 0.25 s gap it sat 25–30 m back, out of the tow, and a pass on equal power never got
  // alongside. Kept into the brake zone: the plan-relative cap and the stopping-gap check below handle a leader that
  // brakes earlier (a gap that jumped back to 0.25 s 150 m before the zone braked the follower on the straight).
  const towing = ai.mode !== 'start'
    && Math.abs(lineAt(line.curvature, line, me.s, L)) < 0.004 && Math.abs(lineAt(line.curvature, line, me.s + 40, L)) < 0.004;
  // Just reset (ghosted: no contact for 3 s) behind a stopped car: drive through it. Held at a creep behind a stalled car
  // on the grid, a reset car was put back on the same spot and reset again every 3.3 s (2026-10-26).
  if (aheadId >= 0 && me.aux !== undefined && me.aux.ghostT > 0 && cars[aheadId]!.vehicle.speed < 1) aheadId = -1;
  if (aheadId >= 0) {
    const o = cars[aheadId]!.vehicle;
    // 0.15 s in corners from lap 2 (QC2-05: 0.25 s kept a faster car out of reach); lap 1 keeps 0.25 s (the packed
    // field concertinaed into the T12 hairpin at 0.15 s, seed 19).
    // From lap 2 harder racers sit closer in corners (0.15 s → 0.09 s at full aggression) to be in range on the exit.
    const gap = 4 + (towing ? 0.05 : car.race.lapsCompleted < 1 ? 0.25 : 0.15 - 0.06 * raceAggression(ctx, car.id)) * speed;
    // Leader's speed 0.4 s ahead (its braking is known from its deceleration; Sprint 1 used the current speed
    // only, so trains rear-ended into the T12 brake zone).
    const oAx = o.axLong < 0 ? o.axLong : 0;
    // Predicted with its acceleration too (QC2-05: braking-only prediction capped a faster follower below the leader's
    // speed on every corner exit, so it dropped 10–15 m back each time and never got a run). Lap 1: braking only.
    const vLead = o.speed + 0.4 * (car.race.lapsCompleted < 1 ? oAx : o.axLong);
    // Relative to this car's own plan (S2-S5): the leader's deficit = my profile speed where it will be in 0.4 s
    // minus its predicted speed; I follow my own profile minus that deficit, plus the gap term. A leader braking
    // for the same corner on the same curve costs nothing (the Sprint 1 cap on its absolute speed made followers
    // brake 30–45 m early at every corner, so a 1 s/lap faster car never got close enough to pass).
    const deficit = planSpeed(ctx, car.id, o.s + 0.4 * o.speed) - vLead;
    // Inside the gap behind a car pulling away (it just passed me, user 2026-10-21) the gap opens by itself: the pull-back
    // term fades out over 0–2 m/s of its speed advantage (it braked a just-passed car 20–30 km/h on the corner exit).
    let gT = 0.5 * (aheadDs - gap);
    if (gT < 0) {
      const f = 1 - 0.5 * (o.speed - speed);
      gT *= f < 0 ? 0 : f > 1 ? 1 : f;
    }
    let cap = planSpeed(ctx, car.id, me.s) - (deficit > 0 ? deficit : 0) + gT;
    // In the tow the leader often runs above my no-tow plan speed (DRS, its own tow): close up on its actual speed
    // (QC2-05: the plan cap parked followers ~20 m back on every DRS straight, out of reach of a pass).
    if (towing) {
      const capT = vLead + 0.5 * (aheadDs - gap);
      if (capT > cap) cap = capT;
    }
    // Never park behind a stopped car: crawl while the lane change takes us around it.
    const crawl = o.speed < 30 / 3.6 && aheadDs > 7 ? 6 : 0;
    if (cap < crawl) cap = crawl;
    // Going round it (a move on this slow car with the lane target clear of it, D-056 field deadlock behind a car stopped
    // on the line): walking pace even when close, so the car can steer out; braking only when nose to tail in its lane.
    const ddO = o.d - me.d;
    const tgtClear = o.d - (lineD + ai.laneTarget);
    const goingRound = o.speed < 30 / 3.6 && ai.mode === 'overtake' && ai.targetCar === aheadId && (tgtClear > 2.4 || tgtClear < -2.4);
    const noseToTail = aheadDs < 6 && ddO < 1.9 && ddO > -1.9;
    if (goingRound && cap < 3) cap = 3;
    // Still in line behind the stopped car (< 2.3 m to the side): ease in so the lane change completes before the nose gets
    // there (a car on the grid slot behind a stalled one pushed against its gearbox at 24 km/h, 2026-10-26).
    if ((goingRound || (o.speed < 1 && aheadDs < 30)) && (ddO < 2.4 && ddO > -2.4)) {
      const cr = 0.5 * (aheadDs - 8);
      if (cap > cr) cap = cr > 0.3 ? cr : 0.3;
    }
    // A leader going away (≥ 2 m/s faster, not braking) is no obstacle: the plan cap at my own position held a car
    // just passed off the throttle on the corner exit (user 2026-10-21); the closing checks below still apply.
    const goingAway = !calm && o.speed - speed > 2 && o.axLong > -3;
    out.vCap = goingAway ? Infinity : cap > 0 ? cap : 0;
    // Closing speed against this car's own plan: I will be at most at my profile speed where the leader is now, so
    // a leader that is simply braking for the same corner is not an obstacle (S2-S5: comparing raw speeds made every
    // follower brake 40–80 m early behind a car already in the brake zone; nobody ever got close enough to pass).
    const vPlan = planSpeed(ctx, car.id, o.s);
    const vMe = speed < vPlan ? speed : vPlan;
    const closing = vMe - o.speed - 0.5 * oAx;
    if (closing > 0.1 && (!goingRound || noseToTail)) {
      const ttc = (aheadDs - 5.6) / closing;
      if (ttc < 1) out.brake = ttc < 0 ? 1 : 1 - ttc;
    }
    // Stopping-gap check: extra deceleration needed to cancel the closing speed before contact, on top of what
    // this car already does (trains rear-ended in the T12 brake zone: the follower in dirty air brakes later).
    const raw = vMe - o.speed;
    if (raw > 0 && (!goingRound || noseToTail)) {
      // Lap 1: 1.5 m more buffer (packed field, cold tyres; Sprint 4 paired start lanes: T3 rear-ends at ~5 kN·s).
      const dGap = aheadDs - (car.race.lapsCompleted < 1 ? 7.5 : 6);
      const need = (raw * raw) / (2 * (dGap > 0.5 ? dGap : 0.5));
      if (need > 2) {
        const b = ((me.axLong < 0 ? -me.axLong : 0) + need) / BRAKE_REF;
        if (b > out.brake) out.brake = b > 1 ? 1 : b;
      }
    }
    // Slow or stopped car ahead: steer to the wider gap (not off the grid: a car ahead that is itself still in
    // its start phase is accelerating, not stopped; Sprint 1 turned every start into a lane-change scramble).
    // (Not round a car queueing for the pit entry in the calm zone: that is the queue, not a stopped car.)
    if (o.speed < 30 / 3.6 && aheadDs < 60 && !(ai.mode === 'start' && cars[aheadId]!.ai.mode === 'start' && !stalled(world, cars[aheadId]!)) && !(calm && cars[aheadId]!.pit.phase !== 'none') && !(scOut && o.speed > 4 && cars[aheadId]!.race.status === 'running')) {
      q.frameAt(o.s, ctx.frame);
      const roomL = ctx.frame.halfWidthL - o.d;
      const roomR = ctx.frame.halfWidthR + o.d;
      const side = roomL > roomR ? 1 : -1;
      // (Relative to the line abeam the stopped car: the line moves across the road, and a lane taken at my own s left the car
      // only 1.5 m beside it there, 2026-10-26.)
      ai.laneTarget = o.d + side * 3.4 - lineAt(line.d, line, o.s, L);
      // Steered as an absolute lane abeam it: the line-relative lane drifted with the line (and its 40 m track-limit
      // check) and a car one grid slot behind a stalled one ended 1.5 m beside it, nose against its corner (2026-10-26).
      q.frameAt(o.s, ctx.frame);
      const lim = side > 0 ? ctx.frame.halfWidthL - 1.2 : -(ctx.frame.halfWidthR - 1.2);
      const want = o.d + side * 3.4;
      out.dAbs = side * want > side * lim ? lim : want;
      ai.mode = st.perfect ? 'perfect' : 'overtake';
      ai.overtakeTimer = 3;
      ai.targetCar = aheadId;
    }
  }

  // ---- Overtaking ----
  const perfect = ai.mode === 'perfect' || st.perfect;
  if (ai.mode === 'overtake' || (perfect && ai.overtakeTimer > 0)) {
    ai.overtakeTimer -= AI_DT;
    const t = ai.targetCar >= 0 ? cars[ai.targetCar]!.vehicle : null;
    const dsT = t ? q.deltaS(me.s, t.s) : -100;
    // Done (passed or timed out) or abort below 30 % overlap at the brake point.
    const brakeNow = distToBrakeZone(ctx, car.id, me.s + 0.15 * speed, 10) < 10;
    // Committed (QC2-05): on the inside of the next corner with the nose at least level with the rear wheels the
    // move goes on into the corner (brake a few metres later, side-by-side rules below); otherwise abort below 30 %
    // overlap at the brake point as before.
    let committed = false;
    // (A harder racer commits from further back: nose up to 1.5 m behind the target's tail at full aggression.)
    if (t && dsT > -6 && dsT < 4.5 + 2.6 * raceAggression(ctx, car.id)) {
      const cs = nextCornerSide(ctx, me.s, 250);
      committed = cs !== 0 && (me.d - t.d) * cs > 1.2;
      if (committed) {
        out.late = dsT > -2;
        if (ai.overtakeTimer < 1) ai.overtakeTimer = 1;
      }
    }
    // Going round a stopped / crawling car is not a move to abort at the brake point (SC test, Ardennes: the queue behind
    // a car stopped on the line near T5 dropped back onto the line every tick and pushed nose to tail at walking pace).
    const aroundSlow = t !== null && t.speed < 30 / 3.6;
    if (dsT < -6 || ai.overtakeTimer <= 0 || (brakeNow && dsT > 0.7 * 5.6 && !committed && !aroundSlow) || (calm && !aroundSlow && dsT > 0)) {
      ai.mode = st.perfect ? 'perfect' : 'race';
      ai.overtakeTimer = 0;
      ai.laneTarget = 0;
      ai.targetCar = -1;
    }
  } else if (aheadId >= 0 && ai.mode !== 'start' && ai.mode !== 'recover') {
    const o = cars[aheadId]!.vehicle;
    const aggression = raceAggression(ctx, car.id);
    const closing = speed - o.speed;
    // Sprint 1: moves start only on straights (no lane changes mid-corner).
    // User 2026-10-25 ("still not aggressive"): also from a corner exit onto a straight (the run out of the corner is
    // where a faster car gets alongside), not only once both car and lead point are on the straight.
    const straight = Math.abs(lineAt(line.curvature, line, me.s + 20, L)) < 0.004 && Math.abs(lineAt(line.curvature, line, me.s, L)) < 0.004;
    const exitRun = !straight && Math.abs(lineAt(line.curvature, line, me.s + 40, L)) < 0.004 && Math.abs(lineAt(line.curvature, line, me.s + 90, L)) < 0.004 && aheadDs < 15 && closing > 0.5;
    const brakeDist = straight || exitRun ? distToBrakeZone(ctx, car.id, me.s, 300) : 0;
    // §6.5: a move starts within 25 m (the tow gap above lets a follower get there on a straight).
    // Pull out late (QC2-05): stay in the tow until close or the brake zone nears; pulling out at 25 m dropped the
    // tow and the attacker fell back 20–40 m before the brake point (13 of 14 moves).
    const pullOut = aheadDs < 14 || (brakeDist < 260 && aheadDs < 28);
    // Never a move on a car in a pit phase (entering / leaving the lane; the pit-exit corridor is kept by aiModule).
    if ((straight || exitRun) && brakeDist > 45 && pullOut && !calm && cars[aheadId]!.pit.phase === 'none' && (closing > 0.25 * (1.3 - aggression) || me.slipstream > 0.2 || me.drs.open)) {
      q.frameAt(me.s, ctx.frame);
      let side: number;
      if (brakeDist > 150) side = nextCornerSide(ctx, me.s + brakeDist, 400) || 1;
      else {
        const roomL = ctx.frame.halfWidthL - o.d;
        const roomR = ctx.frame.halfWidthR + o.d;
        side = roomL > roomR ? 1 : -1;
      }
      const room = side > 0 ? ctx.frame.halfWidthL - 1.2 - o.d : ctx.frame.halfWidthR - 1.2 + o.d;
      if (room > 2.4) {
        ai.mode = perfect ? ai.mode : 'overtake';
        ai.targetCar = aheadId;
        ai.overtakeTimer = 6;
        ai.laneTarget = o.d + side * OVERTAKE_LANE - lineD;
      }
    }
  }

  // ---- Side by side: keep ≥ 2.3 m centre-to-centre ----
  if (sideId >= 0) {
    const o = cars[sideId]!.vehicle;
    const side = me.d > o.d || (me.d === o.d && car.id > sideId) ? 1 : -1;
    const want = o.d + side * (SIDE_GAP + 0.2);
    ai.laneTarget = want - lineD;
    const c = lineAt(line.curvature, line, me.s + 20, L);
    // Outside car (on the side away from the corner) gives up 4 % of corner speed.
    // (1–4 %: less the harder it races, so it holds its place round the outside instead of lifting, user 2026-10-21.)
    if ((c > 0.004 && side < 0) || (c < -0.004 && side > 0)) out.cornerFactor = 1 - 0.04 * (1 - 0.75 * raceAggression(ctx, car.id));
    // No room on my side (the lane would leave the track): the car not clearly ahead yields and tucks in behind
    // instead of being squeezed off (S2-S2: lap-1 offs at T5 and T8).
    q.frameAt(me.s + 10, ctx.frame);
    const edge = side > 0 ? ctx.frame.halfWidthL - 1.1 : -(ctx.frame.halfWidthR - 1.1);
    const squeezed = side > 0 ? want > edge : want < edge;
    const dsO = q.deltaS(me.s, o.s);
    // (Not on a straight: there the lane is held at the edge and nobody lifts; user report 2026-10-17.)
    const onStraight = Math.abs(c) < 0.004 && Math.abs(lineAt(line.curvature, line, me.s, L)) < 0.004 && distToBrakeZone(ctx, car.id, me.s, 60) >= 60;
    if (squeezed && dsO > -1.5 && !onStraight) {
      // Already (slightly) ahead of a crawling car: creep on instead of stopping. That car follows this one as
      // "ahead", so two cars at rest side by side each waited for the other (Bosphorus T1 lap-1 deadlock).
      let cap = o.speed - 1.5;
      if (dsO < 0 && cap < 3) cap = 3;
      if (cap < out.vCap) out.vCap = cap > 0 ? cap : 0;
      ai.laneTarget = edge - lineD;
    }
  }

  // ---- Lane relaxation: with no move, no neighbour and no avoidance in progress the car returns to the line
  // (Sprint 1 kept side-by-side lane targets for the rest of the lap; offset cars clipped the T8 inside kerb). ----
  if (ai.mode !== 'overtake' && ai.overtakeTimer <= 0 && sideId < 0 && ai.mode !== 'start') {
    ai.laneTarget = 0;
    // Situational lines (user request), rate-limited through laneOffset (no snapping):
    //  - dirty air in a corner: take an offset line out of the leader's wake (clean air on its outside);
    //  - defending: a car within 25 m behind before a brake zone → cover the inside by up to 1 m (light, so a faster car
    //    still gets by on the brakes or the exit).
    const split = q.data.pit.mainSAtSplit;
    const nearPit = split >= 0 && q.deltaS(split, me.s) > -150 && q.deltaS(split, me.s) < 100;
    const cs = nearPit ? 0 : nextCornerSide(ctx, me.s, 160);
    if (aheadId >= 0 && me.dirtyAir > 0.35 && cs !== 0) {
      const o = cars[aheadId]!.vehicle;
      const away = me.d >= o.d ? 1 : -1;
      ai.laneTarget = away * 1.0 * (me.dirtyAir < 1 ? me.dirtyAir : 1);
    } else if (cs !== 0 && ai.mode === 'race') {
      let behind = 999;
      for (let j = 0; j < cars.length; j++) {
        if (j === car.id) continue;
        const o = cars[j]!.vehicle;
        if (o.hint.ribbon !== 'main') continue;
        const ds = q.deltaS(o.s, me.s);
        if (ds > 0 && ds < behind) behind = ds;
      }
      // One defensive move: the full cover as soon as the attacker is within 25 m before the brake zone, then held (a lane
      // that followed the gap moved again as the attacker closed). Harder racers cover more.
      if (behind < 20 + 15 * raceAggression(ctx, car.id) && distToBrakeZone(ctx, car.id, me.s, 200) < 200) ai.laneTarget = cs * (0.6 + 0.6 * raceAggression(ctx, car.id));
    }
  }

  // ---- Safety car queue: hold the place in line. Every racing car ahead within 60 m counts, whatever its lateral offset (a car
  // a lane to the side is still ahead in the order: İstanbul seed 1234 a car 5.8 m wide drove past one at 119 vs 40 km/h, +5 s);
  // only a stopped / crawling or retired car, or one in the pits, may be passed (the director's rule).
  if (scOut) {
    if (ai.mode !== 'overtake') ai.laneTarget = 0;
    let qDs = 60;
    let qId = -1;
    for (let j = 0; j < cars.length; j++) {
      if (j === car.id) continue;
      const oc = cars[j]!;
      const o = oc.vehicle;
      if (o.hint.ribbon !== 'main' || oc.pit.phase !== 'none' || oc.race.status !== 'running' || oc.race.finished || o.speed < 4) continue;
      const ds = q.deltaS(me.s, o.s);
      if (ds > 0 && ds < qDs) { qDs = ds; qId = j; }
    }
    if (qId >= 0) {
      const o = cars[qId]!.vehicle;
      // Overlapping it (a move under way when the SC came out): drop back behind it at once, it brakes hard for the queue
      // too (İstanbul seed 1234: a pass 1.4 m from done at the deployment completed 0.2 s later, +5 s).
      const cap = qDs < 6 ? o.speed - 3 : o.speed + 0.5 * (qDs - 12);
      if (cap < out.vCap) out.vCap = cap > 0 ? cap : 0;
      if (qDs < 8 && speed > o.speed - 1) {
        const b = 0.3 + 0.25 * (speed - o.speed + 1);
        if (b > out.brake) out.brake = b > 1 ? 1 : b;
      }
    }
  }

  // ---- Track limits for every lane: the lane is relative to the line, which crosses the track; a lane picked on the
  // straight ran 2 m past the inside edge at the T8 entry (recover at 270 km/h). Keep the lane 1.2 m inside both
  // edges 40 m ahead.
  if (ai.laneTarget !== 0) {
    q.frameAt(me.s + 40, ctx.frame);
    const lA = lineAt(line.d, line, me.s + 40, L);
    const tA = lA + ai.laneTarget;
    const hiA = ctx.frame.halfWidthL - 1.2;
    const loA = -(ctx.frame.halfWidthR - 1.2);
    if (tA > hiA) ai.laneTarget = hiA - lA;
    else if (tA < loA) ai.laneTarget = loA - lA;
  }

  // ---- Lane-change guard: never move across into the path of a car ahead that we are closing on fast (an
  // aborted pass tucked back in at 300 km/h onto a 180 km/h train at T9). Hold the current lane and brake in it.
  const tgtD = lineD + ai.laneTarget;
  if ((tgtD - me.d > 0.3 || me.d - tgtD > 0.3) && sideId < 0) {
    for (let j = 0; j < cars.length; j++) {
      if (j === car.id) continue;
      const o = cars[j]!.vehicle;
      if (o.hint.ribbon !== 'main') continue;
      const ds = q.deltaS(me.s, o.s);
      if (ds <= 0 || ds > 70 || speed - o.speed < 3) continue;
      const inPath = (o.d - tgtD < CORRIDOR && tgtD - o.d < CORRIDOR) || (o.d - me.d) * (o.d - tgtD) < 0;
      const inLane = o.d - me.d < CORRIDOR && me.d - o.d < CORRIDOR;
      if (inPath && !inLane) {
        ai.laneTarget = me.d - lineD;
        break;
      }
    }
  }
}
