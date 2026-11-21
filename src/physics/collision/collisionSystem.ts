// CollisionSystem (ARCHITECTURE §4.1 row 5; planner-report §5.9, §5.10 NaN guard). Writes car.vehicle pose and
// velocity corrections, wallImpulse/carImpulse/resetCount/sparks and the physics aux timers; emits `collision`
// and `carReset`. Sim layer, allocation-free (events aside).
//
// Walls: OBB corners (bodyLength × bodyWidth) against TrackQuery.wallsNear(radius 6); push-out by the deepest
//        penetration, impulse at that corner j = −(1+e)·vn / (1/m + (r×n)²/Izz), e = 0.25, Coulomb friction μ 0.35.
// Cars:  pairs closer than 6 m, 2D SAT on the two OBBs, MTV split by inverse mass, impulse e = 0.15, μ = 0.25,
//        clamped to 30 kN·s. Cars inside their 3 s post-reset window do not collide with cars.
// Recovery: < 2 km/h for 4 s while off track or while the driver asks for throttle, NaN state, more than 5 m
//        beyond a barrier line, or an AI stuck timer > 4 s → reset onto the nearest in-limits point, v = 0,
//        `carReset`, 3 s ghosting.
// Online (P3c, multiplayer §6.2): 'remote' puppets are kinematic. No reset/walls for them; remote–remote pairs are
//        skipped; a local–remote pair gives the local car only its half of the two-body impulse (scaled by
//        opts.remoteContactScale, ≤ 15 kN·s per 200 ms episode), a soft separation (30 % of the overlap per tick,
//        ≤ 0.5 m/s + 20 m/s per m of overlap) and ONE `collision` event per episode (a = local, b = remote, n from a to b, impulse = the episode
//        total when it passes 300 N·s). The puppet is credited with the response its owner applied but its samples do
//        not show yet (+credit·n/m_b, decaying over opts.remoteResponseDelayMs), so the local car converges like the
//        offline pair instead of absorbing the whole closing speed against a stale puppet. No contact before lights out + 1 s or while either car
//        has aux.ghostT > 0 (the glue sets it on a puppet for its reset ghost and after a (re)connect).

import type { SimCarState, SimSystem, SimWorld } from '../../contracts/sim';
import type { TrackFrame, WallHit } from '../../contracts/track';
import type { VehicleParams, VehicleState } from '../../contracts/vehicle';
import { yawFromDir } from '../../contracts/frames';
import {
  CONTACT_J_MAX, type ContactEpisodes, contactAccumulate, contactApplied, contactCredit, contactTolerance, createContactEpisodes,
} from '../remote/contact';
import { aux } from '../state';

const WALL_E = 0.25;
const WALL_MU = 0.35;
const CAR_E = 0.15;
const CAR_MU = 0.25;
const CAR_J_MAX = 30_000;
const SPARK_VN = 3;
const MAX_WALLS = 6;
const STUCK_SPEED = 2 / 3.6;
const STUCK_TIME = 4;
/** AI cars are reset just before 4 s so no car is ever stuck longer than 4 s (S8 acceptance). */
const AI_STUCK_TIME = 3.3;
const GHOST_TIME = 3;
const ESCAPE_M = 5;
/** Soft separation of a local–remote overlap: share of the overlap per tick, capped as a push speed (m/s). */
const REMOTE_SEP_SHARE = 0.3;
const REMOTE_SEP_V = 0.5;
/** Deviation from §6.2 (0.5 m/s flat): the cap grows 20 m/s per m of overlap beyond the tolerance, so a car leaning into
 *  the local one cannot hold a lasting 0.15 m overlap (T13: no overlap > 300 ms); still positional only, nobody is launched. */
const REMOTE_SEP_GAIN = 20;
/** No contact with remote cars until this long after lights out (grid start). */
const REMOTE_GRID_GHOST_MS = 1000;
/** Corners within this of the support distance belong to the supporting face (m, ≈ 3° of yaw over a 2 m face). */
const FACE_EPS = 0.1;

