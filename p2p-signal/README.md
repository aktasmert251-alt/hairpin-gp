# p2p-signal: optional pairing mailbox for host-in-browser rooms

Host-in-browser rooms (D-064) work **without** this: players copy the invite code and the answer code through any chat.
This optional Cloudflare Worker only saves the copying. The host's page leaves its invite code in a mailbox under the
6-character room code. The guest types that short code, and the guest's answer goes back the same way.
Codes expire after 5 minutes. The mailbox never sees game traffic and stores no IP addresses.

It runs on the **free** Cloudflare plan: Workers plus Workers KV, no Durable Objects and no card.
Free-plan limits: 100,000 requests a day, 1,000 KV writes a day and 100,000 KV reads a day.
That is plenty for friends playing together.

KV is eventually consistent. If host and guest reach different Cloudflare locations, an invite can take up to about
a minute to appear. Manual copy-paste always works.

## Deploy (you run these yourself; nothing here is deployed automatically)

1. Create a free Cloudflare account. Then, in this folder: `npx wrangler login`
2. `npx wrangler kv namespace create MAILBOX`
3. Paste the printed `id` into `wrangler.toml` (`PASTE_YOUR_KV_NAMESPACE_ID_HERE`).
   Optionally set `ALLOWED_ORIGIN` to your game page origin.
4. `npx wrangler deploy`. This prints `https://hairpin-signal.<your-subdomain>.workers.dev`.
5. Build the game with that URL:
   `VITE_P2P_SIGNAL_URL=https://hairpin-signal.<your-subdomain>.workers.dev npm run build`
   (PowerShell: `$env:VITE_P2P_SIGNAL_URL='https://...'; npm run build`).

With an empty `VITE_P2P_SIGNAL_URL` (the default), the game uses manual codes only.

## API

| Method | Path | Body / result |
|---|---|---|
| `PUT` | `/m/<CODE>-o` (an `HP1I.` invite) or `/m/<CODE>-a<slot>` (an `HP1A.` answer), header `x-hp-owner` | 16 KB at most. 204; 409 if another writer owns the key |
| `GET` | same | 200 with the code, or 404 |
| `DELETE` | same, header `x-hp-owner` | 204; 409 if another writer owns the key |

`<CODE>` is 6 characters from `A–Z` (no `I`/`O`) and `2–9`. The worker rejects anything that is not a game code.
The first `PUT` binds a key to the writer's random page token (only its SHA-256 is stored), so nobody else can replace
an invite or answer. Per IP and Worker isolate, in memory only: 30 writes and 30 unknown-invite lookups per 10 minutes
(429 after). Security notes: `docs/design/multiplayer-p2p-relay.md`.
