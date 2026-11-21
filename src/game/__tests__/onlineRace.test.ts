import { describe, expect, it } from 'vitest';
import type { NetCarState, NetClientMsg, NetContact, NetLobbyModel, NetServerMsg } from '../../contracts/net';
import { SIM_DT } from '../../contracts/sim';
import { createStore } from '../../core/store';
import { NET_FLAG_RESET, createClockSync, newNetCarState, newNetContact, OFFLINE_LOBBY, trackHashOf, type NetClient } from '../../net/index';
import { lightsOutAtMsFor } from '../../race/index';
import { crx } from '../../race/extra';
import { PARK_X } from '../../race/rules';
import { createSim, defaultSessionConfig } from '../createSim';
import { createRenderFrameBuilder } from '../renderFrame';
import { buildOnlineResults, createOnlineRace, nicknameCode } from '../net/onlineSession';

type Load = Extract<NetServerMsg, { type: 'load' }>;

/** In-memory NetClient: the test plays the server. */
function fakeNet() {
  let serverNow = 0;
  const msgCbs: ((m: NetServerMsg) => void)[] = [];
  const stateCbs: ((e: Readonly<NetCarState>, ms: number) => void)[] = [];
  const contactCbs: ((c: Readonly<NetContact>) => void)[] = [];
  const sentJson: NetClientMsg[] = [];
  const sentStates: NetCarState[] = [];
  const sentContacts: NetContact[] = [];
  const lobby = createStore<NetLobbyModel>({ ...OFFLINE_LOBBY, status: 'online', myId: 5 });
  const client: NetClient = {
    lobby,
    clock: createClockSync(),
    connect() {},
    send: (m) => (sentJson.push(m), true),
    sendState: (s) => (sentStates.push({ ...s }), true),
    sendContact: (c) => (sentContacts.push({ ...c }), true),
    onMessage: (cb) => (msgCbs.push(cb), () => {}),
    onStates: (cb) => (stateCbs.push(cb), () => {}),
    onContact: (cb) => (contactCbs.push(cb), () => {}),
    onStatus: () => () => {},
    serverNow: () => serverNow,
    stats: () => ({ state: 'online', rttMs: 30, offsetMs: 0, sent: 0, recv: 0, dropped: 0, staleCars: 0 }),
    setStaleCars() {},
    close() {},
  };
  return {
    client, sentJson, sentStates, sentContacts,
    contact: (c: NetContact) => contactCbs.forEach((cb) => cb(c)),
    setServerNow: (t: number) => (serverNow = t),
    msg: (m: NetServerMsg) => msgCbs.forEach((cb) => cb(m)),
    state: (e: NetCarState) => stateCbs.forEach((cb) => cb(e, 0)),
  };
}

const LOAD: Load = {
  type: 'load', raceId: 'ABCDE-1', lightsOutAtMs: 9000,
  config: { trackId: 'bosphorus', laps: 1, tod: 'day', weather: 'dry', aiCount: 1, difficulty: 70, seed: 42 },
  roster: [
    { id: 2, kind: 'human', name: 'Zeynep', teamId: 'anka', driverIdx: 0, gridSlot: 0 },
    { id: 64, kind: 'ai', name: 'AI One', teamId: 'anka', driverIdx: 1, gridSlot: 1 },
    { id: 5, kind: 'human', name: 'ılgaz', teamId: 'vortex', driverIdx: 0, gridSlot: 2 },
  ],
};

function setup() {
  const net = fakeNet();
  const race = createOnlineRace(net.client, LOAD, 5);
  const sim = createSim(race.cfg, { lineup: race.lineup, collision: race.collision });
  const snaps: number[] = [];
  race.bind(sim, (c) => snaps.push(c));
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) {
      race.beforeTick();
      sim.step();
    }
    race.afterTicks();
  };
  return { net, race, sim, snaps, run };
}

