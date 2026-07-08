// Registry of the child agent surfaces that las federates, plus the stdio
// JSON-RPC client used to reach each one.
//
// las (Polish for "forest") gathers every sibling agent surface into a single
// tree: weles, skarbiec, stado, lem, echo, most. Each child already speaks the
// Model Context Protocol over stdio; las only spawns a child, performs the
// initialize + tools/list handshake, and routes calls. It never widens any
// child's own security boundary — a read-only child stays read-only here.
import { spawn } from "node:child_process";
import readline from "node:readline";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// las/src -> las -> Wisent workspace root shared by every sibling project.
const ROOT = path.resolve(HERE, "..", "..");

// One entry per federated surface. `command`+`args` launch that surface's MCP
// server; `cwd` is its project root; `summary` is a one-line human hint.
export const SURFACES = [
  {
    name: "weles",
    command: process.execPath,
    args: [path.join(ROOT, "weles", "dist", "mcp.js")],
    cwd: path.join(ROOT, "weles"),
    summary: "Anti-detect browser automation. Runs only on its dedicated host.",
  },
  {
    name: "skarbiec",
    command: path.join(
      ROOT,
      "entitlements-rotator",
      "target",
      "debug",
      "skarbiec-entitlements-router",
    ),
    args: ["mcp"],
    cwd: path.join(ROOT, "entitlements-rotator"),
    summary: "Credential vault. Read-only, token-gated resolve.",
  },
  {
    name: "stado",
    command: "python3",
    args: ["-m", "stado.mcp.server"],
    cwd: path.join(ROOT, "wisent-compute"),
    summary: "GPU job queue. Read-only status, cost, quota, schedules.",
  },
  {
    name: "lem",
    command: path.join(ROOT, "lem-desktop", ".build", "debug", "LemMCP"),
    args: [],
    cwd: path.join(ROOT, "lem-desktop"),
    summary: "Research-paper manager. Read-only registry + provenance.",
  },
  {
    name: "echo",
    command: process.execPath,
    args: [path.join(ROOT, "echo", "agent", "mcp.mjs")],
    cwd: path.join(ROOT, "echo"),
    summary: "Growth/content dashboard. Read-only Supabase reads.",
  },
  {
    name: "most",
    command: "python3",
    args: [path.join(ROOT, "most", "most_agent", "mcp_server.py")],
    cwd: path.join(ROOT, "most"),
    summary: "iMessage/RCS/SMS bridge. Read-only health + diagnostics.",
  },
  {
    name: "probierz",
    command: process.execPath,
    args: [path.join(ROOT, "probierz", "agent", "mcp.mjs")],
    cwd: path.join(ROOT, "probierz"),
    summary: "Cross-platform test toolkit. Discovery (surfaces/specs/run commands) + execution: run a target under chosen conditions, record video/trace/screenshots, analyze the result.",
  },
  {
    name: "byk",
    command: path.join(ROOT, "swiatowid", ".build", "debug", "oko-mcp"),
    args: [],
    cwd: path.join(ROOT, "swiatowid"),
    summary: "Founder strategy tool (Oko). Read-only org roster, auto-goals, velocity.",
  },
  {
    name: "brama",
    command: path.join(ROOT, "brama", "target", "debug", "brama"),
    args: ["mcp"],
    cwd: path.join(ROOT, "brama"),
    summary: "Multi-provider LLM gateway (formerly model-router). Read-only hardware detect + model list.",
  },
];

// Which surfaces are active this run. LAS_ONLY is a comma-separated allow-list;
// LAS_SKIP is a comma-separated deny-list applied when LAS_ONLY is absent.
export function activeSurfaces() {
  const only = (process.env.LAS_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (only.length) {
    const wanted = new Set(only);
    return SURFACES.filter((s) => wanted.has(s.name));
  }
  const skip = new Set((process.env.LAS_SKIP || "").split(",").map((s) => s.trim()).filter(Boolean));
  return SURFACES.filter((s) => !skip.has(s.name));
}

const JSONRPC_VERSION = "2.0";
const PROTOCOL_VERSION = "2024-11-05";

// Spawn a child surface's MCP server and return a small JSON-RPC client:
// { surface, request(method, params) -> Promise<result>, close() }.
// Resolution is completion-based: a pending request settles when the child
// answers, or rejects if the child errors or exits first. No limit is imposed
// on how long a child may take — it runs to completion.
export function connect(surface) {
  const child = spawn(surface.command, surface.args, {
    cwd: surface.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...(surface.env || {}) },
  });

  const pending = new Map();
  let fatal = null;

  function failAll(err) {
    fatal = err;
    for (const entry of pending.values()) entry.reject(err);
    pending.clear();
  }

  child.on("error", (err) => failAll(err));
  child.on("exit", (codeVal) => {
    if (pending.size) failAll(new Error(`${surface.name} exited (${codeVal})`));
  });
  // Child diagnostics belong on its own stderr; las does not forward them to
  // its stdout, which must stay a clean protocol stream.
  child.stderr.on("data", () => {});

  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }
    const rid = msg && msg.id;
    if (rid === undefined || rid === null) return;
    const entry = pending.get(rid);
    if (!entry) return;
    pending.delete(rid);
    if (msg.error) entry.reject(new Error(msg.error.message || "child error"));
    else entry.resolve(msg.result);
  });

  function request(method, params) {
    return new Promise((resolve, reject) => {
      if (fatal) {
        reject(fatal);
        return;
      }
      const id = randomUUID();
      pending.set(id, { resolve, reject });
      const payload = JSON.stringify({ jsonrpc: JSONRPC_VERSION, id, method, params: params || {} });
      child.stdin.write(payload + "\n");
    });
  }

  function close() {
    try { rl.close(); } catch { /* already closed */ }
    try { child.stdin.end(); } catch { /* already ended */ }
    try { child.kill(); } catch { /* already gone */ }
  }

  return { surface, request, close };
}

// Standard MCP handshake against a connected child: initialize, then list its
// tools. Returns the child's tool array (possibly empty).
export async function handshake(client) {
  await client.request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "las", version: "0.1.0" },
  });
  const result = await client.request("tools/list", {});
  return (result && result.tools) || [];
}
