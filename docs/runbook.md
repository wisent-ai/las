# Runbook

A surface is missing, a call is refused, a session hangs — which command
first, and what does its answer mean? Each entry starts from the symptom.
Every quoted sentence below exists verbatim in `src/` or was captured from a
real refused run (2026-08-24, Node v22.20.0, toy release in a temp
directory); grep for it and you land in the code.

## Every surface reports `configured: false`

The catalogue flattens release failures on purpose: `las list` says only
`"configured": false`, and explicit selection says only
`las: surface '<name>' is not active under the signed release and operator
filters` (exit 1). First command:

```bash
node docs/examples/verify-release.mjs
```

It runs the same `loadSignedManifest()` the registry runs and prints the
exact sentence. Captured causes, one per broken fixture:

| Sentence | Meaning | Check |
|---|---|---|
| `las manifest: LAS_RELEASE_MANIFEST_FILE must name an absolute path` | Variable unset, relative, or NUL-containing. Same sentence pattern for the other three `LAS_RELEASE_*` variables. | `env \| grep LAS_RELEASE` |
| `las manifest: missing regular file` | The manifest path names nothing (or not a regular file). Signature file: `las manifest signature: missing regular file`. | the path in the variable |
| `las manifest: detached signature verification failed` | Manifest bytes do not match the signature — tampered, reformatted, re-saved, or signed under a different domain/key. | restore the exact signed bytes, or re-sign |
| `las trust store: signature key_id is not trusted` | The envelope's `key_id` selects no trust-store key. | `key_id` in the signature file vs `keys[].key_id` |
| `las trust store: permissions must be owner-only` | Group/other bits set. Also possible: `…: file is not owned by the current user`, `…: missing regular file`. Same rules for the watermark. | `chmod 600`, ownership |
| `las manifest: sequence rollback rejected` | Manifest `sequence` is below the stored watermark — an old release replayed over a newer one. | the watermark file; issue a higher-sequence release |
| `las manifest: manifest has expired` | `expires_at` is in the past. Also thrown live inside a long-running process the moment its memoized manifest lapses. | mint a fresh release; restart Las |
| `las watermark: duplicate member 'sequence' at byte 36` | A strict-JSON refusal, here in the watermark: Las's parser rejects duplicate keys, trailing data (`…: trailing data at byte <n>`), invalid UTF-8, bad escapes/numbers/control characters — always with the byte offset. | fix or regenerate the named file |

## `verify-release.mjs` says `release ok`, yet nothing is configured

The one refusal that lives above the loader: the manifest names a surface the
registry does not know (or names `finance`, which may never be in the
manifest). The registry rejects the **whole manifest** with
`las manifest: unknown or separately trusted surface '<name>'`
(`src/registry.mjs`), and every surface deconfigures. Captured: a manifest
whose surface was renamed `toy` verifies clean and leaves the entire
catalogue `configured: false`. Check the manifest's `surfaces[].name` against
`las list`'s `surface` column.

## One surface errors on `tools`/`check`

A surface that is configured and active can still fail closed at spawn or
handshake. `las check <name>` prints the sentence and exits 1:

| Sentence (captured) | Meaning | Repair |
|---|---|---|
| `brama: release binary digest mismatch` | The child binary was rebuilt/replaced since signing. Also: `…: release code digest mismatch` for `code_path`. | re-mint the release against the current bytes, or restore the signed build |
| `brama: input schema drift for 'brama_detect'` | The child changed a tool's input schema. | new signed release capturing the new schema |
| `brama: signed argv mismatch` | Registry and manifest disagree on launch argv. Same family: `signed command mismatch`, `signed cwd mismatch`, `signed environment-name mismatch`, `signed tool names exceed the local release policy`. | re-mint against the current registry |
| `<name>: child tool surface does not match signed manifest` | The child advertises more, fewer, or different tool names than signed. | new signed release |
| `<name> exited (<code>)` | The child died mid-handshake. Las discards child stderr; run the child's own command by hand (see the launch column in [concepts/registry-entry](concepts/registry-entry.md)) to see its diagnostics. | fix the child |
| `<name>: cwd is not an existing directory` / `…: command is not an existing file` | Sibling checkout or build artifact missing at the registry path. | build/clone the sibling |
| `<name>: command resolves outside the workspace` (and the cwd/argv variants) | A symlink or moved checkout escapes `las/..` containment. | keep children inside the workspace root |

