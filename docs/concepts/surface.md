# Surface (federation target)

A surface is the unit Las federates: one sibling product's own MCP server,
spawned as a child process and reached over a private stdio pipe. "Federation
target" and "surface" are the same noun; the code says surface everywhere
(`src/registry.mjs`).

## Shape

A surface exists in three layers, each owning different facts:

- the [registry entry](registry-entry.md) — how to launch it;
- the [signed manifest](signed-manifest.md) entry — what is admitted, down to
  bytes and schemas;
- the running child — an MCP server speaking JSON-RPC 2.0 over stdio,
  protocol version `2024-11-05`.

Las's client for one child (`connect` in `src/registry.mjs`) is
`{ surface, request(method, params), close() }`: requests carry UUID ids,
responses resolve by id, and stderr from the child is drained and discarded —
child diagnostics belong to the child, never to Las's protocol stream.

## Lifecycle

**CLI:** `las tools` and `las check` spawn each selected child, perform the
verified `initialize` + `tools/list` handshake, and close it — one spawn per
command, nothing stays running. `las list` spawns nothing.

**MCP server:** the federation is built once per process, on the first
`tools/list` or routed `tools/call`, and memoized as a promise. Every child
spawned during the build stays alive for the life of the session, routing
calls. On client disconnect Las awaits the in-flight build and pending
handlers so responses flush, then closes every child; with stdin ended the
event loop drains and the process exits on its own.

There is no restart, health-check, or hot-reload loop: a child that fails at
build time is omitted for the whole session, and a child repaired afterwards
appears only after a Las restart. A partial catalogue is a normal state.

## Namespacing

Every child tool is re-exposed as `<surface>__<tool>` (double underscore), so
names never collide across surfaces; descriptions are prefixed `[<surface>] `.
The child receives its original un-namespaced tool name on `tools/call`.
Verified: brama's `brama_detect` federates as `brama__brama_detect` with
description `[brama] Detect local compute resources …`.

## Failure semantics

- Child exits with requests outstanding → each pending request rejects with
  `<name> exited (<code>)`.
- Child never answers → the call stays in flight forever. Las deliberately
  imposes no timeout; a child runs to completion
  ([architecture](../architecture.md)).
- Child fails to spawn, handshake, or verify during federation → omitted;
  `las: surface '<name>' unavailable` on stderr; a later `tools/call` to it
  answers `-32601 unknown tool`.
- Child answers a routed call with an error, or the route throws → the client
  sees only `-32000 surface request failed`; the surface name alone goes to
  stderr (`las: surface '<name>' request failed`).

## What a surface is not

- **Not a trust grant.** Routing through Las adds no permission: the child's
  own security boundary still applies, and Las's [policy](policy.md) can only
  narrow it further.
- **Not sandboxed.** Las gives a child a frozen minimal environment and a
  clean pipe — not process isolation, network policy, or resource quotas. A
  signed manifest proves authorization and byte/schema binding, not that the
  child is safe.
- **Not discovered.** Surfaces exist only in the compiled registry; there is
  no way to add one at runtime.
