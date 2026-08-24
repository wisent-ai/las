#!/bin/sh
# catalogue-health.sh — the whole read-only health surface of Las, in order.
# Requires the four LAS_RELEASE_* variables to point at valid release
# material (docs/examples/mint-toy-release.mjs mints a toy set).
# Run from the las repository root: sh docs/examples/catalogue-health.sh
set -eu

# 1. The catalogue: every registered surface, configured/active booleans.
#    Spawns nothing, proves no connectivity.
node src/cli.mjs list

# 2. Advertised tools per active surface: spawns each child, performs the
#    verified initialize + tools/list handshake, prints namespaced names.
#    NOTE: `tools` reports per-surface errors inline and still exits 0.
node src/cli.mjs tools

# 3. Connectivity verdict: same verified handshake, but the exit code is the
#    answer — 1 if any selected surface fails. This is the line to put in a
#    health check.
node src/cli.mjs check

# 4. If a surface is missing above, name the exact release refusal:
node docs/examples/verify-release.mjs
