# Federation and policy preservation

Las's core promise is that federating a child never widens it. This page
follows one surface from signed release to routed tool call and names every
check on the path. All of it is implemented in `src/registry.mjs` and
`src/signed-manifest.mjs`.

## The signed release manifest

Four required environment variables name the release material (absolute
paths): `LAS_RELEASE_MANIFEST_FILE`, `LAS_RELEASE_MANIFEST_SIGNATURE_FILE`,
`LAS_RELEASE_TRUST_STORE_FILE`, `LAS_RELEASE_WATERMARK_FILE`.

Loading verifies, in order:

1. **Signature envelope.** The detached signature file is strict JSON with
   exactly `type` (`las.release-manifest`), `version` (`1`), `key_id`, and a
   canonical-base64, 64-byte Ed25519 `signature`.
2. **Trust store.** An owner-only regular file (`version: 1`, `keys[]` of
   `key_id` + `public_key_spki`). The envelope's `key_id` must select one
   trusted Ed25519 public key. The store holds public verification keys only.
3. **Signature.** Verified over the domain-separated raw manifest bytes —
   the prefix `LAS\0release-manifest\0v1\0` concatenated with the manifest
   file exactly as stored.
4. **Manifest schema.** Strict JSON with exactly `type`, `version: 1`, a
   positive safe-integer `sequence`, an RFC 3339 UTC `expires_at` that is in
   the future, and a non-empty `surfaces[]` with unique names. Each surface
   binds `name`, absolute `command`/`cwd`/`code_path`, exact `argv`, unique
   `env_names`, `binary_sha256`, `code_sha256`, and a non-empty `tools[]` of
   `{name, input_schema_sha256, credential_templates}` with unique tool names
   and unique template arguments.
5. **Watermark.** An owner-only regular file `{version: 1, sequence}`. A
   manifest sequence lower than the stored one is rejected as rollback; a
   higher one advances the watermark through an exclusive owner-only
   temporary file, `fsync`, and an atomic rename. This is the only file Las
   ever writes.

Strict JSON means Las's own parser: valid UTF-8, no duplicate object keys,
no trailing data, and exact-key checks on every object. Every surface named
by the manifest must exist in the registry, and `finance` may not appear.

## Launch-time validation

`connect(surface)` re-validates before every spawn:

- **cwd** — absolute, an existing directory, and (after `realpath`) inside
  the workspace root.
- **command** — absolute, an existing regular file, and inside the
  workspace, unless it is exactly the current Node executable or
  `/usr/bin/python3`. Absolute `args` entries must also resolve inside the
  workspace.
- **release binding** — the signed entry's `command`, `cwd`, `argv`, and
  `env_names` must equal the registry entry exactly; where the registry
  carries a local `allowTools` list, the signed tool names must equal it; the
  launched binary's SHA-256 must equal `binary_sha256` and the signed
  `code_path`'s SHA-256 must equal `code_sha256`.
- **environment** — see below.

Any mismatch throws, which fails that surface closed.

## The child environment boundary

Las never inherits the parent environment. Each child receives a frozen
environment of a fixed system `PATH`
(`/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`) plus only the variables
named in that surface's `envAllowlist` — which must equal the signed
`env_names` — copied from the parent environment when set and non-empty.
Names matching `TOKEN`, `SECRET`, `PASSWORD`, `UNLOCK`, `PRIVATE_KEY`, or
`SIGNING_KEY` (as `_`-delimited segments) are rejected for every surface
except `finance`.

## Handshake verification

After spawn, Las performs the MCP `initialize` + `tools/list` handshake and
verifies the advertised tools (`authorizeTools`): valid, unique tool
declarations with object input schemas; the tool set exactly equal to the
signed names; and the canonical SHA-256 of each advertised input schema equal
to the signed `input_schema_sha256`. Canonicalization sorts object keys, so
cosmetic re-serialization does not break the digest, but any semantic schema
drift does.

## Call-time policy

Each `tools/call` passes three gates:

- `authorizeToolCall` — the remote tool must be in the signed tool list (or
  the Finance local allowlist).
- `authorizeToolArguments` — arguments must be an object; signed
  `credential_templates` are injected as fixed arguments, and a model
  argument with the same name is rejected rather than merged. Skarbiec
  arguments additionally pass a strict local contract (below).
- `authorizeToolResult` — results pass through unchanged except for
  Skarbiec, whose result envelopes are validated field-for-field.

Failures return generic Las errors; child-controlled diagnostics are
discarded, never forwarded into the parent protocol stream or Las stderr.

## The Skarbiec boundary

Skarbiec gets the strictest posture:

- Only `health`, `capability_available`, and `capability_request` are
  permitted; their input-schema digests and descriptions are pinned in Las
  source, and the signed manifest must match them.
- Arguments must match the broker v1 contract exactly: non-empty,
  non-wildcard `purpose`/`resource`/`target`; a purpose/target/resource
  taxonomy fixed in Las source; `ttl_seconds` at most 60; `max_uses` at most
  1; `delegation_depth` at most 0.
- Results are validated as exact envelopes: `health` must report the
  `skarbiec-capability-broker` service on wire `skarbiec.redeem.v1` with
  bounded numeric fields; `capability_available` returns only a boolean;
  `capability_request` returns only `status: "issued"` plus a 64-hex-char
  opaque `capability_id`. Redeemed credentials never cross Las.
- The MCP session itself is identity-bound: when Skarbiec is active,
  `initialize` must present `agentId` equal to `SKARBIEC_MCP_AGENT_ID`, and
  `SKARBIEC_*` path variables must be absolute.

## The Finance boundary

`finance` is not admitted through the signed-manifest map. It activates only
when all eight `SINGULARITY_FINANCE_*` variables are set; the launched binary
must match `SINGULARITY_FINANCE_BINARY_SHA256` exactly, and a local
proposal-only policy document must match a fingerprint compiled into Las
source. Only `finance_propose`, `finance_status`, and `finance_cancel` are
permitted; any tool name containing `execute`, `approve`, `sign`,
`broadcast`, `beneficiary`, or `policy` as a word is rejected. This is a
local guard — the child must still enforce its own proposal-only and
financial authorization boundary.

## Failure and lifecycle model

Verification fails closed, per surface: the failing surface is omitted from
the federation and only its static registry name is written to stderr. The
remaining surfaces still federate. A child that exits with requests
outstanding rejects them, but Las imposes no timeout, so a child that never
answers keeps that call in flight until the process exits or is externally
interrupted. When the client's stdin closes, Las lets the in-flight
federation build and pending handlers flush, then closes every spawned child
and exits as the event loop drains. Federation is memoized per process;
recovery is a restart after the signed release or child build is repaired.
