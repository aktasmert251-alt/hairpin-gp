# P2P mailbox: security review (D-064)

Scope: `p2p-signal/src/worker.ts`, client `src/net/p2p/relay.ts`. API: `PUT|GET|DELETE /m/<CODE>-o|-a<slot>`,
TTL 300 s, game codes only (`HP1I.` under `-o`, `HP1A.` under `-a`). Reviewed at b4c6b34; fixes on `p2p-aux`.

## Findings
| # | Threat | Before | Now |
|---|---|---|---|
| 1 | Offer tampering / host impersonation | anyone with the code could PUT or DELETE `-o` / `-a` | **fixed**: first PUT binds the key to a random per-page token (`x-hp-owner`); only its SHA-256 is stored, constant-time compare; others get 409, no token 401 |
| 2 | Abuse (free KV quota: 1,000 writes/day) | no limits | **fixed**: 30 writes / 10 min per IP (in memory per isolate, never stored) |
| 3 | Code enumeration (32^6 ≈ 1.07e9) | unlimited GETs | **fixed**: 30 unknown-invite lookups / 10 min per IP; answer polls not counted |
| 4 | CORS | non-matching origin still served | **fixed**: `ALLOWED_ORIGIN` comma list, other pages 403; empty = `*` (README says set it) |
| 5 | Wrong code kind | invite storable under answer key | **fixed** |
| 6 | Hung requests | 2 s poll could pile up | **fixed**: client 8 s timeout |
| 7 | Body cap, logging | 16 KB cap, no logs, no IP stored | OK |

## Residual risks
- **Slot squatting:** whoever knows code + slot first can answer it; the host sees every join and can kick.
- **Guest check (session.ts, not mine):** `joinInvite` should reject an invite whose `display` differs from the typed code.
- **Limits per isolate:** a botnet or isolate churn evades them; worst case the free quota runs out and the relay
  fails for the day. Manual codes always work.
- **KV consistency:** up to ~60 s across locations; negative lookups may be cached.
- **Token loss:** after a reload the page cannot rewrite its old keys; they expire in 300 s, so open a new room.
- **Origin spoofing:** CORS only binds browsers; non-browser clients are covered by the limits.

## Deploy checklist
1. Free Cloudflare account; in `p2p-signal/`: `npx wrangler login` (user, interactive).
2. `npx wrangler kv namespace create MAILBOX`; paste the id into `wrangler.toml`.
3. Set `ALLOWED_ORIGIN` to the Pages origin (+ dev origins if wanted).
4. `npx wrangler deploy`; no account id or secret in git.
5. Build with `VITE_P2P_SIGNAL_URL`; test with two browsers; check the privacy text.
6. Watch the KV usage in the dashboard; delete with `npx wrangler delete`.
