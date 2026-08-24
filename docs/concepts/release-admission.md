# Release admission

How does a [registry entry](registry-entry.md) become a callable surface?
Through an admission pipeline in `src/registry.mjs` in which every stage can
only refuse — nothing on the path can add a surface, a tool, or an
environment variable that the owner did not sign.

## The pipeline

```text
registry entry (compiled in)
  └─ signed manifest loads and verifies          → else: not configured
      └─ manifest names only registry surfaces   → else: whole manifest refused
          └─ surface present in manifest         → "configured"
              └─ LAS_ONLY / LAS_SKIP filters     → "active"
                  └─ spawn-time validation       → else: surface fails closed
                      └─ handshake verification  → tools callable
```

## Stage 1: manifest load (once per process)

`signedManifest()` calls `loadSignedManifest()`
([signed manifest](signed-manifest.md)) the first time any admission question
is asked, then memoizes **both** the result and the error. Two consequences:

- Expiry is live: the memoized `expires_at` is re-checked on every use, so a
  running `las-mcp` starts refusing with `las manifest: manifest has expired`
  the moment its manifest lapses.
- Repair is a restart: a fixed manifest, trust store, or watermark on disk
  changes nothing in a process that already cached the failure.

One check lives here rather than in the loader: every surface named by the
manifest must exist in the registry, and `finance` may not appear —
`las manifest: unknown or separately trusted surface '<name>'`. This refuses
the **whole manifest**, so one typo'd surface name deconfigures everything.
Verified: a manifest naming a surface `toy` passes
`docs/examples/verify-release.mjs` (`release ok`) yet leaves every surface
`configured: false`.

## Stage 2: configured

`surfaceConfigured(surface)` answers "does the current release admit this
surface":

- Ordinary surface: present in the verified manifest. The underlying error is
  swallowed on purpose — `las list` reports `configured: false`, and explicit
  selection refuses with
  `las: surface '<name>' is not active under the signed release and operator
  filters`. To name the actual cause, run
  `node docs/examples/verify-release.mjs` ([runbook](../runbook.md)).
- `finance`: all eight `SINGULARITY_FINANCE_*` variables set and non-empty;
  the manifest is never consulted ([policy](policy.md)).

## Stage 3: active

`activeSurfaces()` applies the two operator filters over the configured set:
`LAS_ONLY` (allowlist; when non-empty, only named surfaces stay) and
`LAS_SKIP` (denylist). Both can only subtract. Verified:
`LAS_SKIP=brama las tools brama` refuses with the not-active sentence even
when the release admits brama.

## Stage 4: spawn-time validation

`connect(surface)` runs immediately before every spawn:

1. **Filesystem invariants** — `validateCwd` and `validateCommand`
   ([registry entry](registry-entry.md)): absolute paths, existing files,
   workspace containment after `realpath`, trusted-external set limited to
   the current Node executable and `/usr/bin/python3`.
2. **Release binding** — `validateReleaseBinding` compares the signed entry
   against the registry entry and the actual bytes:

   | Check | Refusal sentence |
   |---|---|
   | signed `command` = registry command | `<name>: signed command mismatch` |
   | signed `cwd` = registry cwd | `<name>: signed cwd mismatch` |
   | signed `argv` = registry args | `<name>: signed argv mismatch` |
   | signed `env_names` = registry envAllowlist | `<name>: signed environment-name mismatch` |
   | signed tool names = registry `allowTools` (where present) | `<name>: signed tool names exceed the local release policy` |
   | SHA-256 of launched binary = `binary_sha256` | `<name>: release binary digest mismatch` |
   | SHA-256 of `code_path` = `code_sha256` | `<name>: release code digest mismatch` |
   | `code_path` is a regular file | `<name>: signed code path is not a file` |

   For `skarbiec`, the signed tool schemas must additionally equal the broker
   v1 digests pinned in Las source
   (`skarbiec: signed tool policy does not match the capability broker v1
   surface`).
3. **Environment build** — `buildChildEnvironment` produces the frozen child
   environment: fixed system `PATH` plus allowlisted variables that are set
   and non-empty. Skarbiec additionally requires absolute `SKARBIEC_*` paths
   and a configured agent identity ([policy](policy.md)).

Rebuilding a child binary trips this stage: after replacing the brama binary
the signed digest no longer matches, and `las tools brama` reports
`{"error": "brama: release binary digest mismatch"}` (captured in
[runbook](../runbook.md)).

## Stage 5: handshake verification

After spawn, Las performs `initialize` + `tools/list` and `authorizeTools`
verifies the advertisement against the signature:

- valid, unique tool declarations with object input schemas —
  `<name>: invalid or duplicate tool declaration`;
- the advertised set exactly equal to the signed names —
  `<name>: child tool surface does not match signed manifest`;
- each advertised schema's canonical SHA-256 equal to the signed digest —
  `<name>: input schema drift for '<tool>'`.

A child that upgrades its schema without a new signed release is refused —
captured: corrupting one signed digest turns `las tools brama` into
`{"error": "brama: input schema drift for 'brama_detect'"}`.

## Defense in depth

Two sentences on this path are unreachable in a single healthy process and
exist as guards against internal drift: `<name>: absent from owner-signed
release manifest` (a surface that passed `configured` cannot lose its
manifest entry, since the manifest is memoized) and the call-time re-checks
in [policy](policy.md). They are listed here so a grep for them lands
somewhere.

## Failure is per-surface and silent by design

Except for stage 1 (whole-manifest refusal), every failure removes one
surface: the CLI reports it in that surface's slot, and the MCP server prints
only `las: surface '<name>' unavailable` to stderr — child-controlled
diagnostics never reach the parent protocol stream. A partial catalogue is a
normal state ([catalogue](../catalogue.md)).
