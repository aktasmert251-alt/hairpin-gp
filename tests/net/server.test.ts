import { expect, test } from 'vitest';
import { ProbeBot, makeLobby, startLobby, startRace } from './bots';
import { scenario } from './scenario';
import { sleep, until } from './runtime';
import { PROTOCOL_VERSION } from '../../src/contracts/net';

test('T1 hello-to-welcome below 100 ms and correct room snapshot', async () => {
  await scenario('t1-connect', async (_srv, fleet) => {
    const b = await fleet.add('Connect');
    await makeLobby([b], { trackId: 'istanbul', laps: 3 });
    expect(b.welcomeMs).toBeLessThan(100);
    expect(b.room).toMatchObject({ ownerId: b.id, phase: 'lobby', settings: { trackId: 'istanbul', laps: 3, aiCount: 0 } });
    expect(b.room!.players).toEqual([expect.objectContaining({ id: b.id, name: 'Connect', connected: true, ready: false })]);
    expect(b.token).toMatch(/^[a-f0-9]{32}$/);
    return { welcomeMs: b.welcomeMs, connectMs: b.connectMs };
  });
});

test('T4 two rooms with four bots each never cross relay, roster, or control identities', async () => {
  await scenario('t4-isolation', async (srv, fleet) => {
    const a = await fleet.group(4, 'RoomA');
    const b = await fleet.group(4, 'RoomB');
    const codeA = await startRace(a, { trackId: 'istanbul', laps: 10 });
    const codeB = await startRace(b, { trackId: 'bosphorus', laps: 10 });
    expect(codeA).not.toBe(codeB);
    await until(() => a.every((x) => x.batches >= 50) && b.every((x) => x.batches >= 50), 20_000, 'both rooms relaying');
    for (const group of [a, b]) {
      const ids = group.map((x) => x.id);
      for (const bot of group) {
        expect([...bot.seenIds].sort()).toEqual(ids.filter((id) => id !== bot.id).sort());
        expect(bot.seenAiIds.size).toBe(0);
        for (const m of bot.msgs) {
          if (m.type === 'room') expect(m.players.every((p) => ids.includes(p.id))).toBe(true);
          if (m.type === 'load') expect(m.roster.map((p) => p.id).sort()).toEqual([...ids].sort());
          if (m.type === 'standings') expect(m.order.every((id) => ids.includes(id))).toBe(true);
          if (m.type === 'player' || m.type === 'lap' || m.type === 'penalty') expect(ids).toContain(m.id);
        }
      }
    }
    expect((await srv.health()).rooms.map((r) => r.humans)).toEqual([4, 4]);
    expect(srv.logs.filter((l) => l.event === 'roomError' || l.event === 'messageError')).toEqual([]);
  });
});

test('T5 resume after 5 s keeps token, slot and race; 70 s disconnected becomes DNF', async () => {
  await scenario('t5-reconnect', async (srv, fleet) => {
    const [keeper, lost] = await fleet.group(2, 'Resume');
    await startRace([keeper!, lost!], { laps: 10, trackId: 'istanbul' });
    await until(() => lost!.lastState && lost!.sent >= 80 && lost!.lastState.simMs > lost!.load!.lightsOutAtMs + 3000,
      25_000, 'car moving after lights before drop');
    const id = lost!.id, token = lost!.token, t0 = lost!.t0;
    const entry = lost!.load!.roster.find((r) => r.id === id)!;
    const dropped = keeper!.next((m) => m.type === 'player' && m.id === id && !m.connected);
    lost!.drop(); await dropped; await sleep(5000);
    const countBeforeResume = keeper!.receivedCounts.get(id) ?? 0;
    // This is a transport reconnect: keep the live sender's sequence, as opposed to a fresh session/reload.
    const lastSeq = lost!.lastState!.seq;
    const resumed = new ProbeBot({ url: srv.url, name: 'Resume Again' }); fleet.bots.push(resumed);
    resumed.transformState = (s) => { s.seq = (s.seq + lastSeq) & 0xffff; };
    const resumeAt = performance.now();
    expect((await resumed.connect(token)).type).toBe('welcome');
    await resumed.waitFor((m) => m.type === 'start');
    expect(resumed.id).toBe(id); expect(resumed.token).toBe(token); expect(resumed.t0).toBe(t0);
    expect(resumed.load!.roster.find((r) => r.id === id)).toEqual(entry);
    await keeper!.waitFor((m) => m.type === 'player' && m.id === id && m.connected);
    await until(() => (keeper!.receivedCounts.get(id) ?? 0) > countBeforeResume, 5000, 'fresh state relayed after resume');
    const resumeRelayMs = performance.now() - resumeAt;
    expect(keeper!.receivedStates.get(id)!.simMs).toBeGreaterThan(lost!.lastState!.simMs);
    expect(srv.logs.some((l) => l.event === 'roomLeave' && l.id === id)).toBe(false);
    const gone = keeper!.next((m) => m.type === 'player' && m.id === id && !m.connected);
    resumed.drop(); await gone;
    const since = performance.now();
    await sleep(70_000);
    const timeout = srv.logs.find((l) => l.event === 'roomLeave' && l.id === id && l.reason === 'timeout');
    expect(timeout).toBeDefined();
    const standings = [...keeper!.msgs].reverse().find((m) => m.type === 'standings');
    expect(standings?.type).toBe('standings');
    if (standings?.type === 'standings') expect(standings.status[standings.order.indexOf(id)]).toBe('dnf');
    const expired = await fleet.add('Expired', {}, token);
    expect(expired.token).not.toBe(token);
    expect(expired.room).toBeNull();
    expect(performance.now() - since).toBeGreaterThanOrEqual(70_000);
    return { graceRaceMs: 60_000, withinGraceOfflineMs: 5000, resumeRelayMs, expiredOfflineMs: performance.now() - since };
  });
});

