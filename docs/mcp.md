# The Las MCP server

`las-mcp` (`node src/mcp.mjs` from source) is one stdio MCP server that
federates every configured, signed surface.

## Federated surfaces

`src/registry/surfaces.mjs` declares every surface Las federates: the command
and arguments that start its MCP server, its project directory and the
environment names it may see.

| Las name | Owning surface | Registry posture |
|---|---|---|
| `weles` | Weles browser executor MCP | signed release required |
| `skarbiec` | capability broker MCP | signed release plus strict local schema/taxonomy/result validation |
| `tama` | local hook catalogue/inspection MCP | signed release; explicit read-oriented tool allowlist |
| `stado` | compute status/cost/quota/schedule MCP | signed release required |
| `lem` | research registry/provenance MCP | signed release required |
| `echo` | growth/content dashboard MCP | signed release required |
| `most` | communications health/diagnostics MCP | signed release required |
| `probierz` | cross-platform quality MCP | signed release required |
| `brama` | model gateway detect/list MCP | signed release required |
| `warsztat` | repository proposal workflow MCP | signed release and explicit proposal-tool allowlist |
| `finance` | financial reference/proposal MCP | separate local policy and exact configuration required |
| `trading` | trading platform agent-proxy actions MCP | signed release required; the proxy authenticates each call with the agent token |

Descriptions are operator hints, not authorization contracts. The signed manifest,
local special policy, advertised schema verification, argument policy, and child
server enforcement determine the callable surface.

## Transport

Las reads one JSON-RPC request per stdin line and writes one response per stdout
line. It speaks the MCP protocol revision `src/mcp/protocol.mjs` declares and
names itself with the version its `package.json` declares.

Supported methods:

- `initialize` (exactly once);
- `ping`;
- `tools/list`;
- `tools/call`.

Notifications receive no response. Requests before initialization fail. A later
request may not replace `agentId`.

## Agent identity

When the Skarbiec surface is active, the agent identity is the one the operator
sets in Las's environment as `SKARBIEC_MCP_AGENT_ID`; Las forwards that variable,
and only that one, to the broker. At `initialize`:

- a client that sends no `agentId` (omp, Claude Code, Codex and other standard
  MCP clients) runs as `SKARBIEC_MCP_AGENT_ID`;
- a client that sends the same `agentId` is admitted;
- a client that sends a different `agentId` is refused (-32600, `agent identity
  rejected: …`);
- with `SKARBIEC_MCP_AGENT_ID` unset, every client is refused (-32600, `agent
  identity is not configured: … set SKARBIEC_MCP_AGENT_ID …`).

Give each agent harness its own Las server entry with its own identity, for
example in `.mcp.json`:

```json
{ "mcpServers": { "las": { "command": "las-mcp",
  "env": { "SKARBIEC_MCP_AGENT_ID": "zuzanna-omp", "SKARBIEC_MCP_HARNESS": "omp", "SKARBIEC_MCP_PERSON": "zuzanna" } } } }
```

## Skarbiec: requesting access

Skarbiec is launched as `skarbiec/target/release/skarbiec mcp broker` from the
workspace and serves exactly these tools, in this order:

| Tool | Arguments | Answer (JSON text) |
|---|---|---|
| `skarbiec__health` | none | `{ok, service, wire, policy_sequence, registry_sequence, active_capabilities, anomaly_count}` |
| `skarbiec__capability_available` | `purpose, resource, target, ttl_seconds, max_uses` | `{available}` |
| `skarbiec__capability_request` | as above, plus optional `delegation_depth` | `{status:"issued", capability_id}` or `{status:"pending", request_id}` |
| `skarbiec__access_request_status` | `request_id` | `{request_id, state:"pending"\|"denied"\|"withdrawn"}` or `{request_id, state:"approved", capability_id}` |

A `capability_request` no grant covers files an access request in Skarbiec's
register and answers `pending` with its UUID; the decider approves or denies it
(`skarbiec request approve|deny`, or the dialog/ask Skarbiec shows them). The
agent then polls `access_request_status` with that `request_id`; once approved
it carries the capability ID, whose redemption proof must sign the
`request_id` as its authorization ID. An agent sees only the requests filed
under its own identity. Las checks the arguments' shape and taxonomy and admits
only these exact answers; a `request_id` must be a lowercase UUID, a
`capability_id` 64 lowercase hex digits, and a status answer must name the
`request_id` it was asked about.

A rebuilt Skarbiec, or this tool set on an older manifest, needs a newly
signed manifest with a higher sequence: see [release-signing.md](release-signing.md).

## Every request is answered

Every message that names an `id` is answered, so no client waits on a request
Las cannot serve:

- a line that is not JSON gets a parse error (-32700) with the parser's cause,
  and a line that is not one JSON object an invalid request (-32600), both with
  a `null` id;
- a request whose `method` is missing or not a non-empty string gets an invalid
  request (-32600);
- `tools/call` without `params.name`, or with onboarding arguments other than
  an optional string `action`, gets invalid params (-32602); `las__onboarding`
  without an action runs `show`, the default its schema declares;
- a request Las fails to answer gets -32000 naming Las's own cause.

A child surface's failures are named on stderr (`surface '<name>' unavailable:
…`) and in the `surface request failed: …` error by Las's cause: its release,
policy, launch, exit or protocol breach. A JSON-RPC error the child answered is
named by its code only; its text is withheld, and child stderr is discarded.

A child line must decode to a JSON-RPC object with the declared version.
Non-object values, wrong versions, and responses without a string or numeric
request id or exactly one of `result` and `error` fail all pending calls.
An error response must carry an integer code and a string message. Las reports
the surface and invalid envelope or response, never the child-controlled payload.
Valid method messages remain separate from responses; they cannot settle a
pending call. Once a protocol failure occurs, later calls on that connection
are refused instead of waiting for another answer.

`node tests/mcp/requests.mjs` runs the server from the declared revision's
committed source, taken out of git into its run directory, with no surface
federated, and checks each of these answers. It takes
`LAS_TEST_SOURCE_REVISION`, `LAS_TEST_SUCCESS_EXIT` and `LAS_TEST_REFUSAL_EXIT`
and keeps its commands, output and verdict under `.build/mcp-requests/`. It does
not qualify a federated child. `node tests/mcp/skarbiec.mjs` (same variables,
run directory `.build/mcp-skarbiec/`) builds a stand-in broker where the
committed registry launches Skarbiec, describes, signs and trusts it with `las
release`, and checks the identity rule above, a `pending` request and
`access_request_status`. Every Las journey (these,
`tests/catalog/load.mjs`, `tests/onboarding/state.mjs`) also writes the report a
defect register takes as a repair's evidence when `LAS_JOURNEY_REPORT` names a
path, with `LAS_JOURNEY_SUBJECT` naming the defect and `LAS_JOURNEY_CRITERION`
its completion criterion word for word.

## Namespacing

A child tool `health` from surface `most` becomes:

```text
most__health
```

Las removes ambiguity with a double-underscore separator. The remote child still
receives its original `health` name.
