## Signed release boundary

Each ordinary surface entry binds:

- absolute command and working directory;
- exact argv and environment-variable names;
- SHA-256 of the launched binary and a designated code path;
- exact tool names;
- canonical SHA-256 of each advertised input schema;
- optional credential argument templates.

The detached Ed25519 signature covers the domain-separated raw manifest bytes.
The manifest uses strict JSON, positive sequence numbers, an RFC 3339 UTC expiry,
and unique surface/tool names. The trust store selects one configured public key.

The watermark rejects sequence rollback and is atomically advanced. Trust store
and watermark must be regular, current-user-owned files with no group/other
permissions. Manifest, signature, trust-store, and watermark variables must be
absolute paths.

At child launch Las additionally validates that:

- cwd and absolute code arguments remain inside the workspace;
- command is inside the workspace or is the exact current Node or
  `/usr/bin/python3` executable;
- binary/code digests equal the manifest;
- child `tools/list` exactly equals the signed names and schema digests;
- model arguments cannot overwrite signed credential templates.

Any mismatch fails closed for that surface.

## Special security boundaries

### Skarbiec

Las launches `skarbiec mcp broker` from `skarbiec/target/release/` in the
workspace and permits only `health`, `capability_available`,
`capability_request` and `access_request_status`, in that order. It pins
their schemas/descriptions, validates the purpose/resource/target taxonomy and
the `request_id` shape, and validates exact result envelopes. Callers declare
positive whole-number `ttl_seconds` and `max_uses`; optional
`delegation_depth` is nonnegative. Las checks their shape, while Skarbiec owns
the capability policy and refuses requests outside its authority. Las does not
impose a separate lifetime, use-count or delegation ceiling. It returns only
availability, opaque capability IDs, or a pending access request's ID and
state—not redeemed credentials. Whether a request is approved, and for how
long and how many uses, is decided by a person in Skarbiec, never by Las or
the model.

#### Agent identity

The identity Skarbiec grants to is the operator's, not the model's. Las passes
the broker exactly its own `SKARBIEC_MCP_AGENT_ID` (with
`SKARBIEC_MCP_HARNESS` and `SKARBIEC_MCP_PERSON`, recorded as the requester).
At `initialize`, a client that sends no `agentId` runs as that identity; a
client that sends a different one is refused; and with
`SKARBIEC_MCP_AGENT_ID` unset Las refuses every client while Skarbiec is
active. A later request may not carry `agentId` at all. So whoever starts
`las-mcp` for a harness chooses which agent it is, and a prompt cannot switch
identity. Run one Las server per agent identity.

### Finance

Finance is not admitted through the ordinary signed-manifest map. It activates
only when all finance policy/state/key/binary-digest variables are set, verifies
the exact binary digest and a local proposal-only policy fingerprint, and permits
only `finance_propose`, `finance_status`, and `finance_cancel`. Names containing
execution/approval/signing/broadcast/beneficiary/policy verbs are rejected.

This is still a local guard; the child must enforce its own proposal-only and
financial authorization boundary.

## Security and privacy

- Protect trust-store private provenance, watermark state, signed manifest,
  policy files, and Skarbiec/Finance configuration from unauthorized changes.
- Las uses public verification keys, not signing keys. Never place a manifest
  private signing key in this workspace or child environment; `las release
  keygen` writes it owner-only to the path you name, and
  [release-signing.md](release-signing.md) lists every file and variable.
- Ordinary child environments reject raw-secret variable names. Use Skarbiec or
  child-owned secure transport rather than broad environment inheritance.

- Credential templates are operator-signed fixed arguments. Review them as
  authority-bearing release content even when they are opaque identifiers.
- Child tool results can contain sensitive customer or operational data. Las does
  not redact ordinary child results; the client and child policies remain
  responsible.
- Child stderr is discarded by Las. Operate child-specific logs separately when
  diagnostics are required.
- Partial federation is allowed. Clients must not interpret a missing tool as an
  empty/healthy downstream resource.
- The child process runs under the Las OS account. Use OS sandboxing and least
  privilege where the product risk requires stronger isolation.
- Never attach manifests, policy/state files, capability IDs, customer tool
  results, agent identities, or private paths to a public issue.

## Operational model

- **Configuration:** static source registry, signed release files, trust store,
  watermark, operator filters, and explicitly allowed child variables.
- **State:** in-memory memoized federation, child processes, pending requests, and
  persistent sequence watermark.
- **Credentials:** Las holds no general secret store; signed templates and
  child-specific secure boundaries carry approved authority.
- **Observability:** CLI/API adoption results and canonical catalogue readback
  without environment values, generic per-surface stderr availability/failure
  lines, child-owned logs, and MCP errors.
- **Failure model:** invalid/expired/rolled-back release, byte/schema drift,
  missing build/configuration, child exit/error, or policy rejection fails the
  affected surface. Federation can remain partially available.
- **Recovery:** deploy a new signed higher-sequence release, repair exact child
  builds/configuration, restart Las, and repeat `las check` for the affected
  surface.
- **Cost:** local processes and child service usage; managed organization
  catalogue/governance is a separate platform surface.

