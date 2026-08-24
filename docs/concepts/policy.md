# Policy

Which calls may cross Las, with which arguments, and what may come back?
Policy in Las is the set of call-time gates in `src/registry.mjs` — all
local, all deterministic, all able only to narrow what the [signed
release](signed-manifest.md) and the child's own boundary already allow.

## The four gates on every routed call

1. **`authorizeToolCall`** — the remote tool name must appear in the signed
   tool list (`<name>: tool is not permitted by signed policy`) or, for
   finance, the local allowlist. The MCP server maps any refusal here to
   `-32601 tool is not permitted`.
2. **`authorizeToolArguments`** — arguments must be an object
   (`<name>: tool arguments must be an object`). Each signed
   `credential_template` is then injected as a fixed argument; a model
   argument with the same name is refused, never merged:
   `<name>: model arguments may not override credential template '<arg>'`.
   The child receives a deep copy — the model's object is never forwarded by
   reference.
3. **The child's own enforcement** — Las forwards the call with the original
   tool name; whatever the child refuses stays refused.
4. **`authorizeToolResult`** — results pass through unchanged for every
   surface except Skarbiec, whose result envelopes are validated
   field-for-field (below).

Failures surface to the MCP client as generic Las errors
(`-32000 surface request failed`); child-controlled text is never copied into
the response or Las stderr.

## The environment boundary

Children never inherit Las's environment. Each child gets a frozen
environment of a fixed system `PATH`
(`/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`) plus only its allowlisted
names, copied when set and non-empty — and the allowlist must equal the
signed `env_names`. Names with a `TOKEN`, `SECRET`, `PASSWORD`, `UNLOCK`,
`PRIVATE_KEY`, or `SIGNING_KEY` segment refuse with
`<name>: raw-secret environment inheritance is prohibited` (every surface
except `finance`).

## The Skarbiec boundary

The credential broker gets the strictest posture; every rule is pinned in Las
source and cross-checked against the signature:

- **Surface pinning.** Exactly `health`, `capability_available`,
  `capability_request`, with input-schema digests and descriptions compiled
  into Las. A manifest signing anything else refuses with
  `skarbiec: signed tool policy does not match the capability broker v1
  surface` / `…: signed tool schema does not match the capability broker v1
  surface`. Las re-writes the federated descriptions from its own pinned
  copies, so the child cannot spoof tool descriptions.
- **Session identity.** When skarbiec is active, MCP `initialize` must carry
  `agentId` equal to `SKARBIEC_MCP_AGENT_ID` (`agent identity rejected`;
  `agent identity is not configured` when unset). Any later request carrying
  an `agentId` key refuses with `agent identity is fixed at initialization`.
  The variable itself must name one explicit identity:
  `skarbiec: SKARBIEC_MCP_AGENT_ID must name one explicit agent identity`.
  Every other set `SKARBIEC_*` path variable must be absolute:
  `skarbiec: <NAME> must name an absolute path`.
- **Argument contract.** Beyond the schema: `purpose`/`resource`/`target`
  non-empty, trimmed, never `*`, no NUL; unknown argument names refuse. The
  sentence for all of these is
  `skarbiec: capability arguments do not match the broker v1 contract`.
- **Least-privilege ceilings.** `ttl_seconds` ≤ 60, `max_uses` ≤ 1,
  `delegation_depth` ≤ 0 —
  `skarbiec: capability request exceeds the local least-privilege ceiling`.
- **Purpose taxonomy.** The purpose must be one of the pairs fixed in Las
  source, the target must match it, and the resource must match the
  purpose's resource list or prefix (with content after the prefix):

  | Purpose | Target | Resource |
  |---|---|---|
  | `weles.browser.fill` | `weles` | `origin:…` |
  | `weles.captcha.solve`, `weles.sms.verify` | `weles` | `provider:…` |
  | `weles.proxy.authenticate` | `weles` | `proxy:…` |
  | `weles.brama.sign` | `weles` | `brama:…` or `agent:…` |
  | `most.service.authenticate` | `most-service` | `credential:most/service` |
  | `most.database.connect` | `most-service` | `credential:most/database` |
  | `most.twilio.authenticate` | `most-service` | `credential:most/twilio` |
  | `most.attachment.sign` | `most-service` | `credential:most/attachment-signing` |
  | `most.remote-worker.authenticate` | `most-service` | `credential:most/remote-worker` |
  | `brama.provider.authenticate` | `brama` | `provider:…` |
  | `brama.supabase.connect` | `brama` | `supabase:…` |
  | `brama.request.sign` | `brama` | `agent:…` |
  | `singularity.brama.bootstrap` | `singularity-bootstrap` | `brama:…` |
  | `singularity.most.bootstrap` | `singularity-bootstrap` | `most:…` |

  Off-taxonomy targets refuse with
  `skarbiec: capability target is outside the contract taxonomy`; resources
  with `skarbiec: capability resource is outside the contract taxonomy`.
- **Result validation.** Results must be exactly one text content block whose
  JSON matches the tool: `health` an exact seven-field envelope naming the
  `skarbiec-capability-broker` service on wire `skarbiec.redeem.v1`;
  `capability_available` exactly `{available: <boolean>}`;
  `capability_request` exactly `{status: "issued", capability_id: <64 hex>}`.
  Anything else refuses (`skarbiec: invalid health result`,
  `…: invalid capability availability result`,
  `…: invalid capability request result`, `…: invalid MCP content result`).
  Redeemed credential material can never cross Las: the wire format has no
  field for it.

## The Finance boundary

`finance` is deliberately outside the shared manifest
([release admission](release-admission.md)): it activates only when all eight
`SINGULARITY_FINANCE_*` variables are set, and its binary must match
`SINGULARITY_FINANCE_BINARY_SHA256` exactly
(`finance: release binary digest mismatch`; a malformed digest refuses with
`finance: SINGULARITY_FINANCE_BINARY_SHA256 must be a 64-character lowercase
SHA-256 digest`). The local policy document — allowed tools
`finance_propose`, `finance_status`, `finance_cancel`; blocked verbs
`execute`, `approve`, `sign`, `broadcast`, `beneficiary`, `policy` — must
hash to a fingerprint compiled into Las
(`finance: local tool policy fingerprint mismatch`). At handshake, a child
advertising a prohibited verb as a word in any tool name refuses with
`finance: child advertised a prohibited financial verb`, and the advertised
set must equal the three allowed tools exactly
(`finance: child tool policy does not match the locally bound proposal-only
policy`). Calls to anything else refuse with
`finance: tool is not permitted by the proposal-only policy`.

This is a local guard, not a substitute: the child must still enforce its own
proposal-only and financial authorization boundary.

## What policy is not

Policy here is admission and argument/result shape — not authentication of
the model, not audit logging, not rate limiting, and not the child's business
authorization. Las assumes the operator controls its environment and the
release signer controls the manifest; see
[architecture](../architecture.md#trust-boundaries).
