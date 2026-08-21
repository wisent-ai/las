// Registry of the child agent surfaces that las federates, plus the stdio
// JSON-RPC client used to reach each one.
//
// las (Polish for "forest") gathers every sibling agent surface into a single
// tree, including Tama's adaptive hook enforcement surface. Each child already speaks the
// Model Context Protocol over stdio; las only spawns a child, performs the
// initialize + tools/list handshake, and routes calls. It never widens any
// child's own security boundary — a read-only child stays read-only here.
import { spawn } from "node:child_process";
import readline from "node:readline";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { fileSha256, jsonSha256, loadSignedManifest } from "./signed-manifest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// las/src -> las -> Wisent workspace root shared by every sibling project.
const ROOT = path.resolve(HERE, "..", "..");

const SYSTEM_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
const BASE_ENV = Object.freeze({ PATH: SYSTEM_PATH });
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

function declaredEnv(names = []) {
  const env = { ...BASE_ENV };
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.length) env[name] = value;
  }
  return env;
}

// One entry per federated surface. `command`+`args` launch that surface's MCP
// server; `cwd` is its project root; `summary` is a one-line human hint.
export const SURFACES = [
  {
    name: "weles",
    command: process.execPath,
    args: [path.join(ROOT, "weles", "dist", "mcp.js")],
    cwd: path.join(ROOT, "weles"),
    summary: "Anti-detect browser automation. Runs only on its dedicated host.",
    envAllowlist: [],
  },
  {
    name: "skarbiec",
    command: path.join(
      ROOT,
      "entitlements-rotator",
      "target",
      "release",
      "skarbiec-entitlements-router",
    ),
    args: ["mcp"],
    cwd: path.join(ROOT, "entitlements-rotator"),
    summary: "Credential capability broker. Opaque grants only; redemption is workload-bound over AF_UNIX.",
    allowTools: ["health", "capability_available", "capability_request"],
    envAllowlist: [
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
      "SKARBIEC_MCP_AGENT_ID",
    ],
  },
  {
    name: "tama",
    command: process.execPath,
    args: [path.join(ROOT, "hooks-rotator", "src", "mcp-server.mjs")],
    cwd: path.join(ROOT, "hooks-rotator"),
    summary: "Adaptive hook enforcement. Catalog, source inspection, validation, and documentation; runtime policy remains fail-safe.",
    allowTools: [
      "list_hooks",
      "show_hook",
      "read_hook_source",
      "validate_hooks",
      "render_hook_docs",
    ],
    envAllowlist: [],
  },
  {
    name: "stado",
    command: "/usr/bin/python3",
    args: ["-m", "stado.mcp.server"],
    cwd: path.join(ROOT, "wisent-compute"),
    summary: "GPU job queue. Read-only status, cost, quota, schedules.",
    envAllowlist: [
      "COMPUTE_API_URL",
      "GCP_PROJECT",
      "GCP_REGION",
      "GCP_REGIONS",
      "WC_BUCKET",
      "WC_PROVIDERS",
      "WC_STORAGE_BACKEND",
    ],
  },
  {
    name: "lem",
    command: path.join(ROOT, "lem-desktop", ".build", "debug", "LemMCP"),
    args: [],
    cwd: path.join(ROOT, "lem-desktop"),
    summary: "Research-paper manager. Read-only registry + provenance.",
    envAllowlist: [],
  },
  {
    name: "echo",
    command: process.execPath,
    args: [path.join(ROOT, "echo", "agent", "mcp.mjs")],
    cwd: path.join(ROOT, "echo"),
    summary: "Growth/content dashboard. Read-only Supabase reads.",
    envAllowlist: ["NEXT_PUBLIC_SUPABASE_URL"],
  },
  {
    name: "most",
    command: "/usr/bin/python3",
    args: [path.join(ROOT, "most", "most_agent", "mcp_server.py")],
    cwd: path.join(ROOT, "most"),
    summary: "iMessage/RCS/SMS bridge. Read-only health + diagnostics.",
    envAllowlist: ["MOST_BASE_URL"],
  },
  {
    name: "probierz",
    command: process.execPath,
    args: [path.join(ROOT, "probierz", "agent", "mcp.mjs")],
    cwd: path.join(ROOT, "probierz"),
    summary: "Cross-platform test toolkit. Discovery (surfaces/specs) + toolchain check/setup + change-driven ci: select targets a change affects, run the ready ones (recording video/trace/screenshots), analyze the verdict.",
    envAllowlist: [
      "ANDROID_HOME",
      "ANDROID_SDK_ROOT",
      "APPIUM_HOME",
      "APP_IOS",
      "BUNDLE_ID",
      "IOS_DEVICE",
      "IOS_VERSION",
      "PLAYWRIGHT_BROWSERS_PATH",
    ],
  },
  {
    name: "byk",
    command: path.join(ROOT, "swiatowid", ".build", "debug", "oko-mcp"),
    args: [],
    cwd: path.join(ROOT, "swiatowid"),
    summary: "Founder strategy tool (Oko). Read-only org roster, auto-goals, velocity.",
    envAllowlist: [],
  },
  {
    name: "brama",
    command: path.join(ROOT, "brama", "target", "debug", "brama"),
    args: ["mcp"],
    cwd: path.join(ROOT, "brama"),
    summary: "Multi-provider LLM gateway (formerly model-router). Read-only hardware detect + model list.",
    envAllowlist: [],
  },
  {
    name: "warsztat",
    command: path.join(ROOT, "singularity", "target", "debug", "singularity-repo-mcp"),
    args: [],
    cwd: path.join(ROOT, "singularity"),
    summary: "Policy-gated repository proposals. Never merge, deploy, or restart.",
    allowTools: [
      "workspace_create",
      "workspace_read",
      "workspace_apply_patch",
      "workspace_diff",
      "workspace_seal",
      "workspace_check",
      "commit_create",
      "branch_publish",
      "pull_request_open",
      "proposal_status",
    ],
    envAllowlist: ["LAS_ONLY", "LAS_SKIP"],
  },
  {
    name: "finance",
    command: path.join(ROOT, "singularity", "target", "release", "singularity-finance-mcp"),
    args: [],
    cwd: path.join(ROOT, "singularity"),
    summary: "Policy-bound finance lifecycle with isolated signed execution.",
    envAllowlist: [
      "SINGULARITY_FINANCE_POLICY_FILE",
      "SINGULARITY_FINANCE_ENABLE_LEASE_FILE",
      "SINGULARITY_FINANCE_STATE_DIR",
      "SINGULARITY_FINANCE_VERIFY_KEY_HEX",
      "SINGULARITY_FINANCE_BINARY_SHA256",
      "SINGULARITY_FINANCE_EXECUTOR",
    ],
  },
];

