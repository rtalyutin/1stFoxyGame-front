#!/usr/bin/env bash
# Run on the host AFTER reviewing/installing the prefix rules. No nginx reload.
set -euo pipefail
artifact=${1:?Usage: publish.sh ARTIFACT_DIR HUB_ROOT ORIGIN}
hub_root=${2:?HUB_ROOT is required}
origin=${3:?ORIGIN is required}
[[ "$origin" =~ ^https://[^/]+$ ]] || { echo 'Expected HTTPS origin without trailing slash' >&2; exit 1; }
[[ -d "$artifact/releases" && -f "$artifact/index.html" ]] || exit 1
mapfile -t ids < <(find "$artifact/releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n')
[[ ${#ids[@]} = 1 && ${ids[0]} =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$ ]] || exit 1
build_id=${ids[0]}
mkdir -p "$hub_root/releases"
exec 9>"$hub_root/.publish.lock"
flock 9
release="$hub_root/releases/$build_id"
staging=$(mktemp -d "$hub_root/releases/.staging-$build_id-XXXXXX")
next_index=$(mktemp "$hub_root/.index-XXXXXX")
cleanup() { rm -rf -- "$staging"; rm -f -- "$next_index"; }
trap cleanup EXIT
cp -a "$artifact/releases/$build_id/." "$staging/"
(cd "$staging" && sha256sum --check SHA256SUMS)
cmp "$artifact/index.html" "$staging/index.html"
if [[ -e "$release" ]]; then
    diff -r "$staging" "$release" > /dev/null || { echo 'Immutable release collision' >&2; exit 1; }
else
    mv "$staging" "$release"
fi
# All resources must be reachable BEFORE stable index changes. Missing resources
# and mismatched remote bytes abort, including a game/SW/catch-all HTML response.
while IFS= read -r line; do
    expected=${line%%  *}; path=${line#*  }
    [[ "$path" != *..* && "$path" != /* ]] || exit 1
    actual=$(curl --fail --silent --show-error --max-time 30 "$origin/hub/releases/$build_id/$path" | sha256sum)
    [[ "${actual%% *}" = "$expected" ]] || { echo "HTTP checksum failed: $path" >&2; exit 1; }
done < "$release/SHA256SUMS"
cp "$artifact/index.html" "$next_index"
chmod 0644 "$next_index"
if [[ -f "$hub_root/index.html" ]]; then cp "$hub_root/index.html" "$hub_root/previous-index.html"; fi
mv -f "$next_index" "$hub_root/index.html"
curl --fail --silent --show-error --max-time 30 "$origin/hub/" | cmp - "$hub_root/index.html"
echo "Published $build_id. Previous index retained; old releases untouched."
