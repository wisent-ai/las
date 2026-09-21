// Reading one standard MCP configuration file and deciding, entry by
// entry, which of its servers are canonical Las surfaces and which are
// refused with the reason.
//
// Split out of `src/catalog.mjs`, which had grown past the
// three-hundred-line limit; the catalogue store and the adoption itself
// stay there.

import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";

const ONE = Number("1");
const NONE = Number("0");

/**
 * @param {string} sourcePath the configuration file to read
 * @param {Map<string, object>} surfacesByName canonical surfaces, by name
 * @param {object} shape the vocabulary and helpers the caller owns
 */
export function parseSource(sourcePath, surfacesByName, shape) {
  const {
    maxConfigBytes,
    topLevelFields,
    entryFields,
    envName,
    isRecord,
    matchingRegistration,
    fingerprint,
  } = shape;
  const rejected = [];
  const registrations = [];
  if (!existsSync(sourcePath)) {
    rejected.push({ source: sourcePath, reason: "configuration file does not exist" });
    return { source: sourcePath, registrations, rejected };
  }
  const metadata = lstatSync(sourcePath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    rejected.push({ source: sourcePath, reason: "configuration must be a regular file, not a symbolic link or directory" });
    return { source: sourcePath, registrations, rejected };
  }
  if (metadata.size > maxConfigBytes) {
    rejected.push({ source: sourcePath, reason: "configuration exceeds 4 MiB" });
    return { source: sourcePath, registrations, rejected };
  }
  const realSource = realpathSync(sourcePath);
  let decoded;
  try {
    decoded = JSON.parse(readFileSync(realSource, "utf8"));
  } catch {
    rejected.push({ source: realSource, reason: "configuration is not valid JSON" });
    return { source: realSource, registrations, rejected };
  }
  const serverCollections = [decoded?.mcpServers, decoded?.servers].filter((value) => value !== undefined);
  if (!isRecord(decoded) || Object.keys(decoded).some((key) => !topLevelFields.includes(key))
    || serverCollections.length !== ONE || !isRecord(serverCollections[NONE])
    || (decoded.$schema !== undefined && typeof decoded.$schema !== "string")) {
    rejected.push({ source: realSource, reason: "configuration must contain exactly one mcpServers or servers object and no unsupported top-level fields" });
    return { source: realSource, registrations, rejected };
  }
  const entries = Object.entries(serverCollections[NONE]).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === NONE) {
    rejected.push({ source: realSource, reason: "MCP server collection contains no entries" });
    return { source: realSource, registrations, rejected };
  }
  for (const [sourceKey, entry] of entries) {
    const surface = surfacesByName.get(sourceKey);
    if (!surface) {
      rejected.push({ source: realSource, entry: sourceKey, reason: "entry is not a supported canonical Las surface" });
      continue;
    }
    if (!isRecord(entry) || Object.keys(entry).some((key) => !entryFields.includes(key))) {
      rejected.push({ source: realSource, entry: sourceKey, reason: "entry has unsupported fields" });
      continue;
    }
    if (entry.type !== undefined && entry.type !== "stdio") {
      rejected.push({ source: realSource, entry: sourceKey, reason: "only stdio MCP entries can be adopted" });
      continue;
    }
    if (entry.disabled === true) {
      rejected.push({ source: realSource, entry: sourceKey, reason: "entry is disabled" });
      continue;
    }
    if (entry.disabled !== undefined && typeof entry.disabled !== "boolean") {
      rejected.push({ source: realSource, entry: sourceKey, reason: "disabled must be boolean" });
      continue;
    }
    if (typeof entry.command !== "string" || entry.command.includes("\0")
      || (entry.args !== undefined && (!Array.isArray(entry.args) || entry.args.some((argument) => typeof argument !== "string" || argument.includes("\0"))))
      || (entry.cwd !== undefined && (typeof entry.cwd !== "string" || entry.cwd.includes("\0")))
      || (entry.env !== undefined && (!isRecord(entry.env) || Object.entries(entry.env).some(([name, value]) =>
        !envName.test(name) || typeof value !== "string" || value.includes("${"))))) {
      rejected.push({ source: realSource, entry: sourceKey, reason: "entry command, args, cwd, or environment is invalid" });
      continue;
    }
    const registration = {
      surface: surface.name,
      sourcePath: realSource,
      sourceKey,
      command: entry.command,
      args: entry.args || [],
      cwd: entry.cwd || surface.cwd,
      env: entry.env || {},
    };
    if (!matchingRegistration(surface, registration)) {
      rejected.push({
        source: realSource,
        entry: sourceKey,
        reason: "entry command, arguments, working directory, or environment names do not match the canonical signed surface",
      });
      continue;
    }
    registrations.push({ ...registration, fingerprint: fingerprint(registration) });
  }
  return { source: realSource, registrations, rejected };
}