test('T5 lobby reload resumes the existing ready seat', async () => {
  await scenario('t5-lobby-resume', async (_srv, fleet) => {
    const b = await fleet.add('Lobby'); await makeLobby([b]);
    const room = b.room!; b.drop(); await sleep(150);
    const resumed = await fleet.add('Reload', {}, b.token);
    await resumed.waitFor((m) => m.type === 'room');
    expect(resumed.id).toBe(b.id); expect(resumed.room!.code).toBe(room.code);
    expect(resumed.room!.players.map((p) => p.id)).toEqual([b.id]);
  });
});

test('T6 malformed binaries/JSON rejected; five bad messages close 1008; oversized closes 1009', async () => {
  await scenario('t6-malformed', async (srv, fleet) => {
    const b = await fleet.add('Malformed'); await makeLobby([b]);
    const short = new Uint8Array(39); short[0] = 0x10;
    const long = new Uint8Array(41); long[0] = 0x10;
    // x is a float at offset 8. Start with a valid encoded state so NaN is the only invalid field.
    const { encodeState, newNetCarState, viewOf } = await import('../../src/net/protocol');
    const nan = new Uint8Array(40); encodeState(newNetCarState(), viewOf(nan)); viewOf(nan).setFloat32(8, NaN, true);
    for (const payload of [new Uint8Array([0xff, 0x43, 0x12]), short, long, nan]) {
      const response = b.next((m) => m.type === 'error'); b.sendRaw(payload);
      expect(await response).toEqual({ type: 'error', code: 'badMessage' });
    }
    b.sendRaw('{broken');
    await until(() => b.closeCode === 1008, 3000, 'bad-message close');
    const huge = await fleet.add('Oversized'); huge.sendRaw('x'.repeat(1025));
    await until(() => huge.closeCode === 1009, 3000, 'oversize close');
    const unknown = await fleet.add('Unknown');
    const reply = unknown.next((m) => m.type === 'error'); unknown.send({ type: 'invented' });
    expect(await reply).toEqual({ type: 'error', code: 'badMessage' });
    expect((await srv.health()).ok).toBe(true);
    expect(srv.logs.filter((l) => l.event === 'messageError')).toEqual([]);
  });
});

test('T6 HTML/bidi names rejected and sustained 200 messages/s flood closed', async () => {
  await scenario('t6-names-flood', async (srv, fleet) => {
    for (const name of ['<script>', 'Safe\u202EName', 'Bad\u0000Name']) {
      const b = new ProbeBot({ url: srv.url, name }); fleet.bots.push(b);
      expect(await b.connect()).toEqual({ type: 'error', code: 'badName' }); b.dispose();
    }
    const b = await fleet.add('Flood');
    // Valid ping packets exercise rate limiting rather than the malformed-message counter.
    const { encodePing, viewOf } = await import('../../src/net/protocol');
    const packet = new Uint8Array(12); let seq = 0;
    const timer = setInterval(() => { encodePing(seq++, performance.now(), viewOf(packet)); b.sendRaw(packet); }, 5);
    try { await until(() => b.closeCode === 1008, 5000, 'flood close'); } finally { clearInterval(timer); }
    expect(srv.logs.some((l) => l.event === 'wsFlood')).toBe(true);
    expect((await srv.health()).ok).toBe(true);
  });
});