export interface CollisionOptions {
  /**
   * Online glue (P3c): contact scale of a local–remote pair by the remote car's id, normally
   * `contactScale(rttMs, sampleAgeMs)` from physics/remote/contact. 1 = full, 0 = no contact. Default 1.
   */
  remoteContactScale?(remoteCarId: number): number;
  /**
   * Online glue: ms until the remote owner's response to a local hit shows in its puppet (≈ RTT/2 + 50 ms relay tick).
   * Default 100 ms.
   */
  remoteResponseDelayMs?(remoteCarId: number): number;
  /**
   * Episode memory shared with the glue's relayed contacts (`contactTopUp`), so a hit is applied once per episode whichever
   * path sees it first. Default: a private one (created on the first local–remote overlap).
   */
  episodes?: ContactEpisodes;
}

function finite(n: number): boolean {
  return n === n && n !== Infinity && n !== -Infinity;
}

function vehicleFinite(v: VehicleState): boolean {
  return finite(v.x) && finite(v.z) && finite(v.vx) && finite(v.vz) && finite(v.yaw) && finite(v.yawRate) && finite(v.speed)
    && finite(v.wheels[0].omega) && finite(v.wheels[1].omega) && finite(v.wheels[2].omega) && finite(v.wheels[3].omega);
}

