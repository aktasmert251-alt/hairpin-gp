# Doğrudan bağlantılı odalar / Direct-connection rooms (status note)

The direct-room disclosure is now part of the KVKK sections `data`, `technical`, `retention` and `transfer` in
`src/ui/i18n/credits.{tr,en}.ts`, and is copied into `docs/legal/{privacy,kvkk-aydinlatma}.md` and
`public/legal/{privacy,kvkk}.html` (checked by `tests/e2e/about.spec.ts`). No separate `kvkk.p2p` key is needed.

Facts it states, checked against the code (keep them true when the code changes):
- STUN only, no TURN; servers listed in `src/net/p2p/config.ts` (`P2P_STUN_SERVERS`). `?p2pIce=none` contacts none.
- Mailbox TTL `TTL_S = 300` s (`p2p-signal/src/worker.ts`); stored per key: the game code and a SHA-256 hash of the writer's
  random page token. No IP address is stored or logged; IPs are in-memory rate-limit keys per Worker isolate only.
- The hosting provider of the mailbox (Cloudflare, already named under Transfers) processes request metadata as the platform.
