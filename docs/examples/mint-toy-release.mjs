#!/usr/bin/env node
// mint-toy-release.mjs — mint a complete, valid, owner-signed Las release
// that admits exactly one surface, using a throwaway Ed25519 key.
//
// Usage: node docs/examples/mint-toy-release.mjs [surface] [out-dir]
//   surface  registry surface name (default: brama)
//   out-dir  where to write the four release files (default: mktemp-style
//            directory under the system temp dir)
//
// The script does exactly what an owner signing a real release does:
//   1. read the launch contract from the compiled-in registry (src/registry.mjs);
//   2. spawn the child once and capture its advertised tool schemas;
//   3. bind the manifest to the exact bytes (binary/code SHA-256) and the
//      canonical SHA-256 of every input schema (src/signed-manifest.mjs);
//   4. sign the raw manifest bytes under the domain separator
//      "LAS\0release-manifest\0v1\0" and write the trust store + watermark
//      with owner-only permissions, as loadSignedManifest() requires.
// The private key is generated in memory and never written anywhere.
import { generateKeyPairSync, sign } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAS = path.resolve(HERE, "..", "..");
const { fileSha256, jsonSha256 } = await import(path.join(LAS, "src", "signed-manifest.mjs"));
const { SURFACES } = await import(path.join(LAS, "src", "registry.mjs"));

const name = process.argv[2] || "brama";
const surface = SURFACES.find((entry) => entry.name === name);
if (!surface) {
  process.stderr.write(`mint: unknown surface '${name}' (known: ${SURFACES.map((s) => s.name).join(", ")})\n`);
  process.exit(1);
}
if (surface.name === "finance") {
  process.stderr.write("mint: finance is admitted by SINGULARITY_FINANCE_* configuration, never by the signed manifest\n");
  process.exit(1);
}
const out = path.resolve(process.argv[3] || mkdtempSync(path.join(tmpdir(), "las-release-")));

// 1. Handshake the child directly to capture its advertised input schemas.
const child = spawn(surface.command, surface.args, {
  cwd: surface.cwd,
  stdio: ["pipe", "pipe", "ignore"],
  env: { PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
});
const rl = readline.createInterface({ input: child.stdout });
const pending = new Map();
let sequenceNumber = 0;
rl.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
});
const request = (method, params) => new Promise((resolve, reject) => {
  const id = ++sequenceNumber;
  pending.set(id, { resolve, reject });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method}: child did not answer within 30s`)); }, 30000);
});
await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "mint-toy-release", version: "0" } });
const { tools } = await request("tools/list", {});
child.kill();

// 2. Bind the manifest to the exact registry launch and the exact bytes.
//    code_path must be a regular file; for a compiled child the binary is the
//    code, for a script child sign the entry script instead.
const codePath = surface.args.find((arg) => path.isAbsolute(arg)) || surface.command;
const manifest = {
  type: "las.release-manifest",
  version: 1,
  sequence: 1,
  expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, ".000Z"),
  surfaces: [{
    name: surface.name,
    command: surface.command,
    cwd: surface.cwd,
    argv: [...surface.args],
    env_names: [...surface.envAllowlist],
    binary_sha256: fileSha256(surface.command),
    code_path: codePath,
    code_sha256: fileSha256(codePath),
    tools: tools.map((tool) => ({
      name: tool.name,
      input_schema_sha256: jsonSha256(tool.inputSchema),
      credential_templates: [],
    })),
  }],
};

// 3. Sign the raw manifest bytes under the Las domain separator.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const payload = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
const domain = Buffer.from("LAS\0release-manifest\0v1\0", "utf8");
const signature = sign(null, Buffer.concat([domain, payload]), privateKey).toString("base64");

// 4. Write the four files loadSignedManifest() reads. Trust store and
//    watermark must be regular files owned by the current user with
//    owner-only permissions.
mkdirSync(out, { recursive: true });
const write = (file, content, mode) => {
  const target = path.join(out, file);
  writeFileSync(target, content);
  if (mode) chmodSync(target, mode);
};
write("release-manifest.json", payload);
write("release-manifest.sig.json", JSON.stringify({ type: "las.release-manifest", version: 1, key_id: "toy-2026", signature }, null, 2) + "\n");
write("trust-store.json", JSON.stringify({ version: 1, keys: [{ key_id: "toy-2026", public_key_spki: publicKey.export({ format: "der", type: "spki" }).toString("base64") }] }, null, 2) + "\n", 0o600);
write("watermark.json", JSON.stringify({ version: 1, sequence: 0 }) + "\n", 0o600);

process.stdout.write([
  `minted release for '${surface.name}' (${manifest.surfaces[0].tools.length} signed tool(s)) in ${out}`,
  `export LAS_RELEASE_MANIFEST_FILE=${path.join(out, "release-manifest.json")}`,
  `export LAS_RELEASE_MANIFEST_SIGNATURE_FILE=${path.join(out, "release-manifest.sig.json")}`,
  `export LAS_RELEASE_TRUST_STORE_FILE=${path.join(out, "trust-store.json")}`,
  `export LAS_RELEASE_WATERMARK_FILE=${path.join(out, "watermark.json")}`,
].join("\n") + "\n");
