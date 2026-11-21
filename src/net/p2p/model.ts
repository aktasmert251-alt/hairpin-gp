// D-064 host-in-browser UI model (the online / lobby screens read it through net/index) and the pure rules behind it.
import type { HostCtlMsg } from './hostProtocol';
import type { CodeError } from './signal';

/** `server` field values of the online UiActions that select a host-in-browser room instead of a server URL. */
export const P2P_HOST_URL = 'p2p:host';
export const P2P_GUEST_URL = 'p2p:guest';
export const isP2PUrl = (url: string | null | undefined): boolean => url === P2P_HOST_URL || url === P2P_GUEST_URL;

/** Guest slot numbers start at 2 (the host is player 1). */
export const FIRST_GUEST_SLOT = 2;

export type P2PError = CodeError | 'wrongRoom' | 'wrongSlot' | 'noRoom' | 'full' | 'webrtc' | 'unsupported' | 'relay' | 'relayEmpty';

export type SlotState = 'preparing' | 'waiting' | 'connecting' | 'connected' | 'closed' | 'failed';

export interface P2PSlot { n: number; state: SlotState; invite: string; error: P2PError | null; pingMs: number }

export type GuestState = 'idle' | 'preparing' | 'answer' | 'connected' | 'lost' | 'failed';

export interface P2PModel {
  role: 'none' | 'host' | 'guest';
  /** 6-character display code of the room (lobby UI, relay mailbox key). */
  display: string;
  /** Host: guest invitations, newest last. */
  slots: P2PSlot[];
  /** Host: this tab is hidden now / was hidden long enough while guests were connected (warning until dismissed). */
  hidden: boolean;
  hiddenWarn: boolean;
  /** Guest: the invitation flow. */
  guest: { state: GuestState; answer: string; error: P2PError | null; slot: number };
  /** Guest: the host's tab is in the background (its room keeps running, its own car does not). */
  hostPaused: boolean;
  /** Guest: the host closed the room. */
  hostLeft: boolean;
  /** An optional signaling relay is configured (6-character codes instead of copy-paste). */
  relay: boolean;
}

export const IDLE_GUEST: P2PModel['guest'] = { state: 'idle', answer: '', error: null, slot: 0 };

export const EMPTY_P2P: Readonly<P2PModel> = {
  role: 'none', display: '', slots: [], hidden: false, hiddenWarn: false, guest: IDLE_GUEST, hostPaused: false, hostLeft: false, relay: false,
};

/** Slots that hold (or are about to hold) a guest: they count against the room's player cap. */
export function liveSlots(slots: readonly P2PSlot[]): number {
  return slots.filter((s) => s.state !== 'closed' && s.state !== 'failed').length;
}

/** The host can invite while the room (host + live guest slots) is under the cap. */
export function canInvite(slots: readonly P2PSlot[], maxPlayers: number): boolean {
  return 1 + liveSlots(slots) < maxPlayers;
}

// ---- host tab visibility -----------------------------------------------------------------------------------------------------

/** Hidden for at least this long while guests were connected → the host is warned when he comes back. */
export const HIDDEN_WARN_MS = 2000;

export interface HostVisibility { hidden: boolean; hiddenAt: number }

/**
 * Page Visibility rule of a host tab: guests are told when the host tab hides / shows again (`ctl`), and the host is warned
 * (`warn`) after a background spell of HIDDEN_WARN_MS or more with guests connected (browsers throttle hidden tabs: his own
 * car stops and the page relays guest traffic late).
 */
export function hostVisibilityStep(prev: HostVisibility, hidden: boolean, now: number, guests: number): { next: HostVisibility; ctl: HostCtlMsg | null; warn: boolean } {
  if (hidden === prev.hidden) return { next: prev, ctl: null, warn: false };
  if (hidden) return { next: { hidden: true, hiddenAt: now }, ctl: guests > 0 ? { t: 'paused', v: true } : null, warn: false };
  return { next: { hidden: false, hiddenAt: prev.hiddenAt }, ctl: guests > 0 ? { t: 'paused', v: false } : null, warn: guests > 0 && now - prev.hiddenAt >= HIDDEN_WARN_MS };
}
