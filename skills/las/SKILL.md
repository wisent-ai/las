---
name: las
description: Use las to see and reach the whole Wisent agent ecosystem from one place. las federates every sibling agent surface — weles, skarbiec, stado, lem, echo, most, probierz, byk, brama — into a single stdio MCP server and a single CLI by spawning each child's own MCP server and re-exposing its tools under a namespace prefix. Use it when a task spans more than one product, when you want one tool list for the whole ecosystem, or when you want a connectivity check across every surface. las only proxies; it never widens any child's own security boundary.
---

# las

las (Polish for "forest") is the aggregator that gathers every tree in the
Wisent agent ecosystem into one canopy. Each sibling product already ships its
own agent surface — a CLI, a stdio Model Context Protocol server, and a
SKILL.md. las does not reimplement any of them. It spawns each child's MCP
server, performs the standard handshake, and re-exposes every child tool under
a `<surface>__<tool>` namespace so names never collide.

## Federated surfaces

| Surface | What it is | Boundary |
| --- | --- | --- |
| `weles` | Anti-detect browser automation | Runs only on its dedicated host |
| `skarbiec` | Credential vault | Read-only, token-gated resolve |
| `stado` | GPU job queue | Read-only status, cost, quota, schedules |
| `lem` | Research-paper manager | Read-only registry and provenance |
| `echo` | Growth and content dashboard | Read-only Supabase reads |
| `most` | iMessage, RCS, and SMS bridge | Read-only health and diagnostics |
| `probierz` | Cross-platform test toolkit | Read-only surface/spec discovery and run commands |
| `byk` | Founder strategy tool (Oko) | Read-only org roster, auto-goals, velocity |
| `brama` | Multi-provider LLM gateway (formerly model-router) | Read-only hardware detect and model list |

The registry that maps each surface to its launch command is the single source
of truth: `src/registry.mjs`. It derives the workspace root from its own
location, so las is portable across checkouts.

## CLI

```bash
las list                 # every federated surface plus a one-line summary
las tools [surface...]   # advertised tools, spawning each child to ask
las check [surface...]   # connectivity: spawn plus initialize handshake
```

With no surface arguments, `tools` and `check` cover every active surface.

## MCP

Run the stdio server with:

```bash
las-mcp
# or
node src/mcp.mjs
```

It speaks the same protocol every child speaks: `initialize`, `ping`,
`tools/list`, and `tools/call`. A request that arrives without an `id` key is a
notification and is never answered. On first use las lazily spawns each active
child, handshakes, and aggregates their tools. A `tools/call` for
`<surface>__<tool>` is routed to the owning child unchanged; the child's own
result and errors are passed straight back.

## Scoping to a host

Not every surface can run on every machine — `weles`, for instance, is pinned
to its own host. Two environment variables scope which surfaces las activates:

- `LAS_ONLY` — a comma-separated allow-list; only these surfaces are active.
- `LAS_SKIP` — a comma-separated deny-list, applied when `LAS_ONLY` is absent.

A surface that cannot be reached is reported on stderr and omitted from the
aggregated tool list. Its absence is explicit; las never substitutes a
stand-in for a missing child.

## Operational rules

- Keep MCP and CLI stdout clean: only JSON-RPC frames and command output go to
  stdout; every diagnostic goes to stderr. las never forwards a child's stderr
  to its own stdout.
- las is a proxy. It re-exposes exactly what each child advertises and routes
  calls verbatim; it never adds a tool, and it never widens a child's own
  security boundary. A read-only child stays read-only through las.
- The registry is the single source of truth for which surfaces exist and how
  to launch them. To add a surface, add an entry there — do not scatter launch
  commands across the server and the CLI.
- Children are spawned lazily and closed when the stream closes, so las holds
  no long-lived child processes beyond the life of its own session.
