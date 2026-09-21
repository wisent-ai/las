import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseSource as readSource } from "./catalog/source.mjs";

const SCHEMA_VERSION = 1;
// One MCP configuration file larger than 4 MiB is not one an editor wrote.
const MAX_CONFIG_BYTES = 4 * 1024 * 1024;
// The catalogue directory and file are owner-only.
const OWNER_ONLY_DIRECTORY = 0o700;
const OWNER_ONLY_FILE = 0o600;
const JSON_INDENT = 2;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const ENTRY_FIELDS = ["command", "args", "cwd", "env", "disabled", "type"];
const TOP_LEVEL_FIELDS = ["$schema", "mcpServers", "servers"];

let cachedCatalog;
let cachedCatalogPath;

export function catalogPath() {
  const configured = process.env.LAS_CATALOG_PATH;
  if (typeof configured === "string" && configured.trim().length) return path.resolve(configured);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "las", "catalog.json");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function defaultSources() {
  const home = homedir();
  return [
    path.resolve(process.cwd(), ".mcp.json"),
    path.resolve(process.cwd(), ".vscode", "mcp.json"),
    path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "Claude", "claude_desktop_config.json"),
  ].filter((candidate, index, all) => all.indexOf(candidate) === index && existsSync(candidate));
}

function normalizeCommand(command) {
  if (command === "node") return realpathSync(process.execPath);
  if (command === "python" || command === "python3") return realpathSync("/usr/bin/python3");
  if (!path.isAbsolute(command) || !existsSync(command)) return null;
  return realpathSync(command);
}

function normalizedArgument(argument) {
  if (path.isAbsolute(argument) && existsSync(argument)) return realpathSync(argument);
  return argument;
}

function matchingRegistration(surface, registration) {
  if (!isRecord(registration) || registration.surface !== surface.name) return false;
  const command = normalizeCommand(registration.command);
  const expectedCommand = normalizeCommand(surface.command);
  if (command === null || expectedCommand === null || command !== expectedCommand) return false;
  if (!Array.isArray(registration.args) || registration.args.some((argument) => typeof argument !== "string")) return false;
  if (JSON.stringify(registration.args.map(normalizedArgument)) !== JSON.stringify(surface.args.map(normalizedArgument))) return false;
  if (typeof registration.cwd !== "string" || !path.isAbsolute(registration.cwd) || !existsSync(registration.cwd)) return false;
  if (realpathSync(registration.cwd) !== realpathSync(surface.cwd)) return false;
  if (!isRecord(registration.env)) return false;
  if (Object.entries(registration.env).some(([name, value]) =>
    !ENV_NAME.test(name) || !surface.envAllowlist.includes(name) || typeof value !== "string")) return false;
  return true;
}

function validateStoredCatalog(candidate, source) {
  if (!isRecord(candidate) || candidate.schemaVersion !== SCHEMA_VERSION || !Array.isArray(candidate.registrations)) {
    throw new Error(`Las catalogue is invalid: ${source}`);
  }
  if (Object.keys(candidate).some((key) => key !== "schemaVersion" && key !== "registrations")) {
    throw new Error(`Las catalogue has unsupported fields: ${source}`);
  }
  const seen = new Set();
  for (const registration of candidate.registrations) {
    if (!isRecord(registration)
      || Object.keys(registration).some((key) => !["surface", "sourcePath", "sourceKey", "command", "args", "cwd", "env", "fingerprint"].includes(key))
      || typeof registration.surface !== "string"
      || typeof registration.sourcePath !== "string"
      || typeof registration.sourceKey !== "string"
      || typeof registration.fingerprint !== "string"
      || seen.has(registration.surface)) {
      throw new Error(`Las catalogue contains an invalid or duplicate registration: ${source}`);
    }
    seen.add(registration.surface);
  }
  return candidate;
}

function loadCatalog() {
  const target = catalogPath();
  if (cachedCatalogPath === target && cachedCatalog !== undefined) return cachedCatalog;
  cachedCatalog = undefined;
  cachedCatalogPath = target;
  if (!existsSync(target)) {
    cachedCatalog = null;
    return cachedCatalog;
  }
  const metadata = lstatSync(target);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_CONFIG_BYTES) {
    throw new Error(`Las catalogue must be a regular file of at most 4 MiB: ${target}`);
  }
  let candidate;
  try {
    candidate = JSON.parse(readFileSync(target, "utf8"));
  } catch {
    throw new Error(`Las catalogue is not valid JSON: ${target}`);
  }
  cachedCatalog = validateStoredCatalog(candidate, target);
  return cachedCatalog;
}

function fingerprint(registration) {
  return createHash("sha256").update(JSON.stringify({
    surface: registration.surface,
    command: registration.command,
    args: registration.args,
    cwd: registration.cwd,
    env: registration.env,
  })).digest("hex");
}

