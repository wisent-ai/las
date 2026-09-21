// What must hold before a child is spawned: its working directory and
// command stay inside the workspace, its bytes match the signed release,
// and its environment is exactly the names the surface declared.
//
// Split out of `src/registry.mjs`, which had grown past the
// three-hundred-line limit; what the child may then advertise and call
// stays there.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { catalogEnvironment } from "../catalog.mjs";
import { fileSha256 } from "../signed-manifest.mjs";
import { releaseFor } from "./release.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// las/src/registry -> las/src -> las -> the Wisent workspace root.
const ROOT = path.resolve(HERE, "..", "..", "..");

const FINANCE = "finance";
const SKARBIEC = "skarbiec";
const SYSTEM_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
const BASE_ENV = Object.freeze({ PATH: SYSTEM_PATH });
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const RAW_SECRET_ENV = /(?:^|_)(?:TOKEN|SECRET|PASSWORD|UNLOCK|PRIVATE_KEY|SIGNING_KEY)(?:_|$)/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const SKARBIEC_PATH_ENV = new Set([
  "SKARBIEC_CAP_POLICY",
  "SKARBIEC_CAP_POLICY_SIG",
  "SKARBIEC_CAP_TRUST_ROOT",
  "SKARBIEC_WORKLOAD_REGISTRY",
  "SKARBIEC_WORKLOAD_REGISTRY_SIG",
  "SKARBIEC_CAP_STATE",
  "SKARBIEC_CAP_SOCKET",
  "SKARBIEC_WORM_RECEIPT_DIR",
  "SKARBIEC_WORM_CHECKPOINT",
  "SKARBIEC_WORM_RECEIPT_COMMAND",
]);

function declaredEnv(names = [], imported = {}) {
  const env = { ...BASE_ENV };
  for (const name of names) {
    const current = process.env[name];
    if (typeof current === "string" && current.length) env[name] = current;
    else if (typeof imported[name] === "string" && imported[name].length) env[name] = imported[name];
  }
  return env;
}

export function validateCwd(surface) {
  if (typeof surface.cwd !== "string" || !path.isAbsolute(surface.cwd)) {
    throw new Error(`${surface.name}: cwd must be an absolute path`);
  }
  if (!existsSync(surface.cwd) || !statSync(surface.cwd).isDirectory()) {
    throw new Error(`${surface.name}: cwd is not an existing directory`);
  }
  const root = realpathSync(ROOT);
  const cwd = realpathSync(surface.cwd);
  if (cwd !== root && !cwd.startsWith(root + path.sep)) {
    throw new Error(`${surface.name}: cwd escapes the workspace root`);
  }
}

export function validateCommand(surface) {
  if (typeof surface.command !== "string" || !surface.command || surface.command.includes("\0")) {
    throw new Error(`${surface.name}: invalid command`);
  }
  if (!Array.isArray(surface.args) || surface.args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    throw new Error(`${surface.name}: invalid command arguments`);
  }
  if (surface.args.some((arg) => path.isAbsolute(arg))) {
    const root = realpathSync(ROOT);
    for (const arg of surface.args.filter((value) => path.isAbsolute(value))) {
      if (!existsSync(arg)) throw new Error(`${surface.name}: command argument does not exist`);
      const resolved = realpathSync(arg);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        throw new Error(`${surface.name}: command argument resolves outside the workspace`);
      }
    }
  }
  if (!path.isAbsolute(surface.command)) {
    throw new Error(`${surface.name}: command must be an absolute path`);
  }
  const command = path.resolve(surface.command);
  if (!existsSync(command) || !statSync(command).isFile()) {
    throw new Error(`${surface.name}: command is not an existing file`);
  }
  const realCommand = realpathSync(command);
  const root = realpathSync(ROOT);
  const trustedExternal = new Set([realpathSync(process.execPath), realpathSync("/usr/bin/python3")]);
  if (!trustedExternal.has(realCommand) && realCommand !== root && !realCommand.startsWith(root + path.sep)) {
    throw new Error(`${surface.name}: command resolves outside the workspace`);
  }
  if (surface.name === FINANCE) {
    const expectedDigest = process.env.SINGULARITY_FINANCE_BINARY_SHA256?.trim().toLowerCase();
    if (!expectedDigest || !SHA256_HEX.test(expectedDigest)) {
      throw new Error("finance: SINGULARITY_FINANCE_BINARY_SHA256 must be a 64-character lowercase SHA-256 digest");
    }
    const actualDigest = createHash("sha256").update(readFileSync(realCommand)).digest("hex");
    if (actualDigest !== expectedDigest) {
      throw new Error("finance: release binary digest mismatch");
    }
  }
}

/**
 * The signed release must describe this surface exactly. `verifyPolicy` is
 * the caller's own extra check on the release it names, so this module
 * compares bytes and paths and decides no policy of its own.
 */
export function validateReleaseBinding(surface, verifyPolicy) {
  if (surface.name === FINANCE) return;
  const release = releaseFor(surface);
  const exact = [
    [release.command, surface.command, "command"],
    [release.cwd, surface.cwd, "cwd"],
  ];
  if (surface.allowTools && JSON.stringify(release.tools.map((tool) => tool.name)) !== JSON.stringify(surface.allowTools)) {
    throw new Error(`${surface.name}: signed tool names exceed the local release policy`);
  }
  verifyPolicy(release);
  for (const [actual, expected, field] of exact) if (actual !== expected) throw new Error(`${surface.name}: signed ${field} mismatch`);
  if (JSON.stringify(release.argv) !== JSON.stringify(surface.args)) throw new Error(`${surface.name}: signed argv mismatch`);
  if (JSON.stringify(release.env_names) !== JSON.stringify(surface.envAllowlist)) throw new Error(`${surface.name}: signed environment-name mismatch`);
  const command = realpathSync(surface.command);
  const code = realpathSync(release.code_path);
  if (!statSync(code).isFile()) throw new Error(`${surface.name}: signed code path is not a file`);
  if (fileSha256(command) !== release.binary_sha256) throw new Error(`${surface.name}: release binary digest mismatch`);
  if (fileSha256(code) !== release.code_sha256) throw new Error(`${surface.name}: release code digest mismatch`);
}

export function requiredSkarbiecAgentIdentity() {
  const agentId = process.env.SKARBIEC_MCP_AGENT_ID;
  if (typeof agentId !== "string" || agentId.trim() !== agentId || !agentId.length || agentId === "*" || agentId.includes("\0")) {
    throw new Error("skarbiec: SKARBIEC_MCP_AGENT_ID must name one explicit agent identity");
  }
  return agentId;
}

export function buildChildEnvironment(surface) {
  if (!Array.isArray(surface.envAllowlist)
    || surface.envAllowlist.some((name) => typeof name !== "string" || !ENV_NAME.test(name))
    || new Set(surface.envAllowlist).size !== surface.envAllowlist.length) {
    throw new Error(`${surface.name}: envAllowlist must contain unique, explicit environment names`);
  }
  if (surface.name !== FINANCE && surface.envAllowlist.some((name) => RAW_SECRET_ENV.test(name))) throw new Error(`${surface.name}: raw-secret environment inheritance is prohibited`);
  if (surface.name === SKARBIEC) {
    for (const name of SKARBIEC_PATH_ENV) {
      if (!surface.envAllowlist.includes(name)) continue;
      const value = process.env[name];
      if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) throw new Error(`skarbiec: ${name} must name an absolute path`);
    }
    requiredSkarbiecAgentIdentity();
  }
  return Object.freeze(declaredEnv(surface.envAllowlist, catalogEnvironment(surface)));
}