for (const surface of SURFACES) {
  Object.freeze(surface.args);
  Object.freeze(surface.envAllowlist);
  if (surface.allowTools) Object.freeze(surface.allowTools);
  Object.freeze(surface);
}
Object.freeze(SURFACES);

let signedRelease = null;
let signedReleaseExpiresAt = null;
let signedReleaseError = null;

function signedManifest() {
  if (signedRelease) {
    if (signedReleaseExpiresAt <= Date.now()) throw new Error("las manifest: manifest has expired");
    return signedRelease;
  }
  if (signedReleaseError) throw signedReleaseError;
  try {
    const loaded = loadSignedManifest();
    const known = new Set(SURFACES.filter((surface) => surface.name !== "finance").map((surface) => surface.name));
    for (const release of loaded.manifest.surfaces) {
      if (!known.has(release.name)) throw new Error(`las manifest: unknown or separately trusted surface '${release.name}'`);
    }
    signedReleaseExpiresAt = Date.parse(loaded.manifest.expires_at);
    signedRelease = new Map(loaded.manifest.surfaces.map((surface) => [surface.name, surface]));
    return signedRelease;
  } catch (error) {
    signedReleaseError = error;
    throw error;
  }
}

function releaseFor(surface) {
  if (surface.name === "finance") return null;
  const release = signedManifest().get(surface.name);
  if (!release) throw new Error(`${surface.name}: absent from owner-signed release manifest`);
  return release;
}

