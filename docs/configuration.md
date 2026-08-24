# Configuration

Las has no configuration file of its own. Everything is environment
variables plus operator-owned release files; the registry itself is compiled
into `src/registry.mjs`. Las reads all of the below and writes exactly two
things: the release watermark (forward-only, atomic) and the advisory
onboarding state file. Each table names the reader so every claim is
greppable.

## Signed release boundary

Read by `loadSignedManifest()` (`src/signed-manifest.mjs`); required for any
ordinary surface to be configured; each must be an absolute path or loading
refuses with `las manifest: <VARIABLE> must name an absolute path`. Full file
contracts in [concepts/signed-manifest](concepts/signed-manifest.md).

| Variable | File |
|---|---|
| `LAS_RELEASE_MANIFEST_FILE` | The strict-JSON release manifest. |
| `LAS_RELEASE_MANIFEST_SIGNATURE_FILE` | Detached Ed25519 signature envelope over the raw manifest bytes. |
| `LAS_RELEASE_TRUST_STORE_FILE` | Public verification keys. Regular file, current-user-owned, owner-only permissions. |
| `LAS_RELEASE_WATERMARK_FILE` | Sequence watermark, same ownership/permission rules. The only file the release path writes — forward-only, exclusive temp + fsync + atomic rename. |

There is no default for any of the four: unset means every ordinary surface
is `configured: false`.

## Operator filters

Read by `activeSurfaces()` (`src/registry.mjs`) on every catalogue
derivation:

| Variable | Effect | Default |
|---|---|---|
| `LAS_ONLY` | Comma-separated allowlist; when non-empty, only the named surfaces stay active. | unset — no restriction |
| `LAS_SKIP` | Comma-separated denylist; the named surfaces are removed. | unset — nothing skipped |

Both only subtract from configured, signed surfaces; neither can add an
unsigned surface or bypass local configuration. Unknown names in either are
ignored, not errors.

## Child environment allowlists

Built by `buildChildEnvironment()` (`src/registry.mjs`) at every spawn. Each
child receives a frozen environment: the fixed system `PATH`
(`/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin` — never the parent's) plus
only the variables in that surface's `envAllowlist`, copied from Las's own
environment when set and non-empty. The allowlist must equal the signed
`env_names`, and names containing a `TOKEN`, `SECRET`, `PASSWORD`, `UNLOCK`,
`PRIVATE_KEY`, or `SIGNING_KEY` segment are rejected for every surface except
`finance` (`<name>: raw-secret environment inheritance is prohibited`).

Per-surface allowlisted names in the current registry:

| Surface | Names |
|---|---|
| `weles`, `tama`, `lem`, `byk`, `brama` | none |
| `skarbiec` | `SKARBIEC_CAP_POLICY`, `SKARBIEC_CAP_POLICY_SIG`, `SKARBIEC_CAP_TRUST_ROOT`, `SKARBIEC_WORKLOAD_REGISTRY`, `SKARBIEC_WORKLOAD_REGISTRY_SIG`, `SKARBIEC_CAP_STATE`, `SKARBIEC_CAP_SOCKET`, `SKARBIEC_WORM_RECEIPT_DIR`, `SKARBIEC_WORM_CHECKPOINT`, `SKARBIEC_WORM_RECEIPT_COMMAND`, `SKARBIEC_MCP_AGENT_ID` |
| `stado` | `COMPUTE_API_URL`, `GCP_PROJECT`, `GCP_REGION`, `GCP_REGIONS`, `WC_BUCKET`, `WC_PROVIDERS`, `WC_STORAGE_BACKEND` |
| `echo` | `NEXT_PUBLIC_SUPABASE_URL` |
| `most` | `MOST_BASE_URL` |
| `probierz` | `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `APPIUM_HOME`, `APP_IOS`, `BUNDLE_ID`, `IOS_DEVICE`, `IOS_VERSION`, `PLAYWRIGHT_BROWSERS_PATH` |
| `warsztat` | `LAS_ONLY`, `LAS_SKIP` |
| `finance` | the eight `SINGULARITY_FINANCE_*` variables below |

What each variable means belongs to the owning child product; Las only
forwards the value unchanged.

## Skarbiec

Enforced by `buildChildEnvironment()` and `requiredSkarbiecAgentIdentity()`
when the `skarbiec` surface spawns, and by `initialize` handling in
`src/mcp.mjs`:

- `SKARBIEC_MCP_AGENT_ID` — one explicit agent identity: non-empty, trimmed,
  not `*`, no NUL (`skarbiec: SKARBIEC_MCP_AGENT_ID must name one explicit
  agent identity`). MCP clients must present it as `agentId` at `initialize`.
- Every *set* `SKARBIEC_*` path variable in the allowlist above (all except
  the agent ID) must be an absolute path
  (`skarbiec: <NAME> must name an absolute path`).

## Finance

Checked by `financeConfigured()` and `validateCommand()`
(`src/registry.mjs`). `finance` is configured only when all eight are set
and non-empty (the signed manifest is never consulted):
`SINGULARITY_FINANCE_POLICY_FILE`, `SINGULARITY_FINANCE_ENABLE_LEASE_FILE`,
`SINGULARITY_FINANCE_STATE_DIR`, `SINGULARITY_FINANCE_VERIFY_KEY_HEX`,
`SINGULARITY_FINANCE_BINARY_SHA256`, `SINGULARITY_FINANCE_EXECUTOR`,
`SINGULARITY_FINANCE_CUSTODY_URL`, `SINGULARITY_FINANCE_CUSTODY_TOKEN_FILE`.

`SINGULARITY_FINANCE_BINARY_SHA256` must be a 64-character lowercase SHA-256
digest and must equal the digest of the launched finance binary
(`finance: release binary digest mismatch`). The other seven are forwarded to
the child; their semantics belong to the finance product.

## Onboarding state and transport

Read by `src/onboarding.mjs` ([concepts/onboarding](concepts/onboarding.md)):

| Variable | Effect | Default |
|---|---|---|
| `XDG_STATE_HOME` | Root of the state directory; progress persists at `<root>/las/onboarding.json`, directory `0700`, file `0600`, atomic rename. | `~/.local/state` |
| `STADO_INTEGRATION_API_URL` | Origin of the onboarding control plane. Must parse as HTTPS with no embedded credentials, or the transport marks itself unavailable. | unset — fully offline; events stay queued locally |
| `LAS_STADO_INTEGRATION_TOKEN` | Bearer token for the control plane. Both variables must be set for any request to be attempted; requests time out after 1500 ms. | unset — offline |

Onboarding state is advisory: persistence or transport failure never turns a
successful catalogue query into a failure.

## Workspace layout

`src/registry.mjs` resolves every child from the parent of the las repository
directory — `las/..` is the workspace root shared by every sibling project.
Child commands, working directories, and absolute code arguments must resolve
(after `realpath`) inside that root; the current Node executable and
`/usr/bin/python3` are the only permitted external commands. A standalone
clone without siblings has nothing to federate. Each surface's exact launch
path is in [concepts/registry-entry](concepts/registry-entry.md).
