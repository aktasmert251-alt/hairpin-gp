# Host-in-browser rooms (D-064)

This is a second online mode. The tab of the player who creates the room runs the game server, and guests connect to it
over WebRTC. The page can be served statically, with no server of ours involved. Server (WebSocket) mode is unchanged.

## What runs where

| Piece | Where | Code |
|---|---|---|
| Room server (hub, room FSM, validation, timing, server AI, SC/stall, pit, D-058, D-062) | host tab, **dedicated Web Worker** | the Node server's own `server/src/hubCore.ts`, `room.ts`, `serverAi.ts` via `server/src/p2p/hostRoom.ts`; entry `src/net/p2p/hostWorker.ts` |
| Host's own client | host page | normal `netClient` over a **MessagePort** |
| Guests | guest page ↔ host page | `RTCPeerConnection`. Channel `game` is reliable and ordered (WebSocket semantics) and is piped to a worker port. Channel `ctl` carries host → guest `paused` / `bye`. |
| Signaling | any chat (manual codes) or an optional mailbox | `src/net/p2p/signal.ts`, `relay.ts`, `p2p-signal/` |

There is one protocol and one room implementation; only the transport differs.

- **Transport** (`src/net/p2p/transport.ts`) is `SocketLike` plus `bufferedAmount()`. Implementations: WebSocket,
  in-memory loopback, MessagePort and RTCDataChannel.
- **LinkPeer** (in `hostRoom.ts`) applies the limits of `ws.ts`:
  - a 1 KB payload cap (close code 1009);
  - `PeerLimits` per-class buckets with flood close (shared with `ws.ts`);
  - the server JSON cap;
  - state batches are skipped while a channel holds more than 64 KB.
- **Ping** comes from the `getStats()` round-trip time, polled every 2 s.

**Shared-file changes**
- `hub.ts` is renamed to `hubCore.ts`, which is runtime-neutral. The new `hub.ts` is a thin Node subclass that adds the
  salted log tag.
- `rand.ts` uses Web Crypto.
- `PeerLimits` is extracted into `limits.ts`.
- Bots take an optional `socket` factory.
- `vite.config` sets `worker.format: 'es'`.
- **No contract change:** the UI sends `server: 'p2p:host' | 'p2p:guest'`.

## Codes

- **Invite:** `HP1I.` + base64url(zlib(JSON)). The JSON holds `r` (room code), `c` (6-character display code), `s` (slot)
  and `d` (the SDP offer).
- **Answer:** `HP1A.` + the same encoding, without `r`.

ICE gathering finishes (4 s cap) before encoding. Adler-32 rejects damaged codes; whitespace is ignored.

STUN servers are `stun.l.google.com:19302` and `stun.cloudflare.com:3478`, set in `src/net/p2p/config.ts`.
`?p2pIce=none` uses host candidates only, for tests and LAN play.

## Flow

1. **Host:** choose *Online → Bağlantı: Oda kur (bu bilgisayar sunucu)*. A privacy note shows. Enter a nickname and
   press **ODAYI KUR**. The lobby shows the 6-character code and *"Bu sekmeyi açık ve ön planda tut"*.
2. **Host:** press **MİSAFİRLER → YENİ DAVET KODU** (Misafir 2), copy the code and send it to the friend.
3. **Guest:** choose *Odaya katıl (davet kodu)*, enter a nickname and paste the code (paste is auto-detected). Copy the
   answer code that appears and send it back.
4. **Host:** paste the answer (auto-detected, or press **BAĞLA**). The slot shows "Bağlandı · n ms" and the guest lands
   in the lobby.
5. Repeat for Misafir 3, 4 and so on, up to 20 players (the server's `maxPlayersPerRoom`). Teams, mode, track, laps,
   AI, ready, countdown and results work as in server mode.

## Host rules

- **Authority:** the host is authoritative, with one room per tab (`maxRooms: 1`); the host is the room owner.
- **Hidden host tab:** when the host tab is hidden, guests get `paused`, shown as a lobby banner or race toast. If the
  host comes back after 2 s or more with guests connected, the host sees a warning. The worker keeps ticking, but the
  host's own car stops while the tab is hidden.
- **Host leaves** (leave, quit or closing the tab): guests get `bye`, the worker ends and links close with 1001. Guests
  return to Online with *"Oda sahibi odayı kapattı"*. There is no migration in v1.
- **Guest reconnect:** the guest needs a new invite. Within the room grace (30 s in the lobby, 60 s in a race) the resume
  token rejoins the same player.

## Optional mailbox (`p2p-signal/`)

A Cloudflare Worker with KV on the free plan (no Durable Objects). It accepts `PUT/GET /m/<CODE>-o|-a<slot>` and stores
only game codes, with a TTL of 300 s. It is used when the game is built with `VITE_P2P_SIGNAL_URL` (empty by default).
Guests then type the 6-character code instead. Manual codes always work. The mailbox is not deployed (see its README).

## Known limits

- **NAT:** STUN only, no TURN (TURN costs money). Symmetric NAT or strict firewalls (some mobile and corporate networks)
  block connections. LAN and most home routers work.
- **Host load:** the host tab runs the AI and its own render; weak PCs with 19 AI cars may lag.
- **Host cheating:** the host controls the authority. Guest validation stays fully active.
- **Privacy:** IP addresses are visible to the players in the room, and the codes contain addresses. This is noted in
  the UI and `docs/legal`.
- **Head-of-line delay:** state uses the reliable channel (unreliable channel: v2).
