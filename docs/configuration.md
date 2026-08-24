# Configuration

Las has no configuration file of its own. Everything is environment
variables plus operator-owned release files; the registry itself is compiled
into `src/registry.mjs`. Las reads all of these and writes exactly one file:
the watermark.

## Signed release boundary

Required for any ordinary surface to be configured. All four must be
absolute paths; see [federation and policy](federation-and-policy.md) for
what each file must contain.

| Variable | File |
|---|---|
| `LAS_RELEASE_MANIFEST_FILE` | The strict-JSON release manifest. |
| `LAS_RELEASE_MANIFEST_SIGNATURE_FILE` | Detached Ed25519 signature envelope over the raw manifest bytes. |
| `LAS_RELEASE_TRUST_STORE_FILE` | Public verification keys. Regular file, current-user-owned, owner-only permissions. |
| `LAS_RELEASE_WATERMARK_FILE` | Sequence watermark, same ownership/permission rules. The only file Las writes, atomically and only forward. |

## Operator filters

| Variable | Effect |
|---|---|
| `LAS_ONLY` | Comma-separated allowlist; when non-empty, only the named surfaces stay active. |
| `LAS_SKIP` | Comma-separated denylist; the named surfaces are removed. |

Both only subtract from configured, signed surfaces; neither can add an
unsigned surface or bypass local configuration.

## Child environment allowlists

Each child receives a frozen environment: a fixed system `PATH` plus only
the variables in that surface's `envAllowlist`, copied from Las's own
environment when set and non-empty. The allowlist must equal the signed
`env_names` list, and names containing a `TOKEN`, `SECRET`, `PASSWORD`,
`UNLOCK`, `PRIVATE_KEY`, or `SIGNING_KEY` segment are rejected for every
surface except `finance`.

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

## Skarbiec

When the `skarbiec` surface is active:

- `SKARBIEC_MCP_AGENT_ID` must name one explicit agent identity (non-empty,
  trimmed, not `*`). MCP clients must present it as `agentId` at
  `initialize`.
- Every set `SKARBIEC_*` path variable in the allowlist above (all except
  the agent ID) must be an absolute path.

## Finance

`finance` is configured only when all eight variables are set and non-empty
(it does not use the signed manifest):

`SINGULARITY_FINANCE_POLICY_FILE`, `SINGULARITY_FINANCE_ENABLE_LEASE_FILE`,
`SINGULARITY_FINANCE_STATE_DIR`, `SINGULARITY_FINANCE_VERIFY_KEY_HEX`,
`SINGULARITY_FINANCE_BINARY_SHA256`, `SINGULARITY_FINANCE_EXECUTOR`,
`SINGULARITY_FINANCE_CUSTODY_URL`, `SINGULARITY_FINANCE_CUSTODY_TOKEN_FILE`.

`SINGULARITY_FINANCE_BINARY_SHA256` must be a 64-character lowercase SHA-256
digest and must equal the digest of the launched finance binary.

## Onboarding state

First-use onboarding progress persists at
`$XDG_STATE_HOME/las/onboarding.json`, defaulting to
`~/.local/state/las/onboarding.json`. It is advisory product state:
persistence failures never fail a catalogue query.

## Workspace layout

Las resolves every child from the parent of its own repository directory —
`las/..` is the workspace root shared by every sibling project. Child
commands, working directories, and absolute code arguments must resolve
inside that root (the current Node executable and `/usr/bin/python3` are the
only permitted external commands). A standalone clone without siblings has
nothing to federate. See [catalogue](catalogue.md) for each surface's exact
launch path.
