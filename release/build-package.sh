#!/bin/bash
# Stado's release build: one npm pack of this package, staged as dist/las.tgz
# with its SHA-256 beside it, for the npm delivery to publish unchanged.
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out="$root/dist"
rm -rf "$out"
mkdir -p "$out"
cd "$root"
npm pack --ignore-scripts --pack-destination "$out" >/dev/null
shopt -s nullglob
packed=("$out"/*.tgz)
if [[ ${#packed[@]} -ne 1 ]]; then
  printf 'npm pack did not produce exactly one artifact: %s\n' "${#packed[@]}" >&2
  exit 1
fi
mv "${packed[0]}" "$out/las.tgz"
digest=$(shasum -a 256 "$out/las.tgz")
printf '%s\n' "${digest%% *}" > "$out/las.tgz.sha256"
