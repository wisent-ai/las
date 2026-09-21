// The stdio JSON-RPC client las reaches one child surface with: spawn it,
// read one response per line, and perform the MCP handshake.
//
// Split out of `src/registry.mjs`, which had grown past the
// three-hundred-line limit; which surfaces exist, and what each one is
// allowed to advertise, stay there.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import readline from "node:readline";

const JSONRPC_VERSION = "2.0";
const PROTOCOL_VERSION = "2024-11-05";
const CLIENT_NAME = "las";
const CLIENT_VERSION = "0.1.0";

/**
 * Spawn a child surface's MCP server and return a small JSON-RPC client:
 * `{ surface, request(method, params) -> Promise<result>, close() }`.
 *
 * Resolution is completion-based: a pending request settles when the child
 * answers, or rejects if the child errors or exits first. No limit is
 * imposed on how long a child may take — it runs to completion.
 *
 * `admit` is the caller's own gate: it validates the surface and returns
 * the environment the child is allowed to see, so this module spawns and
 * speaks the protocol and decides nothing about authority.
 */
export function connect(surface, admit) {
  const env = admit(surface);
  const child = spawn(surface.command, surface.args, {
    cwd: surface.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env,
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
    clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
  });
  const result = await client.request("tools/list", {});
  return (result && result.tools) || [];
}