export function createCollisionSystem(opts: CollisionOptions = {}): SimSystem {
  const hits: WallHit[] = [];
  for (let i = 0; i < MAX_WALLS; i++) hits.push({ nx: 0, nz: 0, px: 0, pz: 0, dist: 0, wallId: 0, kind: 'concrete' });
  const frame: TrackFrame = {
    s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0,
  };
  const pos = { x: 0, y: 0, z: 0 };
  const corner = new Float64Array(8);
  const cornerB = new Float64Array(8);

  const fillCorners = (v: VehicleState, p: VehicleParams, out: Float64Array): void => {
    const hl = p.bodyLength * 0.5;
    const hw = p.bodyWidth * 0.5;
    const fx = Math.cos(v.yaw);
    const fz = -Math.sin(v.yaw);
    const lx = -Math.sin(v.yaw);
    const lz = -Math.cos(v.yaw);
    let k = 0;
    for (let a = -1; a <= 1; a += 2) {
      for (let c = -1; c <= 1; c += 2) {
        out[k++] = fx * hl * a + lx * hw * c;
        out[k++] = fz * hl * a + lz * hw * c;
      }
    }
  };

  /** Reset onto the nearest in-limits point at the car's s, facing the driving direction, at rest. */
  const resetCar = (world: SimWorld, car: SimCarState): void => {
    const q = world.static.track.query;
    const p = world.static.params[car.id]!;
    const v = car.vehicle;
    let s = finite(v.s) ? v.s : finite(v.hint.s) ? v.hint.s : 0;
    s = q.wrapS(s);
    q.frameAt(s, frame);
    let d = finite(v.d) ? v.d : 0;
    const maxL = frame.halfWidthL - 1.3;
    const maxR = frame.halfWidthR - 1.3;
    d = d > maxL ? maxL : d < -maxR ? -maxR : d;
    q.worldFromSD(s, d, pos);
    v.x = pos.x;
    v.y = pos.y;
    v.z = pos.z;
    v.yaw = yawFromDir(frame.tx, frame.tz);
    v.vx = 0; v.vz = 0; v.yawRate = 0; v.vLong = 0; v.vLat = 0; v.speed = 0; v.axLong = 0; v.ayLat = 0;
    v.pitch = 0; v.roll = 0; v.steerAngle = 0;
    v.s = s;
    v.d = d;
    v.hint.s = s; v.hint.ribbon = 'main'; v.hint.sp = NaN;
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i]!;
      w.omega = 0; w.slipRatio = 0; w.slipAngle = 0; w.fx = 0; w.fy = 0; w.locked = false;
      w.hint.s = s; w.hint.ribbon = 'main'; w.hint.sp = NaN;
      if (!finite(w.brakeTempC)) w.brakeTempC = 300;
      const t = v.tyres[i]!;
      if (!finite(t.surfC) || !finite(t.coreC)) { t.surfC = 80; t.coreC = 80; }
      if (!finite(t.wear)) t.wear = 0;
      if (!finite(t.gripMul)) t.gripMul = 1;
    }
    v.gear = 1; v.shiftTimer = 0; v.clutch = 0; v.rpm = p.idleRpm; v.limiterHit = false;
    v.drs.open = false; v.drs.flap = 0;
    if (!finite(v.ers.socJ)) v.ers.socJ = 0;
    v.resetCount++;
    const x = aux(v);
    x.ghostT = GHOST_TIME;
    x.stuckT = 0;
    x.axF = 0;
    x.ayF = 0;
    world.events.push({ type: 'carReset', car: car.id });
  };

  const walls = (world: SimWorld, car: SimCarState): void => {
    const q = world.static.track.query;
    const p = world.static.params[car.id]!;
    const v = car.vehicle;
    const n = q.wallsNear(v.x, v.z, 6, hits, MAX_WALLS);
    if (n === 0) return;
    const m = v.massKg;
    const izz = p.yawInertiaPerKg * m;
    for (let k = 0; k < n; k++) {
      const h = hits[k]!;
      fillCorners(v, p, corner);
      let deepest = 0;
      let rx = 0;
      let rz = 0;
      for (let c = 0; c < 4; c++) {
        const cx = v.x + corner[c * 2]!;
        const cz = v.z + corner[c * 2 + 1]!;
        const sd = (cx - h.px) * h.nx + (cz - h.pz) * h.nz;
        if (sd < deepest) {
          deepest = sd;
          rx = corner[c * 2]!;
          rz = corner[c * 2 + 1]!;
        }
      }
      if (deepest >= 0) continue;
      v.x -= h.nx * deepest;
      v.z -= h.nz * deepest;
      // Velocity of the contact corner: v + ω × r (ω about +Y).
      const r = v.yawRate;
      const pvx = v.vx + r * rz;
      const pvz = v.vz - r * rx;
      const vn = pvx * h.nx + pvz * h.nz;
      if (vn >= 0) continue;
      const rn = rz * h.nx - rx * h.nz;
      const j = (-(1 + WALL_E) * vn) / (1 / m + (rn * rn) / izz);
      v.vx += (j * h.nx) / m;
      v.vz += (j * h.nz) / m;
      v.yawRate += (j * rn) / izz;
      // Friction along the tangential contact velocity.
      const tvx = pvx - vn * h.nx;
      const tvz = pvz - vn * h.nz;
      const tl = Math.sqrt(tvx * tvx + tvz * tvz);
      if (tl > 1e-4) {
        const tx = tvx / tl;
        const tz = tvz / tl;
        const rt = rz * tx - rx * tz;
        let jt = tl / (1 / m + (rt * rt) / izz);
        if (jt > WALL_MU * j) jt = WALL_MU * j;
        v.vx -= (jt * tx) / m;
        v.vz -= (jt * tz) / m;
        v.yawRate -= (jt * rt) / izz;
      }
      v.wallImpulse += j;
      if (-vn > SPARK_VN) {
        const sp = -vn / 15;
        if (sp > v.sparks) v.sparks = sp > 1 ? 1 : sp;
        world.events.push({ type: 'collision', a: car.id, b: -1, impulse: j, x: v.x + rx, y: v.y, z: v.z + rz });
      }
    }
    v.speed = Math.sqrt(v.vx * v.vx + v.vz * v.vz);
  };

  // Result of `overlap`: penetration depth, unit normal from A to B, contact point.
  let ovBest = 0, ovNx = 0, ovNz = 0, ovPx = 0, ovPz = 0;
  let ownEpisodes: ContactEpisodes | null = null;

  /**
   * 2D SAT of two car OBBs; false when apart (or > 6 m between centres). `faceMid` (remote pairs) takes the middle of a
   * supporting face instead of its first corner, so a square rear-end or T-bone has no spurious lever arm: the single
   * per-episode impulse must carry the whole hit.
   */
  const overlap = (a: VehicleState, pa: VehicleParams, b: VehicleState, pb: VehicleParams, faceMid = false): boolean => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (dx * dx + dz * dz > 36) return false;
    const hla = pa.bodyLength * 0.5, hwa = pa.bodyWidth * 0.5;
    const hlb = pb.bodyLength * 0.5, hwb = pb.bodyWidth * 0.5;
    const afx = Math.cos(a.yaw), afz = -Math.sin(a.yaw), alx = -Math.sin(a.yaw), alz = -Math.cos(a.yaw);
    const bfx = Math.cos(b.yaw), bfz = -Math.sin(b.yaw), blx = -Math.sin(b.yaw), blz = -Math.cos(b.yaw);
    let best = Infinity;
    let nx = 0;
    let nz = 0;
    for (let k = 0; k < 4; k++) {
      const ux = k === 0 ? afx : k === 1 ? alx : k === 2 ? bfx : blx;
      const uz = k === 0 ? afz : k === 1 ? alz : k === 2 ? bfz : blz;
      const ra = hla * Math.abs(afx * ux + afz * uz) + hwa * Math.abs(alx * ux + alz * uz);
      const rb = hlb * Math.abs(bfx * ux + bfz * uz) + hwb * Math.abs(blx * ux + blz * uz);
      const dist = dx * ux + dz * uz;
      const ov = ra + rb - (dist < 0 ? -dist : dist);
      if (ov <= 0) return false;
      if (ov < best) {
        best = ov;
        nx = dist < 0 ? -ux : ux;
        nz = dist < 0 ? -uz : uz;
      }
    }
    // n points from A to B. Contact = mean of A's support point along +n and B's along −n.
    fillCorners(a, pa, corner);
    fillCorners(b, pb, cornerB);
    let sa = -Infinity, sb = Infinity, cax = 0, caz = 0, cbx = 0, cbz = 0;
    for (let c = 0; c < 4; c++) {
      const da = corner[c * 2]! * nx + corner[c * 2 + 1]! * nz;
      if (da > sa) { sa = da; cax = corner[c * 2]!; caz = corner[c * 2 + 1]!; }
      const db = cornerB[c * 2]! * nx + cornerB[c * 2 + 1]! * nz;
      if (db < sb) { sb = db; cbx = cornerB[c * 2]!; cbz = cornerB[c * 2 + 1]!; }
    }
    if (faceMid) {
      let na = 0, nb = 0, ax = 0, az = 0, bx = 0, bz = 0;
      for (let c = 0; c < 4; c++) {
        if (corner[c * 2]! * nx + corner[c * 2 + 1]! * nz > sa - FACE_EPS) { ax += corner[c * 2]!; az += corner[c * 2 + 1]!; na++; }
        if (cornerB[c * 2]! * nx + cornerB[c * 2 + 1]! * nz < sb + FACE_EPS) { bx += cornerB[c * 2]!; bz += cornerB[c * 2 + 1]!; nb++; }
      }
      cax = ax / na; caz = az / na; cbx = bx / nb; cbz = bz / nb;
    }
    ovBest = best;
    ovNx = nx;
    ovNz = nz;
    ovPx = 0.5 * (a.x + cax + b.x + cbx);
    ovPz = 0.5 * (a.z + caz + b.z + cbz);
    return true;
  };

  const pair = (world: SimWorld, A: SimCarState, B: SimCarState): void => {
    const a = A.vehicle;
    const b = B.vehicle;
    const pa = world.static.params[A.id]!;
    const pb = world.static.params[B.id]!;
    if (!overlap(a, pa, b, pb)) return;
    const best = ovBest, nx = ovNx, nz = ovNz, px = ovPx, pz = ovPz;
    const ma = a.massKg, mb = b.massKg;
    const ia = pa.yawInertiaPerKg * ma, ib = pb.yawInertiaPerKg * mb;
    // Positional separation by inverse mass.
    const wa = mb / (ma + mb);
    const wb = ma / (ma + mb);
    a.x -= nx * best * wa; a.z -= nz * best * wa;
    b.x += nx * best * wb; b.z += nz * best * wb;
    const rax = px - a.x, raz = pz - a.z, rbx = px - b.x, rbz = pz - b.z;
    const vax = a.vx + a.yawRate * raz, vaz = a.vz - a.yawRate * rax;
    const vbx = b.vx + b.yawRate * rbz, vbz = b.vz - b.yawRate * rbx;
    const rvx = vbx - vax, rvz = vbz - vaz;
    const vn = rvx * nx + rvz * nz;
    if (vn >= 0) return;
    const ran = raz * nx - rax * nz;
    const rbn = rbz * nx - rbx * nz;
    let j = (-(1 + CAR_E) * vn) / (1 / ma + 1 / mb + (ran * ran) / ia + (rbn * rbn) / ib);
    if (j > CAR_J_MAX) j = CAR_J_MAX;
    a.vx -= (j * nx) / ma; a.vz -= (j * nz) / ma; a.yawRate -= (j * ran) / ia;
    b.vx += (j * nx) / mb; b.vz += (j * nz) / mb; b.yawRate += (j * rbn) / ib;
    const tvx = rvx - vn * nx, tvz = rvz - vn * nz;
    const tl = Math.sqrt(tvx * tvx + tvz * tvz);
    if (tl > 1e-4) {
      const tx = tvx / tl, tz = tvz / tl;
      const rat = raz * tx - rax * tz;
      const rbt = rbz * tx - rbx * tz;
      let jt = tl / (1 / ma + 1 / mb + (rat * rat) / ia + (rbt * rbt) / ib);
      if (jt > CAR_MU * j) jt = CAR_MU * j;
      a.vx += (jt * tx) / ma; a.vz += (jt * tz) / ma; a.yawRate += (jt * rat) / ia;
      b.vx -= (jt * tx) / mb; b.vz -= (jt * tz) / mb; b.yawRate -= (jt * rbt) / ib;
    }
    a.speed = Math.sqrt(a.vx * a.vx + a.vz * a.vz);
    b.speed = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
    a.carImpulse += j;
    b.carImpulse += j;
    if (j > 300) world.events.push({ type: 'collision', a: A.id, b: B.id, impulse: j, x: px, y: 0.5 * (a.y + b.y), z: pz, nx, nz });
  };

  /** Local car L against the kinematic remote puppet R (pose and velocity as written by the glue): only L responds. */
  const remotePair = (world: SimWorld, L: SimCarState, R: SimCarState, dt: number): void => {
    const a = L.vehicle;
    const b = R.vehicle;
    const pa = world.static.params[L.id]!;
    const pb = world.static.params[R.id]!;
    // Broad phase first (6 m centre distance inside overlap), so the glue callback only runs for touching pairs.
    if (!overlap(a, pa, b, pb, true)) return;
    const scale = opts.remoteContactScale ? opts.remoteContactScale(R.id) : 1;
    if (!(scale > 0)) return;
    const best = ovBest, nx = ovNx, nz = ovNz, px = ovPx, pz = ovPz;
    const tol = contactTolerance(scale);
    if (best <= tol) return;
    let push = REMOTE_SEP_SHARE * best;
    const pushMax = (REMOTE_SEP_V + REMOTE_SEP_GAIN * (best - tol)) * dt;
    if (push > pushMax) push = pushMax;
    a.x -= nx * push; a.z -= nz * push;
    const ma = a.massKg, mb = b.massKg;
    const ia = pa.yawInertiaPerKg * ma, ib = pb.yawInertiaPerKg * mb;
    const ep = opts.episodes ?? (ownEpisodes ??= createContactEpisodes(world.state.cars.length));
    const nowMs = world.state.race.raceMs;
    const prior = contactApplied(ep, L.id, R.id, nowMs);
    const credit = contactCredit(ep, L.id, R.id, nowMs, opts.remoteResponseDelayMs ? opts.remoteResponseDelayMs(R.id) : 100);
    const rax = px - a.x, raz = pz - a.z, rbx = px - b.x, rbz = pz - b.z;
    const vax = a.vx + a.yawRate * raz, vaz = a.vz - a.yawRate * rax;
    const vbx = b.vx + b.yawRate * rbz + (credit * nx) / mb, vbz = b.vz - b.yawRate * rbx + (credit * nz) / mb;
    const rvx = vbx - vax, rvz = vbz - vaz;
    const vn = rvx * nx + rvz * nz;
    if (vn >= 0) return;
    const ran = raz * nx - rax * nz;
    const rbn = rbz * nx - rbx * nz;
    let j = (scale * (-(1 + CAR_E) * vn)) / (1 / ma + 1 / mb + (ran * ran) / ia + (rbn * rbn) / ib);
    if (j > CONTACT_J_MAX - prior) j = CONTACT_J_MAX - prior;
    if (!(j > 0)) return;
    contactAccumulate(ep, L.id, R.id, j, nowMs);
    a.vx -= (j * nx) / ma; a.vz -= (j * nz) / ma; a.yawRate -= (j * ran) / ia;
    const tvx = rvx - vn * nx, tvz = rvz - vn * nz;
    const tl = Math.sqrt(tvx * tvx + tvz * tvz);
    if (tl > 1e-4) {
      const tx = tvx / tl, tz = tvz / tl;
      const rat = raz * tx - rax * tz;
      const rbt = rbz * tx - rbx * tz;
      let jt = tl / (1 / ma + 1 / mb + (rat * rat) / ia + (rbt * rbt) / ib);
      if (jt > CAR_MU * j) jt = CAR_MU * j;
      a.vx += (jt * tx) / ma; a.vz += (jt * tz) / ma; a.yawRate += (jt * rat) / ia;
    }
    a.speed = Math.sqrt(a.vx * a.vx + a.vz * a.vz);
    a.carImpulse += j;
    const total = prior + j;
    if (prior <= 300 && total > 300) world.events.push({ type: 'collision', a: L.id, b: R.id, impulse: total, x: px, y: 0.5 * (a.y + b.y), z: pz, nx, nz });
  };

  const needsReset = (world: SimWorld, car: SimCarState, dt: number): boolean => {
    const v = car.vehicle;
    if (!vehicleFinite(v)) return true;
    const x = aux(v);
    const phase = world.state.race.phase;
    const racing = phase === 'running' || phase === 'finishing';
    const trying = car.input.throttle > 0.5;
    if (racing && v.speed < STUCK_SPEED && (v.offTrackWheels >= 3 || trying) && car.pit.phase === 'none') x.stuckT += dt;
    else x.stuckT = 0;
    if (x.stuckT > STUCK_TIME) return true;
    if (car.control !== 'player' && x.ghostT <= 0 && car.ai.stuckTimer > AI_STUCK_TIME) return true;
    if (v.hint.ribbon === 'main') {
      const data = world.static.track.data;
      const idx = Math.floor(v.s) % data.count;
      if (idx >= 0) {
        const wall = v.d > 0 ? data.wallL[idx]! : data.wallR[idx]!;
        if (wall > 0 && (v.d > 0 ? v.d : -v.d) > wall + ESCAPE_M) return true;
      }
    }
    return false;
  };

  return {
    name: 'collision',
    step(world, dt) {
      const cars = world.state.cars;
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i]!;
        const v = car.vehicle;
        v.wallImpulse = 0;
        v.carImpulse = 0;
        const x = aux(v);
        if (x.ghostT > 0) x.ghostT = x.ghostT > dt ? x.ghostT - dt : 0;
        if (car.control !== 'remote' && needsReset(world, car, dt)) resetCar(world, car);
      }
      const race = world.state.race;
      const remoteOpen = (race.phase === 'running' || race.phase === 'finishing') && race.raceMs >= race.lightsOutAtMs + REMOTE_GRID_GHOST_MS;
      for (let i = 0; i < cars.length; i++) {
        const A = cars[i]!;
        if (aux(A.vehicle).ghostT > 0) continue;
        const aRemote = A.control === 'remote';
        for (let j = i + 1; j < cars.length; j++) {
          const B = cars[j]!;
          if (aux(B.vehicle).ghostT > 0) continue;
          const bRemote = B.control === 'remote';
          if (!aRemote && !bRemote) pair(world, A, B);
          else if (aRemote !== bRemote && remoteOpen) remotePair(world, aRemote ? B : A, aRemote ? A : B, dt);
        }
      }
      for (let i = 0; i < cars.length; i++) if (cars[i]!.control !== 'remote') walls(world, cars[i]!);
    },
  };
}
