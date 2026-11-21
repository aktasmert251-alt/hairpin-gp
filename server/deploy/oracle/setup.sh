#!/usr/bin/env bash
# APEX GP: one-time setup of an Oracle Cloud Always Free VM (Ubuntu 24.04 aarch64, A1 Flex).
# Deploy doc: docs/team/multiplayer-deploy.md section 1.2 step 1. Safe to run again (every step is idempotent).
#
#   scp -i ~/.ssh/apexgp server/deploy/oracle/* ubuntu@<ip>:~/apex-setup/
#   ssh -i ~/.ssh/apexgp ubuntu@<ip> 'sudo bash ~/apex-setup/setup.sh <duckdns-name>'
#
# <duckdns-name> is the part before .duckdns.org. It goes into apex.service (HOST=...). No secrets are used here;
# the DuckDNS token is entered later in dns-cert.sh.
set -euo pipefail

NODE_MAJOR="${NODE_MAJOR:-24}"          # Node LTS line from NodeSource (Ubuntu's own nodejs is too old)
DEPLOY_USER="${SUDO_USER:-ubuntu}"       # the SSH user that deploy.ps1 copies files as
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="${1:-}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run with sudo: sudo bash $0 <duckdns-name>"
[[ -n "$NAME" ]] || die "usage: sudo bash $0 <duckdns-name>   (e.g. apexgp for apexgp.duckdns.org)"
[[ "$NAME" =~ ^[a-z0-9-]+$ ]] || die "the DuckDNS name may contain only a-z, 0-9 and '-' (without .duckdns.org)"
[[ "$(uname -m)" == "aarch64" ]] || echo "WARNING: expected aarch64 (Ampere A1), got $(uname -m); continuing"
export DEBIAN_FRONTEND=noninteractive

# --- 1. Packages and automatic security updates -------------------------------------------------------
log "apt update + full-upgrade"
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confold full-upgrade
apt-get -y -q install ca-certificates curl gnupg cron unattended-upgrades iptables-persistent netfilter-persistent qrencode

log "enable unattended-upgrades (security + NodeSource)"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
# Node security releases arrive through the NodeSource repo; let unattended-upgrades install them too.
# (A running server keeps the old binary until the next `systemctl restart apex` or deploy.)
cat > /etc/apt/apt.conf.d/51apex-nodesource <<'EOF'
Unattended-Upgrade::Origins-Pattern { "site=deb.nodesource.com"; };
EOF
systemctl enable --now unattended-upgrades >/dev/null

# --- 2. Node LTS (arm64) from NodeSource ----------------------------------------------------------------
log "Node ${NODE_MAJOR}.x from NodeSource"
install -d -m 0755 /etc/apt/keyrings
if [[ ! -s /etc/apt/keyrings/nodesource.gpg ]]; then
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
fi
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list
cat > /etc/apt/preferences.d/nodesource <<'EOF'
Package: nodejs
Pin: origin deb.nodesource.com
Pin-Priority: 600
EOF
apt-get update -q
apt-get -y -q install nodejs
echo "node $(node -v) at $(command -v node)"
[[ "$(command -v node)" == "/usr/bin/node" ]] || die "node is not /usr/bin/node; apex.service expects that path"

# --- 3. Service user and directories -----------------------------------------------------------------
log "system user 'apex' and /opt/apex"
if ! id apex >/dev/null 2>&1; then
  # No login shell. The home holds acme.sh and the DuckDNS updater config (dns-cert.sh).
  useradd --system --create-home --home-dir /var/lib/apex --shell /usr/sbin/nologin apex
fi
# app/ and dist/ are written by deploy.ps1 (as the SSH user) and only read by the service.
install -d -m 0755 -o "$DEPLOY_USER" -g apex /opt/apex /opt/apex/app /opt/apex/dist
# certs/ (acme.sh writes, the server reads) and log/ belong to the service user only.
install -d -m 0750 -o apex -g apex /opt/apex/certs /opt/apex/log
# data/: admin panel login (admin.json), bans.json and the admin audit log (D-050); service user only.
install -d -m 0700 -o apex -g apex /opt/apex/data

# --- 3b. Log retention (docs/legal/audit.md M6): journald keeps at most 14 days ---------------------------
log "journald: MaxRetentionSec=14day"
install -d -m 0755 /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/10-apex-retention.conf <<'EOF'
[Journal]
MaxRetentionSec=14day
EOF
systemctl restart systemd-journald

# --- 4. OS firewall: open 443 -----------------------------------------------------------------------
# Oracle's Ubuntu image ends INPUT with a REJECT rule; insert ACCEPT for 443 before it. Do not add ufw.
log "iptables: allow TCP 443"
if iptables -C INPUT -p tcp --dport 443 -m state --state NEW -j ACCEPT 2>/dev/null; then
  echo "rule already present"
else
  pos="$(iptables -L INPUT --line-numbers -n | awk '$2=="REJECT"{print $1; exit}')"
  if [[ -n "$pos" ]]; then
    iptables -I INPUT "$pos" -p tcp --dport 443 -m state --state NEW -j ACCEPT
  else
    iptables -A INPUT -p tcp --dport 443 -m state --state NEW -j ACCEPT
  fi
fi
netfilter-persistent save
iptables -L INPUT -n --line-numbers

# --- 5. SSH: key only, no root login -------------------------------------------------------------------
log "sshd: key-only, no root login"
AUTH_KEYS="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)/.ssh/authorized_keys"
if [[ -s "$AUTH_KEYS" ]]; then
  # sshd keeps the FIRST value it reads, and drop-ins are read in name order, so 10- wins over 50-cloud-init.conf.
  cat > /etc/ssh/sshd_config.d/10-apex-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
EOF
  sshd -t || { rm -f /etc/ssh/sshd_config.d/10-apex-hardening.conf; die "sshd config test failed; hardening reverted"; }
  systemctl reload ssh || systemctl restart ssh
else
  echo "WARNING: $AUTH_KEYS is empty; SSH hardening skipped so you are not locked out"
fi

# --- 6. systemd unit ----------------------------------------------------------------------------------
log "journald: 14-day retention (VM-wide)"
install -d -m 0755 /etc/systemd/journald.conf.d
install -m 0644 "$HERE/retention.conf" /etc/systemd/journald.conf.d/60-hairpin-retention.conf
systemctl restart systemd-journald
journalctl --rotate
journalctl --vacuum-time=14day

log "apex.service (HOST=${NAME}.duckdns.org)"
[[ -f "$HERE/apex.service" ]] || die "apex.service not found next to setup.sh"
sed "s/__APEX_HOST__/${NAME}.duckdns.org/" "$HERE/apex.service" > /etc/systemd/system/apex.service
systemctl daemon-reload
systemctl enable apex >/dev/null
if [[ -f /opt/apex/app/apex-server.mjs ]]; then
  systemctl restart apex
  echo "apex restarted"
else
  echo "apex is enabled; it starts after the first deploy (deploy.ps1)"
fi

log "done"
cat <<EOF
Next:
  1. Certificate + DuckDNS updater:  sudo bash $HERE/dns-cert.sh ${NAME}
  2. From the PC:                     .\\server\\deploy\\oracle\\deploy.ps1 -Name ${NAME}
  3. Admin panel login (after 2):     sudo bash $HERE/admin-setup.sh
Check listening ports with: sudo ss -tlnp   (only sshd :22 and node :443 expected)
EOF
