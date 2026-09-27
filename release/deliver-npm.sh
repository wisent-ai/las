#!/bin/bash
# Stado's npm delivery: verify the canonical release archive, publish the
# las.tgz inside it unchanged, and record npm's answer as the receipt.
set -euo pipefail
required() {
  local value="${!1:-}"
  [[ -n "${value// /}" ]] || { printf 'missing %s\n' "$1" >&2; exit 1; }
  printf '%s' "$value"
}
archive=$(required WISENT_RELEASE_ARCHIVE)
digest=$(required WISENT_RELEASE_SHA256)
product=$(required WISENT_PRODUCT)
version=$(required WISENT_VERSION)
release_uri=$(required WISENT_RELEASE_URI)
out=$(required WISENT_OUTPUT_DIR)
required NPM_TOKEN >/dev/null

actual=$(shasum -a 256 "$archive")
if [[ "${actual%% *}" != "$digest" ]]; then
  printf 'canonical Stado archive digest mismatch\n' >&2
  exit 1
fi
work=$(mktemp -d "$out/.npm-delivery.XXXXXX")
trap 'rm -rf "$work"' EXIT
tar -xzf "$archive" -C "$work" las.tgz
printf '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n' > "$work/npmrc"
provider=$(NPM_CONFIG_USERCONFIG="$work/npmrc" npm publish "$work/las.tgz" --access public --ignore-scripts --json)
mkdir -p "$out"
jq -cnS \
  --arg product "$product" --arg version "$version" \
  --arg release_uri "$release_uri" --arg release_sha256 "$digest" \
  --argjson provider "$provider" \
  '{schema_version: 1, channel: "npm", product: $product, version: $version,
    release_uri: $release_uri, release_sha256: $release_sha256, provider: $provider}' \
  > "$out/npm-receipt.json"
