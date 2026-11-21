// D-064 host-in-browser constants (one place to change them).

/**
 * Free public STUN servers (they only tell a browser its public address; no game data passes through them). A guest behind a
 * symmetric NAT / strict firewall may still fail to connect: v1 has no TURN relay (that costs money to run).
 */
export const P2P_STUN_SERVERS: readonly string[] = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];

/**
 * Optional signaling mailbox (p2p-signal/, a Cloudflare Worker the user deploys himself): base URL such as
 * `https://hairpin-signal.<account>.workers.dev`. Empty = manual copy-paste codes only. Set at build time with
 * `VITE_P2P_SIGNAL_URL=... npm run build`.
 */
export const P2P_SIGNAL_URL: string = (import.meta.env?.VITE_P2P_SIGNAL_URL as string | undefined) ?? '';

/** ICE gathering waits at most this long before the invite / answer code is made from the candidates found so far. */
export const ICE_GATHER_MS = 4000;
/** A guest link whose connection stays 'disconnected' this long is closed (the room's reconnect grace takes over). */
export const LINK_LOST_MS = 8000;
/** Host page → worker link stats (RTT, send buffer) period. */
export const LINK_STATS_MS = 2000;
/** Longest code the paste fields accept (an invite is ~0.5–1.5 KB). */
export const MAX_CODE_CHARS = 12_000;

/** ICE servers; `?p2pIce=none` (tests, LAN only) uses host candidates only and contacts no STUN server. */
export function iceServers(search = typeof location !== 'undefined' ? location.search : ''): RTCIceServer[] {
  if (new URLSearchParams(search).get('p2pIce') === 'none') return [];
  return [{ urls: [...P2P_STUN_SERVERS] }];
}
