# Catalogue model

The catalogue is the answer to "which agent surfaces exist here, and which
can actually be called". It is derived from three layers, each of which can
only narrow the previous one: the static registry, the signed
release/configuration check, and the operator filters.

## The static registry

`SURFACES` in `src/registry.mjs` is a frozen array with one entry per
federated surface. Every entry declares the exact `command`, `args`, and
`cwd` used to launch that surface's own MCP server, an `envAllowlist` of
inheritable environment-variable names, optionally an `allowTools` list, and
a one-line `summary`. Paths resolve from the parent Wisent workspace — the
directory containing `las/` and its sibling repositories.

The current registry:

| Las name | Owning surface | Launch | Extra local policy |
|---|---|---|---|
| `weles` | Weles browser executor MCP | Node, `weles/dist/mcp.js` | — |
| `skarbiec` | Skarbiec capability broker MCP | `entitlements-rotator/target/release/skarbiec-entitlements-router mcp` | tool allowlist `health`, `capability_available`, `capability_request`; strict schema/taxonomy/result validation |
| `tama` | Tama hook catalogue/inspection MCP | Node, `hooks-rotator/src/mcp-server.mjs` | tool allowlist `list_hooks`, `show_hook`, `read_hook_source`, `validate_hooks`, `render_hook_docs` |
| `stado` | Stado compute status MCP | `/usr/bin/python3 -m stado.mcp.server` in `wisent-compute` | — |
| `lem` | Lem research registry MCP | `lem-desktop/.build/debug/LemMCP` | — |
| `echo` | Echo growth/content dashboard MCP | Node, `echo/agent/mcp.mjs` | — |
| `most` | Most communications health MCP | `/usr/bin/python3 most/most_agent/mcp_server.py` | — |
| `probierz` | Probierz cross-platform quality MCP | Node, `probierz/agent/mcp.mjs` | — |
| `byk` | Oko founder-strategy MCP | `swiatowid/.build/debug/oko-mcp` | — |
| `brama` | Brama model gateway MCP | `brama/target/debug/brama mcp` | — |
| `warsztat` | repository proposal workflow MCP | `singularity/target/debug/singularity-repo-mcp` | explicit proposal-tool allowlist (`workspace_*`, `commit_create`, `branch_publish`, `pull_request_open`, `proposal_status`) |
| `finance` | financial reference/proposal MCP | `singularity/target/release/singularity-finance-mcp` | separate local policy; not in the signed manifest |

Summaries are operator hints. The signed manifest, local special policy,
advertised schema verification, argument policy, and the child server's own
enforcement determine the callable surface.

## Configured

`surfaceConfigured(surface)` answers "does the current signed
release/configuration admit this surface":

- For every ordinary surface, the surface must appear in the verified signed
  manifest (see [federation and policy](federation-and-policy.md)). A
  manifest that is missing, invalid, expired, or rolled back makes the
  surface unconfigured; a manifest surface name outside the registry (or
  naming `finance`) fails manifest loading entirely.
- For `finance`, all eight `SINGULARITY_FINANCE_*` variables must be set and
  non-empty; the signed manifest is not consulted.

The verified manifest is cached per process; expiry is re-checked on each
use, and a load error is also cached, so recovery from a bad manifest is a
restart.

## Active

`activeSurfaces()` starts from the configured surfaces and applies two
operator filters:

- `LAS_ONLY=a,b` — allowlist; when non-empty, only the named surfaces stay.
- `LAS_SKIP=a,b` — denylist; the named surfaces are removed.

Both filters only subtract from configured, signed surfaces. They cannot add
an unsigned surface or bypass local configuration. `las list` reports both
booleans per surface: `configured` (admitted by release/configuration) and
`active` (also survives the filters).

## Explicit surface selection

`las tools` and `las check` accept explicit surface names. An unknown name,
or a name that is not configured or not active under the filters, is rejected
with exit code `1` — explicit selection cannot reach past the catalogue.
With no names, both commands cover every active surface.

## Federation is a snapshot

The MCP server builds the federation once per process, on the first request
that needs it, and memoizes the result. A child that fails to start,
handshake, or verify at that moment is omitted — only its static registry
name is written to stderr — and child changes are not hot-reloaded. A partial
catalogue is therefore a normal state, and a missing tool must not be read as
an empty, healthy downstream resource. Restart Las to pick up repaired
children or a new signed release.
