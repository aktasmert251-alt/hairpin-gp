import { describe, expect, it } from 'vitest';
import { parseCtl } from '../hostProtocol';
import { HIDDEN_WARN_MS, canInvite, hostVisibilityStep, isP2PUrl, liveSlots, type P2PSlot } from '../model';
import { answerKey, offerKey, relayCodeInput, relayGet, relayPut } from '../relay';

const slot = (n: number, state: P2PSlot['state']): P2PSlot => ({ n, state, invite: '', error: null, pingMs: 0 });

describe('host tab visibility (Page Visibility → guests paused banner, host warning)', () => {
  it('hiding with guests tells them; a long absence warns the host on return', () => {
    let v = { hidden: false, hiddenAt: 0 };
    const hide = hostVisibilityStep(v, true, 1000, 2);
    expect(hide.ctl).toEqual({ t: 'paused', v: true });
    expect(hide.warn).toBe(false);
    v = hide.next;
    const show = hostVisibilityStep(v, false, 1000 + HIDDEN_WARN_MS, 2);
    expect(show.ctl).toEqual({ t: 'paused', v: false });
    expect(show.warn).toBe(true);
    expect(show.next.hidden).toBe(false);
  });

  it('a short glance away does not warn; without guests nothing is sent; repeated states are no-ops', () => {
    const v = hostVisibilityStep({ hidden: false, hiddenAt: 0 }, true, 5000, 1).next;
    expect(hostVisibilityStep(v, false, 5000 + HIDDEN_WARN_MS - 1, 1).warn).toBe(false);
    expect(hostVisibilityStep({ hidden: false, hiddenAt: 0 }, true, 0, 0).ctl).toBeNull();
    expect(hostVisibilityStep(v, false, 99_999, 0)).toMatchObject({ ctl: null, warn: false });
    expect(hostVisibilityStep(v, true, 9000, 3)).toEqual({ next: v, ctl: null, warn: false });
  });
});

describe('host model rules', () => {
  it('guest slots count against the 20-player cap (the host is one of them); closed / failed ones do not', () => {
    const slots = [slot(2, 'connected'), slot(3, 'waiting'), slot(4, 'failed'), slot(5, 'closed')];
    expect(liveSlots(slots)).toBe(2);
    expect(canInvite(slots, 20)).toBe(true);
    expect(canInvite(Array.from({ length: 19 }, (_, i) => slot(i + 2, 'connected')), 20)).toBe(false);
    expect(canInvite(Array.from({ length: 18 }, (_, i) => slot(i + 2, 'connected')), 20)).toBe(true);
  });

  it('p2p urls and the ctl side channel parser', () => {
    expect(isP2PUrl('p2p:host')).toBe(true);
    expect(isP2PUrl('p2p:guest')).toBe(true);
    expect(isP2PUrl('wss://example.test/ws')).toBe(false);
    expect(parseCtl('{"t":"paused","v":true}')).toEqual({ t: 'paused', v: true });
    expect(parseCtl('{"t":"bye"}')).toEqual({ t: 'bye' });
    expect(parseCtl('{"t":"paused","v":1}')).toBeNull();
    expect(parseCtl('nonsense')).toBeNull();
    expect(parseCtl(new ArrayBuffer(4))).toBeNull();
  });
});

describe('optional signaling relay client', () => {
  it('uses fixed mailbox keys and the same codes; unreachable relay = null / false', async () => {
    expect(offerKey('K7M2PQ')).toBe('K7M2PQ-o');
    expect(answerKey('K7M2PQ', 3)).toBe('K7M2PQ-a3');
    expect(relayCodeInput(' k7m2pq ')).toBe('K7M2PQ');
    expect(relayCodeInput('HP1I.abc')).toBeNull();
    const box = new Map<string, string>();
    const fake = (async (url: string, init?: RequestInit) => {
      const key = url.split('/m/')[1]!;
      if (init?.method === 'PUT') {
        box.set(key, String(init.body));
        return new Response(null, { status: 204 });
      }
      return box.has(key) ? new Response(box.get(key)) : new Response('', { status: 404 });
    }) as typeof fetch;
    expect(await relayPut('https://relay.test/', 'K7M2PQ-o', 'HP1I.x', fake)).toBe(true);
    expect(await relayGet('https://relay.test', 'K7M2PQ-o', fake)).toBe('HP1I.x');
    expect(await relayGet('https://relay.test', 'K7M2PQ-a2', fake)).toBeNull();
    const down = (async () => { throw new Error('offline'); }) as typeof fetch;
    expect(await relayGet('https://relay.test', 'K7M2PQ-o', down)).toBeNull();
    expect(await relayPut('https://relay.test', 'K7M2PQ-o', 'x', down)).toBe(false);
  });
});
