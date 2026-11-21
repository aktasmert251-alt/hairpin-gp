import { expect, test } from 'vitest';
import type { NetCarState, NetContact } from '../../src/contracts/net';
import { NET_FLAG_RESET, NET_LIMITS, newNetContact } from '../../src/net/protocol';
import { loadRaceTrack } from '../../src/track/registry';
import { checkContact, type ContactReject } from '../../server/src/contact';
import { ProbeBot, startRace } from './bots';
import { scenario } from './scenario';
import { sleep, until, writeEvidence } from './runtime';

// Server-side skeleton only: prescribed kinematic samples on the track, no collision response or renderer.
// Both trajectories share 150 km/h forward travel, converging laterally to 1 m separation at the scripted impact.
function scriptedPair(a: ProbeBot, b: ProbeBot): void {
  const q = loadRaceTrack('istanbul').query;
  for (const [bot, side] of [[a, -1], [b, 1]] as const) {
    bot.transformState = (s) => {
      const t = Math.max(0, (s.simMs - bot.load!.lightsOutAtMs) / 1000);
      const progress = 100 + 150 / 3.6 * t;
      const d = side * (3 - Math.min(2.5, Math.max(0, t - 1.5) * 25));
      const p = q.worldFromSD(q.wrapS(progress), d, { x: 0, y: 0, z: 0 });
      const i = Math.floor(q.wrapS(progress));
      const tx = q.data.tx[i]!, tz = q.data.tz[i]!;
      s.x = p.x; s.y = p.y; s.z = p.z; s.progress = progress;
      // Prescribe pre-impact velocities for the clamp probe; the harness intentionally does not resolve impacts.
      s.vx = tx * 150 / 3.6 - tz * side * 25;
      s.vz = tz * 150 / 3.6 + tx * side * 25;
      s.yaw = Math.atan2(tx, tz);
    };
  }
}

function hit(a: ProbeBot, b: ProbeBot, episode: number, j = 20_000): NetContact {
  const sa = a.lastState!, sb = b.lastState!;
  const dx = sb.x - sa.x, dz = sb.z - sa.z, length = Math.hypot(dx, dz);
  return { ...newNetContact(), other: b.id, seq: episode, episode, simMs: sa.simMs, j,
    nx: dx / length, nz: dz / length, px: (sa.x + sb.x) / 2, pz: (sa.z + sb.z) / 2, vRelN: -50 };
}

async function freshPair(a: ProbeBot, b: ProbeBot): Promise<void> {
  const aCount = a.receivedCounts.get(b.id) ?? 0, bCount = b.receivedCounts.get(a.id) ?? 0;
  await until(() => (a.receivedCounts.get(b.id) ?? 0) > aCount && (b.receivedCounts.get(a.id) ?? 0) > bCount
    && Math.abs(a.receivedStates.get(b.id)!.simMs - b.receivedStates.get(a.id)!.simMs) < 200,
    5000, 'both scripted poses freshly admitted and relayed');
}

test('T13 pure validation boundaries: cap, plausibility, far/time/stale/start rejection', () => {
  const a = { x: 0, z: 0, vx: 25, vz: 0, simMs: 5000 };
  const b = { x: 1, z: 0, vx: -25, vz: 0, simMs: 5000 };
  const c = { ...newNetContact(), simMs: 5000, j: 50_000, nx: 1 };
  const why: { r: ContactReject } = { r: '' };
  expect(checkContact(c, a, b, 5000, 1000, why)).toBe(15_000);
  expect(checkContact({ ...c, j: 100_000_000 }, a, b, 5000, 1000, why)).toBe(-1); expect(why.r).toBe('impulse');
  expect(checkContact(c, a, { ...b, x: 100 }, 5000, 1000, why)).toBe(-1); expect(why.r).toBe('far');
  expect(checkContact(c, a, b, 10_000, 1000, why)).toBe(-1); expect(why.r).toBe('time');
  expect(checkContact(c, { ...a, simMs: 3000 }, b, 5000, 1000, why)).toBe(-1); expect(why.r).toBe('stale');
  expect(checkContact({ ...c, simMs: 1500 }, a, b, 1500, 1000, why)).toBe(-1); expect(why.r).toBe('early');
  expect(checkContact({ ...c, j: 1000 }, { ...a, vx: 0 }, { ...b, vx: 0 }, 5000, 1000, why)).toBe(500);
});

