#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${RELEASE_ENV:?Set the absolute release.r34.env path}"
: "${BACKUP_DIR:?Set a protected backup directory}"
deploy_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mkdir -p -- "$BACKUP_DIR"
chmod 0700 -- "$BACKUP_DIR"
dump_file="$BACKUP_DIR/foxy-$(date -u +%Y%m%dT%H%M%SZ).dump"
temporary=$(mktemp "$BACKUP_DIR/.foxy-backup.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
docker compose --env-file "$RELEASE_ENV" -f "$deploy_dir/compose.r34.yml" exec -T postgres \
  pg_dump -U foxy_migrator -d foxy -Fc --no-owner > "$temporary"
test -s "$temporary"
ln -- "$temporary" "$dump_file" # Fails instead of replacing an existing copy.
rm -f -- "$temporary"
(cd -- "$BACKUP_DIR" && sha256sum "$(basename -- "$dump_file")") > "$dump_file.sha256"
printf 'Backup created: %s\n' "$dump_file"
