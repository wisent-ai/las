// Registry of the child agent surfaces that las federates, plus the stdio
// JSON-RPC client used to reach each one.
//
// las (Polish for "forest") gathers every sibling agent surface into a single
// tree, including Tama's adaptive hook enforcement surface. Each child already speaks the
// Model Context Protocol over stdio; las only spawns a child, performs the
// initialize + tools/list handshake, and routes calls. It never widens any
// child's own security boundary — a read-only child stays read-only here.
import { createHash } from "node:crypto";
import { jsonSha256 } from "./signed-manifest.mjs";
import { connect as connectChild } from "./registry/client.mjs";
import {
  buildChildEnvironment,
  requiredSkarbiecAgentIdentity,
  validateCommand,
  validateCwd,
  validateReleaseBinding,
} from "./registry/launch.mjs";
import { releaseFor } from "./registry/release.mjs";

export { SURFACES } from "./registry/surfaces.mjs";
export { activeSurfaces, surfaceConfigured } from "./registry/release.mjs";
export { buildChildEnvironment, requiredSkarbiecAgentIdentity };

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

// Spawn a child surface after this module's own gates admit it. The
// protocol client lives beside this file; the decision to admit does not.
export function connect(surface) {
  return connectChild(surface, (admitted) => {
    validateCwd(admitted);
    validateCommand(admitted);
    validateReleaseBinding(admitted, verifySkarbiecReleasePolicy);
    return buildChildEnvironment(admitted);
  });
}

export { handshake } from "./registry/client.mjs";
