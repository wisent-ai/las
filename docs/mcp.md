# The Las MCP server

`las-mcp` (`node src/mcp.mjs` from source) is one stdio MCP server that
federates every configured, signed surface.

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
request may not replace `agentId`; when Skarbiec is active, initialization must
provide the exact `SKARBIEC_MCP_AGENT_ID`.

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

`node tests/mcp/requests.mjs` runs the server from the declared clean source
with no surface federated and checks each of these answers. It takes
`LAS_TEST_SOURCE_REVISION`, `LAS_TEST_SUCCESS_EXIT` and `LAS_TEST_REFUSAL_EXIT`
and keeps its commands, output and verdict under `.build/mcp-requests/`. It does
not qualify a federated child.

## Namespacing

A child tool `health` from surface `most` becomes:

```text
most__health
```

Las removes ambiguity with a double-underscore separator. The remote child still
receives its original `health` name.
