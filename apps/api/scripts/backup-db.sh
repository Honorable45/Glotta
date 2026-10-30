#!/bin/sh
# Sauvegarde quotidienne de la base du serveur. Le dossier doit se trouver hors du serveur.
set -eu
: "${DATABASE_URL:?DATABASE_URL manquante}"
: "${BACKUP_DIR:?BACKUP_DIR manquant}"
KEEP="${KEEP:-30}"
mkdir -p "$BACKUP_DIR"
target="$BACKUP_DIR/gestion-$(date +%Y%m%d-%H%M%S).dump"
# Écrit à côté puis renomme : une sauvegarde interrompue ne passe jamais pour complète.
pg_dump --format=custom --file="$target.partiel" "$DATABASE_URL"
mv "$target.partiel" "$target"
ls -1t "$BACKUP_DIR"/gestion-*.dump | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old"; done
echo "$target"
