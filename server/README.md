# APEX GP server (multiplayer v1)

One Node process: the built game (`dist/`) as static files, `/health`, and the WebSocket endpoint `/ws`, all on one origin.
Owner: Sunucu (SRV). Design: `docs/design/multiplayer.md`. Deployment: `docs/team/multiplayer-deploy.md` Part 1.

Status: **P2 server MVP**. `/ws` speaks the P1 protocol (`src/net/protocol.ts`): rooms/lobby/race FSM, relay at NET_HZ, validation, timing, results, contacts, reconnect, and the server-side AI sim (D-043).

## Layout

| Path | What |
|---|---|
| `src/main.ts` | entry: reads `PORT`, `HOST`, `DIST_DIR`, `CERT_DIR`; SIGTERM/SIGINT shutdown |
| `src/server.ts` | HTTPS if `CERT_DIR` has `key.pem` + `cert.pem`, else HTTP; 10 s header/request timeouts |
| `src/http.ts` | static files (GET/HEAD only, path-traversal guard, no dotfiles, no listing), CSP/nosniff/HSTS, `/health` |
| `src/ws.ts` | `/ws` transport: same-origin check, 1024 B payload cap, rate buckets per class (state+contact 30/s burst 10, control 5/s burst 10, ping 4/s), flood close, 24 sockets per IP, 128 total (6 ? 20 + 8; previously 48 for 2 rooms), ping every 15 s, `--net-delay` delay lines |
| `src/hub.ts` | hello (version, `normalizeName`, resume token), NetId pool (humans 0–63), room registry, message routing, bad-message strikes (5 in 10 s → 1008), 10 s hello timeout |
| `src/room.ts` | one room: lobby (owner, cars, ready, settings), load/countdown/racing/finishing/results, batched relay + AI entries (bit 7), standings 2 Hz, reconnect grace, DNF/DSQ |
| `src/validate.ts`, `src/timing.ts`, `src/contact.ts` | state checks (design §7.2), lap timing / results (§6.1, §6.3), contact clamp (§6.2) |
| `src/serverAi.ts` | `RoomSim`: `createSim` with humans as `'remote'` puppets and AI as `'ai'`, stepped to the race clock each room tick |
| `src/config.ts` | `MAX_ROOMS` 6, `MAX_PLAYERS_PER_ROOM` 20, timeouts, grace windows, lap floors (all overridable in tests) |
| `src/admin/` | admin panel (D-050): `admin.ts` /admin page + `/admin/api/*`, `crypto.ts` scrypt/TOTP, `auth.ts` lockout + sessions, `bans.ts`, `audit.ts`, `events.ts`, `setup.ts` (CLI), `panel/` (static page) |
| `src/privacy.ts` | salted /24 network hashes: logs, bans and the audit log never see a raw IP (audit.md M6) |
| `bots/bot.ts`, `bots/cli.ts` | replay bots: headless clients that drive a local autodrive sim and send `state` (optionally tampered) |
| `bench/aiCpu.ts` | server AI CPU per room (0/4/12/18 AI) |
| `src/limits.ts` | token bucket, flood guard, per-IP counter |
| `src/metrics.ts` | `/health` numbers: CPU %, RSS, event-loop lag p99, sockets, msg/s (10 s window) |
| `src/certs.ts` | loads the cert, reloads it on change with `setSecureContext`, days to expiry |
| `vite.config.ts` | bundles everything (including `ws`) into `server/dist/apex-server.mjs` |
| `deploy/oracle/` | `setup.sh`, `apex.service`, `dns-cert.sh`, `deploy.ps1`, `admin-setup.sh` |

## Run locally (port 8787)

```powershell
npm run build          # the game -> dist/ (once, or after game changes)
npm run server:build   # -> server/dist/apex-server.mjs
npm run server         # http://localhost:8787  (ws://localhost:8787/ws, /health)
```

Without the npm scripts: `npx vite build --config server/vite.config.ts` then `node server/dist/apex-server.mjs`.
Run from the project root: `DIST_DIR` and `CERT_DIR` default to `./dist` and `./certs`. Stop with Ctrl+C.

Other devices on the LAN can open `http://<pc-ip>:8787` (allow Node through the Windows firewall when asked).
A Vite dev page on another localhost port may also connect to `ws://localhost:8787/ws` (allowed only without TLS).

Artificial latency (tests only): `node server/dist/apex-server.mjs --net-delay 100 --net-jitter 10 --net-loss 1` (ms per direction; loss drops binary state batches only).

Bots and bench: `npx vite build --config server/vite.tools.config.ts`, then
`node server/dist/tools/apex-bot.mjs --n 2 --track bosphorus --laps 1 --ai 4 [--hz 15] [--tamper teleport|speed|fakeProgress|earlyStart] [--join CODE]`
and `node server/dist/tools/ai-bench.mjs 60 istanbul`.