function writeCatalog(catalog) {
  const target = catalogPath();
  const directory = path.dirname(target);
  if (existsSync(directory)) {
    const metadata = lstatSync(directory);
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || realpathSync(directory) !== path.resolve(directory)) {
      throw new Error(`Las catalogue directory must be a real directory: ${directory}`);
    }
  } else {
    mkdirSync(directory, { recursive: true, mode: OWNER_ONLY_DIRECTORY });
  }
  if (existsSync(target)) {
    const metadata = lstatSync(target);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`Las catalogue must be a regular file: ${target}`);
    }
  }
  chmodSync(directory, OWNER_ONLY_DIRECTORY);
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(catalog, null, JSON_INDENT)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: OWNER_ONLY_FILE,
    });
    renameSync(temporary, target);
    chmodSync(target, OWNER_ONLY_FILE);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  cachedCatalog = catalog;
  cachedCatalogPath = target;
}

/** One configuration file, read with this module's own vocabulary. */
function parseSource(sourcePath, surfacesByName) {
  return readSource(sourcePath, surfacesByName, {
    maxConfigBytes: MAX_CONFIG_BYTES,
    topLevelFields: TOP_LEVEL_FIELDS,
    entryFields: ENTRY_FIELDS,
    envName: ENV_NAME,
    isRecord,
    matchingRegistration,
    fingerprint,
  });
}

/**
 * Import standard local MCP `mcpServers` or VS Code `servers` entries into
 * Las's durable catalogue. Every source is parsed and matched against the
 * canonical signed surface before one atomic write; environment values are
 * retained but never returned.
 */
export function adoptMcpConfigurations(surfaces, { sources = [], replace = false } = {}) {
  const selected = sources.length ? sources.map((source) => path.resolve(source)) : defaultSources();
  const result = {
    status: "rejected",
    catalogPath: catalogPath(),
    sources: selected,
    imported: [],
    unchanged: [],
    conflicting: [],
    rejected: [],
  };
  if (!selected.length) {
    result.rejected.push({ reason: "no MCP configuration was discovered; pass a JSON file containing mcpServers" });
    return result;
  }
  const surfacesByName = new Map(surfaces.map((surface) => [surface.name, surface]));
  const incoming = new Map();
  for (const source of selected) {
    const parsed = parseSource(source, surfacesByName);
    result.rejected.push(...parsed.rejected);
    for (const registration of parsed.registrations) {
      const earlier = incoming.get(registration.surface);
      if (earlier && earlier.fingerprint !== registration.fingerprint) {
        result.conflicting.push({
          surface: registration.surface,
          sources: [earlier.sourcePath, registration.sourcePath],
          reason: "the same surface has different configurations in the selected sources",
        });
      } else if (!earlier) {
        incoming.set(registration.surface, registration);
      }
    }
  }
  if (result.rejected.length || result.conflicting.length || !incoming.size) {
    result.status = result.conflicting.length ? "conflicting" : "rejected";
    return result;
  }

  let existing;
  try {
    existing = loadCatalog() || { schemaVersion: SCHEMA_VERSION, registrations: [] };
  } catch (error) {
    result.rejected.push({ reason: error instanceof Error ? error.message : String(error) });
    return result;
  }
  for (const registration of existing.registrations) {
    const surface = surfacesByName.get(registration.surface);
    if (!surface || !matchingRegistration(surface, registration)
      || registration.fingerprint !== fingerprint(registration)) {
      result.rejected.push({
        surface: registration.surface,
        reason: "the durable catalogue contains a registration that no longer matches a canonical signed surface",
      });
    }
  }
  if (result.rejected.length) {
    return result;
  }
  const registrations = new Map(existing.registrations.map((registration) => [registration.surface, registration]));
  for (const [surface, registration] of incoming) {
    const current = registrations.get(surface);
    if (current && current.fingerprint === registration.fingerprint) {
      result.unchanged.push({ surface, source: current.sourcePath, entry: current.sourceKey });
      continue;
    }
    if (current && !replace) {
      result.conflicting.push({
        surface,
        sources: [current.sourcePath, registration.sourcePath],
        reason: "the durable catalogue already has a different registration; preserve it or pass --replace",
      });
      continue;
    }
    registrations.set(surface, registration);
    result.imported.push({ surface, source: registration.sourcePath, entry: registration.sourceKey, action: current ? "updated" : "created" });
  }
  if (result.conflicting.length) {
    result.imported = [];
    result.status = "conflicting";
    return result;
  }
  if (result.imported.length) {
    try {
      writeCatalog({
        schemaVersion: SCHEMA_VERSION,
        registrations: [...registrations.values()].sort((left, right) => left.surface.localeCompare(right.surface)),
      });
    } catch (error) {
      result.imported = [];
      result.rejected.push({ reason: error instanceof Error ? error.message : String(error) });
      return result;
    }
    result.status = "imported";
  } else {
    result.status = "unchanged";
  }
  return result;
}

export function catalogRegistration(surface) {
  const catalog = loadCatalog();
  if (catalog === null) return { managed: false, valid: true, registration: null };
  const registration = catalog.registrations.find((candidate) => candidate.surface === surface.name) || null;
  return { managed: true, valid: registration !== null && matchingRegistration(surface, registration), registration };
}

export function catalogEnvironment(surface) {
  const state = catalogRegistration(surface);
  return state.valid && state.registration ? { ...state.registration.env } : {};
}
