# MCP server reference

`las-mcp` (`src/mcp.mjs`) is the aggregator MCP server: one stdio endpoint
that re-exposes every active child surface. It reads one JSON-RPC 2.0 request
per stdin line and writes one response per stdout line; protocol version
`2024-11-05`. Stdout stays a protocol-pure stream; availability notes go to
stderr. Every response and error sentence on this page was captured from a
real session ([walkthrough-federated-session](walkthrough-federated-session.md)).

## Supported methods

Four methods — not the entire MCP protocol surface:

| Method | Behavior |
|---|---|
| `initialize` | Exactly once per session. Returns `protocolVersion: "2024-11-05"`, `capabilities: { tools: {} }`, `serverInfo: { name: "las", version: "0.1.0" }`. |
| `ping` | Returns `{}`. |
| `tools/list` | Builds (or reuses) the federation; returns every namespaced child tool plus `las__onboarding`. |
| `tools/call` | Routes to the owning child after the policy gates. |

A message without an `id` key is a notification and receives no response.
Responses are written in **completion order**, not request order: handlers
run concurrently, and a `tools/call` that triggers the federation build
answers after later cheap requests. Match on `id`.

## Errors

Captured code → sentence table (meanings in the [runbook](runbook.md#an-mcp-request-is-refused)):

| Code | Sentence |
|---|---|
| `-32700` | `parse error` |
| `-32002` | `session is not initialized` |
| `-32600` | `session is already initialized` |
| `-32600` | `agent identity is not configured` / `agent identity rejected` |
| `-32600` | `agent identity is fixed at initialization` |
| `-32600` | `invalid onboarding arguments` |
| `-32601` | `method not found` |
| `-32601` | `unknown tool` / `tool is not permitted` |
| `-32000` | `params.name must be a string` / `surface request failed` |

## Agent identity

When the `skarbiec` surface is active, `initialize` params must be an object
whose `agentId` equals `SKARBIEC_MCP_AGENT_ID`; otherwise initialization
fails with `-32600` (`agent identity rejected`, or `agent identity is not
configured` when the variable is unset). After initialization, **any**
request whose params carry an `agentId` key is refused — identity is fixed at
initialization, and the check applies even when skarbiec is inactive
(captured: id 8 in the walkthrough).

## Federation and namespacing

The federation is built once per process, on the first `tools/list` or
routed `tools/call`, and memoized ([concepts/surface](concepts/surface.md)).
For each active surface Las spawns the child, performs the verified
handshake, and lists each signed tool as:

- `name` — `<surface>__<tool>` (double underscore, so names never collide);
- `description` — the child description prefixed `[<surface>] `; for
  skarbiec, Las's own pinned descriptions replace the child's;
- `inputSchema` — the child's advertised schema, already verified against
  the signed digest (`{ type: "object", properties: {} }` when absent).

A surface that fails to spawn, handshake, or verify is omitted; Las writes
only `las: surface '<name>' unavailable` to stderr — child diagnostics are
never copied into the MCP response or Las stderr. Child changes are not
hot-reloaded; restart to rebuild the federation.

## tools/call

`params.name` must be a string naming a federated tool (`-32601 unknown
tool` otherwise — including for surfaces that failed to federate). The call
then passes the [policy gates](concepts/policy.md): signed/local tool
permission (`-32601 tool is not permitted`), argument authorization with
credential-template injection, and — for skarbiec — strict argument and
result validation. The child receives its original un-namespaced tool name
with the call otherwise unchanged. A child failure returns the generic
`-32000 surface request failed`; the surface name alone goes to stderr
(`las: surface '<name>' request failed`). Las imposes no timeout — a child
that never answers keeps the call in flight
([runbook](runbook.md#a-call-hangs-forever)).

## las__onboarding

The one tool Las serves itself, always appended to `tools/list`:

```json
{
  "name": "las__onboarding",
  "description": "Run Las first-use onboarding for the federated catalogue, then complete it by making a real tools/list catalogue query.",
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
with `-32600 invalid onboarding arguments`. The result is one text content
block containing the onboarding view as JSON. A successful MCP `tools/list`
counts as the catalogue query that completes the journey — the same journey
as `las onboarding` ([concepts/onboarding](concepts/onboarding.md)).

## Shutdown

When client stdin closes, Las awaits any in-flight federation build and
pending request handlers so their responses flush, then closes every spawned
child. With children closed and stdin ended, the event loop drains and the
process exits on its own — no forced exit. Captured: a nine-request batch
whose stdin closed immediately still received all nine responses.