describe('online race glue', () => {
  it('lineup: the local human is car 0 (player), everyone else a remote puppet at its server grid slot', () => {
    const { race, sim } = setup();
    expect(race.lineup.map((e) => e.control)).toEqual(['player', 'remote', 'remote']);
    expect(race.lineup.map((e) => e.gridSlot)).toEqual([2, 0, 1]);
    expect(race.carOf(5)).toBe(0);
    expect(race.carOf(2)).toBe(1);
    expect(race.carOf(64)).toBe(2);
    expect(race.idOf(2)).toBe(64);
    expect(race.codes).toEqual(['ILG', 'ZEY', null]);
    expect(sim.world.state.cars.map((c) => c.control)).toEqual(['player', 'remote', 'remote']);
    expect(race.cfg).toMatchObject({ mode: 'race', trackId: 'bosphorus', laps: 1, seed: 42, flashbacks: 0, mandatoryStop: false });
    // CR-NET-6: the server computes lightsOutAtMs with the same pure helper.
    expect(sim.world.state.race.lightsOutAtMs).toBe(lightsOutAtMsFor(LOAD.config.seed));
  });

  it('nickname codes use the Turkish upper case', () => {
    expect(nicknameCode('ılgaz')).toBe('ILG');
    expect(nicknameCode('iris')).toBe('İRİ');
    expect(nicknameCode('a.b c')).toBe('ABC');
  });

  it('sendLoaded sends the track hash of the built track', () => {
    const { net, race, sim } = setup();
    race.sendLoaded();
    expect(net.sentJson.at(-1)).toEqual({ type: 'loaded', trackHash: trackHashOf(sim.world.static.track.data) });
  });

  it('clock slaving: 0 ticks before start / T0, then (serverNow − T0)/SIM_DT − tick', () => {
    const { net, race, run } = setup();
    expect(race.targetTicks()).toBe(0);
    net.msg({ type: 'start', t0ServerMs: 10_000 });
    net.setServerNow(9_000);
    expect(race.targetTicks()).toBeLessThan(0);
    net.setServerNow(10_100);
    expect(race.targetTicks()).toBeCloseTo(0.1 / SIM_DT, 6);
    run(10);
    expect(race.targetTicks()).toBeCloseTo(0.1 / SIM_DT - 10, 6);
  });

  it('poses puppets from their samples before each tick (live → stale) and snaps on first sight', () => {
    const { net, race, sim, snaps, run } = setup();
    const car = sim.world.state.cars[1]!;
    const x0 = car.vehicle.x;
    const s = newNetCarState();
    s.id = 2;
    s.simMs = 0;
    s.x = x0 + 3;
    s.z = car.vehicle.z;
    s.yaw = car.vehicle.yaw;
    s.vx = 20 * Math.cos(s.yaw);
    s.vz = -20 * Math.sin(s.yaw);
    s.gear = 3;
    s.rpm = 9000;
    s.progress = car.race.progress;
    net.state(s);
    run(24); // 0.1 s
    expect(snaps).toEqual([1]);
    expect(car.vehicle.x).toBeCloseTo(s.x + s.vx * 0.1, 3);
    expect(car.vehicle.gear).toBe(3);
    expect(car.vehicle.rpm).toBe(9000);
    expect(car.vehicle.speed).toBeCloseTo(20, 3);
    expect(race.link(1)).toBe('ok');
    run(240); // 1.1 s past the sample → beyond the 400 ms horizon + 0.5 s roll-out
    expect(race.link(1)).toBe('stale');
    expect(race.staleCount()).toBe(1);
    expect(car.vehicle.x).toBeCloseTo(s.x + s.vx * (0.4 + 0.25), 2); // rolled to a stop past the horizon, held
    net.msg({ type: 'player', id: 2, connected: false, stale: true });
    expect(race.link(1)).toBe('dc');
  });

  it('user bug 2026-10-26: an absent remote car (server-stale, retired) is parked off the map, no yellow / SC cause, and comes back', () => {
    const { net, race, sim, snaps, run } = setup();
    const car = sim.world.state.cars[1]!;
    const sample = (simMs: number): void => {
      const s = newNetCarState();
      s.id = 2;
      s.simMs = simMs;
      s.x = car.vehicle.x < PARK_X * 0.5 ? car.vehicle.x : 0;
      s.z = car.vehicle.z < PARK_X * 0.5 ? car.vehicle.z : 0;
      s.progress = car.race.progress;
      net.state(s);
    };
    // No sample yet: it stays on its grid slot but is no yellow / safety-car cause.
    run(1);
    expect(crx(car.race).scCleared).toBe(1);
    sample(10);
    run(4);
    expect(crx(car.race).scCleared).toBe(0);
    // The server says it went stale (frozen tab / lost link): parked, hidden, cleared.
    net.msg({ type: 'player', id: 2, connected: true, stale: true });
    run(4);
    expect(car.vehicle.x).toBeGreaterThanOrEqual(PARK_X * 0.5);
    expect(crx(car.race).scCleared).toBe(1);
    const rf = createRenderFrameBuilder(sim, sim.world.state.cars.map(() => ({ number: 1, tcam: 'black' as const })), 0, null);
    expect(rf.build(1, 0, false).cars[1]!.visible).toBe(false);
    // Live again: posed from its samples, with a snap (no smear from the parking spot).
    net.msg({ type: 'player', id: 2, connected: true, stale: false });
    snaps.length = 0;
    sample(sim.world.state.time * 1000);
    run(2);
    expect(car.vehicle.x).toBeLessThan(PARK_X * 0.5);
    expect(snaps).toContain(1);
    expect(rf.build(1, 0, false).cars[1]!.visible).toBe(true);
    // Retired by the server (standings): parked for good.
    net.msg({ type: 'standings', order: [5, 2, 64], laps: [0, 0, 0], gapMs: [0, 0, 0], status: ['running', 'dnf', 'running'] });
    sample(sim.world.state.time * 1000 + 50);
    run(2);
    expect(car.vehicle.x).toBeGreaterThanOrEqual(PARK_X * 0.5);
    expect(race.link(1)).toBe('stale');
  });

  it('sends its own state at NET_HZ on the shared race clock', () => {
    const { net, run } = setup();
    for (let k = 0; k < 60; k++) run(4); // 1 s at 60 fps
    expect(net.sentStates.length).toBe(21); // first tick batch, then every 50 ms up to t = 1 s
    expect(net.sentStates[2]!.simMs - net.sentStates[1]!.simMs).toBe(50);
    // 48 fps frames (5 ticks) still average NET_HZ.
    const b = setup();
    for (let k = 0; k < 96; k++) b.run(5);
    expect(Math.abs(b.net.sentStates.length - 40)).toBeLessThanOrEqual(1);
    expect(net.sentStates[0]!.seq).toBe(1);
  });

  it('server standings / finishing / results reach the remote cars, the tower order and the results model', () => {
    const { net, race, sim } = setup();
    net.setServerNow(20_000);
    net.msg({ type: 'standings', order: [64, 5, 2], laps: [1, 0, 0], gapMs: [0, 1200, 3400], status: ['finished', 'running', 'running'] });
    const so = race.standings()!;
    expect(Array.from(so.order)).toEqual([2, 0, 1]);
    expect(Array.from(so.gapMs)).toEqual([0, 1200, 3400]);
    expect(sim.world.state.cars[2]!.race.finished).toBe(true);
    expect(sim.world.state.cars[2]!.race.lapsCompleted).toBe(1);
    net.setServerNow(21_500);
    expect(race.standings()).toBeNull(); // stale after 1 s → local order
    sim.world.state.race.phase = 'running';
    net.msg({ type: 'finishing', byId: 64, windowMs: 120_000 });
    expect(sim.world.state.race.phase).toBe('finishing');
    expect(race.results()).toBeNull();
    const row = { name: 'x', teamId: 'anka', totalMs: 1, gapMs: 0, lapsDown: 0, stops: 0, penaltySec: 0, points: 0, status: 'finished' as const };
    net.msg({ type: 'results', rows: [{ ...row, pos: 2, id: 5, bestLapMs: 70_000 }, { ...row, pos: 1, id: 64, bestLapMs: 69_000 }] });
    const res = race.results()!;
    expect(res.rows.map((r) => r.car)).toEqual([2, 0]);
    expect(res.fastestCar).toBe(2);
  });

  it('reports client-judged penalties to the server', () => {
    const { net, race } = setup();
    race.onSimEvent({ type: 'penalty', car: 0, seconds: 5, reason: 'trackLimits' });
    race.onSimEvent({ type: 'penalty', car: 1, seconds: 5, reason: 'trackLimits' });
    expect(net.sentJson.filter((m) => m.type === 'report')).toEqual([{ type: 'report', kind: 'trackLimits', seconds: 5, lap: 0 }]);
  });

  it('buildOnlineResults skips unknown ids', () => {
    const r = buildOnlineResults([{ pos: 1, id: 99, name: 'x', teamId: 'anka', totalMs: 0, gapMs: 0, lapsDown: 0, bestLapMs: 0, stops: 0, penaltySec: 0, points: 0, status: 'dnf' }], () => -1);
    expect(r.rows).toEqual([]);
  });
});

