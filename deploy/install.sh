#!/bin/bash
# Installe la plateforme Glotta sur un serveur Ubuntu 24.04 neuf.
# Usage : sudo ./install.sh licences.exemple.com /chemin/glotta-cle-privee.pem
set -euo pipefail
DOMAIN="${1:?Indiquez le domaine}"
KEY_FILE="${2:?Indiquez le fichier de la clé privée}"
REPO_URL="${REPO_URL:-https://github.com/Honorable45/Glotta.git}"
APP=/opt/glotta

[ "$(id -u)" = 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }
grep -q 'BEGIN PRIVATE KEY' "$KEY_FILE" || { echo "Ce fichier n'est pas une clé privée."; exit 1; }

apt-get update
apt-get install -y curl git postgresql ufw debian-keyring debian-archive-keyring apt-transport-https gnupg
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
npm install -g pnpm@9.15.9
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

id glotta >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin glotta

# Secrets : relancer le script conserve le mot de passe existant de la base.
install -d -m 750 -o root -g glotta /etc/glotta
if [ ! -f /etc/glotta/env ]; then
  DB_PASSWORD="$(openssl rand -hex 24)"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE glotta LOGIN PASSWORD '$DB_PASSWORD'" -c 'CREATE DATABASE glotta OWNER glotta'
  # Entre apostrophes, systemd garde les \n tels quels ; le serveur les retransforme en retours à la ligne.
  KEY_LINE="$(awk 'NF { printf "%s\\n", $0 }' "$KEY_FILE")"
  cat > /etc/glotta/env <<ENV
DATABASE_URL='postgresql://glotta:$DB_PASSWORD@127.0.0.1:5432/glotta'
LICENSE_PRIVATE_KEY='$KEY_LINE'
ADMIN_DIST='$APP/apps/admin/dist'
TRUST_PROXY='1'
ENV
  chown root:glotta /etc/glotta/env
  chmod 640 /etc/glotta/env
fi

[ -d "$APP/.git" ] || git clone "$REPO_URL" "$APP"
chown -R glotta:glotta "$APP"

cat > /etc/systemd/system/glotta.service <<UNIT
[Unit]
Description=Plateforme Glotta
After=network.target postgresql.service

[Service]
User=glotta
WorkingDirectory=$APP/apps/api
EnvironmentFile=/etc/glotta/env
ExecStart=$APP/node_modules/.bin/tsx src/server.ts
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$APP

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
  redir / /console/
  reverse_proxy 127.0.0.1:8080
}
CADDY

# Sauvegarde quotidienne, à copier aussi hors du serveur.
install -d -m 750 -o glotta -g glotta /var/backups/glotta
cat > /etc/cron.d/glotta-backup <<CRON
30 2 * * * glotta . /etc/glotta/env; DATABASE_URL="\$DATABASE_URL" BACKUP_DIR=/var/backups/glotta $APP/apps/api/scripts/backup-db.sh >/dev/null
CRON

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

systemctl daemon-reload
systemctl enable glotta
"$(dirname "$(readlink -f "$0")")/update.sh"
systemctl restart caddy
echo "Installation terminée : https://$DOMAIN/console/"
