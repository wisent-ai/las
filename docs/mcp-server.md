# MCP server reference

`las-mcp` (`src/mcp.mjs`) is the aggregator MCP server: one stdio endpoint
that re-exposes every active child surface. It reads one JSON-RPC 2.0 request
per stdin line and writes one response per stdout line. Protocol version is
`2024-11-05`. Stdout stays a clean protocol stream; availability notes go to
stderr.

## Supported methods

The server implements four methods — not the entire MCP protocol surface:

| Method | Behavior |
|---|---|
| `initialize` | Exactly once per session. Returns `protocolVersion`, `capabilities: { tools: {} }`, and `serverInfo` (`las`, `0.1.0`). A second `initialize` fails with `-32600`. |
| `ping` | Returns `{}`. |
| `tools/list` | Builds (or reuses) the federation and returns every namespaced child tool plus `las__onboarding`. |
| `tools/call` | Routes to the owning child after policy checks. |

Anything else fails with `-32601` (method not found). A request before
`initialize` fails with `-32002`. A line that is not valid JSON fails with
`-32700`. A message without an `id` key is a notification and receives no
response.

## Agent identity

When the `skarbiec` surface is active, `initialize` params must be an object
whose `agentId` equals the configured `SKARBIEC_MCP_AGENT_ID`; otherwise
initialization fails with `-32600` (`agent identity rejected`, or
`agent identity is not configured` when the variable is unset). After
initialization, any request whose params carry an `agentId` key fails —
identity is fixed at initialization.

## Federation and namespacing

The federation is built once per process, on the first `tools/list` or
routed `tools/call`, and memoized. For each active surface Las spawns the
child, performs the verified handshake, and lists each signed tool as:

- `name` — `<surface>__<tool>` (double-underscore separator, so names never
  collide);
- `description` — the child description prefixed with `[<surface>]`;
- `inputSchema` — the child's advertised schema (already verified against
  the signed digest), or `{ type: "object", properties: {} }` when absent.

A surface that fails to spawn, handshake, or verify is omitted, and Las
writes only `las: surface '<name>' unavailable` to stderr — child
diagnostics are never copied into the MCP response or Las stderr. Child
changes are not hot-reloaded; restart the process to rebuild the federation.

## tools/call

`params.name` must be a string naming a federated tool; an unknown name
fails with `-32601`. The call then passes the policy gates described in
[federation and policy](federation-and-policy.md): the tool must be
permitted by signed/local policy, signed credential templates are injected
over the model arguments (a model argument with a template's name is
rejected), Skarbiec arguments and results are strictly validated, and the
child receives its original un-namespaced tool name with the call otherwise
unchanged. A child failure returns the generic `-32000`
`surface request failed`; the surface name alone goes to stderr. Las imposes
no timeout — a child that never answers keeps the call in flight.

## las__onboarding

The one tool Las serves itself, always appended to `tools/list`:

```json
{
  "name": "las__onboarding",
  "inputSchema": {
    "type": "object",
    "properties": {
      "action": { "type": "string", "enum": ["show", "status", "advance", "skip", "reset"], "default": "show" }
    },
    "additionalProperties": false
  }
}
```

Arguments may contain only the optional string `action`; anything else fails
with `-32600`. The result is a text content block containing the onboarding
view as JSON. A successful MCP `tools/list` counts as the catalogue query
that completes the journey — same journey as `las onboarding` in
[cli](cli.md).

## Shutdown

When client stdin closes, Las awaits any in-flight federation build and
pending request handlers so their responses flush, then closes every spawned
child. With children closed and stdin ended, the event loop drains and the
process exits on its own — no forced exit.
