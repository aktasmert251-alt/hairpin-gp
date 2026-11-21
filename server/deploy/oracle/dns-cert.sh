#!/usr/bin/env bash
# APEX GP: DuckDNS updater + Let's Encrypt certificate (DNS-01, port 80 stays closed). Deploy doc section 1.2 steps 3-4.
# Run on the VM after setup.sh:   sudo bash ~/apex-setup/dns-cert.sh <duckdns-name>
#
# The DuckDNS token is read from $DUCKDNS_TOKEN or typed at a hidden prompt; it is never passed on a command line.
# It is stored only in files owned by the 'apex' user (mode 600): the updater's curl config and acme.sh's
# account.conf (acme.sh needs it for automatic renewals). Safe to run again.
set -euo pipefail

NAME="${1:-}"
DOMAIN="${NAME}.duckdns.org"
APEX_HOME=/var/lib/apex
ACME="$APEX_HOME/.acme.sh/acme.sh"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
as_apex() { sudo -u apex -H "$@"; }

[[ $EUID -eq 0 ]] || die "run with sudo"
[[ "$NAME" =~ ^[a-z0-9-]+$ ]] || die "usage: sudo bash $0 <duckdns-name>   (without .duckdns.org)"
id apex >/dev/null 2>&1 || die "user 'apex' missing; run setup.sh first"

TOKEN="${DUCKDNS_TOKEN:-}"
if [[ -z "$TOKEN" ]]; then
  read -rsp "DuckDNS token (hidden): " TOKEN; echo
fi
[[ "$TOKEN" =~ ^[0-9a-f-]{36}$ ]] || die "that does not look like a DuckDNS token (36 chars, hex and '-')"

# --- 1. DuckDNS updater: every 5 min, token in a curl config file (not in crontab or `ps`) -----------
UPD="$APEX_HOME/duckdns.curl"
umask 077
printf 'url = "https://www.duckdns.org/update?domains=%s&token=%s&ip="\nsilent\nshow-error\nmax-time = 20\noutput = "%s/duckdns.last"\n' \
  "$NAME" "$TOKEN" "$APEX_HOME" > "$UPD"
chown apex:apex "$UPD"; chmod 600 "$UPD"
LINE="*/5 * * * * curl -K $UPD"
( crontab -u apex -l 2>/dev/null | grep -vF "duckdns.curl" || true; echo "$LINE" ) | crontab -u apex -
as_apex curl -K "$UPD"
printf 'DuckDNS update: %s\n' "$(cat "$APEX_HOME/duckdns.last")"   # OK or KO
[[ "$(cat "$APEX_HOME/duckdns.last")" == "OK" ]] || die "DuckDNS said KO: check the name and the token"

# --- 2. acme.sh for user apex (installs its own daily renewal cron) ---------------------------------------
if [[ ! -x "$ACME" ]]; then
  tmp="$(mktemp -d)"; chmod 755 "$tmp"
  curl -fsSL https://raw.githubusercontent.com/acmesh-official/acme.sh/master/acme.sh -o "$tmp/acme.sh"
  chmod 755 "$tmp/acme.sh"
  ( cd "$tmp" && as_apex ./acme.sh --install --home "$APEX_HOME/.acme.sh" --no-profile )
  rm -rf "$tmp"
fi
as_apex "$ACME" --set-default-ca --server letsencrypt

# --- 3. Issue (DNS-01 via the DuckDNS API) and install into /opt/apex/certs ------------------------------
# Exit code 2 = "certificate still valid, skipped", which is fine on a re-run.
set +e
as_apex env DuckDNS_Token="$TOKEN" "$ACME" --issue --dns dns_duckdns -d "$DOMAIN" --keylength ec-256
rc=$?
set -e
[[ $rc -eq 0 || $rc -eq 2 ]] || die "acme.sh --issue failed (exit $rc); see the output above"

# No --reloadcmd: the server watches the files and reloads them itself (server/src/certs.ts).
as_apex "$ACME" --install-cert -d "$DOMAIN" --ecc \
  --key-file /opt/apex/certs/key.pem \
  --fullchain-file /opt/apex/certs/cert.pem
chmod 640 /opt/apex/certs/key.pem

echo
echo "Certificate installed for $DOMAIN:"
openssl x509 -in /opt/apex/certs/cert.pem -noout -subject -enddate
echo "Renewal cron (user apex):"; crontab -u apex -l
# Switch a server that started without certs (plain HTTP) to HTTPS. Later renewals need no restart.
if systemctl is-active --quiet apex; then systemctl restart apex; echo "apex restarted with TLS"; fi
