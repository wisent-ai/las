# Quick start

From a clone to one federated tool call: install, mint a toy signed release,
list the catalogue, handshake a child, and drive one MCP session. Every
command below was executed for these docs on 2026-08-24 (Node v22.20.0); the
outputs are the captured answers. Nothing on this path needs a network,
credential, or paid provider — release material lives in a temp directory and
the signing key only in memory.

## Prerequisites

- Node.js 18 or newer. `npm install` adds nothing: the runtime has zero
  dependencies.
- A local Wisent workspace whose parent directory contains `las/` and at
  least one sibling child at its registry path — this page uses `brama`
  (`brama/target/debug/brama`). A standalone clone has nothing to federate
  ([configuration](configuration.md#workspace-layout)).

## Install

```bash
git clone https://github.com/wisent-ai/las.git
cd las
```

`package.json` declares two bins, `las` (`src/cli.mjs`) and `las-mcp`
(`src/mcp.mjs`); this page runs the sources directly, which is equivalent.

## Mint and export the signed release boundary

No ordinary surface is usable until an owner-signed release admits it
([concepts/release-admission](concepts/release-admission.md)). For a first
run, mint a toy release admitting exactly `brama`:

```console
$ node docs/examples/mint-toy-release.mjs brama /tmp/las-docs/toy-release
minted release for 'brama' (1 signed tool(s)) in /tmp/las-docs/toy-release
export LAS_RELEASE_MANIFEST_FILE=/tmp/las-docs/toy-release/release-manifest.json
export LAS_RELEASE_MANIFEST_SIGNATURE_FILE=/tmp/las-docs/toy-release/release-manifest.sig.json
export LAS_RELEASE_TRUST_STORE_FILE=/tmp/las-docs/toy-release/trust-store.json
export LAS_RELEASE_WATERMARK_FILE=/tmp/las-docs/toy-release/watermark.json
```

Run the four printed `export` lines, then prove the release verifies:

```console
$ node docs/examples/verify-release.mjs
release ok: /private/tmp/las-docs/toy-release/release-manifest.json
key_id: toy-2026
sequence: 1
expires_at: 2026-08-25T22:07:04.000Z
surfaces: brama
```

## List the catalogue

```console
$ node src/cli.mjs list
```

One JSON row per registered surface. With the toy release, `brama` reports
`"configured": true, "active": true` and every other surface
`false`/`false` — the manifest admits exactly what it names. `list` spawns no
children and proves no connectivity.

## Handshake the child

```console
$ node src/cli.mjs tools brama
{
  "brama": [
    "brama__brama_detect"
  ]
}
$ node src/cli.mjs check brama
{
  "brama": {
    "ok": true,
    "toolCount": 1
  }
}
```

Both spawn the child, perform the verified `initialize` + `tools/list`
handshake — tool names and input-schema digests checked against the
signature — and close it. `check`'s exit code is the health verdict (1 on any
failure); `tools` reports errors inline and exits 0. Operator filters
subtract surfaces: `LAS_SKIP=brama node src/cli.mjs check` covers nothing.

## Drive one MCP session

```console
$ sh docs/examples/mcp-session.sh
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"las","version":"0.1.0"}}}
{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"brama__brama_detect",…},{"name":"las__onboarding",…}]}}
{"jsonrpc":"2.0","id":3,"result":{"content":[{"text":"{\n  \"cpu_cores\": 12,\n  …\n  \"recommended_model\": \"cydonia-24b\",\n  \"vram_gb\": 0.0\n}","type":"text"}]}}
```

That is a real MCP client conversation: `initialize` exactly once, the
federated catalogue (every signed child tool as `<surface>__<tool>`, plus
Las's own `las__onboarding`), and one `tools/call` routed to the child. The
unabridged transcript is
[walkthrough-federated-session](walkthrough-federated-session.md). To attach
a real client, point it at `node src/mcp.mjs` (or the `las-mcp` bin) over
stdio; when the `skarbiec` surface is active, `initialize` must also carry
`agentId` ([mcp-server](mcp-server.md#agent-identity)).

## First-use onboarding

```console
$ node src/cli.mjs onboarding
Understand Las federation
…
Status: in_progress
Next: las onboarding advance
```

A two-screen journey that completes when a real catalogue query (`las list`
or MCP `tools/list`) succeeds — contract in
[concepts/onboarding](concepts/onboarding.md).

## What failure looks like

Verification fails closed per surface: an invalid, expired, or rolled-back
release, a digest or schema mismatch, or a child that will not start removes
that surface from the catalogue, and only its static registry name reaches
stderr. A partial catalogue is a normal outcome. Federation and manifest
state are memoized per process — after repairing the release or the child,
restart Las and re-run `check`. Symptom-first triage:
[runbook](runbook.md).

## Where next

Mint-to-verified-surface in detail:
[walkthrough-onboard-a-surface](walkthrough-onboard-a-surface.md). The
catalogue model: [catalogue](catalogue.md). Every command and method:
[cli](cli.md), [mcp-server](mcp-server.md). Every knob:
[configuration](configuration.md).
