# Quick start

This page goes from a clone to a verified federated catalogue: install,
configure the signed release boundary, list the catalogue, handshake the
children, and connect an MCP client.

## Prerequisites

- Node.js 18 or newer.
- A local Wisent workspace whose parent directory contains `las/` and the
  sibling product repositories/build artifacts at the paths encoded in
  `src/registry.mjs` (for example `weles/dist/mcp.js`,
  `brama/target/debug/brama`). A standalone clone is insufficient for normal
  use.
- A valid, unexpired, owner-signed release manifest and detached signature,
  a trust store, and a watermark file, all reachable at absolute paths. The
  trust store and watermark must be regular files owned by the current user
  with owner-only permissions.

## Install

```bash
git clone https://github.com/wisent-ai/las.git
cd las
npm install
```

`npm install` installs no runtime dependencies — Node core modules implement
the server — and does not populate sibling repositories or release material.
`package.json` declares two bins, `las` (`src/cli.mjs`) and `las-mcp`
(`src/mcp.mjs`); running the source files directly is equivalent.

## Configure the signed release boundary

All four variables are required and must be absolute paths:

```bash
export LAS_RELEASE_MANIFEST_FILE=/absolute/path/release-manifest.json
export LAS_RELEASE_MANIFEST_SIGNATURE_FILE=/absolute/path/release-manifest.sig.json
export LAS_RELEASE_TRUST_STORE_FILE=/absolute/path/trust-store.json
export LAS_RELEASE_WATERMARK_FILE=/absolute/path/watermark.json
```

A missing or invalid manifest makes ordinary signed surfaces report
`configured: false` rather than silently trusting current files. See
[configuration](configuration.md) for every variable.

## List the catalogue

```bash
node src/cli.mjs list
```

Expected result: a JSON array with one row per registered surface —
`surface`, `summary`, `configured`, `active`. `list` reads registry and
configuration state only; it spawns no children and proves no connectivity.

## Handshake the children

```bash
node src/cli.mjs tools tama brama
node src/cli.mjs check tama brama
```

`tools` spawns each selected child, performs the verified MCP handshake, and
prints its namespaced tool names (`tama__list_hooks`, `brama__…`) or a
per-surface `{ "error": … }` object. `check` performs the same handshake and
prints `{ "ok": true, "toolCount": N }` per surface, exiting `1` if any
selected child fails. With no surface names, both cover every active surface.
Operator filters subtract surfaces:

```bash
LAS_ONLY=tama,brama node src/cli.mjs check
LAS_SKIP=weles,finance node src/cli.mjs list
```

## Connect an MCP client

Point the client at `node src/mcp.mjs` (or the `las-mcp` bin) over stdio.
The client must send `initialize` exactly once; when the `skarbiec` surface
is active, the initialize params must carry `agentId` equal to the configured
`SKARBIEC_MCP_AGENT_ID`, and no later request may replace it. After
`tools/list`, every signed child tool appears as `<surface>__<tool>`, plus
Las's own `las__onboarding` tool. Protocol details are in
[mcp-server](mcp-server.md).

## First-use onboarding

```bash
node src/cli.mjs onboarding
```

A two-screen guided journey (`show`, `status`, `advance`, `skip`, `reset`):
it explains the federation model, then completes when a real catalogue query
(`las list` or MCP `tools/list`) is observed. State persists under
`$XDG_STATE_HOME/las/onboarding.json` (default `~/.local/state/las/`).

## What failure looks like

Verification fails closed per surface: an invalid, expired, or rolled-back
release, a digest or schema mismatch, or a child that will not start removes
that surface from the catalogue and writes only its static registry name to
Las stderr. The remaining surfaces still federate, so a partial catalogue is
a normal outcome. Federation is memoized for the process lifetime; after the
signed release or child build is repaired, restart Las and repeat
`las check`. See [federation and policy](federation-and-policy.md).
