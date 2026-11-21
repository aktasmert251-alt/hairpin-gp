// D-064 host-in-browser rooms, page side. One manager per tab (role host or guest):
//   host:  starts the room worker, gives its own netClient a MessagePort link, and per guest slot makes an RTCPeerConnection
//          (invite = offer code, answer pasted back), then bridges the guest's 'game' data channel to a worker port. A 'ctl'
//          channel tells guests when the host tab hides (Page Visibility) or the host leaves.
//   guest: answers an invite and hands the 'game' data channel to its netClient as the socket.
// Not sim layer: DOM / WebRTC / Worker globals, wall clock.
import type { Store } from '../../contracts/ui';
import { createStore } from '../../core/store';
import { MSG_STATES } from '../protocol';
import { ICE_GATHER_MS, LINK_LOST_MS, LINK_STATS_MS, P2P_SIGNAL_URL, iceServers } from './config';
import { parseCtl, type HostCtlMsg, type HostWorkerMsg } from './hostProtocol';
import {
  EMPTY_P2P, FIRST_GUEST_SLOT, IDLE_GUEST, P2P_HOST_URL, canInvite, hostVisibilityStep, type HostVisibility, type P2PError, type P2PModel, type P2PSlot,
} from './model';
import { answerKey, offerKey, relayCodeInput, relayGet, relayPut } from './relay';
import { codeErrorOf, decodeAnswer, decodeInvite, encodeAnswer, encodeInvite, newDisplayCode } from './signal';
import { P2P_HANDOFF_CHANNEL, type HandoffMsg } from './inviteLink';
import { DeferredTransport, channelTransport, closedTransport, pipeTransports, portTransport, type Transport } from './transport';

/** Same cap as the Node server's rooms (server/src/config.ts maxPlayersPerRoom). */
export const P2P_MAX_PLAYERS = 20;
/** Batches to a guest are skipped above this data-channel send buffer (the server's maxBufferedBytes). */
const MAX_BUFFERED = 64 * 1024;
const RELAY_POLL_MS = 2000;

export interface P2PManager {
  readonly store: Store<P2PModel>;
  /** WebRTC available in this browser. */
  supported(): boolean;
  /** Host: start the room worker (idempotent). `roomCode` reads the hub room code once the host's client created it. */
  startHost(roomCode: () => string | null): void;
  newInvite(): Promise<void>;
  acceptAnswer(n: number, raw: string): Promise<void>;
  cancelSlot(n: number): void;
  /** Guest: answer an invite (or, with a relay, a 6-character code). Resolves with the room code to join, null on error. */
  joinInvite(raw: string): Promise<string | null>;
  /** The netClient socket factory for a p2p url. */
  socket(url: string): Transport;
  dismissWarning(): void;
  /** Leaves: host → tells guests and ends the room; guest → closes the link. */
  end(): void;
}

interface HostSlot { pc: RTCPeerConnection; game: RTCDataChannel; ctl: RTCDataChannel; lostTimer: ReturnType<typeof setTimeout> | null; poll: ReturnType<typeof setInterval> | null }

async function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ICE_GATHER_MS);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

/** RTT (ms) of the selected ICE candidate pair, NaN when unknown. */
async function rttOf(pc: RTCPeerConnection): Promise<number> {
  try {
    const stats = await pc.getStats();
    let rtt = Number.NaN;
    stats.forEach((s: { type?: string; state?: string; nominated?: boolean; currentRoundTripTime?: number }) => {
      if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated && typeof s.currentRoundTripTime === 'number') rtt = s.currentRoundTripTime * 1000;
    });
    return rtt;
  } catch {
    return Number.NaN;
  }
}