const FINANCE_CONFIGURATION = Object.freeze([
  "SINGULARITY_FINANCE_POLICY_FILE",
  "SINGULARITY_FINANCE_ENABLE_LEASE_FILE",
  "SINGULARITY_FINANCE_STATE_DIR",
  "SINGULARITY_FINANCE_VERIFY_KEY_HEX",
  "SINGULARITY_FINANCE_BINARY_SHA256",
  "SINGULARITY_FINANCE_EXECUTOR",
]);

function financeConfigured() {
  return FINANCE_CONFIGURATION.every((name) => {
    const value = process.env[name];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function surfaceConfigured(surface) {
  if (surface.name === "finance") return financeConfigured();
  try {
    releaseFor(surface);
    return true;
  } catch {
    return false;
  }
}

// Both operator filters can only subtract from configured, signed surfaces.
export function activeSurfaces() {
  const eligible = SURFACES.filter(surfaceConfigured);
  const only = new Set((process.env.LAS_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean));
  const skip = new Set((process.env.LAS_SKIP || "").split(",").map((s) => s.trim()).filter(Boolean));
  return eligible.filter((surface) => (!only.size || only.has(surface.name)) && !skip.has(surface.name));
}

const FINANCE_POLICY_DOCUMENT = JSON.stringify({
  version: 1,
  surface: "finance",
  tools: ["finance_propose", "finance_status", "finance_cancel"],
  blocked: ["execute", "approve", "sign", "broadcast", "beneficiary", "policy"],
});
export const FINANCE_POLICY_FINGERPRINT = "d00d7b06f53f9c9e49dfc7313f77a0d2a9aa77260b053b44670dbdeac4a39cff";
const FINANCE_ALLOWED_TOOLS = new Set(["finance_propose", "finance_status", "finance_cancel"]);
const FINANCE_FORBIDDEN_TOOL = /(?:^|[^a-z])(?:execute|approve|sign|broadcast|beneficiary|policy)(?:[^a-z]|$)/i;
const SKARBIEC_TOOL_SCHEMA_DIGESTS = new Map([
  ["health", jsonSha256({ type: "object", properties: {}, required: [], additionalProperties: false })],
  ["capability_available", jsonSha256({
    type: "object",
    properties: {
      purpose: { type: "string", minLength: 1 },
      resource: { type: "string", minLength: 1 },
      target: { type: "string", minLength: 1 },
      ttl_seconds: { type: "integer", minimum: 1 },
      max_uses: { type: "integer", minimum: 1 },
    },
    required: ["purpose", "resource", "target", "ttl_seconds", "max_uses"],
    additionalProperties: false,
  })],
  ["capability_request", jsonSha256({
    type: "object",
    properties: {
      purpose: { type: "string", minLength: 1 },
      resource: { type: "string", minLength: 1 },
      target: { type: "string", minLength: 1 },
      ttl_seconds: { type: "integer", minimum: 1 },
      max_uses: { type: "integer", minimum: 1 },
      delegation_depth: { type: "integer", minimum: 0 },
    },
    required: ["purpose", "resource", "target", "ttl_seconds", "max_uses"],
    additionalProperties: false,
  })],
]);
const SKARBIEC_TOOL_DESCRIPTIONS = new Map([
  ["health", "Return a non-sensitive broker health summary."],
  ["capability_available", "Check whether the authenticated agent may request an exactly bounded capability. Returns only availability."],
  ["capability_request", "Request an opaque, bounded capability for the authenticated agent. Returns only status and an opaque capability ID."],
]);
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
const CAPABILITY_ID = /^[0-9a-f]{64}$/;
const SKARBIEC_HEALTH_FIELDS = new Set([
  "ok",
  "service",
  "wire",
  "policy_sequence",
  "registry_sequence",
  "active_capabilities",
  "anomaly_count",
]);
const RAW_SECRET_ENV = /(?:^|_)(?:TOKEN|SECRET|PASSWORD|UNLOCK|PRIVATE_KEY|SIGNING_KEY)(?:_|$)/;
const SKARBIEC_MAX_TTL_SECONDS = 60;
const SKARBIEC_MAX_USES = 1;
const SKARBIEC_MAX_DELEGATION_DEPTH = 0;
const SKARBIEC_CAPABILITY_TAXONOMY = new Map([
  ["weles.browser.fill", { target: "weles", prefixes: ["origin:"] }],
  ["weles.captcha.solve", { target: "weles", prefixes: ["provider:"] }],
  ["weles.sms.verify", { target: "weles", prefixes: ["provider:"] }],
  ["weles.proxy.authenticate", { target: "weles", prefixes: ["proxy:"] }],
  ["weles.brama.sign", { target: "weles", prefixes: ["brama:", "agent:"] }],
  ["most.service.authenticate", { target: "most-service", resources: ["credential:most/service"] }],
  ["most.database.connect", { target: "most-service", resources: ["credential:most/database"] }],
  ["most.twilio.authenticate", { target: "most-service", resources: ["credential:most/twilio"] }],
  ["most.attachment.sign", { target: "most-service", resources: ["credential:most/attachment-signing"] }],
  ["most.remote-worker.authenticate", { target: "most-service", resources: ["credential:most/remote-worker"] }],
  ["brama.provider.authenticate", { target: "brama", prefixes: ["provider:"] }],
  ["brama.supabase.connect", { target: "brama", prefixes: ["supabase:"] }],
  ["brama.request.sign", { target: "brama", prefixes: ["agent:"] }],
  ["singularity.brama.bootstrap", { target: "singularity-bootstrap", prefixes: ["brama:"] }],
  ["singularity.most.bootstrap", { target: "singularity-bootstrap", prefixes: ["most:"] }],
]);

function verifySkarbiecReleasePolicy(release) {
  if (release.name !== "skarbiec") return;
  if (release.tools.length !== SKARBIEC_TOOL_SCHEMA_DIGESTS.size) throw new Error("skarbiec: signed tool policy does not match the capability broker v1 surface");
  for (const tool of release.tools) {
    if (SKARBIEC_TOOL_SCHEMA_DIGESTS.get(tool.name) !== tool.input_schema_sha256) throw new Error("skarbiec: signed tool schema does not match the capability broker v1 surface");
  }
}

function verifyFinancePolicyFingerprint() {
  const fingerprint = createHash("sha256").update(FINANCE_POLICY_DOCUMENT).digest("hex");
  if (fingerprint !== FINANCE_POLICY_FINGERPRINT) {
    throw new Error("finance: local tool policy fingerprint mismatch");
  }
}

function validateCwd(surface) {
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

function validateCommand(surface) {
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
  if (surface.name === "finance") {
    const expectedDigest = process.env.SINGULARITY_FINANCE_BINARY_SHA256?.trim().toLowerCase();
    if (!expectedDigest || !/^[0-9a-f]{64}$/.test(expectedDigest)) {
      throw new Error("finance: SINGULARITY_FINANCE_BINARY_SHA256 must be a 64-character lowercase SHA-256 digest");
    }
    const actualDigest = createHash("sha256").update(readFileSync(realCommand)).digest("hex");
    if (actualDigest !== expectedDigest) {
      throw new Error("finance: release binary digest mismatch");
    }
  }
}

function validateReleaseBinding(surface) {
  if (surface.name === "finance") return;
  const release = releaseFor(surface);
  const exact = [
    [release.command, surface.command, "command"],
    [release.cwd, surface.cwd, "cwd"],
  ];
  if (surface.allowTools && JSON.stringify(release.tools.map((tool) => tool.name)) !== JSON.stringify(surface.allowTools)) {
    throw new Error(`${surface.name}: signed tool names exceed the local release policy`);
  }
  verifySkarbiecReleasePolicy(release);
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
  if (surface.name !== "finance" && surface.envAllowlist.some((name) => RAW_SECRET_ENV.test(name))) throw new Error(`${surface.name}: raw-secret environment inheritance is prohibited`);
  if (surface.name === "skarbiec") {
    for (const name of SKARBIEC_PATH_ENV) {
      if (!surface.envAllowlist.includes(name)) continue;
      const value = process.env[name];
      if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) throw new Error(`skarbiec: ${name} must name an absolute path`);
    }
    requiredSkarbiecAgentIdentity();
  }
  return Object.freeze(declaredEnv(surface.envAllowlist));
}

export function authorizeTools(surface, tools) {
  if (!Array.isArray(tools)) throw new Error(`${surface.name}: invalid tools/list response`);
  const unique = new Map();
  for (const tool of tools) {
    if (!tool || typeof tool.name !== "string" || unique.has(tool.name) || !tool.inputSchema || typeof tool.inputSchema !== "object" || Array.isArray(tool.inputSchema)) {
      throw new Error(`${surface.name}: invalid or duplicate tool declaration`);
    }
    unique.set(tool.name, tool);
  }
  if (surface.name !== "finance") {
    const release = releaseFor(surface);
    verifySkarbiecReleasePolicy(release);
    if (unique.size !== release.tools.length) throw new Error(`${surface.name}: child tool surface does not match signed manifest`);
    for (const expected of release.tools) {
      const advertised = unique.get(expected.name);
      if (!advertised) throw new Error(`${surface.name}: child tool surface does not match signed manifest`);
      if (jsonSha256(advertised.inputSchema) !== expected.input_schema_sha256) throw new Error(`${surface.name}: input schema drift for '${expected.name}'`);
    }
    return release.tools.map((expected) => {
      const advertised = unique.get(expected.name);
      if (surface.name !== "skarbiec") return advertised;
      return {
        name: expected.name,
        description: SKARBIEC_TOOL_DESCRIPTIONS.get(expected.name),
        inputSchema: structuredClone(advertised.inputSchema),
      };
    });
  }

  verifyFinancePolicyFingerprint();
  if ([...unique.keys()].some((name) => FINANCE_FORBIDDEN_TOOL.test(name))) {
    throw new Error("finance: child advertised a prohibited financial verb");
  }
  if (unique.size !== FINANCE_ALLOWED_TOOLS.size || [...FINANCE_ALLOWED_TOOLS].some((name) => !unique.has(name))) {
    throw new Error("finance: child tool policy does not match the locally bound proposal-only policy");
  }
  return [...FINANCE_ALLOWED_TOOLS].map((name) => unique.get(name));
}

export function authorizeToolCall(surface, remoteName) {
  if (typeof remoteName !== "string") throw new Error(`${surface.name}: invalid tool name`);
  if (surface.name === "finance") {
    verifyFinancePolicyFingerprint();
    if (FINANCE_FORBIDDEN_TOOL.test(remoteName) || !FINANCE_ALLOWED_TOOLS.has(remoteName)) {
      throw new Error("finance: tool is not permitted by the proposal-only policy");
    }
    return;
  }
  if (!releaseFor(surface).tools.some((tool) => tool.name === remoteName)) throw new Error(`${surface.name}: tool is not permitted by signed policy`);
}

function validateCapabilityTaxonomy(args) {
  const rule = SKARBIEC_CAPABILITY_TAXONOMY.get(args.purpose);
  if (!rule || args.target !== rule.target || args.resource.includes("*")) {
    throw new Error("skarbiec: capability target is outside the contract taxonomy");
  }
  const allowed = rule.resources
    ? rule.resources.includes(args.resource)
    : rule.prefixes.some((prefix) => args.resource.startsWith(prefix) && args.resource.length > prefix.length);
  if (!allowed) throw new Error("skarbiec: capability resource is outside the contract taxonomy");
}

function validateSkarbiecArguments(remoteName, args) {
  const allowed = remoteName === "health"
    ? new Set()
    : new Set(["purpose", "resource", "target", "ttl_seconds", "max_uses"]);
  if (remoteName === "capability_request") allowed.add("delegation_depth");
  if (!SKARBIEC_TOOL_SCHEMA_DIGESTS.has(remoteName) || Object.keys(args).some((name) => !allowed.has(name))) {
    throw new Error("skarbiec: capability arguments do not match the broker v1 contract");
  }
  if (remoteName === "health") return;
  for (const name of ["purpose", "resource", "target"]) {
    const value = args[name];
    if (typeof value !== "string" || value.trim() !== value || !value.length || value === "*" || value.includes("\0")) {
      throw new Error("skarbiec: capability arguments do not match the broker v1 contract");
    }
  }
  validateCapabilityTaxonomy(args);
  if (!Number.isSafeInteger(args.ttl_seconds) || args.ttl_seconds < 1 || args.ttl_seconds > SKARBIEC_MAX_TTL_SECONDS
    || !Number.isSafeInteger(args.max_uses) || args.max_uses < 1 || args.max_uses > SKARBIEC_MAX_USES) {
    throw new Error("skarbiec: capability request exceeds the local least-privilege ceiling");
  }
  if (Object.prototype.hasOwnProperty.call(args, "delegation_depth")
    && (!nonNegativeInteger(args.delegation_depth) || args.delegation_depth > SKARBIEC_MAX_DELEGATION_DEPTH)) {
    throw new Error("skarbiec: capability request exceeds the local least-privilege ceiling");
  }
}


export function authorizeToolArguments(surface, remoteName, modelArguments) {
  if (!modelArguments || typeof modelArguments !== "object" || Array.isArray(modelArguments)) throw new Error(`${surface.name}: tool arguments must be an object`);
  if (surface.name === "finance") return modelArguments;
  const tool = releaseFor(surface).tools.find((entry) => entry.name === remoteName);
  if (!tool) throw new Error(`${surface.name}: tool is not permitted by signed policy`);
  const authorized = structuredClone(modelArguments);
  for (const template of tool.credential_templates) {
    if (Object.prototype.hasOwnProperty.call(authorized, template.argument)) throw new Error(`${surface.name}: model arguments may not override credential template '${template.argument}'`);
    authorized[template.argument] = structuredClone(template.value);
  }
  if (surface.name === "skarbiec") validateSkarbiecArguments(remoteName, authorized);
  return authorized;
}

function exactObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`skarbiec: invalid ${label} result`);
  const keys = Object.keys(value);
  if (keys.length !== fields.size || keys.some((key) => !fields.has(key))) throw new Error(`skarbiec: invalid ${label} result`);
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function authorizeToolResult(surface, remoteName, result) {
  if (surface.name !== "skarbiec") return result;
  exactObject(result, new Set(["content"]), "MCP envelope");
  if (!Array.isArray(result.content) || result.content.length !== 1) throw new Error("skarbiec: invalid MCP content result");
  const content = result.content[0];
  exactObject(content, new Set(["type", "text"]), "MCP content");
  if (content.type !== "text" || typeof content.text !== "string") throw new Error("skarbiec: invalid MCP content result");
  let payload;
  try {
    payload = JSON.parse(content.text);
  } catch {
    throw new Error("skarbiec: invalid capability result");
  }
  if (remoteName === "health") {
    exactObject(payload, SKARBIEC_HEALTH_FIELDS, "health");
    if (payload.ok !== true || payload.service !== "skarbiec-capability-broker" || payload.wire !== "skarbiec.redeem.v1"
      || !Number.isSafeInteger(payload.policy_sequence) || payload.policy_sequence < 1
      || !Number.isSafeInteger(payload.registry_sequence) || payload.registry_sequence < 1
      || !nonNegativeInteger(payload.active_capabilities) || !nonNegativeInteger(payload.anomaly_count)) {
      throw new Error("skarbiec: invalid health result");
    }
  } else if (remoteName === "capability_available") {
    exactObject(payload, new Set(["available"]), "capability availability");
    if (typeof payload.available !== "boolean") throw new Error("skarbiec: invalid capability availability result");
  } else if (remoteName === "capability_request") {
    exactObject(payload, new Set(["status", "capability_id"]), "capability request");
    if (payload.status !== "issued" || typeof payload.capability_id !== "string" || !CAPABILITY_ID.test(payload.capability_id)) {
      throw new Error("skarbiec: invalid capability request result");
    }
  } else {
    throw new Error("skarbiec: tool is not permitted by signed policy");
  }
  return result;
}

const JSONRPC_VERSION = "2.0";
const PROTOCOL_VERSION = "2024-11-05";

// Spawn a child surface's MCP server and return a small JSON-RPC client:
// { surface, request(method, params) -> Promise<result>, close() }.
// Resolution is completion-based: a pending request settles when the child
// answers, or rejects if the child errors or exits first. No limit is imposed
// on how long a child may take — it runs to completion.
export function connect(surface) {
  validateCwd(surface);
  validateCommand(surface);
  validateReleaseBinding(surface);
  const env = buildChildEnvironment(surface);
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
    clientInfo: { name: "las", version: "0.1.0" },
  });
  const result = await client.request("tools/list", {});
  return (result && result.tools) || [];
}