describe('P3c contact glue', () => {
  const relayed = (j: number): NetContact => ({ ...newNetContact(), other: 2, j, nx: 0, nz: 1, px: 0, pz: 0, simMs: 0 });

  it('a relayed contact is applied once: duplicates add nothing, a larger total only tops up', () => {
    const { net, race, sim, run } = setup();
    run(1); // physics creates aux etc.
    const v = sim.world.state.cars[0]!.vehicle;
    const m = v.massKg;
    const vz0 = v.vz;
    net.contact(relayed(1600));
    net.contact(relayed(1600)); // the same episode relayed twice
    race.beforeTick(); // the glue writer applies queued contacts (the grid hold would zero the speed in a step)
    expect((v.vz - vz0) * m).toBeCloseTo(1600, -1);
    const vz1 = v.vz;
    net.contact(relayed(2400)); // the sender's episode total grew: apply the difference only
    race.beforeTick();
    expect((v.vz - vz1) * m).toBeCloseTo(800, -1);
    // The relayed hit also reaches audio / VFX as a collision event from the sender (never sent back).
    expect(net.sentContacts.length).toBe(0);
  });

  it('a hit the local CollisionSystem already resolved is not applied again when its relay arrives', () => {
    const { net, race, sim, run } = setup();
    run(1);
    const v = sim.world.state.cars[0]!.vehicle;
    // Local detection of the same episode first (what the CollisionSystem records through the shared episodes).
    const raceMs = sim.world.state.race.raceMs;
    const k = 0 * race.episodes.n + race.carOf(2); // pair (local car 0, NetId 2's car)
    race.episodes.untilMs[k] = raceMs + 200;
    race.episodes.applied[k] = 1600;
    const vz0 = v.vz;
    net.contact(relayed(1600));
    race.beforeTick();
    expect(Math.abs((v.vz - vz0) * v.massKg)).toBeLessThan(1);
  });

  it('a local hit on a puppet sends one `contact` per 200 ms episode (≤ 5/s per pair), with n from the local car to the other', () => {
    const { net, race, sim } = setup();
    sim.world.state.race.raceMs = 10_000;
    const hit = { type: 'collision' as const, a: 0, b: 2, impulse: 900, x: 1, y: 0, z: 2, nx: 0.6, nz: 0.8 };
    race.onSimEvent(hit);
    race.onSimEvent(hit);
    sim.world.state.race.raceMs = 10_150;
    race.onSimEvent(hit);
    expect(net.sentContacts.length).toBe(1);
    expect(net.sentContacts[0]).toMatchObject({ other: 64, j: 900, nx: 0.6, nz: 0.8, px: 1, pz: 2 });
    sim.world.state.race.raceMs = 10_200;
    race.onSimEvent(hit);
    expect(net.sentContacts.length).toBe(2);
    race.onSimEvent({ ...hit, a: 2, b: 0 }); // a relayed / remote-initiated event is never sent
    race.onSimEvent({ ...hit, b: -1 }); // walls neither
    expect(net.sentContacts.length).toBe(2);
  });

  it('ghost windows: a reset puppet gets 3 s, a (re)connect gives every puppet 2 s', () => {
    const { net, sim, run } = setup();
    run(2);
    const aux = (car: number) => sim.world.state.cars[car]!.vehicle.aux;
    expect(aux(1)).toBeDefined(); // the CollisionSystem creates aux for every car on its first step
    const s = newNetCarState();
    s.id = 2;
    s.simMs = 5;
    s.flags = NET_FLAG_RESET;
    net.state(s);
    expect(aux(1)!.ghostT).toBe(3);
    net.msg({ type: 'welcome', id: 5, resumeToken: '0'.repeat(32), serverMs: 0, limits: { maxPlayers: 20, hz: 20 } });
    expect(aux(2)!.ghostT).toBeGreaterThanOrEqual(2);
    expect(aux(1)!.ghostT).toBe(3);
  });

  it('createSim wires the online collision options (shared episodes)', () => {
    const { race } = setup();
    expect(race.collision.episodes).toBe(race.episodes);
    expect(race.collision.remoteContactScale!(1)).toBe(0); // no sample yet → stale → no contact
  });
});

describe('D-058 equal cars online', () => {
  it('every car of an online session has identical effective params, and the server sim builds the same', async () => {
    const { race, sim } = setup();
    const ps = sim.world.static.params.map((p) => JSON.stringify(p));
    expect(new Set(ps).size).toBe(1);
    expect(race.cfg.equalCars).toBe(true);
    const { RoomSim } = await import('../../../server/src/serverAi');
    const room = new RoomSim(LOAD.config, LOAD.roster, sim.world.static.track);
    expect(room.runner.world.static.params.map((p) => JSON.stringify(p))).toEqual(room.runner.world.static.params.map(() => ps[0]));
    // Single player keeps the team differences.
    const offline = createSim(defaultSessionConfig({ mode: 'race', aiCount: 5, seed: 3 }));
    expect(new Set(offline.world.static.params.map((p) => JSON.stringify(p))).size).toBeGreaterThan(1);
  });
});
