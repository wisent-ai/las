#!/bin/sh
# mcp-session.sh — one scripted las-mcp session over stdio: initialize,
# list the federated catalogue, call one federated tool.
# Requires the four LAS_RELEASE_* variables to point at valid release
# material admitting the brama surface (docs/examples/mint-toy-release.mjs).
# Run from the las repository root: sh docs/examples/mcp-session.sh
set -eu

# las-mcp reads one JSON-RPC 2.0 request per stdin line and writes one
# response per stdout line. initialize must come first and exactly once;
# when the skarbiec surface is active the params must also carry
# "agentId": "$SKARBIEC_MCP_AGENT_ID".
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"mcp-session.sh","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"brama__brama_detect","arguments":{}}}' \
  | node src/mcp.mjs