test('T6 socket identity wins over forged owner/player fields and cross-room target', async () => {
  await scenario('t6-impersonation', async (srv, fleet) => {
    const [owner, attacker, foreign] = await fleet.group(3, 'Identity');
    const code = await makeLobby([owner!, attacker!]); await makeLobby([foreign!]);
    let reply = attacker!.next((m) => m.type === 'error');
    attacker!.send({ type: 'start', id: owner!.id, playerId: owner!.id, code });
    expect(await reply).toEqual({ type: 'error', code: 'badMessage' });
    reply = attacker!.next((m) => m.type === 'error');
    attacker!.send({ type: 'setSettings', id: owner!.id, settings: { ...owner!.room!.settings, laps: 10 } });
    expect(await reply).toEqual({ type: 'error', code: 'badMessage' });
    expect(owner!.room!.settings.laps).toBe(1);
    reply = attacker!.next((m) => m.type === 'error'); attacker!.send({ type: 'start' });
    expect(await reply).toEqual({ type: 'error', code: 'phase' });
    await startLobby([owner!, attacker!]);
    await attacker!.waitFor((m) => m.type === 'room' && m.phase === 'racing', 15_000);
    const { newNetContact } = await import('../../src/net/protocol');
    attacker!.contact({ ...newNetContact(), other: foreign!.id, nx: 1, j: 100 });
    await until(() => srv.logs.some((l) => l.event === 'contactReject' && l.id === attacker!.id && l.why === 'target'), 5000, 'cross-room contact reject');
    expect(foreign!.contacts).toEqual([]);
    reply = attacker!.next((m) => m.type === 'error');
    attacker!.send({ type: 'retire', id: owner!.id });
    expect(await reply).toEqual({ type: 'error', code: 'badMessage' });
    const retired = owner!.next((m) => m.type === 'standings' && m.status[m.order.indexOf(attacker!.id)] === 'dnf');
    attacker!.send({ type: 'retire' }); await retired;
    const last = [...owner!.msgs].reverse().find((m) => m.type === 'standings');
    if (last?.type === 'standings') expect(last.status[last.order.indexOf(owner!.id)]).toBe('running');
    expect((await srv.health()).ok).toBe(true);
    return { protocolVersion: PROTOCOL_VERSION };
  });
});

test('T7 teleport/speed/fakeProgress bots struck; earlyStart penalised; legitimate bots have zero strikes', async () => {
  await scenario('t7-cheats', async (srv, fleet) => {
    const legit = await fleet.add('Legit');
    const teleport = await fleet.add('Teleport', { tamper: 'teleport' });
    const speed = await fleet.add('Speed', { tamper: 'speed' });
    const progress = await fleet.add('Progress', { tamper: 'fakeProgress' });
    const early = await fleet.add('Early', { tamper: 'earlyStart' });
    const other = await fleet.add('Other Legit');
    await startRace([legit, teleport, speed, progress], { trackId: 'istanbul' });
    await startRace([other, early], { trackId: 'istanbul' });
    await until(() => legit.lastState && other.lastState && legit.lastState.simMs > legit.load!.lightsOutAtMs + 7000
      && other.lastState.simMs > other.load!.lightsOutAtMs + 7000, 30_000, 'cheats exercised after lights');
    expect(srv.logs.filter((l) => l.event === 'strike' && [legit.id, other.id].includes(Number(l.id)))).toEqual([]);
    expect(srv.logs.filter((l) => l.event === 'hardViolation' && l.id === teleport.id).length).toBeGreaterThanOrEqual(2);
    expect(srv.logs.some((l) => l.event === 'strike' && l.id === speed.id && l.reason === 'speed')).toBe(true);
    expect(srv.logs.some((l) => l.event === 'strike' && l.id === progress.id && ['progress', 'trackS'].includes(String(l.reason)))).toBe(true);
    expect(srv.logs.some((l) => l.event === 'strikeMute' && l.id === progress.id)).toBe(true);
    await other.waitFor((m) => m.type === 'penalty' && m.id === early.id && m.seconds === 5 && m.reason === 'jumpStart');
    const standing = [...legit.msgs].reverse().find((m) => m.type === 'standings');
    if (standing?.type === 'standings') {
      expect(standing.status[standing.order.indexOf(teleport.id)]).toBe('dsq');
      expect(standing.laps[standing.order.indexOf(progress.id)]).toBe(0);
    } else throw new Error('No standings');
  });
});