Tests: `npx vitest run --project server` (about 2 min: one real-time 1-lap race and a cheat-bot race).
Typecheck: `npx tsc --noEmit -p server/tsconfig.json`.

## Deploy to Oracle Cloud (step by step)

First do the account steps in `docs/team/multiplayer-deploy.md` section 1.1 (agents cannot do these):
account and home region (1-2), SSH key `$HOME\.ssh\apexgp` (3), the Ubuntu 24.04 aarch64 A1 instance (4),
ingress rules: TCP 443 from anywhere, TCP 22 from your home IP only (5), and the DuckDNS name pointed at the instance IP (6).
Below, `<ip>` is the instance's public IP and `<name>` is your DuckDNS name without `.duckdns.org`.

1. **Copy the setup scripts** (PowerShell, project root):
   ```powershell
   ssh -i $HOME\.ssh\apexgp ubuntu@<ip> "mkdir -p ~/apex-setup"
   scp -i $HOME\.ssh\apexgp server/deploy/oracle/setup.sh server/deploy/oracle/dns-cert.sh server/deploy/oracle/apex.service server/deploy/oracle/admin-setup.sh ubuntu@<ip>:~/apex-setup/
   ```
2. **Set up the VM** (≈ 5–10 min; updates, Node LTS, user `apex`, `/opt/apex`, port 443 in iptables, key-only SSH, `apex.service`):
   ```powershell
   ssh -i $HOME\.ssh\apexgp ubuntu@<ip> "sudo bash ~/apex-setup/setup.sh <name>"
   ```
   Afterwards only key login works (passwords and root login are off), so keep `$HOME\.ssh\apexgp` backed up.
3. **DuckDNS updater + HTTPS certificate** (interactive, because it asks for your DuckDNS token; it is typed hidden and stays on the VM):
   ```powershell
   ssh -t -i $HOME\.ssh\apexgp ubuntu@<ip> "sudo bash ~/apex-setup/dns-cert.sh <name>"
   ```
   It prints `DuckDNS update: OK`, then issues a Let's Encrypt certificate over DNS-01 (port 80 stays closed) into `/opt/apex/certs/`.
   Renewal is automatic (acme.sh cron); the server picks up renewed files without a restart.
4. **Deploy the game and server** (builds, uploads, restarts, checks `/health`):
   ```powershell
   .\server\deploy\oracle\deploy.ps1 -Name <name>
   ```
   Use `-Server <ip>` if `<name>.duckdns.org` does not resolve yet, `-SkipBuild` to re-upload the last build.
   If PowerShell refuses to run scripts: `powershell -ExecutionPolicy Bypass -File .\server\deploy\oracle\deploy.ps1 -Name <name>`.
5. **Play:** open `https://<name>.duckdns.org`. Later updates: repeat step 4 only.

Checks on the VM: `sudo ss -tlnp` (only `sshd` on 22 and `node` on 443), `journalctl -u apex -n 50`, `curl -s https://<name>.duckdns.org/health`.
Rollback: the previous build is kept as `/opt/apex/dist.old` and `/opt/apex/app/apex-server.mjs.old`.
Re-creating a reclaimed instance (deploy doc section 1.5): new instance, update DuckDNS to the new IP if needed, then steps 1–4 again (≈ 20 min).

## Yönetici paneli

Adres: `https://<name>.duckdns.org/admin`. Giriş için **parola + doğrulama uygulamasındaki 6 haneli kod** (TOTP) gerekir.
Panel her 2 saniyede yenilenir: sunucu sağlığı (CPU, RAM, gecikme, soket, mesaj/s, trafik, sertifika günü), odalar,
oyuncular (takma ad, NetId, oda, ping, bağlantı, uyarı/ihlal sayısı, kısa cihaz kodu) ve son olaylar.
İşlemler: **At** (oyuncu odadan çıkar, yeniden bağlanma kodu geçersiz olur), **Yasakla** (1 sa / 24 sa / 7 gün / kalıcı;
"ağ" kutusu işaretliyse aynı /24 ağı da yasaklanır; LAN partisinde kutuyu kaldırın, yoksa herkes yasaklanır),
**yasak kaldırma**, **duyuru** ve **bakım modu** (yeni oda/katılım reddedilir, süren yarışlar devam eder).

