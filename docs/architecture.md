# Architecture

One process, two entry points, no sockets. This page names what Las owns,
what it refuses to own, how a request flows, and where the trust boundaries
sit. The per-noun contracts live in [concepts/](concepts/registry-entry.md);
the end-to-end policy narrative in
[federation-and-policy](federation-and-policy.md).

## What Las owns

- **The catalogue** — the compiled-in
  [registry](concepts/registry-entry.md) of surfaces and the
  configured/active derivation over it ([catalogue](catalogue.md)).
- **Release admission** — verification of the owner-signed
  [manifest](concepts/signed-manifest.md) and the byte/schema binding of
  every spawn ([release admission](concepts/release-admission.md)).
- **The federation proxy** — spawning children, the verified handshake,
  `<surface>__<tool>` namespacing, and the call-time
  [policy gates](concepts/policy.md).
- **Two files of state, nothing else** — the release watermark (the only
  file the release path writes) and the advisory
  [onboarding](concepts/onboarding.md) state under `$XDG_STATE_HOME/las/`.

## What Las does not own

- **No sockets.** The only transports are stdin/stdout with the calling
  client and one stdio pipe per spawned child. There is no HTTP listener, no
  port, no remote registry.
- **No child lifecycle management.** Las does not install, build, configure,
  update, restart, or health-check child products. A broken child is omitted,
  not repaired.
- **No secrets.** Raw-secret environment names are refused outright; the one
  credential-shaped surface (Skarbiec) returns availability booleans and
  opaque capability IDs whose wire format has no field for secret material.
- **No isolation.** Children get a minimal frozen environment, not a sandbox:
  no process isolation, network policy, or resource quotas.
- **No timeouts.** A child request runs to completion by design; a child that
  never answers keeps that call in flight until the session ends.

## Data flow

```text
MCP client (stdio)                 operator shell
      │                                  │
   las-mcp (src/mcp.mjs)            las (src/cli.mjs)
      │  initialize / tools/list / tools/call
      ▼
  registry + admission (src/registry.mjs)
      │  SURFACES → signed manifest → filters → connect()
      │  [reads: LAS_RELEASE_* files; writes: watermark forward-only]
      ▼
  one stdio JSON-RPC pipe per admitted child
      │  initialize + tools/list (verified against signature)
      │  tools/call with original name + injected credential templates
      ▼
  child MCP server (its own security boundary)
```

Both entry points sit on the same admission and policy code; the CLI is the
read-only view (spawn-per-command), the MCP server the long-lived router
(memoized federation). Response ordering on the MCP stream follows
completion, not arrival: handlers run concurrently, so a slow `tools/call`
answers after later cheap requests (captured in
[walkthrough-federated-session](walkthrough-federated-session.md)).

## Trust boundaries

| Principal | Trusted with | Checked by |
|---|---|---|
| Release signer | Which surfaces/bytes/schemas/tools/env names are admitted | Ed25519 over domain-separated raw bytes against the operator's trust store; expiry; sequence watermark |
| Operator | Environment: release-file paths, filters, per-child variables, Skarbiec identity | Owner-only permission checks on trust store and watermark; absolute-path checks |
| MCP client / model | Nothing | `initialize`-once session, optional agent identity binding, argument gates, credential-template injection |
| Child process | Its own domain only | Workspace containment of its binary, digest binding, schema-digest verification, result validation (Skarbiec), stderr discarded, generic error mapping |
| Filesystem | Workspace root `las/..` | `realpath` containment of cwd, command, and absolute argv; trusted externals limited to the Node executable and `/usr/bin/python3` |

Two deliberate consequences:

- **Child output is untrusted.** Child stderr is drained and discarded; child
  errors map to generic Las sentences; only static registry names appear on
  Las stderr. A compromised child cannot use Las as a channel into the
  parent's protocol stream or logs.
- **The stdout stream is protocol-pure.** `las-mcp` writes nothing but
  JSON-RPC responses to stdout; diagnostics go to stderr. The CLI prints JSON
  results to stdout and every error to stderr as `las: <message>`.

## Process model

- **Federation is a snapshot.** Built once per MCP process on first need,
  memoized as a promise; per-surface failures are final for the session.
  Restart to pick up repaired children or a new signed release.
- **Manifest errors are memoized too.** Both the verified manifest and a load
  failure are cached; expiry alone is re-checked live. Repair is a restart
  ([release admission](concepts/release-admission.md)).
- **Shutdown is drain, not kill.** On client disconnect: await the in-flight
  federation build, await pending handlers so responses flush, close every
  child, exit as the event loop drains. No forced `process.exit`.
- **No numeric literals.** A repository rule visible throughout the source:
  numbers are written `Number("2")` so no bare numeric literal appears; this
  is cosmetic, not behavioral.

## Dependency surface

`package.json` declares zero runtime dependencies: Node ≥ 18 core modules
(`child_process`, `crypto`, `fs`, `readline`, `url`, `path`, `os`) implement
everything. The two bins are `las` → `src/cli.mjs` and `las-mcp` →
`src/mcp.mjs`; running the source files directly is equivalent.
