#!/bin/bash
# Met à jour la plateforme vers la dernière version de main. À lancer avec sudo.
set -euo pipefail
APP=/opt/glotta
run() { sudo -u glotta -H "$@"; }

run git -C "$APP" pull --ff-only
# Le serveur n'installe ni Electron ni le logiciel de bureau.
(cd "$APP" && run pnpm install --frozen-lockfile --ignore-scripts --filter @gestion/api... --filter @gestion/admin...)
(cd "$APP" && run pnpm --filter @gestion/api generate)
(cd "$APP" && run pnpm --filter @gestion/admin build)
set -a; . /etc/glotta/env; set +a
(cd "$APP/apps/api" && run env DATABASE_URL="$DATABASE_URL" ../../node_modules/.bin/prisma migrate deploy)
systemctl restart glotta
for _ in $(seq 1 30); do
  curl -fs -m 2 http://127.0.0.1:8080/health >/dev/null && { echo "Serveur en service."; exit 0; }
  sleep 1
done
echo "Le serveur ne répond pas : journalctl -u glotta -n 50" >&2
exit 1
