// Which surfaces the owner-signed release admits, and which of those the
// operator's filters leave active.
//
// Split out of `src/registry.mjs`, which had grown past the
// three-hundred-line limit; what a surface may then advertise and call
// stays there.

import { catalogEnvironment, catalogRegistration } from "../catalog.mjs";
import { loadSignedManifest } from "../signed-manifest.mjs";
import { SURFACES } from "./surfaces.mjs";

/// Finance is not admitted through the ordinary signed-manifest map; it is
/// configured entirely by these variables or it is not configured at all.
const FINANCE = "finance";
const FINANCE_CONFIGURATION = Object.freeze([
  "SINGULARITY_FINANCE_POLICY_FILE",
  "SINGULARITY_FINANCE_ENABLE_LEASE_FILE",
  "SINGULARITY_FINANCE_STATE_DIR",
  "SINGULARITY_FINANCE_VERIFY_KEY_HEX",
  "SINGULARITY_FINANCE_BINARY_SHA256",
  "SINGULARITY_FINANCE_EXECUTOR",
  "SINGULARITY_FINANCE_CUSTODY_URL",
  "SINGULARITY_FINANCE_CUSTODY_TOKEN_FILE",
]);

let signedRelease = null;
let signedReleaseExpiresAt = null;
let signedReleaseError = null;

export function signedManifest() {
  if (signedRelease) {
    if (signedReleaseExpiresAt <= Date.now()) throw new Error("las manifest: manifest has expired");
    return signedRelease;
  }
  if (signedReleaseError) throw signedReleaseError;
  try {
    const loaded = loadSignedManifest();
    const known = new Set(SURFACES.filter((surface) => surface.name !== FINANCE).map((surface) => surface.name));
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

export function releaseFor(surface) {
  if (surface.name === FINANCE) return null;
  const release = signedManifest().get(surface.name);
  if (!release) throw new Error(`${surface.name}: absent from owner-signed release manifest`);
  return release;
}

function financeConfigured(surface) {
  const imported = catalogEnvironment(surface);
  return FINANCE_CONFIGURATION.every((name) => {
    const value = process.env[name] || imported[name];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function surfaceConfigured(surface) {
  try {
    const registration = catalogRegistration(surface);
    if (registration.managed && !registration.valid) return false;
    if (surface.name === FINANCE) return financeConfigured(surface);
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
