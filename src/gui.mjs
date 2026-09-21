import { randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { adoptMcpConfigurations, catalogPath, catalogRegistration } from "./catalog.mjs";
import { recordCatalogueAdopted } from "./onboarding.mjs";
import { SURFACES, activeSurfaces, surfaceConfigured } from "./registry.mjs";

const LOOPBACK_HOST = "127.0.0.1";
// One adoption request carries at most 8 MiB and names at most 32 source files; a file name is
// at most 256 characters and is stored under a 120-character base; a path is at most 4096.
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_SOURCES = 32;
const MAX_UPLOAD_NAME_CHARS = 256;
const STORED_NAME_CHARS = 120;
const MAX_PATH_CHARS = 4096;
const UPLOAD_INDEX_DIGITS = 2;
// Import storage is owner-only; the session token is 32 random bytes; the largest TCP port.
const OWNER_ONLY_DIRECTORY = 0o700;
const OWNER_ONLY_FILE = 0o600;
const SESSION_TOKEN_BYTES = 32;
const MAX_PORT = 65535;
// The statuses the GUI answers with.
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_LENGTH_REQUIRED = 411;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_UNSUPPORTED_MEDIA_TYPE = 415;
const HTTP_MISDIRECTED_REQUEST = 421;
const GUI_ASSETS = new Map([
  ["/", ["./gui/index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["./gui/app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["./gui/styles.css", "text/css; charset=utf-8"]],
  ["/styles/base.css", ["./gui/styles/base.css", "text/css; charset=utf-8"]],
  ["/styles/workspace.css", ["./gui/styles/workspace.css", "text/css; charset=utf-8"]],
  ["/styles/results.css", ["./gui/styles/results.css", "text/css; charset=utf-8"]],
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function securityHeaders(contentType) {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Type": contentType,
  };
}

function send(response, status, contentType, body) {
  response.writeHead(status, securityHeaders(contentType));
  response.end(body);
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value).replaceAll("<", "\\u003c");
  send(response, status, "application/json; charset=utf-8", body);
}

function catalogSnapshot() {
  const active = new Set(activeSurfaces());
  return {
    path: catalogPath(),
    surfaces: SURFACES.map((surface) => {
      const state = catalogRegistration(surface);
      return {
        surface: surface.name,
        summary: surface.summary,
        registration: !state.managed ? "compiled-default" : state.valid ? "adopted" : "absent",
        ...(state.registration ? {
          source: state.registration.sourcePath,
          sourceEntry: state.registration.sourceKey,
        } : {}),
        configured: surfaceConfigured(surface),
        active: active.has(surface),
      };
    }),
  };
}
function catalogReadback() {
  try {
    return { catalog: catalogSnapshot(), catalogError: null };
  } catch (error) {
    return {
      catalog: null,
      catalogError: error instanceof Error ? error.message : String(error),
    };
  }
}


function readRequestJson(request) {
  const declared = request.headers["content-length"];
  if (typeof declared !== "string" || !/^\d+$/.test(declared)) {
    throw Object.assign(new Error("Content-Length is required"), { status: HTTP_LENGTH_REQUIRED });
  }
  if (Number(declared) > MAX_REQUEST_BYTES) {
    throw Object.assign(new Error("request exceeds 8 MiB"), { status: HTTP_PAYLOAD_TOO_LARGE });
  }
  if (request.headers["content-type"]?.split(";", 1)[0].trim() !== "application/json") {
    throw Object.assign(new Error("Content-Type must be application/json"), { status: HTTP_UNSUPPORTED_MEDIA_TYPE });
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(Object.assign(new Error("request exceeds 8 MiB"), { status: HTTP_PAYLOAD_TOO_LARGE }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("request body is not valid JSON"), { status: HTTP_BAD_REQUEST }));
      }
    });
    request.on("error", reject);
  });
}

function guiImportDirectory(sessionId) {
  const root = path.join(process.env.XDG_STATE_HOME || path.join(homedir(), ".local", "state"), "las", "gui-imports");
  const directory = path.join(root, sessionId);
  mkdirSync(directory, { recursive: true, mode: OWNER_ONLY_DIRECTORY });
  for (const candidate of [root, directory]) {
    const metadata = lstatSync(candidate);
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || realpathSync(candidate) !== path.resolve(candidate)) {
      throw new Error(`GUI import storage must be a real directory: ${candidate}`);
    }
    chmodSync(candidate, OWNER_ONLY_DIRECTORY);
  }
  return directory;
}

function stageUploads(uploads, sessionId) {
  if (!uploads.length) return [];
  for (const [index, upload] of uploads.entries()) {
    if (!isRecord(upload) || Object.keys(upload).some((key) => key !== "name" && key !== "content")
      || typeof upload.name !== "string" || upload.name.length === 0 || upload.name.length > MAX_UPLOAD_NAME_CHARS
      || typeof upload.content !== "string") {
      throw new Error(`upload ${index + 1} must contain only a file name and text content`);
    }
  }
  const directory = guiImportDirectory(sessionId);
  return uploads.map((upload, index) => {
    const base = path.basename(upload.name).replaceAll(/[^A-Za-z0-9._-]/g, "_").slice(0, STORED_NAME_CHARS) || "mcp.json";
    const target = path.join(directory, `${String(index + 1).padStart(UPLOAD_INDEX_DIGITS, "0")}-${randomUUID()}-${base}`);
    writeFileSync(target, upload.content, { encoding: "utf8", flag: "wx", mode: OWNER_ONLY_FILE });
    return target;
  });
}

