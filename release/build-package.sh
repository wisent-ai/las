#!/bin/bash
# Stado's release build: one npm pack of this package, staged as dist/las.tgz
# inside WISENT_OUTPUT_DIR (where the stage map reads it) with its SHA-256
# beside it, for the npm delivery to publish unchanged.
set -euo pipefail
source=${WISENT_SOURCE_DIR:?Stado must provide WISENT_SOURCE_DIR}
out="${WISENT_OUTPUT_DIR:?Stado must provide WISENT_OUTPUT_DIR}/dist"
rm -rf "$out"
mkdir -p "$out"
cd "$source"
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
