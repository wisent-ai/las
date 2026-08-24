#!/usr/bin/env node
// verify-release.mjs — name the exact reason the signed release is refused.
//
// Usage: node docs/examples/verify-release.mjs
//
// The catalogue deliberately flattens every release failure to
// `configured: false` (las list) or `surface '<name>' is not active under the
// signed release and operator filters` (explicit selection). This script runs
// the same loadSignedManifest() the registry runs and prints its exact
// refusal sentence — "las manifest: detached signature verification failed",
// "las manifest: sequence rollback rejected", a strict-JSON refusal with its
// byte offset, and so on. Exit 0 means the release material itself verifies;
// the registry additionally rejects a manifest naming a surface outside the
// compiled-in registry ("las manifest: unknown or separately trusted
// surface '<name>'", src/registry.mjs).
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAS = path.resolve(HERE, "..", "..");

try {
  const { loadSignedManifest } = await import(path.join(LAS, "src", "signed-manifest.mjs"));
  const { manifest, keyId, manifestFile } = loadSignedManifest();
  process.stdout.write([
    `release ok: ${manifestFile}`,
    `key_id: ${keyId}`,
    `sequence: ${manifest.sequence}`,
    `expires_at: ${manifest.expires_at}`,
    `surfaces: ${manifest.surfaces.map((surface) => surface.name).join(", ")}`,
  ].join("\n") + "\n");
} catch (error) {
  process.stderr.write(error.message + "\n");
  process.exit(1);
}
