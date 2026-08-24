# CLI reference

`las` is a read-only command-line view of the federated catalogue. It reads
the same registry the MCP server uses; nothing here mutates a child. When
installed, `package.json` exposes the `las` bin; running the source directly
(`node src/cli.mjs …`) is equivalent.

```text
usage: las <command> [surface...]
  list                 list every federated surface
  tools [surface...]   list advertised tools (spawns each child)
  check [surface...]   connectivity handshake against each child
  onboarding [action]  first-use catalogue journey (show, status, advance, skip, reset)
```

Any other command prints this usage on stderr and exits `1`. Errors print as
`las: <message>` on stderr with exit code `1`.

## Surface selection

`tools` and `check` accept explicit surface names, validated against the
registry. An unknown name, or a name that is not configured and active under
the signed release and the `LAS_ONLY`/`LAS_SKIP` filters, aborts with exit
code `1`. With no names, both commands cover every active surface. See
[catalogue](catalogue.md) for what configured and active mean.

## las list

Lists every registered surface without spawning children:

```json
[
  {
    "surface": "tama",
    "summary": "Adaptive hook enforcement. …",
    "configured": true,
    "active": true
  }
]
```

`list` reads registry and configuration state only; it does not prove
connectivity. A successful `list` also counts as the catalogue query that
completes first-use onboarding.

## las tools

Spawns each selected child, performs the verified `initialize` +
`tools/list` handshake, closes the child, and prints a JSON object keyed by
surface. A healthy surface maps to its namespaced tool names; a failing one
maps to an error object:

```json
{
  "tama": ["tama__list_hooks", "tama__show_hook"],
  "brama": { "error": "brama: absent from owner-signed release manifest" }
}
```

The advertised tools are verified against the signed release (names and
input-schema digests) before they are printed; a mismatch reports as an
error, not as a tool list.

## las check

Same verified handshake as `tools`, reported as connectivity:

```json
{
  "tama": { "ok": true, "toolCount": 5 },
  "brama": { "ok": false, "error": "…" }
}
```

Exit code is `1` if any selected surface fails. `check` invokes no child
tool and does not prove that downstream credentials, data, or providers are
healthy — only that the child starts, handshakes, and exposes the signed
tool count.

## las onboarding

A guided first-use journey with at most one action argument:

- `show` (default) — display the current screen.
- `status` — report progress without starting the journey.
- `advance` — move from the federation-model screen to the guided query.
- `skip` — mark the journey skipped.
- `reset` — start over.

The journey has two screens — understand Las federation, then run a real
catalogue query — and completes when `las list` (or MCP `tools/list`)
succeeds. Output is the screen title, body, `Status:`, and suggested next
actions. State persists in `$XDG_STATE_HOME/las/onboarding.json`
(default `~/.local/state/las/onboarding.json`); onboarding persistence
failures never turn a successful product query into a failure.

## Environment

- `LAS_ONLY=a,b` — allowlist filter over configured surfaces.
- `LAS_SKIP=a,b` — denylist filter.
- `LAS_RELEASE_*` — the four signed-release paths; required for any ordinary
  surface to be configured. See [configuration](configuration.md).
