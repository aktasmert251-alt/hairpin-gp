// HudPresenter v2 (YÖN; ui-hud §1–§4, CR-05). Fills one long-lived HudModel in place at 30 Hz from the sim (raw
// numbers, no formatting) and owns the notification queue (D-002 coalescing). Allocation-free in update() apart from
// new notifications. Team strip colours use `colors.ui ?? colors.primary` (D-001).
//
// Notification params (the UI formats numbers by name: `time` lap time, `delta` delta, `gap` gap, `p` percent):
// `n`, `corner`, `s` (seconds), `time`, `delta`, `code`, `sector` (1-based), `min`, `p` (0..100), `left` ('∞' when
// unlimited). `reason`, `compound`, `mode` ids are translated here through `notify.reason|compound|lineMode` (opts.t).
// Texts: src/game/hud/i18n/notify.{tr,en}.ts.

import { pitLossEstimateS } from '../../race/pit';
import type { Compound, Quad } from '../../contracts/common';
import type { ConditionsState, ForecastEntry } from '../../contracts/conditions';
import type { TeamDef } from '../../contracts/data';
import type { EventBus, EventMap } from '../../contracts/events';
import type { HudModel, TowerRow } from '../../contracts/hud';
import type { SimEvent, SimRunner } from '../../contracts/sim';
import { crx } from '../../race/extra';
import { PIT_LIMIT_KMH } from '../../race/rules';
import { NOTIFY_CATALOGUE, createNotificationQueue, type NotificationQueue, type NotifyLevel } from './notifications';

export interface HudPresenter {
  readonly model: HudModel;
  /** Rebuilds the model; `dtMs` = wall-clock time since the previous update (notification timers). */
  update(dtMs?: number): HudModel;
  setVisible(mode: HudModel['visible']): void;
  /** Turns a sim event into notifications (call for every drained event). */
  onSimEvent(e: SimEvent): void;
  /** Adds a notification directly (the bus `notify` event lands here too). */
  notify(key: string, params?: Record<string, string | number>, level?: NotifyLevel, ms?: number): void;
  /**
   * Delta reference: per-10 m-marker lap-relative times (ms) of the reference lap (PB / rival ghost), or null.
   * `sectors` = all-time best sectors (Time Trial sector colours, rules §10).
   */
  setReference(kind: 'pb' | 'rival' | null, markers: Float32Array | null, sectors?: [number, number, number] | null): void;
  /** The best-lap markers the presenter recorded for the player this session (race delta reference). */
  bestLapMarkers(): Float32Array | null;
  /** Clears notifications and per-lap recording (flashback apply, restart). */
  reset(): void;
  readonly queue: NotificationQueue;
  dispose(): void;
}

export interface HudPresenterOptions {
  bus?: EventBus<EventMap>;
  /** i18n lookup for id-valued params (reason / compound / mode); without it the ids pass through. */
  t?: (key: string) => string;
  /** CR-10 forecast (pure); without it the forecast stays empty. */
  forecast?: (c: ConditionsState, seed: number, nowS: number, out: ForecastEntry[]) => number;
  /** Online race (multiplayer P3): nickname codes, server standings, link badges, ping. Absent offline (model unchanged). */
  online?: HudOnline;
}

export interface HudOnline {
  /** Tower code per car id (null = the driver's own code). */
  codes: readonly (string | null)[];
  /** Fresh server order (car ids) with leader gaps in ms, or null (then the local director's order is used). */
  standings(): { order: ArrayLike<number>; gapMs: ArrayLike<number>; count: number } | null;
  link(car: number): NonNullable<TowerRow['net']>;
  /** Ping of a car's player in ms (NaN = none, e.g. AI). */
  rttOf(car: number): number;
  hudNet(): NonNullable<HudModel['net']>;
}

