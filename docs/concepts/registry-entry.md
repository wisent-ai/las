# Registry entry

Where does Las write down which surfaces can exist at all? In one frozen
array compiled into the product: `SURFACES` in `src/registry.mjs`. A registry
entry is the launch contract for one federated surface — nothing more. It
grants no permission by itself: a declared surface is unusable until the
[signed release admits it](release-admission.md).

## Fields

Every entry is a frozen object (`Object.freeze`, including `args`,
`envAllowlist`, and `allowTools`) with these fields:

| Field | Meaning |
|---|---|
| `name` | The Las name of the surface, used in CLI arguments, `LAS_ONLY`/`LAS_SKIP`, and the `<surface>__<tool>` namespace. |
| `command` | Absolute path of the executable that serves the child's own MCP server. |
| `args` | Exact argv passed to it. |
| `cwd` | The child's project root; the process is spawned there. |
| `summary` | One-line human hint. Never an authorization contract. |
| `envAllowlist` | The only environment-variable names the child may inherit. Must match `^[A-Z][A-Z0-9_]*$`, be unique, and equal the signed `env_names` exactly. |
| `allowTools` | Optional. Where present, the signed tool-name list must equal it exactly (`skarbiec`, `tama`, `warsztat` carry one). |

All paths resolve from the parent Wisent workspace — `src/registry.mjs`
computes the root as `las/..`, the directory that contains `las/` and every
sibling repository.

## The current registry

| Las name | Owning surface | Launch | Extra local policy |
|---|---|---|---|
| `weles` | Weles browser executor MCP | Node, `weles/dist/mcp.js` | — |
| `skarbiec` | Skarbiec capability broker MCP | `entitlements-rotator/target/release/skarbiec-entitlements-router mcp` | tool allowlist `health`, `capability_available`, `capability_request`; pinned schemas, taxonomy, and result validation ([policy](policy.md)) |
| `tama` | Tama hook catalogue/inspection MCP | Node, `hooks-rotator/src/mcp-server.mjs` | tool allowlist `list_hooks`, `show_hook`, `read_hook_source`, `validate_hooks`, `render_hook_docs` |
| `stado` | Stado compute status MCP | `/usr/bin/python3 -m stado.mcp.server` in `wisent-compute` | — |
| `lem` | Lem research registry MCP | `lem-desktop/.build/debug/LemMCP` | — |
| `echo` | Echo growth/content dashboard MCP | Node, `echo/agent/mcp.mjs` | — |
| `most` | Most communications health MCP | `/usr/bin/python3 most/most_agent/mcp_server.py` | — |
| `probierz` | Probierz cross-platform quality MCP | Node, `probierz/agent/mcp.mjs` | — |
| `byk` | Oko founder-strategy MCP | `swiatowid/.build/debug/oko-mcp` | — |
| `brama` | Brama model gateway MCP | `brama/target/debug/brama mcp` | — |
| `warsztat` | Repository proposal workflow MCP | `singularity/target/debug/singularity-repo-mcp` | proposal-tool allowlist (`workspace_*`, `commit_create`, `branch_publish`, `pull_request_open`, `proposal_status`) |
| `finance` | Financial proposal MCP | `singularity/target/release/singularity-finance-mcp` | separate local policy; never in the signed manifest ([policy](policy.md)) |

## Lifecycle

The registry has no runtime lifecycle: it is code. There is no network
registry, plugin auto-discovery, configuration file, or dynamic surface
addition. Adding, removing, or re-pathing a surface is a source change to
`src/registry.mjs` — which then requires a new signed release whose entry
matches the new declaration byte-for-byte, because [release
admission](release-admission.md) compares `command`, `cwd`, `argv`, and
`env_names` for exact equality.

## Invariants, enforced at every spawn

`connect(surface)` re-validates the entry against the filesystem before every
spawn (`validateCwd`, `validateCommand`, `buildChildEnvironment` in
`src/registry.mjs`). Each violated invariant fails that surface closed with
its own sentence:

- `<name>: cwd must be an absolute path`
- `<name>: cwd is not an existing directory`
- `<name>: cwd escapes the workspace root` — after `realpath`, the cwd must
  be the workspace root or inside it.
- `<name>: invalid command` / `<name>: invalid command arguments` — no empty
  or NUL-containing strings.
- `<name>: command must be an absolute path`
- `<name>: command is not an existing file`
- `<name>: command resolves outside the workspace` — the only permitted
  external commands are the current Node executable (`process.execPath`) and
  `/usr/bin/python3`, compared after `realpath`.
- `<name>: command argument does not exist` /
  `<name>: command argument resolves outside the workspace` — absolute argv
  entries (child entry scripts) are held to the same containment.
- `<name>: envAllowlist must contain unique, explicit environment names`
- `<name>: raw-secret environment inheritance is prohibited` — an allowlist
  name with a `TOKEN`, `SECRET`, `PASSWORD`, `UNLOCK`, `PRIVATE_KEY`, or
  `SIGNING_KEY` segment is rejected for every surface except `finance`.

## Not to be confused with

- **The signed manifest.** The registry declares what could run; the
  [signed manifest](signed-manifest.md) is the owner's statement of what is
  admitted, down to exact bytes and schemas.
- **The catalogue.** `las list` output is the registry joined with admission
  and operator filters — see [catalogue](../catalogue.md).
- **A child's own registry.** Several children (Stado, Lem) have registries
  of their own; a Las registry entry only says how to launch them.