function adoptionSources(body, sessionId) {
  if (!isRecord(body) || Object.keys(body).some((key) => !["mode", "paths", "uploads", "replace"].includes(key))) {
    throw new Error("request must contain only mode, paths, uploads, and replace");
  }
  if (!["discover", "paths", "uploads"].includes(body.mode)) throw new Error("mode must be discover, paths, or uploads");
  if (typeof body.replace !== "boolean") throw new Error("replace must be boolean");
  if (!Array.isArray(body.paths) || !Array.isArray(body.uploads)) throw new Error("paths and uploads must be arrays");
  if (body.paths.length + body.uploads.length > MAX_SOURCES) throw new Error(`at most ${MAX_SOURCES} source files may be selected`);
  if (body.paths.some((source) => typeof source !== "string" || source.length === 0 || source.length > MAX_PATH_CHARS)) {
    throw new Error(`every source path must be a non-empty path of at most ${MAX_PATH_CHARS} characters`);
  }
  if (body.mode === "discover") {
    if (body.paths.length || body.uploads.length) throw new Error("discovery mode does not accept explicit sources");
    return [];
  }
  if (body.mode === "paths") {
    if (!body.paths.length || body.uploads.length) throw new Error("path mode requires at least one path and no uploads");
    return body.paths;
  }
  if (!body.uploads.length || body.paths.length) throw new Error("upload mode requires at least one upload and no paths");
  return stageUploads(body.uploads, sessionId);
}

function authorized(request, authority, origin, token, mutation) {
  if (request.headers.host !== authority) return "Host does not match this Las GUI session";
  if (request.headers.authorization !== `Bearer ${token}`) return "session token is missing or invalid";
  if (mutation && request.headers.origin !== origin) return "Origin does not match this Las GUI session";
  return null;
}

export async function startLasGui({ port = 0 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    throw new Error(`GUI port must be an integer from 0 through ${MAX_PORT}`);
  }
  const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  const sessionId = randomUUID();
  let authority;
  let origin;

  const server = createServer((request, response) => {
    void (async () => {
      if (!authority || request.headers.host !== authority) {
        sendJson(response, HTTP_MISDIRECTED_REQUEST, { error: "Host does not match this Las GUI session" });
        return;
      }
      const url = new URL(request.url || "/", origin);
      if (url.origin !== origin) {
        sendJson(response, HTTP_MISDIRECTED_REQUEST, { error: "Request target does not match this Las GUI session" });
        return;
      }
      if (request.method === "GET" && GUI_ASSETS.has(url.pathname)) {
        const [asset, contentType] = GUI_ASSETS.get(url.pathname);
        send(response, HTTP_OK, contentType, readFileSync(new URL(asset, import.meta.url)));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/catalog") {
        const refusal = authorized(request, authority, origin, token, false);
        if (refusal) {
          sendJson(response, HTTP_FORBIDDEN, { error: refusal });
          return;
        }
        const readback = catalogReadback();
        sendJson(response, readback.catalog ? HTTP_OK : HTTP_CONFLICT, readback);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/adopt") {
        const refusal = authorized(request, authority, origin, token, true);
        if (refusal) {
          sendJson(response, HTTP_FORBIDDEN, { error: refusal });
          return;
        }
        const body = await readRequestJson(request);
        const sources = adoptionSources(body, sessionId);
        const result = adoptMcpConfigurations(SURFACES, { sources, replace: body.replace });
        if (result.status === "imported" || result.status === "unchanged") {
          await recordCatalogueAdopted({
            client: "gui",
            surfaceCount: result.imported.length + result.unchanged.length,
            catalogPath: result.catalogPath,
          });
        }
        sendJson(response, HTTP_OK, { result, ...catalogReadback() });
        return;
      }
      sendJson(response, HTTP_NOT_FOUND, { error: "route not found" });
    })().catch((error) => {
      if (response.headersSent || response.destroyed) return;
      sendJson(response, Number.isInteger(error?.status) ? error.status : HTTP_BAD_REQUEST, {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  await new Promise((resolve, reject) => {
    const failed = (error) => {
      server.off("listening", listening);
      reject(error);
    };
    const listening = () => {
      server.off("error", failed);
      resolve();
    };
    server.once("error", failed);
    server.once("listening", listening);
    server.listen(port, LOOPBACK_HOST);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("GUI server did not expose a TCP address");
  }
  authority = `${LOOPBACK_HOST}:${address.port}`;
  origin = `http://${authority}`;
  return { server, url: `${origin}/?token=${encodeURIComponent(token)}` };
}
