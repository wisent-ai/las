import { createHash, createPublicKey, verify } from "node:crypto";
import { closeSync, constants, fsyncSync, openSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertExactKeys, parseStrictJson } from "./strict-json.mjs";

const DOMAIN = Buffer.from("LAS\0release-manifest\0v1\0", "utf8");
const TYPE = "las.release-manifest";
const HEX256 = /^[0-9a-f]{64}$/;
const KEY_ID = /^[A-Za-z0-9._-]{1,128}$/;
const CONFIG_ENV = Object.freeze({
  manifest: "LAS_RELEASE_MANIFEST_FILE",
  signature: "LAS_RELEASE_MANIFEST_SIGNATURE_FILE",
  trust: "LAS_RELEASE_TRUST_STORE_FILE",
  watermark: "LAS_RELEASE_WATERMARK_FILE",
});

function requiredAbsoluteEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) throw new Error(`las manifest: ${name} must name an absolute path`);
  return value;
}

function regularFile(file, label) {
  const stat = statSync(file, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) throw new Error(`${label}: missing regular file`);
}

function ownerOnlyFile(file, label) {
  regularFile(file, label);
  const stat = statSync(file);
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error(`${label}: file is not owned by the current user`);
  if ((stat.mode & 0o077) !== 0) throw new Error(`${label}: permissions must be owner-only`);
}

function base64(value, label) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error(`${label}: invalid base64`);
  const decoded = Buffer.from(value, "base64");
  if (!decoded.length || decoded.toString("base64") !== value) throw new Error(`${label}: non-canonical base64`);
  return decoded;
}

function text(value, label) {
  if (typeof value !== "string" || !value.length || value.includes("\0")) throw new Error(`${label}: expected non-empty string`);
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !HEX256.test(value)) throw new Error(`${label}: expected lowercase SHA-256`);
  return value;
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.length || entry.includes("\0")) || new Set(value).size !== value.length) {
    throw new Error(`${label}: expected unique non-empty strings`);
  }
  return value;
}

function validateTemplate(template, label) {
  assertExactKeys(template, ["argument", "value"], [], label);
  text(template.argument, `${label}.argument`);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(template.argument)) throw new Error(`${label}.argument: invalid argument name`);
  if (template.value === undefined || typeof template.value === "function") throw new Error(`${label}.value: invalid JSON value`);
}

function validateTool(tool, label) {
  assertExactKeys(tool, ["name", "input_schema_sha256", "credential_templates"], [], label);
  text(tool.name, `${label}.name`);
  digest(tool.input_schema_sha256, `${label}.input_schema_sha256`);
  if (!Array.isArray(tool.credential_templates)) throw new Error(`${label}.credential_templates: expected array`);
  tool.credential_templates.forEach((entry, index) => validateTemplate(entry, `${label}.credential_templates[${index}]`));
  if (new Set(tool.credential_templates.map((entry) => entry.argument)).size !== tool.credential_templates.length) throw new Error(`${label}: duplicate credential template argument`);
}

function validateSurface(surface, index) {
  const label = `las manifest surface[${index}]`;
  assertExactKeys(surface, ["name", "command", "cwd", "argv", "env_names", "binary_sha256", "code_path", "code_sha256", "tools"], [], label);
  text(surface.name, `${label}.name`);
  text(surface.command, `${label}.command`);
  text(surface.cwd, `${label}.cwd`);
  text(surface.code_path, `${label}.code_path`);
  if (![surface.command, surface.cwd, surface.code_path].every(path.isAbsolute)) throw new Error(`${label}: command, cwd, and code_path must be absolute`);
  stringArray(surface.argv, `${label}.argv`);
  stringArray(surface.env_names, `${label}.env_names`);
  digest(surface.binary_sha256, `${label}.binary_sha256`);
  digest(surface.code_sha256, `${label}.code_sha256`);
  if (!Array.isArray(surface.tools) || !surface.tools.length) throw new Error(`${label}.tools: expected non-empty array`);
  surface.tools.forEach((tool, toolIndex) => validateTool(tool, `${label}.tools[${toolIndex}]`));
  if (new Set(surface.tools.map((tool) => tool.name)).size !== surface.tools.length) throw new Error(`${label}: duplicate tool name`);
}