After any repair: restart Las. The manifest and the MCP federation are both
memoized per process ([release admission](concepts/release-admission.md)).

## A tool is missing from MCP `tools/list`

The federation omits a surface that failed to spawn, handshake, or verify,
and writes exactly one line to stderr:

```text
las: surface '<name>' unavailable
```

That is deliberate: child-controlled diagnostics never reach the parent
stream. To name the cause, run `las check <name>` — same gates, sentence
included (table above). A partial catalogue is a normal state, and a missing
tool must not be read as an empty, healthy downstream. Restart after repair.

## An MCP request is refused

Captured code → sentence → meaning:

| Code | Sentence | Meaning |
|---|---|---|
| `-32700` | `parse error` | The stdin line was not JSON. |
| `-32002` | `session is not initialized` | Any request before `initialize`. |
| `-32600` | `session is already initialized` | Second `initialize`. |
| `-32600` | `agent identity is not configured` / `agent identity rejected` | Skarbiec is active and `initialize` lacked the exact `agentId` (or `SKARBIEC_MCP_AGENT_ID` is unset). |
| `-32600` | `agent identity is fixed at initialization` | Any post-initialize request whose params carry an `agentId` key. |
| `-32600` | `invalid onboarding arguments` | `las__onboarding` called with keys other than optional string `action`. |
| `-32601` | `method not found` | Method outside `initialize`/`ping`/`tools/list`/`tools/call`. |
| `-32601` | `unknown tool` | `tools/call` for a name outside the built federation — including a surface that failed to federate. |
| `-32601` | `tool is not permitted` | The name routed, but signed/local policy refuses the remote tool. |
| `-32000` | `surface request failed` | The child errored or died mid-call; the surface name alone is on stderr (`las: surface '<name>' request failed`). |
| `-32000` | `params.name must be a string` | Malformed `tools/call`. |

Responses arrive in completion order, not request order — match on `id`
([walkthrough-federated-session](walkthrough-federated-session.md)).

## A Skarbiec call is refused

All sentences local to Las, before the broker is ever asked
([concepts/policy](concepts/policy.md)):

- `skarbiec: capability arguments do not match the broker v1 contract` —
  wrong keys, empty/wildcard/NUL strings.
- `skarbiec: capability target is outside the contract taxonomy` /
  `…: capability resource is outside the contract taxonomy` — the
  purpose/target/resource triple is outside the fixed table.
- `skarbiec: capability request exceeds the local least-privilege ceiling` —
  `ttl_seconds` > 60, `max_uses` > 1, or `delegation_depth` > 0.
- `skarbiec: invalid health result` / `…: invalid capability availability
  result` / `…: invalid capability request result` / `…: invalid MCP content
  result` — the broker answered off-contract; Las refused to forward it.

## A call hangs forever

By design: Las imposes no timeout on a child request — a child runs to
completion ([architecture](architecture.md)). Distinguish two states: a child
that **died** already rejected the call (`<name> exited (<code>)` →
`-32000`); a child that is **stuck** keeps the call in flight until the
client closes the session. Closing stdin drains in-flight handlers, closes
every child, and exits. If the child ignores its pipe closing, inspect that
child's own process — Las will not kill a working child mid-request.

## `las tools` printed an error but exited 0

Correct reading, not a bug: `tools` reports per-surface errors inline in the
JSON and reserves the exit code for usage errors only. `check` is the command
whose exit code is the health verdict (1 if any selected surface fails).
Health checks should call `check` (`docs/examples/catalogue-health.sh`).

## Onboarding refuses or looks stuck

- `las: unknown onboarding action '<a>'` / `las: onboarding accepts at most
  one action` — usage, exit 1.
- Journey never completes: completion evidence is a **real** catalogue
  query — run `las list` (CLI) or `tools/list` (MCP), not `advance`.
- State damaged: delete `$XDG_STATE_HOME/las/onboarding.json`
  (default `~/.local/state/las/onboarding.json`) or run
  `las onboarding reset` — the state is advisory and rebuilt fresh
  ([concepts/onboarding](concepts/onboarding.md)).
