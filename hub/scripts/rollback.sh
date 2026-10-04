#!/usr/bin/env bash
set -euo pipefail
hub_root=${1:?Usage: rollback.sh HUB_ROOT ORIGIN}
origin=${2:?ORIGIN is required}
[[ "$origin" =~ ^https://[^/]+$ && -f "$hub_root/previous-index.html" ]] || exit 1
exec 9>"$hub_root/.publish.lock"; flock 9
next_index=$(mktemp "$hub_root/.rollback-XXXXXX")
trap 'rm -f -- "$next_index"' EXIT
cp "$hub_root/previous-index.html" "$next_index"; chmod 0644 "$next_index"
mv -f "$next_index" "$hub_root/index.html"
curl --fail --silent --show-error --max-time 30 "$origin/hub/" | cmp - "$hub_root/index.html"
echo 'Previous hub index restored. No game files or releases changed.'