function validateManifest(manifest) {
  assertExactKeys(manifest, ["type", "version", "sequence", "expires_at", "surfaces"], [], "las manifest");
  if (manifest.type !== TYPE || manifest.version !== 1) throw new Error("las manifest: unsupported type or version");
  if (!Number.isSafeInteger(manifest.sequence) || manifest.sequence < 1) throw new Error("las manifest: sequence must be a positive safe integer");
  if (typeof manifest.expires_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(manifest.expires_at)) throw new Error("las manifest: expires_at must be an RFC 3339 UTC timestamp");
  const expiry = Date.parse(manifest.expires_at);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error("las manifest: manifest has expired");
  if (!Array.isArray(manifest.surfaces) || !manifest.surfaces.length) throw new Error("las manifest: surfaces must be non-empty");
  manifest.surfaces.forEach(validateSurface);
  if (new Set(manifest.surfaces.map((surface) => surface.name)).size !== manifest.surfaces.length) throw new Error("las manifest: duplicate surface name");
}

function readTrustStore(file, keyId) {
  ownerOnlyFile(file, "las trust store");
  const store = parseStrictJson(readFileSync(file), "las trust store");
  assertExactKeys(store, ["version", "keys"], [], "las trust store");
  if (store.version !== 1 || !Array.isArray(store.keys)) throw new Error("las trust store: unsupported schema");
  const keys = new Map();
  for (const [index, entry] of store.keys.entries()) {
    const label = `las trust store key[${index}]`;
    assertExactKeys(entry, ["key_id", "public_key_spki"], [], label);
    if (typeof entry.key_id !== "string" || !KEY_ID.test(entry.key_id) || keys.has(entry.key_id)) throw new Error(`${label}: invalid or duplicate key_id`);
    keys.set(entry.key_id, base64(entry.public_key_spki, `${label}.public_key_spki`));
  }
  const raw = keys.get(keyId);
  if (!raw) throw new Error("las trust store: signature key_id is not trusted");
  try { return createPublicKey({ key: raw, format: "der", type: "spki" }); } catch { throw new Error("las trust store: invalid Ed25519 public key"); }
}

function updateWatermark(file, sequence) {
  ownerOnlyFile(file, "las watermark");
  const current = parseStrictJson(readFileSync(file), "las watermark");
  assertExactKeys(current, ["version", "sequence"], [], "las watermark");
  if (current.version !== 1 || !Number.isSafeInteger(current.sequence) || current.sequence < 0) throw new Error("las watermark: invalid schema");
  if (sequence < current.sequence) throw new Error("las manifest: sequence rollback rejected");
  if (sequence === current.sequence) return;
  const temporary = `${file}.${process.pid}.tmp`;
  const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    writeFileSync(fd, JSON.stringify({ version: 1, sequence }) + "\n", "utf8");
    fsyncSync(fd);
  } finally { closeSync(fd); }
  renameSync(temporary, file);
}

export function loadSignedManifest() {
  const manifestFile = requiredAbsoluteEnv(CONFIG_ENV.manifest);
  const signatureFile = requiredAbsoluteEnv(CONFIG_ENV.signature);
  const trustFile = requiredAbsoluteEnv(CONFIG_ENV.trust);
  const watermarkFile = requiredAbsoluteEnv(CONFIG_ENV.watermark);
  regularFile(manifestFile, "las manifest");
  regularFile(signatureFile, "las manifest signature");
  const payload = readFileSync(manifestFile);
  const envelope = parseStrictJson(readFileSync(signatureFile), "las manifest signature");
  assertExactKeys(envelope, ["type", "version", "key_id", "signature"], [], "las manifest signature");
  if (envelope.type !== TYPE || envelope.version !== 1 || typeof envelope.key_id !== "string" || !KEY_ID.test(envelope.key_id)) throw new Error("las manifest signature: unsupported envelope");
  const signature = base64(envelope.signature, "las manifest signature");
  if (signature.length !== 64) throw new Error("las manifest signature: Ed25519 signature must be 64 bytes");
  const publicKey = readTrustStore(trustFile, envelope.key_id);
  if (publicKey.asymmetricKeyType !== "ed25519" || !verify(null, Buffer.concat([DOMAIN, payload]), publicKey, signature)) throw new Error("las manifest: detached signature verification failed");
  const manifest = parseStrictJson(payload, "las manifest");
  validateManifest(manifest);
  updateWatermark(watermarkFile, manifest.sequence);
  return Object.freeze({ manifest, keyId: envelope.key_id, manifestFile: realpathSync(manifestFile) });
}

function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!value || typeof value !== "object") throw new Error("schema contains a non-JSON value");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

export function jsonSha256(value) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

export function fileSha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
