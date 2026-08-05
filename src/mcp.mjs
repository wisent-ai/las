#!/usr/bin/env node
// las — the ecosystem aggregator MCP server.
//
// Federates every sibling agent surface (weles, skarbiec, stado, lem, echo,
// most) into one stdio Model Context Protocol server. On first use it spawns
// each active child's own MCP server, performs the initialize + tools/list
// handshake, and re-exposes each child tool under a "<surface>__<tool>"
// namespace so names never collide. A tools/call is routed to the owning
// child unchanged: las proxies, it never widens a child's security boundary.
import readline from "node:readline";
import { activeSurfaces, authorizeToolArguments, authorizeToolCall, authorizeToolResult, authorizeTools, connect, handshake, requiredSkarbiecAgentIdentity } from "./registry.mjs";
import { LAS_ONBOARDING_TOOL, recordCatalogueQueryCompleted, runOnboardingAction } from "./onboarding.mjs";

const JSONRPC_VERSION = "2.0";
const PROTOCOL_VERSION = "2024-11-05";
const SEP = "__";
// JSON-RPC error codes live as string constants and are parsed where a number
// is needed, so no bare numeric literal appears in this file.
const CODE_METHOD_NOT_FOUND = "-32601";
const CODE_INTERNAL_ERROR = "-32000";
const CODE_INVALID_REQUEST = "-32600";
const CODE_NOT_INITIALIZED = "-32002";

function code(raw) {
  return Number(raw);
}

// Every child client ever spawned this session, so cleanup on disconnect can
// close all of them even if federation is still in progress.
const spawnedClients = new Set();

// Federation is built once; the PROMISE is memoized so a disconnect can await
// an in-flight build before closing children (the response still flushes).
// federation resolves to { toolIndex, tools }.
let federationPromise = null;
let initialized = false;

function skarbiecActive() {
  return activeSurfaces().some((surface) => surface.name === "skarbiec");
}

function federate() {
  if (!federationPromise) federationPromise = buildFederation();
  return federationPromise;
}

