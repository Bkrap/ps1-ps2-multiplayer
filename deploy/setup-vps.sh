#!/bin/bash
# Ubuntu 24.04. Run as root from a checkout of this repo.
# Usage: deploy/setup-vps.sh [domain] [email]
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this as root on the VPS." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="${1:-_}"
EMAIL="${2:-}"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io nginx fail2ban ufw ca-certificates curl nodejs npm
if [[ ! -x /usr/bin/node && -x /usr/bin/nodejs ]]; then
  ln -sf /usr/bin/nodejs /usr/bin/node
fi

if ! id ps1 >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/ps1-rooms --shell /usr/sbin/nologin ps1
fi
usermod -aG docker ps1

install -d -o ps1 -g ps1 -m 755 /var/lib/ps1-rooms/games /var/lib/ps1-rooms/bios
modprobe uinput || true
grep -qx 'uinput' /etc/modules || echo uinput >> /etc/modules

if [[ ! -f "$ROOT/.env" ]]; then
  sed "s|^CATALOG_PATH=.*|CATALOG_PATH=${ROOT}/games/catalog.yaml|" "$ROOT/.env.example" > "$ROOT/.env"
  chown ps1:ps1 "$ROOT/.env"
  chmod 640 "$ROOT/.env"
fi

(cd "$ROOT/lobby" && npm ci --omit=dev)

docker network create ps1-rooms >/dev/null 2>&1 || true
docker build -t ps1-room:local "$ROOT/room-image"

sed "s|__ROOT__|${ROOT}|g" "$ROOT/deploy/ps1-lobby.service" > /etc/systemd/system/ps1-lobby.service
systemctl daemon-reload
systemctl enable --now ps1-lobby.service

sed "s|__DOMAIN__|${DOMAIN}|g" "$ROOT/deploy/nginx.conf" > /etc/nginx/sites-available/ps1-rooms.conf
ln -sfn /etc/nginx/sites-available/ps1-rooms.conf /etc/nginx/sites-enabled/ps1-rooms.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

install -d /etc/fail2ban
cat > /etc/fail2ban/jail.d/ps1-sshd.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

if [[ "$DOMAIN" != "_" && -n "$EMAIL" ]]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
fi

echo
echo "Lobby is installed from ${ROOT}."
echo "Put your own Tekken 3 cue/bin in /var/lib/ps1-rooms/games (the cue must be named tekken3.cue)."
echo "Put your own PS1 BIOS dump in /var/lib/ps1-rooms/bios."
echo "Those files are not in git and are not sent to players."
echo "Then: chmod 644 the files, and systemctl restart ps1-lobby"
if [[ "$DOMAIN" == "_" ]]; then
  echo "Re-run with a domain and email to turn on TLS: deploy/setup-vps.sh play.example.com you@example.com"
fi
