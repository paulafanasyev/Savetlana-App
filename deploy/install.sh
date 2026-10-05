#!/usr/bin/env bash
# Ubuntu 24.04 VPS bootstrap: Docker, swap, firewall, deploy user, secrets.
set -euo pipefail
DOMAIN=${1:?domain}
EMAIL=${2:?email}
RAW=${REPO_RAW:-https://raw.githubusercontent.com/paulafanasyev/Savetlana-App/svetlana/initial-implementation/deploy}
DIR=/opt/svetlana
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get install -y ca-certificates curl ufw unattended-upgrades fail2ban openssl
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
swapon --show | grep -q /swapfile || { fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab; }
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash -G docker deploy
mkdir -p /home/deploy/.ssh "$DIR/backups" && touch /home/deploy/.ssh/authorized_keys && chown -R deploy:deploy /home/deploy/.ssh
curl -fsSL "$RAW/docker-compose.yml" -o "$DIR/docker-compose.yml"
curl -fsSL "$RAW/Caddyfile" -o "$DIR/Caddyfile"
g() { openssl rand -hex 32; }
[ -f "$DIR/.env" ] || cat > "$DIR/.env" <<ENV
DOMAIN=$DOMAIN
ACME_EMAIL=$EMAIL
APP_IMAGE=ghcr.io/paulafanasyev/savetlana-app:latest
TOOLS_IMAGE=ghcr.io/paulafanasyev/savetlana-app-tools:latest
POSTGRES_USER=svetlana
POSTGRES_PASSWORD=$(g)
POSTGRES_DB=svetlana
JWT_SECRET=$(g)
PENDING_ACTION_KEY=$(g)
OAUTH_STATE_KEY=$(g)
CRON_SECRET=$(g)
ENV
chmod 600 "$DIR/.env" && chown -R deploy:deploy "$DIR"
echo "OK: add GitHub Actions public key to /home/deploy/.ssh/authorized_keys and run 'Deploy to VPS'."
