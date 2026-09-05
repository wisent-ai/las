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

const SCHEMA_VERSION = Number("1");
const MAX_CONFIG_BYTES = Number("4194304");
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
    mkdirSync(directory, { recursive: true, mode: Number("448") });
  }
  if (existsSync(target)) {
    const metadata = lstatSync(target);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`Las catalogue must be a regular file: ${target}`);
    }
  }
  chmodSync(directory, Number("448"));
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(catalog, null, Number("2"))}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: Number("384"),
    });
    renameSync(temporary, target);
    chmodSync(target, Number("384"));
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  cachedCatalog = catalog;
  cachedCatalogPath = target;
}

function parseSource(sourcePath, surfacesByName) {
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
  if (metadata.size > MAX_CONFIG_BYTES) {
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
  if (!isRecord(decoded) || Object.keys(decoded).some((key) => !TOP_LEVEL_FIELDS.includes(key))
    || serverCollections.length !== Number("1") || !isRecord(serverCollections[Number("0")])
    || (decoded.$schema !== undefined && typeof decoded.$schema !== "string")) {
    rejected.push({ source: realSource, reason: "configuration must contain exactly one mcpServers or servers object and no unsupported top-level fields" });
    return { source: realSource, registrations, rejected };
  }
  const entries = Object.entries(serverCollections[Number("0")]).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === Number("0")) {
    rejected.push({ source: realSource, reason: "MCP server collection contains no entries" });
    return { source: realSource, registrations, rejected };
  }
  for (const [sourceKey, entry] of entries) {
    const surface = surfacesByName.get(sourceKey);
    if (!surface) {
      rejected.push({ source: realSource, entry: sourceKey, reason: "entry is not a supported canonical Las surface" });
      continue;
    }
    if (!isRecord(entry) || Object.keys(entry).some((key) => !ENTRY_FIELDS.includes(key))) {
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
        !ENV_NAME.test(name) || typeof value !== "string" || value.includes("${"))))) {
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