const RPM_MAX = 12_500;
/** ui-hud §2 shift LED rule. */
const LED_START = 10_000;
const LED_SPAN = 1_800;
const SHIFT_NOW_RPM = 11_800;
const FORECAST_SLOTS = 4;
const FORECAST_EVERY_MS = 500;
const START_LIGHTS_OUT_MS = 2000;
/** Estimated pit loss (s) until PitProcedure (L10) provides the track's real value. */
/** Fallback pit loss (pit-weather §2.1) for tracks without a pit lane. */
const PIT_LOSS_FALLBACK_S = 22;
const DEFAULT_TICK_MS = 1000 / 30;

/** ui-hud §4: suggested next compound (pre-selected when the box is requested). */
export function suggestCompound(wetness: number, lapsLeft: number, twoCompoundOpen: Compound | null): Compound {
  if (wetness >= 0.62) return 'wet';
  if (wetness >= 0.12) return 'inter';
  if (twoCompoundOpen) return twoCompoundOpen;
  return lapsLeft <= 12 ? 'soft' : lapsLeft <= 25 ? 'medium' : 'hard';
}

function quad<T>(v: T): Quad<T> {
  return [v, v, v, v];
}

export function createHudPresenter(
  sim: SimRunner, teams: readonly TeamDef[], playerId: number, visible: HudModel['visible'], opts: HudPresenterOptions = {},
): HudPresenter {
  const world = sim.world;
  const cfg = world.static.config;
  const cars = world.state.cars;
  const n = cars.length;
  const q = world.static.track.query;
  const data = q.data;
  const markerCount = cars[playerId]!.race.markerTimes.length;
  const queue = createNotificationQueue();
  const colorOf = (teamId: string): string => {
    const t = teams.find((x) => x.id === teamId);
    return t ? t.colors.ui ?? t.colors.primary : '#F2F4F7';
  };
  const codeOf = (driverId: string): string => {
    for (const t of teams) for (const d of t.drivers) if (d.id === driverId) return d.code;
    return driverId.slice(0, 3).toUpperCase();
  };
  const colors = cars.map((c) => colorOf(c.teamId));
  const online = opts.online ?? null;
  const codes = cars.map((c, i) => online?.codes[i] ?? codeOf(c.driverId));
  const tower: TowerRow[] = cars.map((c, i) => {
    const row: TowerRow = {
      car: c.id, pos: i + 1, code: codes[i]!, teamColor: colors[i]!, gapMs: 0, lapsDown: 0, compound: c.vehicle.compound,
      inPit: false, penaltySec: 0, isPlayer: c.isPlayer, fastest: false, drs: false, status: 'running',
    };
    if (online) {
      row.net = 'ok';
      row.rttMs = Number.NaN;
    }
    return row;
  });
  const position = { pos: 1, of: n };
  const forecastOut: ForecastEntry[] = Array.from({ length: FORECAST_SLOTS }, () => ({ inMin: 0, rain: 0, probability: 0 }));
  const pitModel: NonNullable<HudModel['pit']> = { phase: 'none', inLane: false, limitKmh: PIT_LIMIT_KMH, speeding: false, boxDistM: 0, serviceLeftS: 0 };

  const model: HudModel = {
    visible,
    mode: cfg.mode,
    lap: { current: 1, total: cfg.mode === 'race' ? cfg.laps : null },
    position: cfg.mode === 'race' ? position : null,
    timing: {
      curLapMs: 0, lastLapMs: 0, bestLapMs: 0, deltaMs: null, invalid: false,
      sectors: [{ ms: 0, status: 'none' }, { ms: 0, status: 'none' }, { ms: 0, status: 'none' }],
      curSector: 0,
      deltaRef: null,
    },
    tower,
    towerExpanded: false,
    gapMode: 'interval',
    car: {
      kmh: 0, gear: 1, rpm: 0, rpmMax: RPM_MAX, shiftLeds: 0, shiftNow: false, limiter: false, pitLimiter: false,
      throttle: 0, brake: 0, drs: 'disabled',
      ers: { soc: 1, mode: 'medium', lapUsed: 0, overtake: false },
      brakeBias: 0.575,
      tyre: { compound: 'medium', ageLaps: 0, wear: quad(0), tempC: quad(0), state: quad<'cold' | 'ok' | 'hot'>('ok') },
    },
    minimap: { x: new Float32Array(n), z: new Float32Array(n), teamColor: colors, player: playerId, inPit: new Uint8Array(n) },
    startLights: { visible: false, lit: 0, out: false },
    flags: { yellow: [false, false, false], blue: false, chequered: false, blackWhite: false },
    notifications: [],
    penalty: { toServeSec: 0, trackLimitWarnings: 0 },
    pit: null,
    mfd: {
      open: false, page: 'strategy', nextCompound: 'medium', boxRequested: false, forecast: forecastOut,
      ersAuto: true, pitLossS: pitLossEstimateS(world, playerId) || PIT_LOSS_FALLBACK_S, rejoinPos: null,
    },
    weather: { rain: 0, wetness: 0, airC: 0, trackC: 0 },
    flashback: { open: false, offsetSec: 0, maxSec: 15, left: cfg.flashbacks },
    wrongWay: false,
  };

  // ---- delta recording (10 m markers, lap-relative ms) ----
  const curRel = new Float32Array(markerCount).fill(-1);
  const bestRel = new Float32Array(markerCount).fill(-1);
  let hasBest = false;
  let refKind: 'pb' | 'rival' | null = null;
  let refMarkers: Float32Array | null = null;
  let allTimeSectors: [number, number, number] | null = null;
  let lastMarker = -1;
  let lapsSeen = cars[playerId]!.race.lapsCompleted;
  let forecastTimer = FORECAST_EVERY_MS;
  let blackWhiteMs = 0;

  const recordMarkers = (from: number, to: number, lapStart: number): void => {
    const mt = cars[playerId]!.race.markerTimes;
    for (let k = from; k <= to && k < markerCount; k++) {
      const t = mt[k]!;
      curRel[k] = t >= lapStart ? t - lapStart : -1;
    }
  };

  const nearestCorner = (s: number): number => {
    const corners = data.corners;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < corners.length; i++) {
      const d = Math.abs(q.deltaS(corners[i]!.apexS, s));
      if (d < bestD) {
        bestD = d;
        best = corners[i]!.n;
      }
    }
    return best;
  };

  const carBehind = (carId: number): number => {
    const me = cars[carId]!;
    let best = -1;
    let bestGap = Infinity;
    for (let i = 0; i < n; i++) {
      if (i === carId) continue;
      const g = q.deltaS(cars[i]!.vehicle.s, me.vehicle.s);
      if (g > 0 && g < bestGap) {
        bestGap = g;
        best = i;
      }
    }
    return best;
  };

  const LOCALIZED: Readonly<Record<string, string>> = { reason: 'notify.reason', compound: 'notify.compound', mode: 'notify.lineMode' };
  const localize = (params: Record<string, string | number> | undefined): Record<string, string | number> | undefined => {
    if (!params || !opts.t) return params;
    let out: Record<string, string | number> | null = null;
    for (const k in LOCALIZED) {
      const v = params[k];
      if (typeof v !== 'string') continue;
      const key = `${LOCALIZED[k]}.${v}`;
      const txt = opts.t(key);
      if (txt !== key) (out ??= { ...params })[k] = txt;
    }
    return out ?? params;
  };
  const push = (key: string, params?: Record<string, string | number>, level?: NotifyLevel, ms?: number): void => queue.push(key, localize(params), level, ms);

  const emit = (key: string, params?: Record<string, string | number>, level?: NotifyLevel, ms?: number): void => {
    if (opts.bus) opts.bus.emit('notify', { key, params, level: level ?? NOTIFY_CATALOGUE[key]?.level ?? 'info', ms: ms ?? 0 });
    else push(key, params, level, ms);
  };
  /** Bus path: the catalogue decides level/ms unless the emitter gave explicit values (ms 0 = catalogue). */
  const unNotify = opts.bus?.on('notify', (p) => push(p.key, p.params, p.level, p.ms > 0 ? p.ms : undefined));
  const unFlashback = opts.bus?.on('flashback:applied', (p) => emit('notify.flashback.used', { left: p.left < 0 ? '∞' : p.left }));
  const unLine = opts.bus?.on('racingLine:mode', (p) => emit('notify.racingLine.mode', { mode: p.mode }));

  const onSimEvent = (e: SimEvent): void => {
    const race = cfg.mode === 'race';
    switch (e.type) {
      case 'jumpStart':
        if (e.car === playerId) emit('notify.start.jumpStart', { s: 5 }, 'penalty');
        break;
      case 'trackLimits':
        if (e.car === playerId && e.count <= 3) emit('notify.limits.warning', { n: e.count, corner: nearestCorner(cars[playerId]!.vehicle.s) }, 'warn');
        break;
      case 'penalty':
        if (e.car === playerId && e.reason !== 'jumpStart') emit(`notify.penalty.${e.reason}`, { s: e.seconds }, 'penalty');
        break;
      case 'penaltyServed':
        if (e.car === playerId) emit('notify.penalty.served', { s: e.seconds }, 'info');
        break;
      case 'wrongWay':
        // D-040: short cue on the existing UI sound path (the banner itself is model.wrongWay).
        if (e.car === playerId && e.on) opts.bus?.emit('ui:sound', { kind: 'error' });
        break;
      case 'lapInvalidated':
        if (e.car === playerId) emit('notify.lap.invalid', { reason: e.reason }, 'warn');
        break;
      case 'lap':
        if (e.car === playerId) {
          const r = cars[playerId]!.race;
          if (e.valid && r.bestLapMs === e.ms && e.lap > 1 && hasBest) emit('notify.lap.personalBest', { time: e.ms, delta: e.ms - prevBest }, 'good');
          if (race && e.lap === cfg.laps - 1) emit('notify.lap.final', {}, 'info');
        }
        break;
      case 'fastestLap':
        if (race) emit('notify.lap.fastest', { code: codes[e.car] ?? '', time: e.ms }, 'good');
        break;
      case 'flag':
        if (e.flag === 'yellow') {
          const cur = q.sectorAt(cars[playerId]!.vehicle.s);
          if (e.sector === cur || e.sector === (cur + 1) % 3) emit('notify.flag.yellow', { sector: e.sector + 1 }, 'warn');
        } else if (e.flag === 'blue' && e.car === playerId) {
          const b = carBehind(playerId);
          emit('notify.flag.blue', { code: b >= 0 ? codes[b]! : '' }, 'warn');
        } else if (e.flag === 'chequered') emit('notify.flag.chequered', {}, 'info');
        else if (e.flag === 'blackWhite' && e.car === playerId) {
          blackWhiteMs = 5000;
          emit('notify.limits.blackWhite', {}, 'warn');
        }
        break;
      case 'drsEnabled':
        emit('notify.drs.enabled', {}, 'info');
        break;
      case 'drsDisabled':
        emit('notify.drs.disabled', {}, 'info');
        break;
      case 'weather': {
        const comp = cars[playerId]!.vehicle.compound;
        const slick = comp === 'soft' || comp === 'medium' || comp === 'hard';
        if (e.msg === 'rainSoon') {
          const f = forecastOut[0]!;
          emit('notify.weather.rainSoon', { min: f.inMin, p: Math.round(f.probability * 100) }, 'info');
        } else if (e.msg === 'rainStarted') emit('notify.weather.rainStarted', {}, 'info');
        else if (e.msg === 'drying') emit('notify.weather.drying', {}, 'info');
        else if (e.msg === 'intersNow' && slick) emit('notify.weather.intersNow', {}, 'warn');
        else if (e.msg === 'wetsNow' && comp !== 'wet') emit('notify.weather.wetsNow', {}, 'warn');
        else if (e.msg === 'slicksNow' && !slick) emit('notify.weather.slicksNow', {}, 'warn');
        break;
      }
      // D-056
      case 'collisionWarning':
        if (e.car === playerId) emit('notify.collision.warning', {}, 'warn');
        break;
      case 'safetyCar':
        if (race) emit(e.phase === 'deployed' ? 'notify.sc.deployed' : e.phase === 'ending' ? 'notify.sc.ending' : 'notify.sc.restart');
        break;
      case 'carReset':
        if (e.car === playerId) emit('notify.car.reset', {}, 'info');
        break;
      default:
        break;
    }
  };
  let prevBest = 0;

  const update = (dtMs = DEFAULT_TICK_MS): HudModel => {
    const st = world.state;
    const race = st.race;
    const me = cars[playerId]!;
    const r = me.race;
    const v = me.vehicle;
    const p = world.static.params[playerId]!;
    const isRace = cfg.mode === 'race';

    model.lap.current = isRace ? Math.min(cfg.laps, r.lapsCompleted + 1) : r.lapsCompleted + 1;
    position.pos = r.position > 0 ? r.position : 1;

    // ---- timing + delta ----
    const t = model.timing;
    const running = race.phase !== 'grid' && race.phase !== 'lights';
    t.curLapMs = r.lapStartMs >= 0 && running && !r.finished ? race.raceMs - r.lapStartMs : r.finished ? r.lastLapMs : 0;
    t.lastLapMs = r.lastLapMs;
    t.bestLapMs = r.bestLapMs;
    t.invalid = !r.lapValid;
    for (let k = 0; k < 3; k++) {
      const ms = r.curSectors[k]!;
      t.sectors[k]!.ms = ms;
      if (isRace) t.sectors[k]!.status = r.sectorStatus[k]!;
      else {
        // Rules §10 (TT): purple < all-time best, green = session best, yellow slower, none on invalid laps.
        const at = allTimeSectors ? allTimeSectors[k] : 0;
        t.sectors[k]!.status = !r.lapValid || ms <= 0 ? 'none' : at > 0 && ms < at ? 'purple' : ms <= r.bestSectors[k]! ? 'green' : 'yellow';
      }
    }
    t.curSector = r.sector;

    if (r.lapsCompleted !== lapsSeen) {
      // Lap completed since the last update: finish the previous lap's markers, keep it if it is the new best.
      const prevStart = r.lapStartMs - r.lastLapMs;
      recordMarkers(lastMarker + 1, markerCount - 1, prevStart);
      const newBest = r.bestLapMs > 0 && r.bestLapMs === r.lastLapMs && r.lapsCompleted > lapsSeen;
      if (newBest) {
        bestRel.set(curRel);
        hasBest = true;
      }
      prevBest = r.bestLapMs;
      curRel.fill(-1);
      lastMarker = 0;
      curRel[0] = 0;
      lapsSeen = r.lapsCompleted;
    }
    const m = Math.min(markerCount - 1, Math.max(0, Math.floor(v.s / 10)));
    if (running && r.lapStartMs >= 0 && m > lastMarker) {
      recordMarkers(lastMarker + 1, m, r.lapStartMs);
      lastMarker = m;
    }
    const ref = refMarkers ?? (hasBest && isRace ? bestRel : null);
    t.deltaRef = refMarkers ? refKind : hasBest && isRace ? 'best' : null;
    if (ref && running && !r.finished && lastMarker > 0 && curRel[lastMarker]! >= 0 && ref[lastMarker]! >= 0) t.deltaMs = curRel[lastMarker]! - ref[lastMarker]!;
    else t.deltaMs = null;

    // ---- tower ----
    // Online: the server order and gaps win while fresh (design §6.1); otherwise the local director's.
    const so = online && running ? online.standings() : null;
    for (let i = 0; i < race.order.length; i++) {
      const car = cars[so ? so.order[i]! : race.order[i]!]!;
      const row = tower[i]!;
      row.car = car.id;
      row.pos = i + 1;
      row.code = codes[car.id]!;
      row.teamColor = colors[car.id]!;
      // QC2-11: no gap before lights out (the grid stagger is not a gap); NaN renders as an empty cell.
      if (so) row.gapMs = model.gapMode === 'interval' ? so.gapMs[i]! - (i > 0 ? so.gapMs[i - 1]! : 0) : so.gapMs[i]!;
      else row.gapMs = !running ? NaN : model.gapMode === 'interval' ? car.race.intervalMs : car.race.gapToLeaderMs;
      if (online) {
        row.net = online.link(car.id);
        row.rttMs = online.rttOf(car.id);
        if (so && car.id === playerId) position.pos = i + 1;
      }
      row.lapsDown = car.race.lapsDown;
      row.compound = car.vehicle.compound;
      row.inPit = car.pit.phase !== 'none';
      row.penaltySec = car.race.penaltyToServeSec;
      row.isPlayer = car.isPlayer;
      row.fastest = race.fastest.car === car.id;
      row.drs = car.vehicle.drs.open;
      row.status = car.race.status;
    }

    // ---- car ----
    const c = model.car;
    c.kmh = v.speed * 3.6;
    c.gear = v.gear;
    c.rpm = v.rpm;
    const lf = (v.rpm - LED_START) / LED_SPAN;
    c.shiftLeds = Math.round(15 * (lf < 0 ? 0 : lf > 1 ? 1 : lf));
    c.shiftNow = v.rpm >= SHIFT_NOW_RPM;
    c.limiter = v.limiterHit;
    c.pitLimiter = v.pitLimiterOn;
    c.throttle = me.input.throttle;
    c.brake = me.input.brake;
    c.drs = !race.drsEnabled ? 'disabled' : v.drs.open ? 'open' : r.drsZone >= 0 ? 'available' : 'unavailable';
    c.ers.soc = v.ers.socJ / (p.ers.capacityMJ * 1e6);
    c.ers.mode = v.ers.mode;
    c.ers.lapUsed = v.ers.deployedLapJ / (p.ers.deployLimitMJ * 1e6);
    c.ers.overtake = v.ers.mode === 'overtake';
    c.brakeBias = me.input.brakeBias;
    const comp = p.compounds[v.compound];
    c.tyre.compound = v.compound;
    c.tyre.ageLaps = v.tyreAgeLaps;
    for (let k = 0; k < 4; k++) {
      const ty = v.tyres[k]!;
      c.tyre.wear[k] = ty.wear;
      c.tyre.tempC[k] = ty.surfC;
      c.tyre.state[k] = ty.surfC < comp.tOptC - comp.windowC ? 'cold' : ty.surfC > comp.tOptC + comp.windowC ? 'hot' : 'ok';
    }

    // ---- minimap ----
    for (let i = 0; i < n; i++) {
      model.minimap.x[i] = cars[i]!.vehicle.x;
      model.minimap.z[i] = cars[i]!.vehicle.z;
      model.minimap.inPit[i] = cars[i]!.pit.phase !== 'none' || cars[i]!.vehicle.hint.ribbon === 'pit' ? 1 : 0;
    }

    // ---- lights, flags ----
    const lightsPhase = race.phase === 'grid' || race.phase === 'lights';
    const justOut = !lightsPhase && race.lightsOutAtMs > 0 && race.raceMs - race.lightsOutAtMs < START_LIGHTS_OUT_MS;
    model.startLights.visible = isRace && (lightsPhase || justOut);
    model.startLights.lit = race.lightsLit;
    model.startLights.out = justOut;
    model.flags.yellow[0] = race.yellow[0];
    model.flags.yellow[1] = race.yellow[1];
    model.flags.yellow[2] = race.yellow[2];
    model.flags.blue = crx(r).blueOn === 1;
    if (isRace) model.flags.safetyCar = race.sc.phase;
    model.wrongWay = crx(r).wwOn === 1 && r.status === 'running' && !r.finished; // D-040
    model.flags.chequered = race.phase === 'finishing' || race.phase === 'finished';
    if (blackWhiteMs > 0) blackWhiteMs -= dtMs;
    model.flags.blackWhite = blackWhiteMs > 0;

    // ---- penalty, pit ----
    model.penalty.toServeSec = r.penaltyToServeSec;
    model.penalty.trackLimitWarnings = r.trackLimitCount;
    if (me.pit.phase !== 'none' || me.pit.requested || me.controls.boxRequest) {
      pitModel.phase = me.pit.phase;
      pitModel.inLane = v.hint.ribbon === 'pit';
      pitModel.limitKmh = data.pit.speedLimitKmh;
      pitModel.speeding = me.pit.speeding;
      pitModel.boxDistM = me.pit.phase === 'none' ? 0 : Math.max(0, me.pit.boxSp - (v.hint.ribbon === 'pit' ? v.hint.sp : 0));
      pitModel.serviceLeftS = me.pit.phase === 'stationary' ? Math.max(0, me.pit.serviceS - me.pit.timer) : 0;
      model.pit = pitModel;
    } else model.pit = null;

    // ---- MFD ----
    const mfd = model.mfd;
    mfd.nextCompound = me.controls.nextCompound;
    mfd.boxRequested = me.controls.boxRequest || me.pit.requested;
    mfd.ersAuto = me.controls.ersModeSel === 'auto';
    if (isRace) {
      const lossMs = mfd.pitLossS * 1000;
      const myGap = r.gapToLeaderMs;
      let rejoin = 1;
      for (let i = 0; i < n; i++) {
        if (i === playerId) continue;
        const o = cars[i]!.race;
        if (o.status !== 'running' && o.status !== 'finished') continue;
        if (o.lapsDown < r.lapsDown || (o.lapsDown === r.lapsDown && o.gapToLeaderMs < myGap + lossMs)) rejoin++;
      }
      mfd.rejoinPos = rejoin;
    } else mfd.rejoinPos = null;
    forecastTimer += dtMs;
    if (forecastTimer >= FORECAST_EVERY_MS) {
      forecastTimer = 0;
      if (opts.forecast) {
        const k = opts.forecast(st.conditions, cfg.seed, st.time, forecastOut);
        if (mfd.forecast.length !== k) mfd.forecast.length = k;
      } else mfd.forecast.length = 0;
    }

    // ---- weather, flashback ----
    model.weather.rain = st.conditions.rain;
    model.weather.wetness = st.conditions.wetness;
    model.weather.airC = st.conditions.airC;
    model.weather.trackC = st.conditions.trackC;
    if (!model.flashback.open) model.flashback.left = race.flashbacksLeft;
    if (online) model.net = online.hudNet();

    queue.tick(dtMs);
    queue.write(model.notifications);
    return model;
  };

  return {
    model,
    update,
    queue,
    setVisible(mode) {
      model.visible = mode;
    },
    onSimEvent,
    notify: (key, params, level, ms) => push(key, params, level, ms),
    setReference(kind, markers, sectors) {
      refKind = markers ? kind : null;
      refMarkers = markers;
      allTimeSectors = sectors ?? null;
    },
    bestLapMarkers: () => (hasBest ? bestRel : null),
    reset() {
      queue.clear();
      model.notifications.length = 0;
      curRel.fill(-1);
      lastMarker = -1;
      lapsSeen = cars[playerId]!.race.lapsCompleted;
    },
    dispose() {
      unNotify?.();
      unFlashback?.();
      unLine?.();
      queue.clear();
    },
  };
}