test.each([0, 50, 100, 150])('T13 wire contact relay, clamp, rate and reconnect ghost at %i ms per direction', async (delay) => {
  await scenario(`t13-contact-${delay}`, async (srv, fleet) => {
    const [a, b] = await fleet.group(2, 'Contact');
    scriptedPair(a!, b!);
    await startRace([a!, b!], { trackId: 'istanbul', laps: 10 });
    await until(() => a!.lastState && b!.lastState && a!.lastState.simMs > a!.load!.lightsOutAtMs + 2000,
      25_000, 'scripted collision samples');
    // Let both latest validated poses traverse the delayed input queue.
    await sleep(delay + 150);
    let episode = 1;
    a!.contact(hit(a!, b!, episode++));
    await until(() => b!.contacts.length > 0, 3000, 'contact relayed');
    expect(a!.contacts).toHaveLength(0); // Only the other owner receives it.
    expect(b!.contacts[0]).toMatchObject({ other: a!.id, fromServer: false, episode: 1 });
    expect(b!.contacts[0]!.j).toBeGreaterThan(0);
    expect(b!.contacts[0]!.j).toBeLessThanOrEqual(15_000);
    expect(b!.contacts[0]!.j).toBeLessThan(20_000);
    b!.contact(hit(b!, a!, episode++, 100));
    await until(() => a!.contacts.length > 0, 3000, 'reverse owner relay');
    expect(a!.contacts[0]).toMatchObject({ other: b!.id, fromServer: false });

    // Burst in one pair exhausts the configured pair bucket. Shared per-socket state/contact bucket is still below flood.
    await sleep(1100);
    await freshPair(a!, b!);
    const before = b!.contacts.length;
    for (let i = 0; i < 8; i++) a!.contact(hit(a!, b!, episode++, 100));
    await until(() => srv.logs.some((l) => l.event === 'contactReject' && l.why === 'rate'), 3000, 'pair rate limit');
    await until(() => b!.contacts.length > before, 3000, 'valid contacts in rate-limit burst relayed');
    await sleep(2 * delay + 250);
    expect(b!.contacts.length - before).toBeLessThanOrEqual(NET_LIMITS.contactsPerPairPerS);
    expect(b!.contacts.length - before).toBeGreaterThan(0);

    await sleep(1100);
    await freshPair(a!, b!);
    a!.contact({ ...hit(a!, b!, episode++), j: 100_000_000 });
    await until(() => srv.logs.some((l) => l.event === 'contactReject' && l.why === 'impulse'), 3000, 'huge impulse rejected');

    // Resume gives the target a fresh two-second ghost window, independent of its existing pose.
    const token = b!.token;
    b!.drop(); await sleep(100);
    const resumed = new ProbeBot({ url: srv.url, name: 'Contact Resume' }); fleet.bots.push(resumed);
    expect((await resumed.connect(token)).type).toBe('welcome');
    const mark = srv.logs.length;
    a!.contact(hit(a!, b!, episode++, 100));
    await until(() => srv.logs.slice(mark).some((l) => l.event === 'contactReject' && l.why === 'connect'), 3000, 'resume ghost');
    expect(resumed.contacts).toHaveLength(0);
    expect(srv.logs.filter((l) => ['roomError', 'messageError'].includes(l.event))).toEqual([]);
    return { delayPerDirectionMs: delay, jitterExtraMs: 10, lossPct: 1, relayed: b!.contacts.length,
      maxImpulseNs: Math.max(...b!.contacts.map((c) => c.j)) };
  }, { delay, jitter: 10, loss: 1 });
});

// Acceptance test kept red if the server omits human reset ghost enforcement. No server implementation is patched here.
test('T13 human reset flag blocks contact for the three-second ghost window', async () => {
  await scenario('t13-human-reset-ghost', async (srv, fleet) => {
    const [a, b] = await fleet.group(2, 'Reset'); scriptedPair(a!, b!);
    await startRace([a!, b!], { trackId: 'istanbul', laps: 10 });
    await until(() => a!.lastState && a!.lastState.simMs > a!.load!.lightsOutAtMs + 2200 && b!.lastState, 25_000, 'impact poses');
    const original = b!.transformState!;
    let sentReset: NetCarState | undefined;
    b!.transformState = (s) => { original(s); if (!sentReset) { s.flags |= NET_FLAG_RESET; sentReset = { ...s }; } };
    const resetState = await until(() => sentReset, 3000, 'reset state sent');
    await freshPair(a!, b!);
    // Prove the reset state was admitted, rather than confusing malformed input with a ghost rejection.
    expect(srv.logs.filter((l) => l.event === 'strike')).toEqual([]);
    const before = b!.contacts.length;
    const mark = srv.logs.length;
    const request = hit(a!, b!, 1, 100);
    a!.contact(request);
    // Assert server enforcement directly. A single flagged pose need not be the newest pose at a relay tick.
    await until(() => srv.logs.slice(mark).some((l) => l.event === 'contactReject' && l.why === 'ghost'), 3000, 'reset ghost rejection');
    await writeEvidence('t13-reset-frame', { machine: 'Windows dev PC, not the VM', port: srv.port,
      resetState, relayedReset: a!.receivedResets.get(b!.id), request, contactsRelayedDuringGhost: b!.contacts.slice(before),
      msAfterReset: request.simMs - resetState.simMs });
    expect(b!.contacts.length, 'human reset ghost must suppress relayed contacts').toBe(before);
    await until(() => b!.lastState && b!.lastState.simMs >= resetState.simMs + 3100, 5000, 'reset ghost clock elapsed');
    a!.contact(hit(a!, b!, 2, 100));
    await until(() => b!.contacts.length > before, 3000, 'reset ghost expired');
  });
});

test('T13 stale target rejects a contact after one second without updates', async () => {
  await scenario('t13-stale-ghost', async (srv, fleet) => {
    const [a, b] = await fleet.group(2, 'Stale'); scriptedPair(a!, b!);
    await startRace([a!, b!], { trackId: 'istanbul', laps: 10 });
    await until(() => a!.lastState && a!.lastState.simMs > a!.load!.lightsOutAtMs + 2200 && b!.lastState, 25_000, 'impact poses');
    b!.suppressStates = true; await sleep(1300);
    const before = b!.contacts.length;
    a!.contact(hit(a!, b!, 1, 100));
    await until(() => srv.logs.some((l) => l.event === 'contactReject' && l.why === 'stale'), 3000, 'stale contact rejection');
    await sleep(200); expect(b!.contacts.length).toBe(before);
  });
});
