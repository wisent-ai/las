# Walkthrough: a federated MCP session

What does the federated surface actually look like on the wire? This page is
one real `las-mcp` session plus its refusal paths, executed on 2026-08-24
with Node v22.20.0 against the toy release from
[walkthrough-onboard-a-surface](walkthrough-onboard-a-surface.md) (admitting
only `brama`). Requests were piped one per line into `node src/mcp.mjs`;
responses are pasted verbatim. The method contract is
[mcp-server](mcp-server.md).

## The happy path: initialize, list, call

Input (three lines; `docs/examples/mcp-session.sh` scripts exactly this):

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"docs","version":"0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"brama__brama_detect","arguments":{}}}
```

Output:

```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"las","version":"0.1.0"}}}
{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"brama__brama_detect","description":"[brama] Detect local compute resources (GPU type/name, VRAM, RAM, CPU cores, CUDA/Metal) and the model + backend brama would recommend for this host. Local only; no network, no credentials, no cost.","inputSchema":{"properties":{},"required":[],"type":"object"}},{"name":"las__onboarding","description":"Run Las first-use onboarding for the federated catalogue, then complete it by making a real tools/list catalogue query.","inputSchema":{"type":"object","properties":{"action":{"type":"string","enum":["show","status","advance","skip","reset"],"default":"show"}},"additionalProperties":false}}]}}
{"jsonrpc":"2.0","id":3,"result":{"content":[{"text":"{\n  \"cpu_cores\": 12,\n  \"gpu_name\": null,\n  \"gpu_type\": \"apple_silicon\",\n  \"has_cuda\": false,\n  \"has_metal\": true,\n  \"ram_gb\": 64.0,\n  \"recommended_backend\": \"featherless\",\n  \"recommended_model\": \"cydonia-24b\",\n  \"vram_gb\": 0.0\n}","type":"text"}]}}
```

Reading it:

- `tools/list` carries exactly the signed federation — brama's one tool under
  its `brama__` namespace with the `[brama]` description prefix — plus Las's
  own `las__onboarding`, always appended last.
- The `tools/call` was routed to the child as `brama_detect` (original name)
  and its result passed through unchanged. The hardware summary is the
  child's answer about the workstation the session ran on.
- Nothing appeared on stderr: every admitted surface built cleanly.

## Every refusal path, one session

Input lines 1–9 against the same release (line 2 is deliberately not JSON):

```text
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
not json
{"jsonrpc":"2.0","id":2,"method":"initialize","params":{…}}
{"jsonrpc":"2.0","id":3,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":4,"method":"ping"}
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"weles__browser_open","arguments":{}}}
{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"las__onboarding","arguments":{"bogus":true}}}
{"jsonrpc":"2.0","id":7,"method":"resources/list"}
{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"brama__brama_detect","arguments":{},"agentId":"x"}}
```

Output, verbatim and in the order it arrived:

```json
{"jsonrpc":"2.0","id":1,"error":{"code":-32002,"message":"session is not initialized"}}
{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"parse error"}}
{"jsonrpc":"2.0","id":2,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"las","version":"0.1.0"}}}
{"jsonrpc":"2.0","id":3,"error":{"code":-32600,"message":"session is already initialized"}}
{"jsonrpc":"2.0","id":4,"result":{}}
{"jsonrpc":"2.0","id":6,"error":{"code":-32600,"message":"invalid onboarding arguments"}}
{"jsonrpc":"2.0","id":7,"error":{"code":-32601,"message":"method not found"}}
{"jsonrpc":"2.0","id":8,"error":{"code":-32600,"message":"agent identity is fixed at initialization"}}
{"jsonrpc":"2.0","id":5,"error":{"code":-32601,"message":"unknown tool"}}
```

Reading it:

- Request before `initialize` → `-32002`; second `initialize` → `-32600`.
- `weles__browser_open` (id 5) is refused as `unknown tool` — weles is not in
  this release, so it never federated. Note *where* the response landed:
  last. Id 5 triggered the federation build (spawning brama), so ids 6–8
  answered first. **Responses are ordered by completion, not by request** —
  match on `id`, never on line order.
- An `agentId` key anywhere after initialization is refused (id 8), even with
  no skarbiec surface active.

## What an unavailable surface looks like

Same session shape, but run with a release whose signed binary digest no
longer matches (a rebuilt child): federation omits the surface, stderr names
it — and nothing else — and `tools/list` still answers.

```text
las: surface 'brama' unavailable        # ← stderr
```

```json
{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"las__onboarding","description":"Run Las first-use onboarding for the federated catalogue, then complete it by making a real tools/list catalogue query.","inputSchema":{…}}]}}
```

A partial catalogue is a normal state; the symptom-to-cause table is in the
[runbook](runbook.md). To see the drift *named*, use the CLI:
`las check brama` → `{"ok": false, "error": "brama: release binary digest
mismatch"}` with exit 1.

## Session identity, when Skarbiec is admitted

This session ran without `skarbiec`, so `initialize` needed no identity. When
the skarbiec surface is active, the same first line must carry
`"agentId": "<SKARBIEC_MCP_AGENT_ID>"` in `params`, or initialization refuses
with `-32600 agent identity rejected` (`agent identity is not configured`
when the variable is unset) — see [concepts/policy](concepts/policy.md).

## Shutdown

Closing stdin after the last request lets pending handlers flush their
responses, then Las closes every spawned child and the process exits on its
own — visible above in that all nine responses arrived even though stdin
closed immediately after the ninth request line.