**Kurulum (bir kez, ilk deploy'dan sonra):**
1. `admin-setup.sh` VM'de olmalı (yukarıdaki adım 1 onu da kopyalar).
2. `ssh -t -i $HOME\.ssh\apexgp ubuntu@<ip> "sudo bash ~/apex-setup/admin-setup.sh"`
3. Parolayı iki kez yazın (en az 12 karakter, görünmez). Ekrandaki QR kodu Google Authenticator, Aegis, 2FAS gibi bir
   uygulamayla tarayın (kamera yoksa yazan anahtarı elle girin). Ekran görüntüsü almayın, sonra `clear` yazın.
4. `/admin` sayfasında parola ve uygulamadaki kodla giriş yapın.

**Telefon kayboldu / parola unutuldu:** SSH anahtarınız (`$HOME\.ssh\apexgp`) ile VM'e girin ve 2–4. adımları tekrarlayın.
Betik parolayı da TOTP anahtarını da yeniler; eski telefondaki kod artık çalışmaz. Açık panel oturumlarını hemen kapatmak
için `sudo systemctl restart apex` (yarışlar kesilir; beklerseniz oturumlar en geç 30 dakika boşta kalınca biter).
SSH anahtarı da kaybolduysa: Oracle konsolundan instance'a yeni anahtar ekleyin ya da instance'ı yeniden kurun (bölüm 1.5).

**Güvenlik:** 5 hatalı girişten sonra o ağ 1 dakika kilitlenir, her yeni hatada süre ikiye katlanır (en çok 1 saat);
10 dakikada 30'dan fazla hata olursa tüm girişler 5 dakika kapanır. Oturum 30 dakika işlem yapılmazsa ya da en geç
8 saatte biter (yalnızca panelin otomatik yenilemesi oturumu uzatmaz). Çerez HttpOnly + Secure + SameSite=Strict,
her işlemde CSRF anahtarı ve Origin denetimi var. Her giriş, hatalı deneme ve işlem
`/opt/apex/data/audit/audit-YYYY-MM-DD.jsonl` dosyasına yazılır (14 gün saklanır); IP yerine tuzlu bir ağ özeti yazılır.
Yasaklar `/opt/apex/data/bans.json` içinde (yalnızca özetler). journald günlükleri de 14 gün tutulur (`setup.sh`).
Yerel çalıştırmada veriler `./data` altına gider (`DATA_DIR` ile değiştirilebilir); kurulum:
`"parola..." | node server/dist/apex-server.mjs admin-setup data/admin.json` (çıktı: otpauth adresi).

## Limits and headers (P0)

- HTTP: GET/HEAD only (405 otherwise), URLs ≤ 2048 chars, `..`/dotfiles/backslashes/NUL rejected with 400, no directory listing;
  `headersTimeout`/`requestTimeout`/socket timeout 10 s, keep-alive 5 s. Hashed chunks `assets/*-<hash>.js` cache for a year (immutable), everything else `no-cache`.
- Headers on every response: CSP (`default-src 'self'`, inline styles allowed for `index.html`, `connect-src 'self' ws:|wss:`),
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`; HSTS (1 year) over TLS only.
- `/ws`: 404 on other paths, 403 for a foreign `Origin`, 429 above 24 sockets per IP, 503 above 128 (previously 48) in total; messages > 1024 B close with 1009;
  over-rate messages are dropped, and ≥ 90 drops within 3 s (sustained > 2× the limit) close with 1008; two missed pongs terminate.
- `/health` (no-store) returns coarse numbers only; `warnings` contains `certExpiresSoon` under 10 days.

D-052: public rooms are listed; private rooms require a code. Quick join selects the fullest available public lobby or creates a public room. The default room cap is 6; socket total is derived as rooms ? seats + 8 (24 per IP). Tune and measure the real capacity on the VM before release.

## In-game feedback (D-055)

POST /api/contact accepts JSON type (bug/suggestion/complaint/other), message (1-1000 characters), website (empty honeypot), deviceId (existing random 22-character browser key), and optional nickname (32 characters) + roomCode (5 characters) only for complaints. No reply address or consent field is accepted. The administrator reads messages in /admin Inbox and can filter, mark read, archive or delete. No replies are sent.

DATA_DIR/contact.jsonl is private (600), capped at 2 MiB; full storage returns 503 without dropping existing messages. DATA_DIR is excluded from static HTTP responses. Expiry is 30 days with startup/hourly cleanup, including abandoned atomic-write copies. Avoid long-lived backups. Limits: 8 KiB request, 5/device/hour and 20/network/hour, bounded process-local salted counters. Honeypot submissions return success without storage. Production requires HTTPS; local loopback HTTP supports tests/dev. Normal and audit logs never receive contact message bodies.

Desktop/separate-origin builds use the existing ?server=wss://host/ws setting; contact converts it to https://host/api/contact. Set CONTACT_ORIGINS to a comma-separated exact list of trusted origins only if required (null for a trusted file build). Default: same origin; admin checks stay unchanged. An offline/unconfigured server shows server unreachable.