export function createP2PManager(): P2PManager {
  const store = createStore<P2PModel>({ ...EMPTY_P2P, relay: P2P_SIGNAL_URL !== '' });
  const relay = P2P_SIGNAL_URL;
  // ---- host state ----
  let worker: Worker | null = null;
  let roomCodeOf: () => string | null = () => null;
  let nextSlot = FIRST_GUEST_SLOT;
  const slots = new Map<number, HostSlot>();
  let vis: HostVisibility = { hidden: false, hiddenAt: 0 };
  let statsTimer: ReturnType<typeof setInterval> | null = null;
  let onVisibility: (() => void) | null = null;
  let onPageHide: (() => void) | null = null;
  /** Answer links opened in another tab of this browser hand their code over here (see inviteLink.ts). */
  let handoff: BroadcastChannel | null = null;
  // ---- guest state ----
  let guestPc: RTCPeerConnection | null = null;
  let guestGame: RTCDataChannel | null = null;
  let guestUsed = false;
  let pending: DeferredTransport | null = null;

  const patchSlot = (n: number, patch: Partial<P2PSlot>): void => {
    store.set({ slots: store.get().slots.map((s) => (s.n === n ? { ...s, ...patch } : s)) });
  };
  const slotFailed = (n: number, error: P2PError): void => {
    patchSlot(n, { state: 'failed', error });
    dropSlot(n);
  };
  const toWorker = (m: HostWorkerMsg, transfer: Transferable[] = []): void => worker?.postMessage(m, transfer);
  const sendCtl = (dc: RTCDataChannel, m: HostCtlMsg): void => {
    if (dc.readyState === 'open') dc.send(JSON.stringify(m));
  };
  const connectedGuests = (): number => store.get().slots.filter((s) => s.state === 'connected').length;

  function dropSlot(n: number): void {
    const s = slots.get(n);
    if (!s) return;
    slots.delete(n);
    if (s.lostTimer) clearTimeout(s.lostTimer);
    if (s.poll) clearInterval(s.poll);
    try {
      s.pc.close();
    } catch {
      /* closed */
    }
  }

  /** The guest's game channel opened: bridge it to a fresh worker port. */
  function bridge(n: number, s: HostSlot): void {
    const ch = new MessageChannel();
    toWorker({ t: 'attach', label: `guest-${n}`, port: ch.port2 }, [ch.port2]);
    const port = portTransport(ch.port1);
    const dc = channelTransport(s.game);
    // Slow guest: skip state batches while its channel is backed up (the server's maxBufferedBytes rule).
    pipeTransports(port, dc, (d) => d instanceof ArrayBuffer && new Uint8Array(d)[0] === MSG_STATES && s.game.bufferedAmount > MAX_BUFFERED);
    const portClose = port.onclose;
    port.onclose = (ev) => {
      portClose?.(ev);
      patchSlot(n, { state: 'closed' });
      dropSlot(n);
    };
    patchSlot(n, { state: 'connected', error: null });
    if (vis.hidden) sendCtl(s.ctl, { t: 'paused', v: true });
  }

  async function sampleStats(): Promise<void> {
    for (const [n, s] of slots) {
      if (s.game.readyState !== 'open') continue;
      const rtt = await rttOf(s.pc);
      toWorker({ t: 'stats', label: `guest-${n}`, pingMs: rtt, buffered: s.game.bufferedAmount });
      if (Number.isFinite(rtt)) patchSlot(n, { pingMs: Math.round(rtt) });
    }
  }

  function visibilityChanged(): void {
    const step = hostVisibilityStep(vis, document.visibilityState === 'hidden', performance.now(), connectedGuests());
    vis = step.next;
    if (step.ctl) for (const s of slots.values()) sendCtl(s.ctl, step.ctl);
    store.set({ hidden: vis.hidden, ...(step.warn ? { hiddenWarn: true } : {}) });
  }

  function endHost(): void {
    for (const s of slots.values()) sendCtl(s.ctl, { t: 'bye' });
    const w = worker;
    const toClose = [...slots.keys()];
    worker = null;
    if (statsTimer) clearInterval(statsTimer);
    statsTimer = null;
    if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
    if (onPageHide) window.removeEventListener('pagehide', onPageHide);
    onVisibility = onPageHide = null;
    handoff?.close();
    handoff = null;
    // Let the 'bye' leave before the channels close.
    setTimeout(() => {
      for (const n of toClose) dropSlot(n);
      w?.postMessage({ t: 'end' } satisfies HostWorkerMsg);
      setTimeout(() => w?.terminate(), 500);
    }, 300);
  }

  function endGuest(): void {
    pending?.fail(1000);
    pending = null;
    guestGame = null;
    try {
      guestPc?.close();
    } catch {
      /* closed */
    }
    guestPc = null;
  }

  /** An answer link was opened in another tab: accept it for its slot (only the room it belongs to replies). */
  async function onHandoff(m: HandoffMsg): Promise<void> {
    if (!m || m.t !== 'answer' || typeof m.code !== 'string' || typeof m.id !== 'string' || !handoff) return;
    const ch = handoff;
    const reply = (ok: boolean, error: string | null): void => ch.postMessage({ t: 'ack', id: m.id, ok, error } satisfies HandoffMsg);
    let a;
    try {
      a = await decodeAnswer(m.code);
    } catch (e) {
      reply(false, codeErrorOf(e));
      return;
    }
    if (a.display !== store.get().display) return; // another room (another host tab): it answers
    const slot = store.get().slots.find((x) => x.n === a.slot);
    if (!slots.has(a.slot) || slot?.state !== 'waiting') {
      reply(slot?.state === 'connecting' || slot?.state === 'connected', slot ? null : 'wrongSlot');
      return;
    }
    await manager.acceptAnswer(a.slot, m.code);
    const after = store.get().slots.find((x) => x.n === a.slot);
    reply(after?.state === 'connecting' || after?.state === 'connected', after?.error ?? null);
  }

  const manager: P2PManager = {
    store,
    supported: () => typeof RTCPeerConnection !== 'undefined' && typeof Worker !== 'undefined',

    startHost(roomCode) {
      roomCodeOf = roomCode;
      if (worker) return;
      endGuest();
      worker = new Worker(new URL('./hostWorker.ts', import.meta.url), { type: 'module', name: 'hairpin-host-room' });
      nextSlot = FIRST_GUEST_SLOT;
      vis = { hidden: document.visibilityState === 'hidden', hiddenAt: performance.now() };
      store.set({ ...EMPTY_P2P, relay: relay !== '', role: 'host', display: newDisplayCode(), hidden: vis.hidden });
      onVisibility = visibilityChanged;
      document.addEventListener('visibilitychange', onVisibility);
      // Closing the tab: best effort 'bye' so guests see "host left" at once instead of a link timeout.
      onPageHide = () => {
        for (const s of slots.values()) sendCtl(s.ctl, { t: 'bye' });
      };
      window.addEventListener('pagehide', onPageHide);
      statsTimer = setInterval(() => void sampleStats(), LINK_STATS_MS);
      if (typeof BroadcastChannel !== 'undefined') {
        handoff = new BroadcastChannel(P2P_HANDOFF_CHANNEL);
        handoff.onmessage = (ev: MessageEvent) => void onHandoff(ev.data as HandoffMsg);
      }
    },

    async newInvite() {
      const m = store.get();
      const room = roomCodeOf();
      if (m.role !== 'host' || !worker) return;
      if (!room) {
        store.set({ slots: [...m.slots, { n: nextSlot++, state: 'failed', invite: '', error: 'noRoom', pingMs: 0 }] });
        return;
      }
      if (!canInvite(m.slots, P2P_MAX_PLAYERS)) return;
      const n = nextSlot++;
      store.set({ slots: [...m.slots.filter((s) => s.state !== 'failed' && s.state !== 'closed'), { n, state: 'preparing', invite: '', error: null, pingMs: 0 }] });
      let pc: RTCPeerConnection;
      try {
        pc = new RTCPeerConnection({ iceServers: iceServers() });
      } catch {
        patchSlot(n, { state: 'failed', error: 'unsupported' });
        return;
      }
      const game = pc.createDataChannel('game', { ordered: true });
      const ctl = pc.createDataChannel('ctl', { ordered: true });
      const s: HostSlot = { pc, game, ctl, lostTimer: null, poll: null };
      slots.set(n, s);
      game.addEventListener('open', () => {
        if (slots.get(n) === s) bridge(n, s);
      });
      pc.addEventListener('connectionstatechange', () => {
        if (slots.get(n) !== s) return;
        const st = pc.connectionState;
        if (st === 'failed') slotFailed(n, 'webrtc');
        else if (st === 'disconnected' && !s.lostTimer) {
          s.lostTimer = setTimeout(() => {
            if (slots.get(n) === s && pc.connectionState !== 'connected') {
              patchSlot(n, { state: 'closed' });
              dropSlot(n);
            }
          }, LINK_LOST_MS);
        } else if (st === 'connected' && s.lostTimer) {
          clearTimeout(s.lostTimer);
          s.lostTimer = null;
        }
      });
      try {
        await pc.setLocalDescription(await pc.createOffer());
        await gathered(pc);
        if (slots.get(n) !== s) return;
        const invite = await encodeInvite({ room, display: store.get().display, slot: n, sdp: pc.localDescription!.sdp });
        patchSlot(n, { state: 'waiting', invite });
        if (relay) {
          void relayPut(relay, offerKey(store.get().display), invite);
          s.poll = setInterval(() => {
            void relayGet(relay, answerKey(store.get().display, n)).then((a) => {
              if (a && slots.get(n) === s && store.get().slots.find((x) => x.n === n)?.state === 'waiting') void manager.acceptAnswer(n, a);
            });
          }, RELAY_POLL_MS);
        }
      } catch {
        if (slots.get(n) === s) slotFailed(n, 'webrtc');
      }
    },

    async acceptAnswer(n, raw) {
      const s = slots.get(n);
      if (!s) return;
      let a;
      try {
        a = await decodeAnswer(raw);
      } catch (e) {
        patchSlot(n, { error: codeErrorOf(e) });
        return;
      }
      if (a.display !== store.get().display) return patchSlot(n, { error: 'wrongRoom' });
      if (a.slot !== n) return patchSlot(n, { error: 'wrongSlot' });
      if (s.poll) clearInterval(s.poll);
      s.poll = null;
      patchSlot(n, { state: 'connecting', error: null });
      try {
        await s.pc.setRemoteDescription({ type: 'answer', sdp: a.sdp });
      } catch {
        slotFailed(n, 'webrtc');
      }
    },

    cancelSlot(n) {
      const s = slots.get(n);
      if (s) sendCtl(s.ctl, { t: 'bye' });
      dropSlot(n);
      store.set({ slots: store.get().slots.filter((x) => x.n !== n) });
    },

    async joinInvite(raw) {
      if (!manager.supported()) {
        store.set({ guest: { ...IDLE_GUEST, state: 'failed', error: 'unsupported' } });
        return null;
      }
      let text = raw;
      const short = relay ? relayCodeInput(raw) : null;
      if (short) {
        store.set({ guest: { ...IDLE_GUEST, state: 'preparing' } });
        const got = await relayGet(relay, offerKey(short));
        if (!got) {
          store.set({ guest: { ...IDLE_GUEST, state: 'failed', error: 'relayEmpty' } });
          return null;
        }
        text = got;
      }
      let inv;
      try {
        inv = await decodeInvite(text);
      } catch (e) {
        store.set({ guest: { ...IDLE_GUEST, state: 'failed', error: codeErrorOf(e) } });
        return null;
      }
      endGuest();
      store.set({ role: 'guest', display: inv.display, slots: [], hostPaused: false, hostLeft: false, guest: { ...IDLE_GUEST, state: 'preparing', slot: inv.slot } });
      const pc = new RTCPeerConnection({ iceServers: iceServers() });
      guestPc = pc;
      guestUsed = false;
      pc.addEventListener('datachannel', (ev) => {
        const dc = ev.channel;
        if (dc.label === 'ctl') {
          dc.addEventListener('message', (m) => {
            const c = parseCtl(m.data);
            if (c?.t === 'paused') store.set({ hostPaused: c.v });
            else if (c?.t === 'bye') store.set({ hostLeft: true, hostPaused: false });
          });
        } else if (dc.label === 'game') {
          guestGame = dc;
          const ready = (): void => {
            if (guestPc !== pc) return;
            store.set({ guest: { ...store.get().guest, state: 'connected', error: null } });
            if (pending && !guestUsed) {
              guestUsed = true;
              pending.bind(channelTransport(dc));
              pending = null;
            }
          };
          if (dc.readyState === 'open') ready();
          else dc.addEventListener('open', ready);
          dc.addEventListener('close', () => {
            if (guestPc === pc && !store.get().hostLeft) store.set({ guest: { ...store.get().guest, state: 'lost' } });
          });
        }
      });
      pc.addEventListener('connectionstatechange', () => {
        if (guestPc === pc && pc.connectionState === 'failed') {
          store.set({ guest: { ...store.get().guest, state: 'failed', error: 'webrtc' } });
          pending?.fail();
          pending = null;
        }
      });
      try {
        await pc.setRemoteDescription({ type: 'offer', sdp: inv.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await gathered(pc);
        if (guestPc !== pc) return null;
        const answer = await encodeAnswer({ display: inv.display, slot: inv.slot, sdp: pc.localDescription!.sdp });
        if (store.get().guest.state === 'preparing') store.set({ guest: { ...store.get().guest, state: 'answer', answer } });
        else store.set({ guest: { ...store.get().guest, answer } });
        if (relay) void relayPut(relay, answerKey(inv.display, inv.slot), answer);
      } catch {
        store.set({ guest: { ...store.get().guest, state: 'failed', error: 'webrtc' } });
        return null;
      }
      return inv.room;
    },

    socket(url) {
      if (url === P2P_HOST_URL) {
        if (!worker) return closedTransport();
        const ch = new MessageChannel();
        toWorker({ t: 'attach', label: 'host', port: ch.port2 }, [ch.port2]);
        return portTransport(ch.port1);
      }
      // Guest: the live game channel once, else wait for the one being negotiated, else nothing (the netClient backs off;
      // a new invite from the host within the reconnect grace resumes the same player).
      if (guestGame && guestGame.readyState === 'open' && !guestUsed) {
        guestUsed = true;
        return channelTransport(guestGame);
      }
      if (guestPc && !guestUsed && (guestPc.connectionState === 'new' || guestPc.connectionState === 'connecting')) {
        pending?.fail();
        pending = new DeferredTransport();
        return pending;
      }
      return closedTransport();
    },

    dismissWarning() {
      store.set({ hiddenWarn: false });
    },

    end() {
      const role = store.get().role;
      if (role === 'host') endHost();
      if (role === 'guest') endGuest();
      store.set({ ...EMPTY_P2P, relay: relay !== '' });
    },
  };
  return manager;
}

let singleton: P2PManager | null = null;

/** The tab's host-in-browser manager (created on first use). */
export function p2p(): P2PManager {
  return (singleton ??= createP2PManager());
}
