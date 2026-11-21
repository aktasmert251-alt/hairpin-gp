#!/usr/bin/env bash
# HAIRPIN GP: create or replace the admin panel login (D-050) ON THE VM. Run it again after a lost phone or to change
# the password: both the password and the TOTP secret are replaced, the old authenticator entry stops working.
#
#   scp -i ~/.ssh/apexgp server/deploy/oracle/admin-setup.sh ubuntu@<ip>:~/apex-setup/
#   ssh -t -i ~/.ssh/apexgp ubuntu@<ip> 'sudo bash ~/apex-setup/admin-setup.sh'
#
# The password is typed hidden and goes to the server binary over stdin (never on a command line, never in a file in
# clear). /opt/apex/data/admin.json gets only the scrypt hash and the TOTP secret, mode 600, owner apex.
set -euo pipefail

DATA=/opt/apex/data
APP=/opt/apex/app/apex-server.mjs
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run with sudo: sudo bash $0"
[[ -f "$APP" ]] || die "$APP not found: deploy the server first (deploy.ps1)"
id apex >/dev/null 2>&1 || die "user 'apex' missing: run setup.sh first"
command -v qrencode >/dev/null 2>&1 || apt-get -y -q install qrencode >/dev/null
install -d -m 0700 -o apex -g apex "$DATA"

read -rsp 'New admin password (at least 12 characters): ' PW1; echo
read -rsp 'Repeat the password: ' PW2; echo
[[ "$PW1" == "$PW2" ]] || die "the passwords differ"
(( ${#PW1} >= 12 )) || die "the password is too short"

umask 077
URI="$(printf '%s\n' "$PW1" | sudo -u apex /usr/bin/node "$APP" admin-setup "$DATA/admin.json")"
unset PW1 PW2
chmod 600 "$DATA/admin.json"
chown apex:apex "$DATA/admin.json"

SECRET="$(sed -n 's/.*[?&]secret=\([A-Z2-7]*\).*/\1/p' <<<"$URI")"
cat <<EOF

Scan this QR code with an authenticator app (Google Authenticator, Aegis, 2FAS, Microsoft Authenticator...):
EOF
printf '%s' "$URI" | qrencode -t ANSIUTF8 -m 2
cat <<EOF

No camera? Enter the key by hand: ${SECRET}  (type: time-based, 6 digits, 30 s)
Do not save a screenshot of this screen. Clear the terminal afterwards (clear).

Log in at https://<name>.duckdns.org/admin with the password and the 6-digit code.
Existing admin sessions end on their own within 30 minutes; to end them now: sudo systemctl restart apex
EOF
