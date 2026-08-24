# CLI reference

`las` is the read-only command-line view of the federated catalogue. It reads
the same registry and admission state the MCP server uses; nothing here
mutates a child. `package.json` exposes the `las` bin (`src/cli.mjs`);
running the source directly (`node src/cli.mjs …`) is equivalent. Every
example output on this page was captured from a real run against the toy
release of [walkthrough-onboard-a-surface](walkthrough-onboard-a-surface.md).

```text
usage: las <command> [surface...]
  list                 list every federated surface
  tools [surface...]   list advertised tools (spawns each child)
  check [surface...]   connectivity handshake against each child
  onboarding [action]  first-use catalogue journey (show, status, advance, skip, reset)

surfaces: weles, skarbiec, tama, stado, lem, echo, most, probierz, byk, brama, warsztat, finance
env: LAS_ONLY=a,b (allow-list)  LAS_SKIP=a,b (deny-list)
```

## Global behavior

- No command, or an unknown command, prints the usage above on stderr and
  exits 1.
- Any error escaping a command prints `las: <message>` on stderr and exits 1.
- Results go to stdout as pretty-printed JSON (2-space indent); everything
  else goes to stderr.
- Exit codes: `0` success; `1` usage error, unknown/inactive surface
  selection, or (for `check` only) any failing surface. `tools` exits 0 even
  when a surface reports an error — the error lives in the JSON; only
  `check`'s exit code is a health verdict.

## Surface selection (`tools`, `check`)

Explicit names are validated against the registry, then against admission
and filters:

- unknown name → `las: unknown surface '<name>'`, exit 1;
- known but not admitted by the signed release, or subtracted by
  `LAS_ONLY`/`LAS_SKIP` → `las: surface '<name>' is not active under the
  signed release and operator filters`, exit 1. This sentence deliberately
  hides the underlying release failure; `docs/examples/verify-release.mjs`
  names it ([runbook](runbook.md)).

With no names, both commands cover every active surface. Selection cannot
reach past the catalogue: there is no `--force`.

## las list

Every registered surface in registry order, without spawning anything:

```json
[
  {
    "surface": "brama",
    "summary": "Multi-provider LLM gateway (formerly model-router). Read-only hardware detect + model list.",
    "configured": true,
    "active": true
  }
]
```

- `configured` — admitted by the signed release (or, for `finance`, by its
  local configuration). See
  [concepts/release-admission](concepts/release-admission.md).
- `active` — also survives `LAS_ONLY`/`LAS_SKIP`.

`list` proves no connectivity. A successful `list` also counts as the
catalogue query that completes first-use
[onboarding](concepts/onboarding.md).

## las tools

Spawns each selected child, performs the verified `initialize` +
`tools/list` handshake ([release admission](concepts/release-admission.md)),
closes the child, and prints one object keyed by surface: a healthy surface
maps to its namespaced tool names, a failing one to `{ "error": <sentence> }`.

```json
{
  "brama": [
    "brama__brama_detect"
  ]
}
```

Captured failure shape (child binary rebuilt since signing):

```json
{
  "brama": {
    "error": "brama: release binary digest mismatch"
  }
}
```

Exit code stays 0 in both cases.

## las check

The same verified handshake, reported as a connectivity verdict:

```json
{
  "brama": {
    "ok": true,
    "toolCount": 1
  }
}
```

A failing surface reports `{ "ok": false, "error": <sentence> }` and the
command exits 1. `check` invokes no child tool and does not prove that
downstream credentials, data, or providers are healthy — only that the child
starts, handshakes, and exposes exactly the signed tool surface.

## las onboarding

`las onboarding [action]` — at most one action or the command refuses with
`las: onboarding accepts at most one action` (exit 1):

| Action | Effect |
|---|---|
| `show` (default) | Display the current screen; starts the journey if needed. |
| `status` | Report progress without starting the journey (`not_started` when none). |
| `advance` | Move from the federation-model screen to the guided query. |
| `skip` | Mark the attempt skipped (no-op when already completed). |
| `reset` | Discard evidence and start a new attempt. |

An unknown action refuses with `las: unknown onboarding action '<action>'`
(exit 1). Output is the screen title, body, `Status: <status>`, and a
`Next: <action>` line. The journey completes on a real catalogue query, not
on `advance` — full contract and captured transcript in
[concepts/onboarding](concepts/onboarding.md).

## Environment

The CLI reads the same environment as the MCP server — the four
`LAS_RELEASE_*` paths, the `LAS_ONLY`/`LAS_SKIP` filters, per-child
allowlisted variables, and the onboarding state/transport variables. The
complete table with reader locations is [configuration](configuration.md).

## What the CLI cannot do

Call a federated tool (that is `las-mcp`'s `tools/call` —
[mcp-server](mcp-server.md)), mutate a child, edit the registry, or bypass
admission. The CLI is the observation half of Las.
