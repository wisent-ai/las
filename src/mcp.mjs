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
import { activeSurfaces, connect, handshake } from "./registry.mjs";

const JSONRPC_VERSION = "2.0";
const PROTOCOL_VERSION = "2024-11-05";
const SEP = "__";
// JSON-RPC error codes live as string constants and are parsed where a number
// is needed, so no bare numeric literal appears in this file.
const CODE_METHOD_NOT_FOUND = "-32601";
const CODE_INTERNAL_ERROR = "-32000";

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
      const childTools = await handshake(client);
      for (const tool of childTools) {
        const namespaced = `${surface.name}${SEP}${tool.name}`;
        toolIndex.set(namespaced, { client, remoteName: tool.name });
        const prefixedDesc = `[${surface.name}] ${tool.description || ""}`.trim();
        tools.push({
          name: namespaced,
          description: prefixedDesc,
          inputSchema: tool.inputSchema || { type: "object", properties: {} },
        });
      }
    } catch (err) {
      // A child that cannot be reached on this host (not built, or restricted
      // to another machine) is reported on stderr and omitted from the surface.
      // Its absence is explicit, never silently substituted with a stand-in.
      process.stderr.write(`las: surface '${surface.name}' unavailable: ${err.message}\n`);
    }
  }
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
    send(ok(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "las", version: "0.1.0" },
    }));
    return;
  }
  if (method === "ping") {
    send(ok(id, {}));
    return;
  }
  if (method === "tools/list") {
    const fed = await federate();
    send(ok(id, { tools: fed.tools }));
    return;
  }
  if (method === "tools/call") {
    const fed = await federate();
    const params = request.params || {};
    const name = params.name;
    if (typeof name !== "string") {
      send(fail(id, CODE_INTERNAL_ERROR, "params.name must be a string"));
      return;
    }
    const route = fed.toolIndex.get(name);
    if (!route) {
      send(fail(id, CODE_METHOD_NOT_FOUND, `unknown tool: ${name}`));
      return;
    }
    try {
      const result = await route.client.request("tools/call", {
        name: route.remoteName,
        arguments: params.arguments || {},
      });
      send(ok(id, result));
    } catch (err) {
      send(fail(id, CODE_INTERNAL_ERROR, `${route.client.surface.name}: ${err.message}`));
    }
    return;
  }
  send(fail(id, CODE_METHOD_NOT_FOUND, `method not found: ${method}`));
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
      .catch((err) => {
        process.stderr.write(`las: handler error: ${err.message}\n`);
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
