# What is Las

What is Las, and what is the mental model for reading everything else in
these docs? Las is the local catalogue and policy-preserving federation layer
for Wisent agent tools: it discovers an operator-approved set of sibling MCP
servers, verifies their signed release contracts, and exposes them through one
stdio MCP server (`las-mcp`) and one read-only CLI (`las`). The whole product
is three moving parts — a static registry that declares, a signed release
boundary that admits, and a federation proxy that routes.

## The registry declares

The registry is compiled into `src/registry.mjs` and is the single source of
truth for which surfaces exist. One frozen entry per surface declares:

- `name` — the surface's Las name (`weles`, `skarbiec`, `tama`, `stado`,
  `lem`, `echo`, `most`, `probierz`, `byk`, `brama`, `warsztat`, `finance`);
- `command`, `args`, `cwd` — the exact process that serves the child's own
  MCP server, resolved from the parent Wisent workspace (`las/..`);
- `envAllowlist` — the only environment-variable names the child may inherit;
- `allowTools` — for some surfaces, an explicit local tool allowlist;
- `summary` — a one-line human hint, never an authorization contract.

There is no network registry, plugin auto-discovery, or dynamic surface
addition. The full catalogue model, including what `configured` and `active`
mean, is in [catalogue](catalogue.md).

## The signed release admits

A declared surface is not usable until an owner-signed release manifest
admits it. The manifest binds the exact command, working directory, argv,
environment-variable names, binary SHA-256, code SHA-256, tool names, the
canonical SHA-256 of every advertised input schema, and any fixed credential
templates. The detached Ed25519 signature is checked against a
trust store of public keys, expiry is enforced, and a persistent watermark
file rejects sequence rollback. Any mismatch — missing manifest, expired
manifest, digest drift, schema drift, tool-name drift — fails closed for that
surface only. The one exception is `finance`, which is admitted by its own
exact local configuration rather than the shared manifest. See
[federation and policy](federation-and-policy.md).

## Federation proxies, it never widens

On first use, Las spawns each active child's MCP server over stdio, performs
the `initialize` + `tools/list` handshake, verifies the advertised tools
against the signed contract, and re-exposes each child tool as
`<surface>__<tool>` so names never collide. A `tools/call` is routed to the
owning child with its original tool name; signed credential templates are
injected as fixed arguments the model cannot override, and for Skarbiec both
arguments and results are validated against a strict local contract. Las adds
no capability of its own: routing through Las grants no permission beyond the
signed/local policy and the child server's own checks, a read-only child
stays read-only, and an unavailable child is simply omitted from the
catalogue. Las opens no sockets — its only transports are stdin/stdout with
the calling client and one stdio pipe per spawned child.

## What Las is not

Las is not service discovery, and it does not install, build, configure,
authenticate, or repair child products. It is not a secret broker: raw-secret
environment names (`TOKEN`, `SECRET`, `PASSWORD`, `UNLOCK`, `PRIVATE_KEY`,
`SIGNING_KEY`) are rejected for ordinary surfaces, and the Skarbiec boundary
returns availability or opaque capability IDs, never redeemed credentials. It
provides no process isolation, sandboxing, network policy, or resource quotas
for children, and it imposes no timeout on child requests. A valid manifest
proves authorization and byte/schema binding, not that a child is safe or
bug-free.

## The first three commands

```bash
las list
```

The whole catalogue as JSON: every registered surface with its summary and
`configured`/`active` booleans. Spawns nothing.

```bash
las check
```

Spawn every active child, perform the verified MCP handshake, and report
`ok` and `toolCount` per surface. Exit `1` if any child is down.

```bash
las-mcp
```

The stdio MCP server itself — one JSON-RPC request per stdin line, one
response per stdout line. The end-to-end path is
[quick-start](quick-start.md); the command surface is [cli](cli.md); the
protocol surface is [mcp-server](mcp-server.md).