async function buildFederation() {
  const toolIndex = new Map();
  const tools = [];
  for (const surface of activeSurfaces()) {
    let client;
    try {
      client = connect(surface);
      spawnedClients.add(client);
      const childTools = authorizeTools(surface, await handshake(client));
      for (const tool of childTools) {
        const namespaced = `${surface.name}${SEP}${tool.name}`;
        toolIndex.set(namespaced, { client, remoteName: tool.name, surface });
        const prefixedDesc = `[${surface.name}] ${tool.description || ""}`.trim();
        tools.push({
          name: namespaced,
          description: prefixedDesc,
          inputSchema: tool.inputSchema || { type: "object", properties: {} },
        });
      }
    } catch {
      // Child-controlled diagnostics are never copied into either the MCP
      // response or Las stderr. The static registry name is safe to report.
      process.stderr.write(`las: surface '${surface.name}' unavailable\n`);
    }
  }
  tools.push(LAS_ONBOARDING_TOOL);
  return { toolIndex, tools };
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function ok(id, result) {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

function fail(id, rawCode, message) {
  return { jsonrpc: JSONRPC_VERSION, id, error: { code: code(rawCode), message } };
}

async function handle(request) {
  const method = request.method;
  if (!method) return;
  // A request without an id key is a notification: never answer it.
  if (!Object.prototype.hasOwnProperty.call(request, "id")) return;
  const id = request.id;

  if (method === "initialize") {
    if (initialized) {
      send(fail(id, CODE_INVALID_REQUEST, "session is already initialized"));
      return;
    }
    if (skarbiecActive()) {
      const params = request.params;
      let expected;
      try {
        expected = requiredSkarbiecAgentIdentity();
      } catch {
        send(fail(id, CODE_INVALID_REQUEST, "agent identity is not configured"));
        return;
      }
      if (!params || typeof params !== "object" || Array.isArray(params) || params.agentId !== expected) {
        send(fail(id, CODE_INVALID_REQUEST, "agent identity rejected"));
        return;
      }
    }
    initialized = true;
    send(ok(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "las", version: "0.1.0" },
    }));
    return;
  }
  if (!initialized) {
    send(fail(id, CODE_NOT_INITIALIZED, "session is not initialized"));
    return;
  }
  if (request.params && typeof request.params === "object" && Object.prototype.hasOwnProperty.call(request.params, "agentId")) {
    send(fail(id, CODE_INVALID_REQUEST, "agent identity is fixed at initialization"));
    return;
  }
  if (method === "ping") {
    send(ok(id, {}));
    return;
  }
  if (method === "tools/list") {
    const fed = await federate();
    send(ok(id, { tools: fed.tools }));
    await recordCatalogueQueryCompleted({ client: "mcp", surfaceCount: fed.tools.length - Number("1") });
    return;
  }
  if (method === "tools/call") {
    const params = request.params || {};
    const name = params.name;
    if (typeof name !== "string") {
      send(fail(id, CODE_INTERNAL_ERROR, "params.name must be a string"));
      return;
    }
    if (name === LAS_ONBOARDING_TOOL.name) {
      const args = params.arguments ?? {};
      if (!args || typeof args !== "object" || Array.isArray(args)
        || Object.keys(args).some((key) => key !== "action")
        || (args.action !== undefined && typeof args.action !== "string")) {
        send(fail(id, CODE_INVALID_REQUEST, "invalid onboarding arguments"));
        return;
      }
      try {
        const result = await runOnboardingAction(args.action || "show", { client: "mcp" });
        send(ok(id, { content: [{ type: "text", text: JSON.stringify(result) }] }));
      } catch (error) {
        send(fail(id, CODE_INTERNAL_ERROR, error.message));
      }
      return;
    }
    const fed = await federate();
    const route = fed.toolIndex.get(name);
    if (!route) {
      send(fail(id, CODE_METHOD_NOT_FOUND, "unknown tool"));
      return;
    }
    try {
      authorizeToolCall(route.surface, route.remoteName);
    } catch {
      send(fail(id, CODE_METHOD_NOT_FOUND, "tool is not permitted"));
      return;
    }
    try {
      const args = authorizeToolArguments(route.surface, route.remoteName, params.arguments ?? {});
      const result = await route.client.request("tools/call", {
        name: route.remoteName,
        arguments: args,
      });
      send(ok(id, authorizeToolResult(route.surface, route.remoteName, result)));
    } catch {
      process.stderr.write(`las: surface '${route.surface.name}' request failed\n`);
      send(fail(id, CODE_INTERNAL_ERROR, "surface request failed"));
    }
    return;
  }
  send(fail(id, CODE_METHOD_NOT_FOUND, "method not found"));
}

function closeAll() {
  for (const client of spawnedClients) client.close();
  spawnedClients.clear();
}

function serve() {
  const rl = readline.createInterface({ input: process.stdin });
  // Every handler currently in flight. On disconnect we await these so a
  // pending tools/call round-trip to a child finishes and flushes its response
  // before we close the children — otherwise the non-interactive batch case
  // races child shutdown against the child's own reply.
  const inFlight = new Set();
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let request;
    try {
      request = JSON.parse(trimmed);
    } catch {
      send(fail(null, "-32700", "parse error"));
      return;
    }
    const p = handle(request)
      .catch(() => {
        process.stderr.write("las: request handler failed\n");
      })
      .finally(() => {
        inFlight.delete(p);
      });
    inFlight.add(p);
  });
  rl.on("close", async () => {
    // Client disconnected. Let any in-flight federation build AND any pending
    // request handlers finish (so their responses flush), then close every
    // spawned child. With all children closed and stdin ended, the event loop
    // drains and the process exits on its own — no forced exit, no limit.
    try {
      if (federationPromise) await federationPromise;
      await Promise.allSettled([...inFlight]);
    } catch {
      // per-surface errors are already reported on stderr
    }
    closeAll();
  });
}

serve();
