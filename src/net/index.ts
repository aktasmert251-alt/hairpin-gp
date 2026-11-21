// Net module façade (YÖN): other owners (src/ui) import networking only through this index (arch S-AR-06).
// protocol.ts and clock.ts are pure (sim layer, also used by server/**); netClient.ts holds the socket.

export {
  MSG_CONTACT, MSG_CONTACT_RELAY, MSG_PING, MSG_PONG, MSG_STATE, MSG_STATES, NET_FLAG_DRS_OPEN, NET_FLAG_FINISHED, NET_FLAG_IN_PIT_BOX,
  NET_FLAG_PIT_LIMITER, NET_FLAG_PIT_RIBBON, NET_FLAG_RESET, NET_FLAG_REVERSE, NET_FLAG_WRONG_WAY, NET_LAPS, NET_LIMITS, ROOM_CODE_ALPHABET,
  decodeBatchEntry, decodeBatchHeader, decodeContact, decodePing, decodePong, decodeState, encodeContact, encodePing, encodePong, encodeState,
  isRoomCode, newNetCarState, newNetContact, normalizeName, parseClientMessage, parseServerMessage, seqNewer, trackHashOf, viewOf,
} from './protocol';
export { CLOCK_SAMPLES, createClockSync, type ClockSync } from './clock';
// D-064 host-in-browser rooms (WebRTC): the manager, its UI model and the `server` values that select it.
export { p2p, P2P_MAX_PLAYERS, type P2PManager } from './p2p/session';
export {
  EMPTY_P2P, P2P_GUEST_URL, P2P_HOST_URL, canInvite, isP2PUrl, liveSlots, type P2PError, type P2PModel, type P2PSlot,
} from './p2p/model';
export { MAX_CODE_CHARS } from './p2p/config';
export {
  OFFLINE_LOBBY, RECONNECT_BACKOFF_MS, RECONNECT_GRACE_MS, createNetClient, defaultServerUrl,
  type NetClient, type NetClientDeps, type NetClientOptions, type SocketLike,
} from './netClient';
